import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies GitHub's X-Hub-Signature-256 header against the raw request body.
 * Pure and side-effect free so it's testable without spinning up Express.
 */
export function verifyGithubSignature(rawBody: Buffer, secret: string, header: string | undefined): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(expectedHex, "utf8");
  const provided = Buffer.from(header.slice("sha256=".length), "utf8");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
