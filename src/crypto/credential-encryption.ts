import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { hostname, platform, homedir } from "os";
import { existsSync, readFileSync, writeFileSync } from "fs";
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
      const v = readFileSync(path, "utf-8").trim();
      if (v.length >= 32) return v;
    }
    const fresh = randomBytes(32).toString("hex");
    writeFileSync(path, fresh, { encoding: "utf-8", mode: 0o600 });
    return fresh;
  } catch {
    // Last-ditch — if we can't write the file (read-only home?), use a
    // deterministic synthetic value derived from hostname so behavior at
    // least stays consistent within the process; this matches v1's
    // weaker-than-ideal guarantee rather than breaking the install.
    return `nomachineid:${hostname()}`;
  }
}

export class CredentialEncryption {
  private static readonly APP_SALT = "/mailpouch/credential-encryption/v1";
  /** Always write the current version. Older versions remain readable. */
  static readonly CURRENT_VERSION = 2;

  /**
   * Derive a 32-byte AES key for the given blob version.
   * v1: hostname || salt || platform                (legacy, portable across clones)
   * v2: machine-id || hostname || salt || platform  (per-system, blocks clone re-decrypt)
   */
  private static deriveKey(version: number): Buffer {
    let material: string;
    if (version === 1) {
      material = `${hostname()}|${CredentialEncryption.APP_SALT}|${platform()}`;
    } else if (version === 2) {
      material = `${getMachineSecret()}|${hostname()}|${CredentialEncryption.APP_SALT}|${platform()}`;
    } else {
      throw new Error(`Unsupported encryption version: ${version}`);
    }
    return createHash("sha256").update(material, "utf8").digest();
  }

  static encrypt(plaintext: string): EncryptedCredential {
    const version = CredentialEncryption.CURRENT_VERSION;
    const key = CredentialEncryption.deriveKey(version);
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
    };
  }

  static decrypt(encrypted: EncryptedCredential): string {
    const key = CredentialEncryption.deriveKey(encrypted.version);
    const iv = Buffer.from(encrypted.iv, "base64");
    const authTag = Buffer.from(encrypted.authTag, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(encrypted.encryptedData, "base64", "utf8");
    plaintext += decipher.final("utf8");
    return plaintext;
  }

  static isValidEncrypted(obj: unknown): obj is EncryptedCredential {
    if (!obj || typeof obj !== "object") return false;
    const e = obj as Record<string, unknown>;
    return (
      e.algorithm === "aes-256-gcm" &&
      typeof e.version === "number" &&
      typeof e.iv === "string" && e.iv.length > 0 &&
      typeof e.encryptedData === "string" &&
      typeof e.authTag === "string" && e.authTag.length > 0
    );
  }

  /** Is this blob written with an older format that should be re-encrypted? */
  static needsReencrypt(encrypted: EncryptedCredential): boolean {
    return encrypted.version < CredentialEncryption.CURRENT_VERSION;
  }
}
