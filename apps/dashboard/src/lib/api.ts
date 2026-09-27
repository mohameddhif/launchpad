export interface Project {
  id: string;
  slug: string;
  name: string;
  repoUrl: string;
  productionBranch: string;
  previewBranches: string[];
  internalPort: number;
  healthPath: string;
  currentDeploymentId: string | null;
  productionUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWithSecret extends Project {
  webhookSecret: string;
}

export type DeploymentStatus = "QUEUED" | "BUILDING" | "DEPLOYING" | "SUCCESS" | "FAILED" | "SUPERSEDED";
export type DeploymentTrigger = "PUSH" | "MANUAL" | "ROLLBACK" | "PROMOTE";
export type DeployEnvironment = "PRODUCTION" | "PREVIEW";
export type EnvVarEnvironment = DeployEnvironment | "ALL";

export interface Deployment {
  id: string;
  projectId: string;
  branch: string;
  environment: DeployEnvironment;
  commitSha: string;
  commitMessage: string | null;
  imageTag: string | null;
  containerName: string | null;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  containerRemovedAt: string | null;
  /** Immutable per-deployment URL; null once the container is gone. */
  immutableUrl: string | null;
  /** Branch alias URL; only set while this is the branch's current deployment. */
  branchUrl: string | null;
}

export interface Branch {
  id: string;
  projectId: string;
  name: string;
  environment: DeployEnvironment;
  latestDeploymentId: string | null;
  lastPushAt: string;
  deletedUpstream: boolean;
  cleanedUpAt: string | null;
}

export interface DeploymentLogLine {
  id: string;
  deploymentId: string;
  seq: number;
  stream: "stdout" | "stderr" | "system";
  message: string;
  createdAt: string;
}

export interface EnvVarMeta {
  id: string;
  key: string;
  environment: EnvVarEnvironment;
  updatedAt: string;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, typeof body.error === "string" ? body.error : res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ email: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ email: string }>("/api/auth/me"),

  listProjects: () => request<Project[]>("/api/projects"),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (input: {
    name: string;
    slug: string;
    repoUrl: string;
    productionBranch: string;
    internalPort: number;
    healthPath: string;
    webhookSecret?: string;
  }) => request<ProjectWithSecret>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  updateProject: (id: string, patch: Partial<Pick<Project, "name" | "productionBranch" | "previewBranches">>) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  deployProject: (id: string) => request<Deployment>(`/api/projects/${id}/deploy`, { method: "POST" }),

  listDeployments: (projectId: string) => request<Deployment[]>(`/api/projects/${projectId}/deployments`),
  listBranches: (projectId: string) => request<Branch[]>(`/api/projects/${projectId}/branches`),
  getDeployment: (id: string) => request<Deployment>(`/api/deployments/${id}`),
  getDeploymentLogs: (id: string) => request<DeploymentLogLine[]>(`/api/deployments/${id}/logs`),
  rollback: (deploymentId: string) => request<Deployment>(`/api/deployments/${deploymentId}/rollback`, { method: "POST" }),
  promote: (deploymentId: string) => request<Deployment>(`/api/deployments/${deploymentId}/promote`, { method: "POST" }),

  listEnvVars: (projectId: string) => request<EnvVarMeta[]>(`/api/projects/${projectId}/env`),
  /** Upserts only the given keys within one environment — others are left untouched. */
  setEnvVars: (projectId: string, environment: EnvVarEnvironment, vars: Record<string, string>) =>
    request<void>(`/api/projects/${projectId}/env`, { method: "PUT", body: JSON.stringify({ environment, vars }) }),
  deleteEnvVar: (projectId: string, environment: EnvVarEnvironment, key: string) =>
    request<void>(`/api/projects/${projectId}/env/${environment}/${encodeURIComponent(key)}`, { method: "DELETE" }),
};

export { ApiError };
