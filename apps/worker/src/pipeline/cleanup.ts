import { prisma, LABEL_PROJECT, LABEL_BRANCH, LABEL_DEPLOYMENT, createLogger } from "@launchpad/shared";
import { docker } from "../docker.js";
import { updateNginxRouting, removeProjectRouting } from "./proxy.js";
import { removeContainer } from "./swap.js";
import { workerLogger } from "../pipelineLogger.js";

const log = createLogger("cleanup");
// Not a DeployLogger: this sweep isn't tied to one deployment, and deployment log rows are
// keyed by a per-deployment seq that a second writer would collide with.
const logger = workerLogger("cleanup");

const STALE_PREVIEW_DAYS = Number(process.env.STALE_PREVIEW_DAYS ?? 1);

/**
 * Tears down preview branches that have gone quiet or were deleted upstream, so a local
 * Docker daemon doesn't accumulate containers for branches nobody is working on any more.
 *
 * Production is never a candidate — the whole point of a production deploy is that it stays
 * up until something replaces it. Images are left to retention.ts, which already keeps only
 * the newest few per project; a dead branch's images age out of that window on their own.
 */
export async function sweepStalePreviews(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_PREVIEW_DAYS * 24 * 60 * 60 * 1000);

  const stale = await prisma.branch.findMany({
    where: {
      environment: "PREVIEW",
      cleanedUpAt: null,
      OR: [{ deletedUpstream: true }, { lastPushAt: { lt: cutoff } }],
    },
    include: { project: true },
  });

  if (stale.length === 0) return;
  log.info("sweeping stale preview branches", { count: stale.length });

  for (const branch of stale) {
    try {
      const reason = branch.deletedUpstream ? "deleted upstream" : `no push in ${STALE_PREVIEW_DAYS}d`;
      logger.system(`cleaning up preview branch ${branch.name} (${reason})`);

      const containers = await docker.listContainers({
        all: true,
        filters: JSON.stringify({
          label: [`${LABEL_PROJECT}=${branch.project.slug}`, `${LABEL_BRANCH}=${branch.name}`],
        }),
      });

      const removedDeploymentIds: string[] = [];
      for (const c of containers) {
        await removeContainer(c.Id, c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12), logger);
        const deploymentId = c.Labels[LABEL_DEPLOYMENT];
        if (deploymentId) removedDeploymentIds.push(deploymentId);
      }

      if (removedDeploymentIds.length > 0) {
        await prisma.deployment.updateMany({
          where: { id: { in: removedDeploymentIds } },
          data: { containerRemovedAt: new Date() },
        });
      }

      await updateNginxRouting(branch.project, logger);

      // The row is kept, not deleted — deploy history for the branch stays readable, and a
      // fresh push simply clears cleanedUpAt and brings the branch back.
      await prisma.branch.update({ where: { id: branch.id }, data: { cleanedUpAt: new Date() } });

      log.info("cleaned up preview branch", { project: branch.project.slug, branch: branch.name });
    } catch (err) {
      // One branch failing must not abort the sweep for the others.
      const message = err instanceof Error ? err.message : String(err);
      log.error("failed to clean up branch", { project: branch.project.slug, branch: branch.name, error: message });
    }
  }
}

/**
 * Stops and removes every container the deleted project left running, then removes its
 * nginx config file entirely. The Project row is already gone by the time this runs — the
 * API deletes it before enqueuing — so everything here works off the slug alone via Docker
 * labels, not a database lookup.
 */
export async function teardownProject(slug: string): Promise<void> {
  log.info("tearing down deleted project", { slug });

  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${LABEL_PROJECT}=${slug}`] }),
  });
  for (const c of containers) {
    await removeContainer(c.Id, c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12), logger);
  }

  await removeProjectRouting(slug, logger);
  log.info("finished tearing down deleted project", { slug, containersRemoved: containers.length });
}
