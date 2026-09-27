import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGithubSignature } from "./githubSignature.js";

const secret = "test-webhook-secret";
const body = Buffer.from(JSON.stringify({ ref: "refs/heads/main", after: "abc123" }));

function sign(payload: Buffer, withSecret: string): string {
  return `sha256=${createHmac("sha256", withSecret).update(payload).digest("hex")}`;
}

describe("verifyGithubSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyGithubSignature(body, secret, sign(body, secret))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const validSig = sign(body, secret);
    const tampered = Buffer.from(JSON.stringify({ ref: "refs/heads/main", after: "malicious" }));
    expect(verifyGithubSignature(tampered, secret, validSig)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyGithubSignature(body, secret, sign(body, "wrong-secret"))).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyGithubSignature(body, secret, undefined)).toBe(false);
  });

  it("rejects a malformed header without the sha256= prefix", () => {
    expect(verifyGithubSignature(body, secret, "not-a-real-signature")).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(verifyGithubSignature(body, secret, "sha256=abcd")).toBe(false);
  });
});
