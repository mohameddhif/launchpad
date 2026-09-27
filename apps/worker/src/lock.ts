import { randomUUID } from "node:crypto";
import { createRedisConnection, deployLockKey } from "@launchpad/shared";

const LOCK_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 1000;

/**
 * Redis-backed advisory lock so two deploys of the same project can never race through the
 * swap step concurrently. A queued deploy waits for the in-flight one rather than failing —
 * BullMQ concurrency lets other *projects'* jobs proceed in the meantime.
 */
export async function acquireProjectLock(projectId: string): Promise<() => Promise<void>> {
  const redis = createRedisConnection();
  const key = deployLockKey(projectId);
  const token = randomUUID();

  for (;;) {
    const acquired = await redis.set(key, token, "PX", LOCK_TTL_MS, "NX");
    if (acquired === "OK") break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return async () => {
    const releaseScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(releaseScript, 1, key, token);
    redis.disconnect();
  };
}
