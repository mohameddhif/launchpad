import { deployHosts, deployUrl } from "@launchpad/shared";

export interface SerializableDeployment {
  id: string;
  projectId: string;
  branch: string;
  environment: "PRODUCTION" | "PREVIEW";
  commitSha: string;
  commitMessage: string | null;
  imageTag: string | null;
  containerName: string | null;
  status: string;
  trigger: string;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  containerRemovedAt: Date | null;
}

/**
 * Attaches the URLs this deployment is reachable at. Built from the same deployHosts()
 * helper the worker renders nginx server_names from, so the links the dashboard shows and
 * the hosts nginx actually answers on cannot drift apart.
 *
 * Both are null once the container is gone — nginx has no block pointing anywhere by then.
 * branchUrl is additionally null unless this deployment is its branch's current one, since
 * that alias always follows the newest successful deploy.
 */
export function serializeDeployment(
  deployment: SerializableDeployment,
  projectSlug: string,
  isBranchCurrent: boolean,
) {
  const domain = process.env.DEPLOY_DOMAIN ?? "127.0.0.1.nip.io";
  const tlsEnabled = process.env.TLS_ENABLED === "true";
  const hosts = deployHosts(projectSlug, domain);
  const live = deployment.containerRemovedAt === null && deployment.status === "SUCCESS";

  return {
    ...deployment,
    immutableUrl: live ? deployUrl(hosts.deployment(deployment.id), tlsEnabled) : null,
    branchUrl: live && isBranchCurrent ? deployUrl(hosts.branch(deployment.branch), tlsEnabled) : null,
  };
}
