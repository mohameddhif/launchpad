import http from "node:http";
import type { DeployLogger } from "../deployLogger.js";

const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;

function pingOnce(containerName: string, port: number, healthPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: containerName, port, path: healthPath, timeout: 3000 },
      (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

/**
 * Polls the new container over the shared Docker network (both worker and app sit on
 * deploy-net, so Docker's embedded DNS resolves the container name) until it responds or
 * the timeout elapses. Nothing in the swap sequence proceeds past this point until it does.
 */
export async function waitForHealthy(
  containerName: string,
  port: number,
  healthPath: string,
  logger: DeployLogger,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  logger.system(`waiting for ${containerName}:${port}${healthPath} to respond`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingOnce(containerName, port, healthPath)) {
      logger.system("health check passed");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`container did not become healthy within ${timeoutMs}ms`);
}
