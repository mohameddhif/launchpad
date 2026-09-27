import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DeployLogger } from "../deployLogger.js";

const execFileAsync = promisify(execFile);

export interface CloneResult {
  dir: string;
  cleanup: () => Promise<void>;
}

function injectToken(repoUrl: string, token: string | null): string {
  if (!token) return repoUrl;
  const url = new URL(repoUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}

function scrub(text: string, token: string | null): string {
  return token ? text.split(token).join("***") : text;
}

/**
 * Clones a single commit into a fresh temp dir via `git init` + `fetch --depth 1 <sha>` +
 * `checkout FETCH_HEAD`, rather than a full `git clone`, so the worker never pulls history
 * it doesn't need. Every git invocation uses execFile with an args array — never a shell —
 * because repoUrl and commitSha both originate from webhook/user input.
 */
export async function cloneAtCommit(
  repoUrl: string,
  commitSha: string,
  repoToken: string | null,
  logger: DeployLogger,
): Promise<CloneResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "launchpad-build-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });

  const cloneUrl = injectToken(repoUrl, repoToken);

  const run = async (args: string[], label: string) => {
    logger.system(`$ git ${label}`);
    try {
      const { stdout, stderr } = await execFileAsync("git", args, { cwd: dir });
      if (stdout.trim()) logger.log("stdout", scrub(stdout.trim(), repoToken));
      if (stderr.trim()) logger.log("stderr", scrub(stderr.trim(), repoToken));
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      throw new Error(`git ${label} failed: ${scrub(raw, repoToken)}`);
    }
  };

  try {
    await run(["init", "-q"], "init");
    await run(["remote", "add", "origin", cloneUrl], "remote add origin <repo>");
    await run(["fetch", "--depth", "1", "origin", commitSha], `fetch --depth 1 origin ${commitSha}`);
    await run(["checkout", "-q", "FETCH_HEAD"], "checkout FETCH_HEAD");
  } catch (err) {
    await cleanup();
    throw err;
  }

  return { dir, cleanup };
}
