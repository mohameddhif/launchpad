import { Router } from "express";
import { prisma } from "@launchpad/shared";
import { buildQueue } from "../lib/queue.js";
import { serializeDeployment } from "../lib/serialize.js";

export const deploymentsRouter = Router();

deploymentsRouter.get("/:id", async (req, res) => {
  const deployment = await prisma.deployment.findUnique({
    where: { id: req.params.id },
    include: { project: { select: { slug: true } } },
  });
  if (!deployment) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const branch = await prisma.branch.findUnique({
    where: { projectId_name: { projectId: deployment.projectId, name: deployment.branch } },
  });

  const { project, ...row } = deployment;
  res.json(serializeDeployment(row, project.slug, branch?.latestDeploymentId === deployment.id));
});

deploymentsRouter.get("/:id/logs", async (req, res) => {
  const logs = await prisma.deploymentLog.findMany({
    where: { deploymentId: req.params.id },
    orderBy: { seq: "asc" },
  });
  res.json(logs);
});

// Re-runs the identical worker pipeline (run -> health -> nginx -> swap) against the
// target's already-built image, with skipBuild so clone+build never happen — see
// apps/worker/src/pipeline/runDeployment.ts. Near-instant since there's nothing to build.
deploymentsRouter.post("/:id/rollback", async (req, res) => {
  const target = await prisma.deployment.findUnique({ where: { id: req.params.id } });
  if (!target) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (target.status !== "SUCCESS") {
    res.status(400).json({ error: "Can only roll back to a successful deployment" });
    return;
  }
  if (!target.imageTag) {
    res.status(400).json({ error: "This deployment has no built image to roll back to" });
    return;
  }

  await prisma.deployment.updateMany({
    where: { projectId: target.projectId, branch: target.branch, status: "QUEUED" },
    data: { status: "SUPERSEDED", finishedAt: new Date() },
  });

  const deployment = await prisma.deployment.create({
    data: {
      projectId: target.projectId,
      // Rollback stays on the target's own branch and environment — rolling back a preview
      // must not touch production.
      branch: target.branch,
      environment: target.environment,
      commitSha: target.commitSha,
      commitMessage: target.commitMessage,
      imageTag: target.imageTag,
      status: "QUEUED",
      trigger: "ROLLBACK",
    },
  });

  await buildQueue.add("build", { deploymentId: deployment.id, skipBuild: true });
  res.status(201).json(deployment);
});

// Points production at an image that was already built and proved healthy as a preview.
// Same skipBuild path as rollback — the only difference is the new deployment is forced
// onto the production branch/environment, which is what makes the pipeline give it the
// bare project hostname and the full stop-the-old-container swap.
deploymentsRouter.post("/:id/promote", async (req, res) => {
  const target = await prisma.deployment.findUnique({
    where: { id: req.params.id },
    include: { project: { select: { productionBranch: true } } },
  });
  if (!target) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (target.status !== "SUCCESS") {
    res.status(400).json({ error: "Can only promote a successful deployment" });
    return;
  }
  if (!target.imageTag) {
    res.status(400).json({ error: "This deployment has no built image to promote" });
    return;
  }

  const productionBranch = target.project.productionBranch;

  await prisma.deployment.updateMany({
    where: { projectId: target.projectId, branch: productionBranch, status: "QUEUED" },
    data: { status: "SUPERSEDED", finishedAt: new Date() },
  });

  const deployment = await prisma.deployment.create({
    data: {
      projectId: target.projectId,
      branch: productionBranch,
      environment: "PRODUCTION",
      commitSha: target.commitSha,
      commitMessage: target.commitMessage,
      imageTag: target.imageTag,
      status: "QUEUED",
      trigger: "PROMOTE",
    },
  });

  await buildQueue.add("build", { deploymentId: deployment.id, skipBuild: true });
  res.status(201).json(deployment);
});
