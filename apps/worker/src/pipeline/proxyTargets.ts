import { deployHosts, LABEL_BRANCH, LABEL_DEPLOYMENT } from "@launchpad/shared";

export interface LiveContainer {
  containerName: string;
  branch: string;
  deploymentId: string;
  createdAt: number;
}

export interface ProxyTarget {
  containerName: string;
  internalPort: number;
  /** Every hostname nginx should route to this container, most specific last. */
  serverNames: string[];
}

/** Shape of the fields proxyTargets needs from dockerode's listContainers() output. */
export interface DockerContainerSummary {
  Names: string[];
  Created: number;
  Labels: Record<string, string>;
}

export function toLiveContainers(containers: DockerContainerSummary[]): LiveContainer[] {
  return containers
    .filter((c) => c.Labels[LABEL_BRANCH] && c.Labels[LABEL_DEPLOYMENT])
    .map((c) => ({
      containerName: c.Names[0]?.replace(/^\//, "") ?? "",
      branch: c.Labels[LABEL_BRANCH]!,
      deploymentId: c.Labels[LABEL_DEPLOYMENT]!,
      createdAt: c.Created,
    }))
    .filter((c) => c.containerName.length > 0);
}

/**
 * Turns the set of live containers for a project into one nginx block per container.
 *
 * Every container always answers on its own immutable deployment host. The newest container
 * on a branch additionally answers on that branch's stable alias, and if that branch is the
 * production branch, on the bare project host too. Building it this way — one block per
 * container listing all its hostnames, rather than one block per alias — means an alias can
 * never end up pointing at a container that has already been removed.
 */
export function buildProxyTargets(
  containers: LiveContainer[],
  options: { slug: string; domain: string; productionBranch: string; internalPort: number },
): ProxyTarget[] {
  const hosts = deployHosts(options.slug, options.domain);

  const newestPerBranch = new Map<string, LiveContainer>();
  for (const container of containers) {
    const current = newestPerBranch.get(container.branch);
    if (!current || container.createdAt > current.createdAt) {
      newestPerBranch.set(container.branch, container);
    }
  }

  return [...containers]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((container) => {
      const serverNames = [hosts.deployment(container.deploymentId)];
      if (newestPerBranch.get(container.branch)?.deploymentId === container.deploymentId) {
        serverNames.push(hosts.branch(container.branch));
        if (container.branch === options.productionBranch) {
          serverNames.push(hosts.production);
        }
      }
      return { containerName: container.containerName, internalPort: options.internalPort, serverNames };
    });
}
