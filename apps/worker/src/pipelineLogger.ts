import type { LogStream } from "@launchpad/shared";
import { createLogger } from "@launchpad/shared";

/**
 * What the pipeline steps actually need to report progress. DeployLogger satisfies this and
 * streams to the dashboard; background work that isn't tied to a deployment uses
 * workerLogger() instead, since deployment log rows are keyed by a per-deployment `seq` that
 * a second writer would collide with.
 */
export interface PipelineLogger {
  log(stream: LogStream, message: string): void;
  system(message: string): void;
}

export function workerLogger(scope: string): PipelineLogger {
  const log = createLogger(scope);
  return {
    log: (stream, message) => (stream === "stderr" ? log.warn(message) : log.info(message)),
    system: (message) => log.info(message),
  };
}
