import "dotenv/config";
import { Queue, Worker } from "bullmq";
import {
  BUILD_QUEUE_NAME,
  CLEANUP_QUEUE_NAME,
  createRedisConnection,
  createLogger,
  type BuildJobData,
  type TeardownProjectJobData,
} from "@launchpad/shared";
import { runDeployment } from "./pipeline/runDeployment.js";
import { sweepStalePreviews, teardownProject } from "./pipeline/cleanup.js";

const log = createLogger("worker");
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);
const cleanupIntervalMs = Number(process.env.CLEANUP_INTERVAL_MS ?? 60 * 60 * 1000);

const worker = new Worker<BuildJobData>(
  BUILD_QUEUE_NAME,
  async (job) => {
    log.info("processing job", { jobId: job.id, deploymentId: job.data.deploymentId });
    await runDeployment(job.data);
  },
  { connection: createRedisConnection(), concurrency },
);

worker.on("completed", (job) => log.info("job completed", { jobId: job.id }));
worker.on("failed", (job, err) => log.error("job failed", { jobId: job?.id, error: err.message }));

// Its own queue so the periodic sweep never competes with deploys for worker slots.
// Also carries one-off "teardown-project" jobs the api enqueues on project deletion —
// same queue, dispatched by job name, since both are background resource cleanup.
const cleanupWorker = new Worker<TeardownProjectJobData>(
  CLEANUP_QUEUE_NAME,
  async (job) => {
    if (job.name === "teardown-project") {
      await teardownProject(job.data.slug);
      return;
    }
    await sweepStalePreviews();
  },
  { connection: createRedisConnection(), concurrency: 1 },
);

cleanupWorker.on("failed", (job, err) => log.error("cleanup sweep failed", { jobId: job?.id, error: err.message }));

// BullMQ keys repeatable jobs on their schedule, so re-registering on every boot is
// idempotent — no guard needed for restarts or a second worker replica.
const cleanupQueue = new Queue(CLEANUP_QUEUE_NAME, { connection: createRedisConnection() });
await cleanupQueue.add("sweep", {}, { repeat: { every: cleanupIntervalMs } });

log.info(`worker listening, concurrency=${concurrency}, cleanup every ${cleanupIntervalMs}ms`);
