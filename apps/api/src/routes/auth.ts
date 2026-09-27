import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma, loginSchema } from "@launchpad/shared";
import { signAuthToken } from "../lib/jwt.js";
import { authCookie, clearAuthCookie, readAuthToken } from "../lib/cookies.js";
import { verifyAuthToken } from "../lib/jwt.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid credentials payload" });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signAuthToken({ sub: user.id, email: user.email });
  res.setHeader("Set-Cookie", authCookie(token));
  res.json({ email: user.email });
});

authRouter.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearAuthCookie());
  res.status(204).end();
});

authRouter.get("/me", async (req, res) => {
  const token = readAuthToken(req);
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = verifyAuthToken(token);
    res.json({ email: payload.email });
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
});
