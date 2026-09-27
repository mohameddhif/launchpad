import { PrismaClient } from "../generated/client/index.js";

declare global {
  // eslint-disable-next-line no-var
  var __launchpadPrisma: PrismaClient | undefined;
}

/**
 * One PrismaClient per process, reused across hot reloads in dev.
 * api and worker each import this — they never share a client instance across processes.
 */
export const prisma: PrismaClient = globalThis.__launchpadPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__launchpadPrisma = prisma;
}

export * from "../generated/client/index.js";
