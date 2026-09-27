import express from "express";
import cors from "cors";
import { webhooksRouter } from "./routes/webhooks.js";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { deploymentsRouter } from "./routes/deployments.js";
import { requireAuth } from "./middleware/auth.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:5173",
      credentials: true,
    }),
  );

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Mounted before the global JSON parser below: this route owns its own express.raw()
  // body parser so the byte-exact payload survives for GitHub's HMAC signature check.
  app.use("/webhooks", webhooksRouter);

  app.use(express.json());

  app.use("/api/auth", authRouter);
  app.use("/api/projects", requireAuth, projectsRouter);
  app.use("/api/deployments", requireAuth, deploymentsRouter);

  return app;
}
