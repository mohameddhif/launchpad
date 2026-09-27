import { Queue } from "bullmq";
import {
  BUILD_QUEUE_NAME,
  CLEANUP_QUEUE_NAME,
  createRedisConnection,
  type BuildJobData,
  type TeardownProjectJobData,
} from "@launchpad/shared";

export const buildQueue = new Queue<BuildJobData>(BUILD_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});

// Same queue the worker's periodic stale-preview sweep runs on — this only ever adds the
// one-off "teardown-project" job, dispatched by name on the worker side.
export const cleanupQueue = new Queue<TeardownProjectJobData>(CLEANUP_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});
