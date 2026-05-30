import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { hostname, platform, homedir } from "os";
import { existsSync, readFileSync, writeFileSync, statSync, chmodSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";

export interface EncryptedCredential {
  algorithm: "aes-256-gcm";
  version: number;
  /** Random 16-byte IV, base64-encoded. Fresh per encryption call. */
  iv: string;
  /** AES-256-GCM ciphertext, base64-encoded. */
  encryptedData: string;
  /** GCM authentication tag, base64-encoded. Prevents tampering. */
  authTag: string;
  /**
   * Per-blob random 16-byte salt for scrypt-based key derivation.
   * Present from v3 onwards (CRED-003 fix). v1/v2 blobs derive the key
   * deterministically from host material with no per-file salt — readable
   * for back-compat but never written.
   */
  salt?: string;
}

/**
 * Resolve a per-system secret used as additional key material in v2 blobs.
 *
 * Priority:
 *   1. /etc/machine-id (Linux/systemd; sometimes present on other Unixes)
 *   2. /var/lib/dbus/machine-id (legacy Linux)
 *   3. macOS: IOPlatformUUID via ioreg
 *   4. Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid via reg.exe
 *   5. Persisted fallback at ~/.mailpouch-machine-id (32 random bytes, hex,
 *      mode 0600 — generated lazily on first call)
 *
 * Cached for the process lifetime. The v1 key derivation did not mix any
 * per-system secret in, which left identical encrypted credentials
 * decryptable on any machine sharing the same hostname + platform — most
 * acutely on VM/container clones. v2 closes this by deriving from
 * machine-id || hostname || platform || salt.
 */
let _machineSecretCache: string | null = null;
export function getMachineSecret(): string {
  if (_machineSecretCache !== null) return _machineSecretCache;
  const v = resolveMachineSecret();
  _machineSecretCache = v;
  return v;
}

/** Test hook — clears the cache so tests can probe each resolution path. */
export function _resetMachineSecretCacheForTests(): void {
  _machineSecretCache = null;
}

/**
 * Force a credential file back to owner-only (0o600) if its mode has drifted
 * wider. `writeFileSync({mode})` only sets permissions at creation time and is
 * masked by umask, so an existing or restored file can be group/world-readable.
 * No-op on platforms without POSIX modes (the `& 0o077` check is a cheap guard)
 * and best-effort — a chmod failure must not break credential resolution.
 * CRED-007.
 */
function reassertOwnerOnly(path: string): void {
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode & 0o077) chmodSync(path, 0o600);
  } catch { /* file vanished or chmod unsupported — best effort */ }
}

function resolveMachineSecret(): string {
  // Explicit override — useful in tests, containers, or ops scenarios where
  // the OS sources are not available and the persisted fallback file should
  // be supplied via environment instead.
  if (process.env.MAILPOUCH_MACHINE_SECRET) {
    const v = process.env.MAILPOUCH_MACHINE_SECRET.trim();
    if (v.length >= 16) return v;
  }
  // 1. Linux / systemd
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      if (existsSync(p)) {
        const v = readFileSync(p, "utf-8").trim();
        if (v.length >= 16) return v;
      }
    } catch { /* unreadable — try next */ }
  }
  // 2. macOS
  if (platform() === "darwin") {
    try {
      const r = spawnSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf-8", timeout: 5_000 });
      if (r.status === 0 && r.stdout) {
        const m = r.stdout.match(/"IOPlatformUUID"\s*=\s*"([0-9A-F-]+)"/i);
        if (m && m[1].length >= 16) return m[1];
      }
    } catch { /* fall through */ }
  }
  // 3. Windows
  if (platform() === "win32") {
    try {
      const r = spawnSync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { encoding: "utf-8", timeout: 5_000 },
      );
      if (r.status === 0 && r.stdout) {
        const m = r.stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
        if (m && m[1].length >= 16) return m[1];
      }
    } catch { /* fall through */ }
  }
  // 4. Persisted fallback at ~/.mailpouch-machine-id
  try {
    const path = join(homedir(), ".mailpouch-machine-id");
    if (existsSync(path)) {
      // CRED-007: the `mode` arg to writeFileSync only applies at creation and
      // is masked by umask; an existing file may have been left group/world-
      // readable (e.g. a restored backup or a prior umask). Re-assert 0o600
      // before trusting it, mirroring the logger's chmod-on-detect pattern.
      reassertOwnerOnly(path);
      const v = readFileSync(path, "utf-8").trim();
      if (v.length >= 32) return v;
    }
    const fresh = randomBytes(32).toString("hex");
    writeFileSync(path, fresh, { encoding: "utf-8", mode: 0o600 });
    reassertOwnerOnly(path); // umask may have widened the creation mode
    return fresh;
  } catch {
    // Last-ditch — if we can't write the file (read-only home?), use a
    // deterministic synthetic value derived from hostname so behavior at
    // least stays consistent within the process; this matches v1's
    // weaker-than-ideal guarantee rather than breaking the install.
    return `nomachineid:${hostname()}`;
  }
}

/** AES-256-GCM produces a 16-byte authentication tag. We require the full
 *  length on decrypt — anything shorter is a truncated/forged tag. CRED-006. */
const GCM_TAG_BYTES = 16;

export class CredentialEncryption {
  private static readonly APP_SALT = "/mailpouch/credential-encryption/v1";
  /** Always write the current version. Older versions remain readable. */
  static readonly CURRENT_VERSION = 3;
  /** scrypt cost params — N=2^14 keeps key derivation under ~50ms on 2020+
   *  hardware while raising the per-blob attack cost from a single SHA-256
   *  to ~16k rounds + 16MB memory. */
  private static readonly SCRYPT_N = 1 << 14;
  private static readonly SCRYPT_r = 8;
  private static readonly SCRYPT_p = 1;
  private static readonly SCRYPT_MAXMEM = 64 * 1024 * 1024;

  /**
   * Derive a 32-byte AES key for the given blob version.
   * v1: sha256(hostname || salt || platform)                — legacy, portable across clones
   * v2: sha256(machine-id || hostname || salt || platform)  — per-system, blocks clone re-decrypt
   * v3: scrypt(machine-id || hostname || platform, perBlobSalt, N=16384, r=8, p=1, 32 bytes)
   *     — per-blob salt + memory-hard KDF. Resists pre-computation and
   *       cheap brute-force against the (low-entropy) host material.
   *     — Closes CRED-003 from the 2026-05-28 audit. v1/v2 stay readable
   *       so existing blobs continue to decrypt; the next `encrypt()` call
   *       upgrades them to v3.
   */
  private static deriveKey(version: number, salt?: Buffer): Buffer {
    if (version === 1) {
      const material = `${hostname()}|${CredentialEncryption.APP_SALT}|${platform()}`;
      return createHash("sha256").update(material, "utf8").digest();
    }
    if (version === 2) {
      const material = `${getMachineSecret()}|${hostname()}|${CredentialEncryption.APP_SALT}|${platform()}`;
      return createHash("sha256").update(material, "utf8").digest();
    }
    if (version === 3) {
      if (!salt || salt.length < 16) {
        throw new Error("v3 credential decrypt requires a 16-byte salt");
      }
      const material = `${getMachineSecret()}|${hostname()}|${platform()}`;
      return scryptSync(material, salt, 32, {
        N: CredentialEncryption.SCRYPT_N,
        r: CredentialEncryption.SCRYPT_r,
        p: CredentialEncryption.SCRYPT_p,
        maxmem: CredentialEncryption.SCRYPT_MAXMEM,
      });
    }
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  static encrypt(plaintext: string): EncryptedCredential {
    const version = CredentialEncryption.CURRENT_VERSION;
    const salt = randomBytes(16);
    const key = CredentialEncryption.deriveKey(version, salt);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    let encryptedData = cipher.update(plaintext, "utf8", "base64");
    encryptedData += cipher.final("base64");
    const authTag = cipher.getAuthTag();
    return {
      algorithm: "aes-256-gcm",
      version,
      iv: iv.toString("base64"),
      encryptedData,
      authTag: authTag.toString("base64"),
      salt: salt.toString("base64"),
    };
  }

  static decrypt(encrypted: EncryptedCredential): string {
    const saltBuf = encrypted.salt ? Buffer.from(encrypted.salt, "base64") : undefined;
    const key = CredentialEncryption.deriveKey(encrypted.version, saltBuf);
    const iv = Buffer.from(encrypted.iv, "base64");
    const authTag = Buffer.from(encrypted.authTag, "base64");
    // CRED-006: reject a short/truncated GCM tag before handing it to
    // setAuthTag. Node accepts any 4-16 byte tag (with a deprecation warning
    // below 12 bytes); a 4-byte tag has only 2^32 forgery margin. Require the
    // full 16-byte tag so a tampered blob carrying a truncated tag is rejected
    // rather than silently downgrading the GCM integrity guarantee.
    if (authTag.length !== GCM_TAG_BYTES) {
      throw new Error(`Invalid GCM auth tag length: expected ${GCM_TAG_BYTES} bytes, got ${authTag.length}`);
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(encrypted.encryptedData, "base64", "utf8");
    plaintext += decipher.final("utf8");
    return plaintext;
  }

  static isValidEncrypted(obj: unknown): obj is EncryptedCredential {
    if (!obj || typeof obj !== "object") return false;
    const e = obj as Record<string, unknown>;
    if (
      e.algorithm !== "aes-256-gcm" ||
      typeof e.version !== "number" ||
      typeof e.iv !== "string" || (e.iv as string).length === 0 ||
      typeof e.encryptedData !== "string" ||
      typeof e.authTag !== "string" || (e.authTag as string).length === 0
    ) {
      return false;
    }
    // CRED-006: the authTag must decode to a full 16-byte GCM tag. A short
    // tag is either corruption or a deliberate truncation-forgery attempt;
    // either way it is not a blob we should hand to setAuthTag.
    if (Buffer.from(e.authTag as string, "base64").length !== GCM_TAG_BYTES) {
      return false;
    }
    // v3 mandates the per-blob salt; earlier versions never wrote one.
    if (e.version === 3 && (typeof e.salt !== "string" || (e.salt as string).length === 0)) {
      return false;
    }
    return true;
  }

  /** Is this blob written with an older format that should be re-encrypted? */
  static needsReencrypt(encrypted: EncryptedCredential): boolean {
    return encrypted.version < CredentialEncryption.CURRENT_VERSION;
  }
}
