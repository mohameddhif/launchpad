import jwt from "jsonwebtoken";

export interface AuthTokenPayload {
  sub: string;
  email: string;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: "7d" });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, secret()) as AuthTokenPayload;
}
