import { prisma, decrypt, type BuildJobData } from "@launchpad/shared";
import { DeployLogger } from "../deployLogger.js";
import { docker } from "../docker.js";
import { cloneAtCommit } from "./clone.js";
import { buildImage } from "./build.js";
import { runContainer } from "./run.js";
import { waitForHealthy } from "./health.js";
import { updateNginxRouting } from "./proxy.js";
import { swapContainer } from "./swap.js";
import { pruneOldImages } from "./retention.js";
import { acquireProjectLock } from "../lock.js";

/**
 * The full deploy pipeline for one job: clone → build → run → health → nginx → swap.
 * Rollback and promote jobs (skipBuild: true) enter with an imageTag already set on the
 * deployment row and skip straight to run(), so the run/health/nginx/swap logic that matters
 * for correctness exists in exactly one place regardless of how the deployment was triggered.
 *
 * Production and preview deploys also share this one path — the branch and environment on
 * the deployment row are all that distinguish them, and they only change what swap.ts
 * retires and which hostnames proxy.ts hands the new container.
 *
 * The ordering from run() onward is load-bearing: nginx is only repointed once the new
 * container proves healthy, and the old container is only removed once nginx has reloaded.
 * A failed deploy at any point leaves whatever was previously live untouched.
 */
export async function runDeployment(data: BuildJobData): Promise<void> {
  const deployment = await prisma.deployment.findUniqueOrThrow({
    where: { id: data.deploymentId },
    include: { project: true },
  });
  const { project } = deployment;
  const logger = new DeployLogger(deployment.id);
  const release = await acquireProjectLock(project.id);

  try {
    await prisma.deployment.update({ where: { id: deployment.id }, data: { status: "BUILDING" } });
    logger.system(
      `deploying ${project.slug} @ ${deployment.commitSha.slice(0, 7)} ` +
        `(${deployment.branch}, ${deployment.environment.toLowerCase()})`,
    );

    let imageTag = deployment.imageTag ?? undefined;

    if (data.skipBuild && imageTag) {
      try {
        await docker.getImage(imageTag).inspect();
      } catch {
        throw new Error(`Image ${imageTag} was pruned and is no longer available — redeploy instead of rolling back`);
      }
      logger.system(`reusing image ${imageTag}, skipping clone + build`);
    } else {
      const repoToken = project.repoTokenEnc ? decrypt(project.repoTokenEnc) : null;
      const cloned = await cloneAtCommit(project.repoUrl, deployment.commitSha, repoToken, logger);
      try {
        const built = await buildImage(cloned.dir, project.slug, deployment.commitSha, deployment.id, logger);
        imageTag = built.imageTag;
      } finally {
        await cloned.cleanup();
      }
    }

    if (!imageTag) {
      throw new Error("No image available to deploy");
    }

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "DEPLOYING", imageTag },
    });

    const ran = await runContainer(
      imageTag,
      {
        projectId: project.id,
        projectSlug: project.slug,
        internalPort: project.internalPort,
        deploymentId: deployment.id,
        branch: deployment.branch,
        environment: deployment.environment,
      },
      logger,
    );
    await prisma.deployment.update({ where: { id: deployment.id }, data: { containerName: ran.containerName } });

    try {
      await waitForHealthy(ran.containerName, project.internalPort, project.healthPath, logger);
    } catch (err) {
      // The new container never came up cleanly — remove it and leave the previous
      // deployment (and nginx's routing to it) completely untouched.
      await docker
        .getContainer(ran.containerId)
        .remove({ force: true })
        .catch(() => {});
      throw err;
    }

    await updateNginxRouting(project, logger);

    const swapped = await swapContainer(
      {
        projectId: project.id,
        projectSlug: project.slug,
        branch: deployment.branch,
        environment: deployment.environment,
        newContainerId: ran.containerId,
        newDeploymentId: deployment.id,
      },
      logger,
    );

    // Routing was rendered while the retired containers were still up, so their now-dead
    // blocks have to be dropped before nginx tries to resolve them on its next reload.
    if (swapped.removedAny) {
      await updateNginxRouting(project, logger);
    }

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "SUCCESS", finishedAt: new Date() },
    });
    logger.system("deployment succeeded");

    await pruneOldImages(project.slug, [imageTag], logger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.log("stderr", message);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "FAILED", error: message, finishedAt: new Date() },
    });
    throw err;
  } finally {
    await logger.close();
    await release();
  }
}
