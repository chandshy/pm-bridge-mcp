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

  it("output format has the expected fields", () => {
    const enc = CredentialEncryption.encrypt("test");
    expect(enc.algorithm).toBe("aes-256-gcm");
    expect(enc.version).toBe(1);
    expect(typeof enc.iv).toBe("string");
    expect(typeof enc.encryptedData).toBe("string");
    expect(typeof enc.authTag).toBe("string");
  });

  it("throws on unsupported version", () => {
    const enc = { ...CredentialEncryption.encrypt("test"), version: 2 };
    expect(() => CredentialEncryption.decrypt(enc)).toThrow("Unsupported encryption version: 2");
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
});
