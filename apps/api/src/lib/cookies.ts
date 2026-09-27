import { serialize, parse } from "cookie";
import type { Request } from "express";

export const AUTH_COOKIE_NAME = "launchpad_token";

export function authCookie(token: string): string {
  return serialize(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearAuthCookie(): string {
  return serialize(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function readAuthToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parse(header)[AUTH_COOKIE_NAME];
}

/** Same parsing logic, usable from the raw upgrade request the ws server sees. */
export function readAuthTokenFromCookieHeader(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  return parse(cookieHeader)[AUTH_COOKIE_NAME];
}
