import { describe, it, expect } from "vitest";
import { CredentialEncryption } from "./credential-encryption.js";

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
});
