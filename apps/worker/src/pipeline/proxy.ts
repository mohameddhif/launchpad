import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { Writable } from "node:stream";
import path from "node:path";
import Handlebars from "handlebars";
import { LABEL_PROJECT } from "@launchpad/shared";
import { docker } from "../docker.js";
import type { PipelineLogger } from "../pipelineLogger.js";
import { buildProxyTargets, toLiveContainers, type DockerContainerSummary } from "./proxyTargets.js";

const CONF_DIR = process.env.NGINX_CONF_DIR ?? "/etc/nginx/conf.d";
const TEMPLATE_DIR = process.env.NGINX_TEMPLATE_DIR ?? "/repo/apps/nginx-templates";

type DockerContainer = ReturnType<typeof docker.getContainer>;

/** Found by label, not a hardcoded compose container name, so this survives project renames. */
async function findNginxContainer(): Promise<DockerContainer> {
  const containers = await docker.listContainers({
    filters: JSON.stringify({ label: ["launchpad.role=nginx"] }),
  });
  const found = containers[0];
  if (!found) {
    throw new Error("nginx container not found (expected one labeled launchpad.role=nginx)");
  }
  return docker.getContainer(found.Id);
}

async function execInNginx(container: DockerContainer, cmd: string[]): Promise<{ exitCode: number; output: string }> {
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({});
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  await new Promise<void>((resolve, reject) => {
    container.modem.demuxStream(stream, sink, sink);
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const info = await exec.inspect();
  return { exitCode: info.ExitCode ?? 1, output: Buffer.concat(chunks).toString("utf8") };
}

export interface RoutedProject {
  slug: string;
  productionBranch: string;
  internalPort: number;
}

/**
 * A project serving several branches at once puts many long names into nginx's server_names
 * hash, which overflows the default 64-byte bucket and fails `nginx -t`. Written as its own
 * conf.d file (loaded before any project's, hence the 00- prefix) because the directive is
 * http-level and may appear only once.
 */
async function ensureNginxTuning(): Promise<void> {
  await writeFile(path.join(CONF_DIR, "00-launchpad-tuning.conf"), "server_names_hash_bucket_size 128;\n", "utf8");
}

/**
 * Rewrites this project's whole nginx config from whatever containers are actually running
 * right now, validates it with `nginx -t` inside the nginx container, and only reloads if
 * validation passes — restoring the previous config on failure so a bad deploy never breaks
 * routing for what's already live.
 *
 * Routing is derived from Docker's live labeled containers rather than read from Postgres:
 * the containers are what can actually serve traffic, so a config built from them can never
 * point an alias at something that no longer exists.
 */
export async function updateNginxRouting(project: RoutedProject, logger: PipelineLogger): Promise<void> {
  const domain = process.env.DEPLOY_DOMAIN ?? "127.0.0.1.nip.io";
  const tlsEnabled = process.env.TLS_ENABLED === "true";
  const templateName = tlsEnabled ? "tls.conf.hbs" : "http.conf.hbs";

  const running = (await docker.listContainers({
    filters: JSON.stringify({ label: [`${LABEL_PROJECT}=${project.slug}`] }),
  })) as unknown as DockerContainerSummary[];

  const targets = buildProxyTargets(toLiveContainers(running), {
    slug: project.slug,
    domain,
    productionBranch: project.productionBranch,
    internalPort: project.internalPort,
  });

  const templateSrc = await readFile(path.join(TEMPLATE_DIR, templateName), "utf8");
  // The certificate is shared by every deployment hostname under DEPLOY_DOMAIN.
  // Keep its path in the template context rather than hard-coding a manually copied file.
  const rendered = Handlebars.compile(templateSrc)({ targets, domain });

  await mkdir(CONF_DIR, { recursive: true });
  await ensureNginxTuning();
  const confPath = path.join(CONF_DIR, `${project.slug}.conf`);

  let previous: string | null = null;
  try {
    previous = await readFile(confPath, "utf8");
  } catch {
    // No previous config for this project — first deploy.
  }

  await writeFile(confPath, rendered, "utf8");
  logger.system(`wrote nginx config for ${project.slug} (${targets.length} live target(s))`);

  const nginx = await findNginxContainer();

  const test = await execInNginx(nginx, ["nginx", "-t"]);
  if (test.exitCode !== 0) {
    if (previous !== null) {
      await writeFile(confPath, previous, "utf8");
    } else {
      await rm(confPath, { force: true });
    }
    throw new Error(`nginx config validation failed, restored previous config:\n${test.output}`);
  }

  const reload = await execInNginx(nginx, ["nginx", "-s", "reload"]);
  if (reload.exitCode !== 0) {
    throw new Error(`nginx reload failed:\n${reload.output}`);
  }

  for (const target of targets) {
    logger.system(`nginx: ${target.serverNames.join(", ")} -> ${target.containerName}:${target.internalPort}`);
  }
}

/**
 * Deletes a project's whole config file — used when a project itself is torn down, rather
 * than a single deployment being retired. Without this, a deleted project's conf.d file
 * would keep referencing containers that no longer exist, and since nginx resolves
 * proxy_pass hostnames at startup, that stale file would crash-loop nginx for every
 * project the next time the nginx container restarts, not just the deleted one.
 */
export async function removeProjectRouting(slug: string, logger: PipelineLogger): Promise<void> {
  const confPath = path.join(CONF_DIR, `${slug}.conf`);

  let existed = true;
  try {
    await rm(confPath);
  } catch {
    existed = false;
  }
  if (!existed) return;

  const nginx = await findNginxContainer();
  const test = await execInNginx(nginx, ["nginx", "-t"]);
  if (test.exitCode !== 0) {
    throw new Error(`nginx config validation failed after removing ${slug}.conf:\n${test.output}`);
  }
  const reload = await execInNginx(nginx, ["nginx", "-s", "reload"]);
  if (reload.exitCode !== 0) {
    throw new Error(`nginx reload failed after removing ${slug}.conf:\n${reload.output}`);
  }
  logger.system(`removed nginx config for ${slug}`);
}
