import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "./crypto.js";

const key = randomBytes(32);

describe("crypto", () => {
  it("round-trips plaintext", () => {
    const secret = "super-secret-webhook-value";
    const encrypted = encrypt(secret, key);
    expect(decrypt(encrypted, key)).toBe(secret);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const a = encrypt("same-value", key);
    const b = encrypt("same-value", key);
    expect(a).not.toBe(b);
  });

  it("rejects a wrong key", () => {
    const encrypted = encrypt("secret", key);
    const wrongKey = randomBytes(32);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encrypt("secret", key);
    const raw = Buffer.from(encrypted, "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    const tampered = raw.toString("base64");
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it("rejects a too-short ciphertext", () => {
    expect(() => decrypt(Buffer.from("short").toString("base64"), key)).toThrow();
  });
});
