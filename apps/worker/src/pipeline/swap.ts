import { docker } from "../docker.js";
import { prisma, LABEL_PROJECT, LABEL_BRANCH, LABEL_DEPLOYMENT, type DeployEnvironment } from "@launchpad/shared";
import type { PipelineLogger } from "../pipelineLogger.js";

/** How many containers stay live per preview branch, keeping older immutable URLs working. */
export const KEEP_PREVIEW_CONTAINERS = Number(process.env.PREVIEW_CONTAINERS_PER_BRANCH ?? 3);

export interface SiblingContainer {
  id: string;
  name: string;
  deploymentId: string;
  createdAt: number;
}

/**
 * Pure selection logic, mirroring retention.ts's selectImagesToRemove: keep the newest N
 * containers on a preview branch and return the overflow. Preview deployments keep working
 * on their immutable URLs after newer pushes, but not without bound.
 */
export function selectContainersToRemove(siblings: SiblingContainer[], keep: number): SiblingContainer[] {
  return [...siblings].sort((a, b) => b.createdAt - a.createdAt).slice(keep);
}

export interface SwapTarget {
  projectId: string;
  projectSlug: string;
  branch: string;
  environment: DeployEnvironment;
  newContainerId: string;
  newDeploymentId: string;
}

/** Shared with the cleanup sweep, which retires containers for the same reasons. */
export async function removeContainer(id: string, name: string, logger: PipelineLogger): Promise<void> {
  logger.system(`stopping container ${name}`);
  const container = docker.getContainer(id);
  try {
    await container.stop({ t: 10 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 304 means it had already stopped — not a problem worth reporting.
    if (!message.includes("304")) {
      logger.log("stderr", `warning: failed to stop ${name}: ${message}`);
    }
  }
  await container.remove({ force: true });
}

/**
 * Retires containers this deployment supersedes, scoped to its own branch — a deploy on one
 * branch never touches another's.
 *
 * Production replaces its predecessor outright: only one container may answer on the bare
 * project host. Preview branches instead keep the newest few alive so their immutable
 * per-deployment URLs stay resolvable, and only trim the overflow.
 *
 * Returns whether anything was removed, so the caller can re-render nginx to match.
 */
export async function swapContainer(target: SwapTarget, logger: PipelineLogger): Promise<{ removedAny: boolean }> {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({
      label: [`${LABEL_PROJECT}=${target.projectSlug}`, `${LABEL_BRANCH}=${target.branch}`],
    }),
  });

  const siblings: SiblingContainer[] = containers
    .filter((c) => c.Id !== target.newContainerId)
    .map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
      deploymentId: c.Labels[LABEL_DEPLOYMENT] ?? "",
      createdAt: c.Created,
    }));

  const stale =
    target.environment === "PRODUCTION"
      ? siblings
      : // The new container counts toward the cap, so one slot is already spoken for.
        selectContainersToRemove(siblings, Math.max(KEEP_PREVIEW_CONTAINERS - 1, 0));

  for (const container of stale) {
    await removeContainer(container.id, container.name, logger);
  }

  const removedDeploymentIds = stale.map((c) => c.deploymentId).filter(Boolean);
  if (removedDeploymentIds.length > 0) {
    await prisma.deployment.updateMany({
      where: { id: { in: removedDeploymentIds } },
      data: { containerRemovedAt: new Date() },
    });
  }

  await prisma.branch.upsert({
    where: { projectId_name: { projectId: target.projectId, name: target.branch } },
    update: { latestDeploymentId: target.newDeploymentId },
    create: {
      projectId: target.projectId,
      name: target.branch,
      environment: target.environment,
      latestDeploymentId: target.newDeploymentId,
    },
  });

  if (target.environment === "PRODUCTION") {
    await prisma.project.update({
      where: { id: target.projectId },
      data: { currentDeploymentId: target.newDeploymentId },
    });
  }

  return { removedAny: stale.length > 0 };
}
