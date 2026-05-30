import { describe, it, expect } from "vitest";
import { CredentialEncryption, getMachineSecret } from "./credential-encryption.js";

describe("CredentialEncryption", () => {
  it("encrypt → decrypt round-trips correctly", () => {
    const original = "my-secret-password";
    const encrypted = CredentialEncryption.encrypt(original);
    expect(CredentialEncryption.decrypt(encrypted)).toBe(original);
  });

  it("round-trips an empty string", () => {
    const encrypted = CredentialEncryption.encrypt("");
    expect(CredentialEncryption.decrypt(encrypted)).toBe("");
  });

  it("round-trips unicode and special characters", () => {
    const original = "p@ssw0rd!🔐 \t\n";
    expect(CredentialEncryption.decrypt(CredentialEncryption.encrypt(original))).toBe(original);
  });

  it("two encryptions of the same plaintext produce different ciphertexts (random IV)", () => {
    const a = CredentialEncryption.encrypt("same");
    const b = CredentialEncryption.encrypt("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedData).not.toBe(b.encryptedData);
  });

  it("output format has the expected fields and is current version", () => {
    const enc = CredentialEncryption.encrypt("test");
    expect(enc.algorithm).toBe("aes-256-gcm");
    expect(enc.version).toBe(CredentialEncryption.CURRENT_VERSION);
    expect(typeof enc.iv).toBe("string");
    expect(typeof enc.encryptedData).toBe("string");
    expect(typeof enc.authTag).toBe("string");
  });

  it("throws on unsupported (out-of-range) version", () => {
    const enc = { ...CredentialEncryption.encrypt("test"), version: 99 };
    expect(() => CredentialEncryption.decrypt(enc)).toThrow("Unsupported encryption version: 99");
  });

  it("needsReencrypt flags v1 blobs but not current-version blobs", () => {
    const v1Blob = { ...CredentialEncryption.encrypt("anything"), version: 1 };
    expect(CredentialEncryption.needsReencrypt(v1Blob)).toBe(true);
    const current = CredentialEncryption.encrypt("anything");
    expect(CredentialEncryption.needsReencrypt(current)).toBe(false);
  });

  it("throws when auth tag is tampered (integrity check)", () => {
    const enc = CredentialEncryption.encrypt("secure");
    const tampered = { ...enc, authTag: Buffer.alloc(16).toString("base64") };
    expect(() => CredentialEncryption.decrypt(tampered)).toThrow();
  });

  it("throws when ciphertext is tampered", () => {
    const enc = CredentialEncryption.encrypt("secure");
    // Flip a bit in the encoded data
    const buf = Buffer.from(enc.encryptedData, "base64");
    buf[0] ^= 0xff;
    const tampered = { ...enc, encryptedData: buf.toString("base64") };
    expect(() => CredentialEncryption.decrypt(tampered)).toThrow();
  });

  it("throws when IV is wrong (decryption produces garbage that fails auth)", () => {
    const enc = CredentialEncryption.encrypt("secure");
    const wrongIv = { ...enc, iv: Buffer.alloc(16).toString("base64") };
    expect(() => CredentialEncryption.decrypt(wrongIv)).toThrow();
  });

  it("isValidEncrypted accepts a well-formed blob", () => {
    expect(CredentialEncryption.isValidEncrypted(CredentialEncryption.encrypt("x"))).toBe(true);
  });

  it("isValidEncrypted rejects null, strings, and missing fields", () => {
    expect(CredentialEncryption.isValidEncrypted(null)).toBe(false);
    expect(CredentialEncryption.isValidEncrypted("not-an-object")).toBe(false);
    expect(CredentialEncryption.isValidEncrypted({})).toBe(false);
    expect(CredentialEncryption.isValidEncrypted({ algorithm: "aes-256-gcm" })).toBe(false);
    expect(CredentialEncryption.isValidEncrypted(undefined)).toBe(false);
  });

  it("round-trips a large credential (>1 KB)", () => {
    const large = "x".repeat(1024 * 10);
    expect(CredentialEncryption.decrypt(CredentialEncryption.encrypt(large))).toBe(large);
  });

  it("can decrypt v1 blobs produced before per-system entropy was mixed in", () => {
    // Construct a v1 blob by hand using the documented v1 derivation.
    // This test guards the transparent-migration path: existing installs
    // ship encrypted creds on disk; if we ever break v1 decrypt the
    // operator's credentials become unrecoverable on upgrade.
    const { createCipheriv, createHash, randomBytes } = require("crypto");
    const { hostname, platform } = require("os");
    const APP_SALT = "/mailpouch/credential-encryption/v1";
    const v1Material = `${hostname()}|${APP_SALT}|${platform()}`;
    const v1Key = createHash("sha256").update(v1Material, "utf8").digest();
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", v1Key, iv);
    let encryptedData = cipher.update("legacy-secret", "utf8", "base64");
    encryptedData += cipher.final("base64");
    const authTag = cipher.getAuthTag();
    const v1Blob = {
      algorithm: "aes-256-gcm" as const,
      version: 1,
      iv: iv.toString("base64"),
      encryptedData,
      authTag: authTag.toString("base64"),
    };
    expect(CredentialEncryption.decrypt(v1Blob)).toBe("legacy-secret");
    expect(CredentialEncryption.needsReencrypt(v1Blob)).toBe(true);
  });

  // ─── CRED-003 (audit 2026-05-28): v3 scrypt-based key derivation ────────

  it("CURRENT_VERSION is 3 and encrypt() writes the new salt field", () => {
    expect(CredentialEncryption.CURRENT_VERSION).toBe(3);
    const enc = CredentialEncryption.encrypt("v3-secret");
    expect(enc.version).toBe(3);
    expect(typeof enc.salt).toBe("string");
    expect(enc.salt && enc.salt.length).toBeGreaterThan(0);
    // 16-byte salt encoded base64 = at least 22 chars, ≤ 24.
    expect(Buffer.from(enc.salt!, "base64").length).toBe(16);
  });

  it("v3 → v3 round-trip succeeds", () => {
    const enc = CredentialEncryption.encrypt("v3-round-trip");
    expect(CredentialEncryption.decrypt(enc)).toBe("v3-round-trip");
  });

  it("two v3 encryptions of the same plaintext use different salts AND different ciphertexts", () => {
    const a = CredentialEncryption.encrypt("same");
    const b = CredentialEncryption.encrypt("same");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedData).not.toBe(b.encryptedData);
  });

  it("v3 decrypt rejects a blob missing its salt (forged downgrade attempt)", () => {
    const enc = CredentialEncryption.encrypt("guarded");
    const noSalt: typeof enc = { ...enc };
    delete (noSalt as { salt?: string }).salt;
    expect(() => CredentialEncryption.decrypt(noSalt)).toThrow();
    expect(CredentialEncryption.isValidEncrypted(noSalt)).toBe(false);
  });

  it("isValidEncrypted requires salt for v3 blobs but tolerates absence for v1/v2", () => {
    const v1ish = {
      algorithm: "aes-256-gcm" as const,
      version: 1,
      iv: "a".repeat(24),
      encryptedData: "b".repeat(8),
      // CRED-006: isValidEncrypted now requires a full 16-byte GCM tag, so the
      // fixture uses a real 16-byte base64 tag rather than an arbitrary string.
      authTag: Buffer.alloc(16).toString("base64"),
    };
    expect(CredentialEncryption.isValidEncrypted(v1ish)).toBe(true);
    const v3WithoutSalt = { ...v1ish, version: 3 };
    expect(CredentialEncryption.isValidEncrypted(v3WithoutSalt)).toBe(false);
  });

  it("can still decrypt v2 blobs after the v3 cutover (transparent back-compat)", () => {
    // Construct a v2 blob via the documented v2 derivation. Mirrors the v1
    // back-compat test but for the sha256(machine||host||salt||platform) form.
    const { createCipheriv, createHash, randomBytes } = require("crypto");
    const { hostname, platform } = require("os");
    const APP_SALT = "/mailpouch/credential-encryption/v1";
    const v2Material = `${getMachineSecret()}|${hostname()}|${APP_SALT}|${platform()}`;
    const v2Key = createHash("sha256").update(v2Material, "utf8").digest();
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", v2Key, iv);
    let encryptedData = cipher.update("v2-secret", "utf8", "base64");
    encryptedData += cipher.final("base64");
    const authTag = cipher.getAuthTag();
    const v2Blob = {
      algorithm: "aes-256-gcm" as const,
      version: 2,
      iv: iv.toString("base64"),
      encryptedData,
      authTag: authTag.toString("base64"),
    };
    expect(CredentialEncryption.decrypt(v2Blob)).toBe("v2-secret");
    expect(CredentialEncryption.needsReencrypt(v2Blob)).toBe(true);
  });

  it("decrypt with the wrong salt fails authentication (proves salt binds the key)", () => {
    const enc = CredentialEncryption.encrypt("salt-matters");
    const swapped = { ...enc, salt: Buffer.alloc(16, 0xff).toString("base64") };
    expect(() => CredentialEncryption.decrypt(swapped)).toThrow();
  });

  // ─── CRED-006 (audit 2026-05-28): GCM auth-tag length validation ─────────

  it("decrypt rejects a truncated 4-byte GCM auth tag (CRED-006)", () => {
    const enc = CredentialEncryption.encrypt("tag-matters");
    // A 4-byte tag is the worst case Node's setAuthTag silently accepts.
    const shortTag = { ...enc, authTag: Buffer.alloc(4).toString("base64") };
    expect(() => CredentialEncryption.decrypt(shortTag)).toThrow(/auth tag length/i);
  });

  it("decrypt rejects an empty / garbage-length auth tag (CRED-006)", () => {
    const enc = CredentialEncryption.encrypt("guarded");
    const emptyTag = { ...enc, authTag: "" };
    expect(() => CredentialEncryption.decrypt(emptyTag)).toThrow(/auth tag length/i);
    const sevenByteTag = { ...enc, authTag: Buffer.alloc(7).toString("base64") };
    expect(() => CredentialEncryption.decrypt(sevenByteTag)).toThrow(/auth tag length/i);
  });

  it("decrypt rejects an over-length (>16-byte) auth tag (CRED-006)", () => {
    const enc = CredentialEncryption.encrypt("guarded");
    const longTag = { ...enc, authTag: Buffer.alloc(20).toString("base64") };
    expect(() => CredentialEncryption.decrypt(longTag)).toThrow(/auth tag length/i);
  });

  it("isValidEncrypted rejects a blob with a short auth tag (CRED-006)", () => {
    const enc = CredentialEncryption.encrypt("guarded");
    const shortTag = { ...enc, authTag: Buffer.alloc(4).toString("base64") };
    expect(CredentialEncryption.isValidEncrypted(shortTag)).toBe(false);
    // A full 16-byte tag still validates.
    expect(CredentialEncryption.isValidEncrypted(enc)).toBe(true);
  });
});
