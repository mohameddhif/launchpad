import { Redis } from "ioredis";

export const BUILD_QUEUE_NAME = "builds";

/** Separate from builds so the periodic sweep never contends with real deploy concurrency. */
export const CLEANUP_QUEUE_NAME = "cleanup";

export interface BuildJobData {
  deploymentId: string;
  /** true for rollback and promote: skip clone+build, reuse the deployment's existing imageTag. */
  skipBuild?: boolean;
}

/**
 * Runs on CLEANUP_QUEUE_NAME under the job name "teardown-project". Slug travels in the job
 * because by the time the worker processes it, the Project row (and the slug on it) is
 * already gone from Postgres — DELETE /api/projects/:id removes the row before enqueuing.
 */
export interface TeardownProjectJobData {
  slug: string;
}

export type LogStream = "stdout" | "stderr" | "system";

export interface LogEvent {
  deploymentId: string;
  seq: number;
  stream: LogStream;
  message: string;
  ts: string;
}

export function logChannel(deploymentId: string): string {
  return `launchpad:logs:${deploymentId}`;
}

export const LOG_CHANNEL_PATTERN = "launchpad:logs:*";

export function deployLockKey(projectId: string): string {
  return `launchpad:lock:project:${projectId}`;
}

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return url;
}

/**
 * BullMQ requires maxRetriesPerRequest: null on connections used by a Worker/QueueEvents.
 * Every caller (Queue, Worker, pub/sub) gets its own connection — ioredis connections
 * are not safe to share between a subscriber and normal commands.
 */
export function createRedisConnection(): Redis {
  return new Redis(redisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
