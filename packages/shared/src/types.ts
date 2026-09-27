import { z } from "zod";

/** Only the fields Launchpad actually reads from GitHub's push event payload. */
export const githubPushEventSchema = z.object({
  ref: z.string(),
  deleted: z.boolean().optional().default(false),
  after: z.string(),
  head_commit: z
    .object({
      id: z.string(),
      message: z.string().optional(),
    })
    .nullable()
    .optional(),
  repository: z.object({
    clone_url: z.string(),
    full_name: z.string(),
  }),
});
export type GithubPushEvent = z.infer<typeof githubPushEventSchema>;

export function branchFromRef(ref: string): string | null {
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

export type DeployEnvironment = "PRODUCTION" | "PREVIEW";

/**
 * Decides what a pushed branch is allowed to deploy as. null means "ignore this push" —
 * preview deploys are opt-in per branch, so an unlisted branch is silently skipped rather
 * than spinning up a container nobody asked for.
 */
export function classifyBranch(
  branch: string,
  project: { productionBranch: string; previewBranches: string[] },
): DeployEnvironment | null {
  if (branch === project.productionBranch) return "PRODUCTION";
  if (project.previewBranches.includes(branch)) return "PREVIEW";
  return null;
}

/**
 * Branch names and deployment ids become DNS labels, so anything outside [a-z0-9-] has to
 * go. `feature/x` and `feature-x` collapsing to the same host is acceptable — the immutable
 * per-deployment URL is always unambiguous when it matters.
 */
export function hostLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface DeployHosts {
  /** Bare project host. Only ever points at the production branch's current deployment. */
  production: string;
  /** Stable per-branch alias, follows the newest successful deploy on that branch. */
  branch: (branchName: string) => string;
  /** Immutable per-deployment host, valid for as long as that deployment's container lives. */
  deployment: (deploymentId: string) => string;
}

/**
 * Single source of truth for hostname construction — the worker renders nginx server_names
 * from it and the api serializes browser links from it, so the two can never drift.
 */
export function deployHosts(slug: string, domain: string): DeployHosts {
  return {
    production: `${slug}.${domain}`,
    branch: (branchName: string) => `${hostLabel(branchName)}--${slug}.${domain}`,
    // Truncated the same way container names are, which keeps these hostnames short enough
    // to read and stay well inside nginx's server_names hash bucket.
    deployment: (deploymentId: string) => `${hostLabel(deploymentId.slice(0, 8))}--${slug}.${domain}`,
  };
}

export function deployUrl(host: string, tlsEnabled: boolean): string {
  return `${tlsEnabled ? "https" : "http"}://${host}`;
}

export const createProjectSchema = z
  .object({
    name: z.string().min(1).max(100),
    slug: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "slug must be lowercase alphanumeric with hyphens"),
    repoUrl: z.string().url(),
    productionBranch: z.string().min(1).default("main"),
    previewBranches: z.array(z.string().min(1)).default([]),
    internalPort: z.number().int().positive().default(3000),
    healthPath: z.string().min(1).default("/"),
    /** Shared secret configured on the GitHub webhook; used to verify X-Hub-Signature-256. */
    webhookSecret: z.string().min(16).optional(),
    /** For private repos: injected as x-access-token in the clone URL, never logged. */
    repoToken: z.string().optional(),
  })
  .refine((p) => !p.previewBranches.includes(p.productionBranch), {
    message: "productionBranch must not also be listed in previewBranches",
    path: ["previewBranches"],
  });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// .partial() can't apply through the .refine() above, so the update shape is built from the
// same field definitions rather than derived from createProjectSchema.
export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  repoUrl: z.string().url().optional(),
  productionBranch: z.string().min(1).optional(),
  previewBranches: z.array(z.string().min(1)).optional(),
  internalPort: z.number().int().positive().optional(),
  healthPath: z.string().min(1).optional(),
  webhookSecret: z.string().min(16).optional(),
  repoToken: z.string().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// The type name itself comes from the generated Prisma client, which is re-exported
// alongside this module.
export const envVarEnvironmentSchema = z.enum(["PRODUCTION", "PREVIEW", "ALL"]);

export const setEnvVarsSchema = z.object({
  environment: envVarEnvironmentSchema.default("ALL"),
  vars: z.record(z.string(), z.string()),
});
export type SetEnvVarsInput = z.infer<typeof setEnvVarsSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Docker resource label used to find/retain/clean up everything Launchpad creates. */
export const LABEL_PROJECT = "launchpad.project";
export const LABEL_DEPLOYMENT = "launchpad.deployment";
export const LABEL_MANAGED = "launchpad.managed";
export const LABEL_BRANCH = "launchpad.branch";
export const LABEL_ENVIRONMENT = "launchpad.environment";
