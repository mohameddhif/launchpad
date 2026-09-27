import { Router } from "express";
import {
  prisma,
  encrypt,
  createProjectSchema,
  updateProjectSchema,
  setEnvVarsSchema,
  envVarEnvironmentSchema,
  generateWebhookSecret,
} from "@launchpad/shared";
import { deployHosts, deployUrl } from "@launchpad/shared";
import { buildQueue, cleanupQueue } from "../lib/queue.js";
import { serializeDeployment } from "../lib/serialize.js";

export const projectsRouter = Router();

function serializeProject(project: {
  id: string;
  slug: string;
  name: string;
  repoUrl: string;
  productionBranch: string;
  previewBranches: string[];
  internalPort: number;
  healthPath: string;
  currentDeploymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  // webhookSecretEnc / repoTokenEnc are never serialized back to the client.
  const {
    id,
    slug,
    name,
    repoUrl,
    productionBranch,
    previewBranches,
    internalPort,
    healthPath,
    currentDeploymentId,
    createdAt,
    updatedAt,
  } = project;
  const domain = process.env.DEPLOY_DOMAIN ?? "127.0.0.1.nip.io";
  const tlsEnabled = process.env.TLS_ENABLED === "true";
  return {
    id,
    slug,
    name,
    repoUrl,
    productionBranch,
    previewBranches,
    internalPort,
    healthPath,
    currentDeploymentId,
    productionUrl: deployUrl(deployHosts(slug, domain).production, tlsEnabled),
    createdAt,
    updatedAt,
  };
}

projectsRouter.get("/", async (_req, res) => {
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
  res.json(projects.map(serializeProject));
});

projectsRouter.post("/", async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;

  const existing = await prisma.project.findUnique({ where: { slug: input.slug } });
  if (existing) {
    res.status(409).json({ error: `Project slug '${input.slug}' already exists` });
    return;
  }

  // Generated when the caller doesn't supply one, so registering a project always yields
  // a usable secret to paste into GitHub's webhook config.
  const webhookSecret = input.webhookSecret ?? generateWebhookSecret();

  const project = await prisma.project.create({
    data: {
      name: input.name,
      slug: input.slug,
      repoUrl: input.repoUrl,
      productionBranch: input.productionBranch,
      previewBranches: input.previewBranches,
      internalPort: input.internalPort,
      healthPath: input.healthPath,
      webhookSecretEnc: encrypt(webhookSecret),
      repoTokenEnc: input.repoToken ? encrypt(input.repoToken) : null,
    },
  });

  // The plaintext webhook secret is only ever returned here, at creation time.
  res.status(201).json({ ...serializeProject(project), webhookSecret });
});

projectsRouter.get("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeProject(project));
});

projectsRouter.patch("/:id", async (req, res) => {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;

  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.repoUrl !== undefined ? { repoUrl: input.repoUrl } : {}),
      ...(input.productionBranch !== undefined ? { productionBranch: input.productionBranch } : {}),
      ...(input.previewBranches !== undefined ? { previewBranches: input.previewBranches } : {}),
      ...(input.internalPort !== undefined ? { internalPort: input.internalPort } : {}),
      ...(input.healthPath !== undefined ? { healthPath: input.healthPath } : {}),
      ...(input.webhookSecret !== undefined ? { webhookSecretEnc: encrypt(input.webhookSecret) } : {}),
      ...(input.repoToken !== undefined ? { repoTokenEnc: encrypt(input.repoToken) } : {}),
    },
  });
  res.json(serializeProject(project));
});

// Deletes the row, then hands live containers and the nginx config file off to the worker
// as a background job (it owns the Docker socket, the api never touches it directly). The
// slug travels in the job payload since the Project row — and its slug — will already be
// gone from Postgres by the time the worker processes it.
projectsRouter.delete("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await prisma.project.delete({ where: { id: req.params.id } });
  await cleanupQueue.add("teardown-project", { slug: project.slug });
  res.status(204).end();
});

// The dashboard's "Deploy" button re-runs the pipeline for a commit the platform already
// knows about — the production branch's most recent deployment — rather than reaching out
// to the git remote to resolve HEAD. This keeps the API dependency-free of git; the real
// trigger for new commits is still the webhook.
projectsRouter.post("/:id/deploy", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const latest = await prisma.deployment.findFirst({
    where: { projectId: project.id, branch: project.productionBranch },
    orderBy: { startedAt: "desc" },
  });
  if (!latest) {
    res.status(400).json({
      error: `No prior deployment on ${project.productionBranch} to redeploy — push to that branch first`,
    });
    return;
  }

  await prisma.deployment.updateMany({
    where: { projectId: project.id, branch: project.productionBranch, status: "QUEUED" },
    data: { status: "SUPERSEDED", finishedAt: new Date() },
  });

  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      branch: project.productionBranch,
      environment: "PRODUCTION",
      commitSha: latest.commitSha,
      commitMessage: latest.commitMessage,
      status: "QUEUED",
      trigger: "MANUAL",
    },
  });

  await buildQueue.add("build", { deploymentId: deployment.id });
  res.status(201).json(deployment);
});

projectsRouter.get("/:id/deployments", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const deployments = await prisma.deployment.findMany({
    where: { projectId: project.id },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  const branches = await prisma.branch.findMany({ where: { projectId: project.id } });
  const currentPerBranch = new Set(branches.map((b) => b.latestDeploymentId).filter(Boolean) as string[]);

  res.json(deployments.map((d) => serializeDeployment(d, project.slug, currentPerBranch.has(d.id))));
});

projectsRouter.get("/:id/branches", async (req, res) => {
  const branches = await prisma.branch.findMany({
    where: { projectId: req.params.id },
    orderBy: { lastPushAt: "desc" },
  });
  res.json(branches);
});

projectsRouter.get("/:id/env", async (req, res) => {
  const envVars = await prisma.envVar.findMany({
    where: { projectId: req.params.id },
    orderBy: [{ environment: "asc" }, { key: "asc" }],
  });
  // Values are never decrypted back to the client — keys only, so the UI can show what's set.
  res.json(envVars.map((e) => ({ id: e.id, key: e.key, environment: e.environment, updatedAt: e.updatedAt })));
});

// Upserts only the keys provided — never a full replace. Decrypted values are never sent
// back to the client (see GET above), so a full-replace PUT would have no way to know
// what to preserve for keys the caller isn't touching; it would silently blank them.
projectsRouter.put("/:id/env", async (req, res) => {
  const parsed = setEnvVarsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { environment, vars } = parsed.data;

  await prisma.$transaction(
    Object.entries(vars).map(([key, value]) =>
      prisma.envVar.upsert({
        where: { projectId_key_environment: { projectId: req.params.id, key, environment } },
        update: { valueEnc: encrypt(value) },
        create: { projectId: req.params.id, key, environment, valueEnc: encrypt(value) },
      }),
    ),
  );

  res.status(204).end();
});

projectsRouter.delete("/:id/env/:environment/:key", async (req, res) => {
  const environment = envVarEnvironmentSchema.safeParse(req.params.environment);
  if (!environment.success) {
    res.status(400).json({ error: "Unknown environment" });
    return;
  }

  await prisma.envVar
    .delete({
      where: {
        projectId_key_environment: {
          projectId: req.params.id,
          key: req.params.key,
          environment: environment.data,
        },
      },
    })
    .catch(() => {});
  res.status(204).end();
});
