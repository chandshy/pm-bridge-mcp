import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { hostname, platform } from "os";

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

export class CredentialEncryption {
  private static readonly APP_SALT = "/mailpouch/credential-encryption/v1";

  /**
   * Derive a 32-byte AES key from stable system properties.
   * Never stored — re-derived on every call.
   */
  private static deriveKey(): Buffer {
    const material = `${hostname()}|${CredentialEncryption.APP_SALT}|${platform()}`;
    return createHash("sha256").update(material, "utf8").digest();
  }

  static encrypt(plaintext: string): EncryptedCredential {
    const key = CredentialEncryption.deriveKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    let encryptedData = cipher.update(plaintext, "utf8", "base64");
    encryptedData += cipher.final("base64");
    const authTag = cipher.getAuthTag();
    return {
      algorithm: "aes-256-gcm",
      version: 1,
      iv: iv.toString("base64"),
      encryptedData,
      authTag: authTag.toString("base64"),
    };
  }

  static decrypt(encrypted: EncryptedCredential): string {
    if (encrypted.version !== 1) {
      throw new Error(`Unsupported encryption version: ${encrypted.version}`);
    }
    const key = CredentialEncryption.deriveKey();
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
}
