import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/**
 * Encrypts a plaintext string, returning base64(iv || authTag || ciphertext).
 * Layout is fixed so decrypt() can slice deterministically.
 */
export function encrypt(plaintext: string, key: Buffer = loadKey()): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(encoded: string, key: Buffer = loadKey()): string {
  const raw = Buffer.from(encoded, "base64");
  if (raw.length < IV_LENGTH + 16) {
    throw new Error("Invalid ciphertext: too short");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/** Exported for callers that want to load/validate ENCRYPTION_KEY once and reuse the Buffer. */
export function loadEncryptionKey(): Buffer {
  return loadKey();
}
