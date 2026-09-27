import { Router, raw } from "express";
import {
  prisma,
  decrypt,
  githubPushEventSchema,
  branchFromRef,
  classifyBranch,
  createLogger,
} from "@launchpad/shared";
import { buildQueue } from "../lib/queue.js";
import { verifyGithubSignature } from "../lib/githubSignature.js";

export const webhooksRouter = Router();
const log = createLogger("webhooks");

// Raw body only on this route — global express.json() must never cover this path,
// or the buffer used for HMAC verification won't match what GitHub signed.
webhooksRouter.post("/github/:projectId", raw({ type: "application/json" }), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
  if (!project) {
    res.status(404).json({ error: "Unknown project" });
    return;
  }

  const rawBody = req.body as Buffer;
  const secret = decrypt(project.webhookSecretEnc);
  const signatureHeader = req.header("x-hub-signature-256");

  if (!verifyGithubSignature(rawBody, secret, signatureHeader)) {
    log.warn("signature verification failed", { projectId: project.id });
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const githubEvent = req.header("x-github-event");
  if (githubEvent === "ping") {
    res.status(200).json({ ok: true, message: "pong" });
    return;
  }
  if (githubEvent !== "push") {
    res.status(200).json({ ok: true, ignored: `unhandled event: ${githubEvent}` });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON payload" });
    return;
  }

  const parsed = githubPushEventSchema.safeParse(payload);
  if (!parsed.success) {
    res.status(200).json({ ok: true, ignored: "payload did not match expected push event shape" });
    return;
  }
  const event = parsed.data;

  const pushedBranch = branchFromRef(event.ref);

  // A deleted branch can never be redeployed, so this only flags it for the cleanup sweep
  // to tear down — no queue interaction, and the sweep is what actually removes containers.
  if (event.deleted) {
    if (pushedBranch) {
      await prisma.branch.updateMany({
        where: { projectId: project.id, name: pushedBranch },
        data: { deletedUpstream: true },
      });
    }
    res.status(200).json({ ok: true, ignored: "branch deletion" });
    return;
  }

  const environment = pushedBranch ? classifyBranch(pushedBranch, project) : null;
  if (!pushedBranch || !environment) {
    res.status(200).json({
      ok: true,
      ignored: `ref ${event.ref} is neither the production branch (${project.productionBranch}) nor an allow-listed preview branch`,
    });
    return;
  }

  await prisma.branch.upsert({
    where: { projectId_name: { projectId: project.id, name: pushedBranch } },
    update: { environment, lastPushAt: new Date(), deletedUpstream: false, cleanedUpAt: null },
    create: { projectId: project.id, name: pushedBranch, environment },
  });

  // Scoped to this branch: a push to one branch must never supersede a deploy queued
  // for another.
  await prisma.deployment.updateMany({
    where: { projectId: project.id, branch: pushedBranch, status: "QUEUED" },
    data: { status: "SUPERSEDED", finishedAt: new Date() },
  });

  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      branch: pushedBranch,
      environment,
      commitSha: event.after,
      commitMessage: event.head_commit?.message,
      status: "QUEUED",
      trigger: "PUSH",
    },
  });

  await buildQueue.add("build", { deploymentId: deployment.id });
  log.info("build enqueued", {
    projectId: project.id,
    deploymentId: deployment.id,
    branch: pushedBranch,
    environment,
    sha: event.after,
  });

  res.status(200).json({ ok: true, deploymentId: deployment.id });
});
