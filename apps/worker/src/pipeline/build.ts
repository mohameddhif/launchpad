import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pack } from "tar-fs";
import { docker } from "../docker.js";
import type { DeployLogger } from "../deployLogger.js";
import { detectFramework } from "./detect.js";
import { LABEL_PROJECT, LABEL_DEPLOYMENT, LABEL_MANAGED } from "@launchpad/shared";

export interface BuildResult {
  imageTag: string;
}

/**
 * Packs the repo checkout as a tar stream and hands it to the Docker Engine API — the
 * daemon builds the image from the stream directly, so it never needs a filesystem path
 * the worker's own container can see.
 *
 * A Dockerfile at the repo root always wins. Without one, detect.ts generates a synthetic
 * Dockerfile into the checkout, so zero-config builds reuse this exact build path rather
 * than needing a parallel one.
 */
export async function buildImage(
  contextDir: string,
  projectSlug: string,
  commitSha: string,
  deploymentId: string,
  logger: DeployLogger,
): Promise<BuildResult> {
  const dockerfilePath = path.join(contextDir, "Dockerfile");
  if (!existsSync(dockerfilePath)) {
    const detected = await detectFramework(contextDir);
    if (!detected) {
      throw new Error(
        "No Dockerfile found at repo root and no supported framework detected " +
          "(tried: Next.js, static site build output, Node start script). " +
          "Add a Dockerfile at the repo root.",
      );
    }
    await writeFile(dockerfilePath, detected.dockerfileContents, "utf8");
    logger.system(`no Dockerfile found — detected ${detected.name}, generating one`);
  }

  const imageTag = `launchpad/${projectSlug}:${commitSha.slice(0, 7)}`;
  logger.system(`$ docker build -t ${imageTag} .`);

  const tarStream = pack(contextDir, {
    ignore: (name) => name.split(path.sep).includes(".git"),
  });

  const buildStream = await docker.buildImage(tarStream, {
    t: imageTag,
    // Labels, not name parsing, are how retention and cleanup find Launchpad's own images later.
    labels: {
      [LABEL_MANAGED]: "true",
      [LABEL_PROJECT]: projectSlug,
      [LABEL_DEPLOYMENT]: deploymentId,
    },
  });

  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      buildStream,
      (err: Error | null, res: Array<Record<string, unknown>>) => {
        if (err) return reject(err);
        const last = res.at(-1) as { error?: string; errorDetail?: { message?: string } } | undefined;
        if (last?.error) {
          reject(new Error(last.errorDetail?.message ?? last.error));
          return;
        }
        resolve();
      },
      (event: { stream?: string; status?: string; error?: string; progress?: string }) => {
        if (event.stream) {
          const line = event.stream.trimEnd();
          if (line) logger.log("stdout", line);
        } else if (event.error) {
          logger.log("stderr", event.error);
        } else if (event.status) {
          logger.log("stdout", event.progress ? `${event.status} ${event.progress}` : event.status);
        }
      },
    );
  });

  return { imageTag };
}
