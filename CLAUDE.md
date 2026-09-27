# Launchpad

Self-hosted, local Vercel-style push-to-deploy platform. A `git push` fires a GitHub webhook, a queued worker builds a Docker image (from the repo's own Dockerfile, or one synthesized by zero-config framework detection), the new container replaces or joins the running set, nginx routes a per-project/per-branch/per-deployment subdomain to it, and a React dashboard shows deploy history with live-streaming build logs. Scoped-down and inspired by [Openship](https://github.com/oblien/openship); full requirements in [prd-push-to-deploy-platform.md](prd-push-to-deploy-platform.md).

This is a **portfolio project**. It exists to demonstrate queues, container orchestration, reverse-proxy automation, and real-time systems. Two consequences that should shape every change: the code has to read well to an interviewer skimming it cold, and the README/architecture story counts as much as the feature list. Prefer the obvious, explainable implementation over the clever one.

**Status:** all five phases are built and verified end-to-end via `scripts/e2e.sh` plus direct WS/REST protocol tests. See [README.md](README.md) for the user-facing overview and demo script.

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Webhook → queue → clone → build → run container | done |
| 2 | nginx templating + reload, health-gated swap, nip.io / TLS, image retention | done |
| 3 | Dashboard: projects, history, live logs over WS | done |
| 4 | Rollback, env-var UI, README | done |
| 5 | Preview deployments (branch allow-list, branch + immutable URLs, stale-preview cleanup), promote-to-production, per-environment env vars, zero-config framework detection | done |

---

## Commands

```bash
docker network create deploy-net   # once, before the first compose up
docker compose up -d               # postgres, redis, api, worker, nginx

npm run dev                        # compose up + Vite dev server (dashboard on :5173)
npm run build                      # typecheck + build all workspaces
npm test                           # Vitest unit suite
npm run db:migrate                 # prisma migrate dev
npm run db:seed                    # seed admin user from ADMIN_EMAIL / ADMIN_PASSWORD
npm run db:studio                  # prisma studio
npm run e2e                        # scripts/e2e.sh — full pipeline against fixtures/sample-app
```

npm workspaces (no pnpm on this machine). Node 24, Docker 29 / Compose v5.

---

## Architecture

Five services on one shared Docker network, `deploy-net`. Deployed app containers join the **same** network, which is how nginx reaches them by container name via Docker's embedded DNS.

```
GitHub ──webhook──▶ api ──enqueue──▶ redis (BullMQ) ──▶ worker
                     │                   ▲                 │
                     │                   │ pub/sub         │ dockerode
                  postgres ◀─────────────┴─────────────────┤
                     │                                     ▼
browser ◀──WS/REST── api                          docker daemon
                                                    │
                                             app containers ◀── nginx ◀── browser
```

**api and worker never call each other directly.** Redis (queue + pub/sub) and Postgres are the only channels between them. Keep it that way — the process split is the point, not decoration.

Data flows in two directions:
- **Inbound:** webhook/REST → api → Postgres row + BullMQ job → worker.
- **Outbound:** worker log lines → Redis pub/sub → api's single subscriber → fan-out to WebSocket clients.

### Responsibilities

- **api** — REST, webhook receiver, WS server. All three share one `http.Server`. Enqueues work; never touches Docker or nginx.
- **worker** — owns *all* Docker and nginx mutation. Pipeline is one file per step in `apps/worker/src/pipeline/`: `clone → build (incl. detect) → run → health → proxy → swap`, plus `cleanup.ts` for the periodic stale-preview sweep and project-deletion teardown.
- **nginx** — reverse proxy. One config file per project, but *multiple* server blocks in it — one per currently-live container (production, each active preview branch, each still-alive immutable deployment) — regenerated whenever the set of live containers for that project changes.
- **postgres** — projects, deployments, branches (allow-list + staleness bookkeeping), logs, env vars. Source of truth for intent; **not** for nginx routing (see below).
- **redis** — BullMQ queue (`builds` + `cleanup`), log pub/sub, per-project advisory locks.

### Deploy swap ordering

This sequence is load-bearing; don't reorder it. It holds per-branch, not just per-project — production and each preview branch are swapped independently:

1. New container starts (unique name, so old and new coexist), labeled with its branch and environment.
2. Health check passes against the new container.
3. nginx config rewritten from *every currently-live container for the project* → `nginx -t` → graceful `nginx -s reload`.
4. *Only then* is the branch's previous container retired — for **production**, its sole predecessor is stopped and removed outright; for a **preview** branch, the newest few are kept alive instead (`PREVIEW_CONTAINERS_PER_BRANCH`) so recently-superseded builds stay reachable on their own immutable URL, and only the overflow is removed.

If health fails, remove the new container and leave everything else — nginx, and every other branch's containers — untouched. A failed deploy must never take down what's currently serving.

### nginx routing truth is Docker, not Postgres

`proxy.ts` lists live containers by label (`docker.listContainers`, no `all: true`) and renders routing from *that*, the same way `swap.ts` already decided what to retire. Postgres's `Branch` model tracks intent and staleness (allow-list membership, last-push clock, upstream-deleted flag) but never drives what nginx actually points at — so a config built from it can't reference a container that no longer exists.

One consequence worth knowing: nginx resolves `proxy_pass` hostnames **eagerly at boot**, so a stale `<slug>.conf` referencing a container that's gone crash-loops the *entire* nginx container on its next restart — not just that project. This is why project deletion (`DELETE /api/projects/:id`) enqueues a `teardown-project` job (same `cleanup` queue, dispatched by job name) that stops the project's containers and deletes its conf file entirely, rather than leaving Postgres cleanup as the only cleanup. Don't remove that teardown call.

---

## Conventions

**Webhook raw body.** `express.raw({ type: 'application/json' })` is mounted on the webhook route *only*. Global `express.json()` must never cover that path, or HMAC verification breaks against a re-serialized body. Verify with `crypto.timingSafeEqual`.

**Never `shell: true`.** All git and docker invocation goes through `execFile` with an args array. Repo URLs and branch names come from user input.

**Secrets are encrypted at rest.** Webhook secrets, repo tokens, and env-var values are AES-256-GCM via `packages/shared/crypto.ts`. Columns are suffixed `Enc`. Never log a decrypted value; scrub tokens out of git output before it reaches the log stream.

**Docker resources carry labels.** Every image and container gets `launchpad.project=<slug>` and `launchpad.deployment=<id>`; containers additionally get `launchpad.branch=<name>` and `launchpad.environment=<PRODUCTION|PREVIEW>`. Retention, cleanup, routing, and lookup filter on labels — never parse container or image names.

**Jobs are ID-only.** Build jobs are `{ deploymentId, skipBuild? }` — everything else (branch, environment, imageTag) is read from Postgres by the worker off the `Deployment` row. The one exception is the `teardown-project` job on the `cleanup` queue, which carries `{ slug }` because by the time the worker processes it, the `Project` row (and its slug) is already gone.

**Rollback and promote both reuse the build path.** Each creates a new `Deployment` with a target's existing `imageTag` and `skipBuild: true`, then runs the identical worker pipeline with clone+build skipped. Rollback stays on the target's own branch/environment; promote forces the production branch/environment, which is the only thing that makes it behave differently. Swap logic must exist in exactly one place — don't special-case promote inside `swap.ts` or `proxy.ts`, it should fall out of `deployment.branch`/`deployment.environment` alone.

**Logs have two sinks, deliberately.** Each line is published to Redis (`launchpad:logs:<deploymentId>`) for the live tail *and* batched into the `DeploymentLog` table for replay. On WS subscribe: replay history first, then attach the live stream, joined on a `seq` cursor so the handoff is gapless and never duplicates.

---

## Layout

| Path | Contents |
| --- | --- |
| `apps/api` | Express REST + webhook routes + `ws` server |
| `apps/worker` | BullMQ worker; `src/pipeline/` holds one file per deploy step, plus `detect.ts` (zero-config framework detection) and `cleanup.ts` (stale-preview sweep + project teardown) |
| `apps/dashboard` | React + Vite + Tailwind + TanStack Query |
| `apps/nginx-templates` | `http.conf.hbs`, `tls.conf.hbs` — each iterates one server block per live container |
| `packages/shared` | Prisma schema & client, zod types, queue names, crypto, logger, `deployHosts()`/`classifyBranch()` |
| `fixtures/sample-app` | Tiny Express app + Dockerfile, deployed by the E2E script |
| `fixtures/sample-static`, `fixtures/sample-node` | No Dockerfile — exercise zero-config static-site and generic-Node detection |
| `scripts/e2e.sh` | End-to-end pipeline run (production + preview + promote), no GitHub account needed |

---

## Gotchas

**The Docker socket is host-level access.** The worker mounts `/var/run/docker.sock`; write access to it is effectively root on the host. This is the standard tradeoff for tools in this category and is stated plainly in the README rather than glossed. Don't quietly widen it — the api container must not get the socket.

**`deploy-net` must exist before `docker compose up`.** It's declared external so deployed app containers can join the same network. `docker network create deploy-net`.

**nginx reload happens via `docker exec`**, driven by the worker through dockerode — the worker has the socket already and needs no nginx binary. Always `nginx -t` first; on validation failure restore the previous config file and fail the deploy *without* reloading.

**Regenerate the Prisma client after schema edits** (`npm run db:generate`), or api and worker will typecheck against a stale client.

**Dev is same-origin.** Vite proxies `/api` and `/ws` to the api container, so the httpOnly JWT cookie works for both REST and the WebSocket handshake. Don't switch to a `?token=` query param — it leaks credentials into access logs.

**Local URLs use nip.io.** `<slug>.127.0.0.1.nip.io` resolves to localhost with no DNS setup and no cert; preview branches get `<branch>--<slug>.127.0.0.1.nip.io` and individual deployments get `<deploymentId8>--<slug>.127.0.0.1.nip.io` (deployment id truncated to 8 chars, same as container names — a full cuid would overflow nginx's `server_names_hash_bucket_size`, which is why `proxy.ts` also writes a `00-launchpad-tuning.conf` bumping it to 128). The TLS path (wildcard cert, DNS-01) is built behind `TLS_ENABLED` but is not exercised locally.

**A project's nginx conf file is deleted only two ways: on project deletion, or when a preview branch's containers are all torn down by the cleanup sweep — never manually with `docker rm`.** Ripping out a labeled container by hand (outside the worker's own swap/cleanup code) leaves its nginx server block referencing a container that no longer exists; since nginx resolves `proxy_pass` hostnames at boot, that stale block crash-loops the whole nginx container next restart. If you do this while debugging, clear the stale `.conf` from the `nginx-conf` volume before restarting nginx.

**Windows + Docker Desktop: file-watch needs polling.** Bind-mounted host edits don't trigger `tsx watch`'s chokidar watcher through Docker Desktop's Windows filesystem bridge — the container keeps serving stale code with no error. `CHOKIDAR_USEPOLLING=true` (already set in `docker-compose.yml` for `api`/`worker`) fixes it. If a code change doesn't seem to take effect, check `docker compose logs api worker` for a `[tsx] change in ...` line before assuming the bug is elsewhere.
