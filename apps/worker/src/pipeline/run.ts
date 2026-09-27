import { docker } from "../docker.js";
import {
  prisma,
  decrypt,
  LABEL_PROJECT,
  LABEL_DEPLOYMENT,
  LABEL_MANAGED,
  LABEL_BRANCH,
  LABEL_ENVIRONMENT,
  type DeployEnvironment,
} from "@launchpad/shared";
import type { DeployLogger } from "../deployLogger.js";

export interface RunResult {
  containerId: string;
  containerName: string;
}

export interface RunTarget {
  projectId: string;
  projectSlug: string;
  internalPort: number;
  deploymentId: string;
  branch: string;
  environment: DeployEnvironment;
}

/**
 * Resolves the env vars this deployment should see. Vars scoped to a specific environment
 * override an ALL-scoped var of the same key, so a project can set a shared default and
 * point previews at a throwaway database without duplicating every other variable.
 */
async function resolveEnv(projectId: string, environment: DeployEnvironment): Promise<string[]> {
  const envVars = await prisma.envVar.findMany({
    where: { projectId, environment: { in: [environment, "ALL"] } },
  });

  const resolved = new Map<string, string>();
  for (const v of envVars.filter((v) => v.environment === "ALL")) {
    resolved.set(v.key, decrypt(v.valueEnc));
  }
  for (const v of envVars.filter((v) => v.environment !== "ALL")) {
    resolved.set(v.key, decrypt(v.valueEnc));
  }

  return [...resolved].map(([key, value]) => `${key}=${value}`);
}

/**
 * Starts the new container attached to the shared Docker network under a name unique to
 * this deployment, so the outgoing container stays reachable until swap.ts removes it.
 * No host port is published — nginx (proxy.ts) reaches it by container name over Docker's
 * embedded DNS, the same way health.ts does before nginx is ever pointed at it.
 *
 * The branch/environment labels are what let proxy.ts and swap.ts reason about which
 * containers belong to which alias without parsing names.
 */
export async function runContainer(imageTag: string, target: RunTarget, logger: DeployLogger): Promise<RunResult> {
  const env = await resolveEnv(target.projectId, target.environment);

  const containerName = `launchpad-app-${target.projectSlug}-${target.deploymentId.slice(0, 8)}`;
  const network = process.env.DOCKER_NETWORK ?? "deploy-net";

  logger.system(`$ docker run --name ${containerName} --network ${network} ${imageTag}`);

  const container = await docker.createContainer({
    name: containerName,
    Image: imageTag,
    // PORT is the convention most Node frameworks read; generated Dockerfiles bind it too.
    Env: [`PORT=${target.internalPort}`, ...env],
    Labels: {
      [LABEL_MANAGED]: "true",
      [LABEL_PROJECT]: target.projectSlug,
      [LABEL_DEPLOYMENT]: target.deploymentId,
      [LABEL_BRANCH]: target.branch,
      [LABEL_ENVIRONMENT]: target.environment,
    },
    ExposedPorts: { [`${target.internalPort}/tcp`]: {} },
    HostConfig: {
      NetworkMode: network,
      RestartPolicy: { Name: "unless-stopped" },
    },
  });

  await container.start();
  const info = await container.inspect();

  logger.system("container started");

  return { containerId: info.Id, containerName };
}
