#!/usr/bin/env bash
# End-to-end pipeline check — no GitHub account required. Builds a local git commit,
# registers it as a project, fires a signed webhook payload at the running API, polls
# until the deployment succeeds, then curls the project's live nip.io URL through nginx
# and asserts it responds. See CLAUDE.md "Verification".
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f .env ]; then
  echo "No .env found — copying .env.example and generating secrets."
  cp .env.example .env
  KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  # portable in-place edit (works with both BSD and GNU sed via a temp file)
  sed "s#^ENCRYPTION_KEY=.*#ENCRYPTION_KEY=$KEY#" .env > .env.tmp && mv .env.tmp .env
  sed "s#^JWT_SECRET=.*#JWT_SECRET=$JWT#" .env > .env.tmp && mv .env.tmp .env
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

API="http://localhost:${API_PORT:-4000}"
COOKIES=$(mktemp)
trap 'rm -f "$COOKIES" payload.json' EXIT

echo "==> ensuring deploy-net exists"
docker network inspect "${DOCKER_NETWORK:-deploy-net}" >/dev/null 2>&1 || docker network create "${DOCKER_NETWORK:-deploy-net}"

echo "==> starting postgres, redis, nginx, api, worker"
docker compose up -d --build postgres redis nginx api worker

echo "==> applying migrations"
npm run db:deploy --silent

echo "==> seeding admin user"
npm run db:seed --silent

echo "==> waiting for api health"
for i in $(seq 1 60); do
  if curl -sf "$API/healthz" >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 60 ]; then echo "api never became healthy" >&2; exit 1; fi
  sleep 1
done

echo "==> logging in"
curl -sf -c "$COOKIES" -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null

echo "==> preparing sample-app git commit"
if [ ! -d fixtures/sample-app/.git ]; then
  git init -q fixtures/sample-app
fi
git -C fixtures/sample-app add -A
if ! git -C fixtures/sample-app diff --cached --quiet; then
  git -C fixtures/sample-app -c user.email=e2e@launchpad.local -c user.name=launchpad-e2e commit -q -m "e2e commit"
elif [ -z "$(git -C fixtures/sample-app log -1 2>/dev/null)" ]; then
  git -C fixtures/sample-app -c user.email=e2e@launchpad.local -c user.name=launchpad-e2e commit -q --allow-empty -m "e2e commit"
fi
SHA=$(git -C fixtures/sample-app rev-parse HEAD)
echo "    commit: $SHA"

WEBHOOK_SECRET="e2e-test-secret-please-do-not-reuse"
SLUG="sample-app-e2e"
PREVIEW_BRANCH="preview-e2e"

echo "==> registering project (idempotent: removes a stale one from a prior run)"
EXISTING_ID=$(curl -sf -b "$COOKIES" "$API/api/projects" | node -e "
process.stdin.once('data', d => { const p = JSON.parse(d).find(p => p.slug === '$SLUG'); console.log(p ? p.id : ''); });
")
if [ -n "$EXISTING_ID" ]; then
  curl -sf -b "$COOKIES" -X DELETE "$API/api/projects/$EXISTING_ID" >/dev/null
fi

PROJECT_JSON=$(curl -sf -b "$COOKIES" -X POST "$API/api/projects" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Sample App\",\"slug\":\"$SLUG\",\"repoUrl\":\"file:///fixtures/sample-app\",\"productionBranch\":\"main\",\"previewBranches\":[\"$PREVIEW_BRANCH\"],\"internalPort\":3000,\"healthPath\":\"/\",\"webhookSecret\":\"$WEBHOOK_SECRET\"}")
PROJECT_ID=$(echo "$PROJECT_JSON" | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).id))")
echo "    project: $PROJECT_ID"

# Fires a signed push webhook for one ref/sha and blocks until the deployment finishes.
# Echoes the deployment id; exits non-zero (after dumping build logs) if it fails.
deploy_ref() {
  local ref="$1" sha="$2"

  node -e "
const fs = require('fs');
fs.writeFileSync('payload.json', JSON.stringify({
  ref: '$ref',
  deleted: false,
  after: '$sha',
  head_commit: { id: '$sha', message: 'e2e commit' },
  repository: { clone_url: 'file:///fixtures/sample-app', full_name: 'local/sample-app' },
}));
"
  local signature
  signature=$(node -e "
const crypto = require('crypto');
const body = require('fs').readFileSync('payload.json');
console.log('sha256=' + crypto.createHmac('sha256', '$WEBHOOK_SECRET').update(body).digest('hex'));
")

  local deployment_id
  deployment_id=$(curl -sf -X POST "$API/webhooks/github/$PROJECT_ID" \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Event: push" \
    -H "X-Hub-Signature-256: $signature" \
    --data-binary @payload.json |
    node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).deploymentId))")

  local status=""
  for _ in $(seq 1 120); do
    status=$(curl -sf -b "$COOKIES" "$API/api/deployments/$deployment_id" | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).status))")
    if [ "$status" = "SUCCESS" ] || [ "$status" = "FAILED" ]; then break; fi
    sleep 2
  done

  if [ "$status" != "SUCCESS" ]; then
    echo "    deployment $deployment_id did not succeed ($status) — logs:" >&2
    curl -sf -b "$COOKIES" "$API/api/deployments/$deployment_id/logs" |
      node -e "process.stdin.once('data',d=>{for(const l of JSON.parse(d)) console.log(l.stream+': '+l.message)})" >&2
    exit 1
  fi

  echo "$deployment_id"
}

# Retries because nginx's reload is graceful — in-flight workers finish on the old config.
assert_serves() {
  local url="$1" response=""
  for _ in $(seq 1 20); do
    response=$(curl -sf "$url" || true)
    [ -n "$response" ] && break
    sleep 1
  done
  echo "$response" | grep -q "hello from launchpad sample app" ||
    { echo "unexpected or empty response body from $url: $response" >&2; exit 1; }
  echo "    OK: $url"
}

PORT="${NGINX_HTTP_PORT:-80}"
DOMAIN="${DEPLOY_DOMAIN:-127.0.0.1.nip.io}"

# Reads a URL the API serialized (immutableUrl / branchUrl) and points it at nginx's port.
deployment_url() {
  curl -sf -b "$COOKIES" "$API/api/deployments/$1" |
    node -e "process.stdin.once('data',d=>{const u=JSON.parse(d)['$2']; if(!u){console.error('$2 was null');process.exit(1)} console.log(u.replace('$DOMAIN','$DOMAIN:$PORT'))})"
}

echo "==> deploying production branch (main)"
PROD_DEPLOYMENT=$(deploy_ref "refs/heads/main" "$SHA")
echo "    deployment: $PROD_DEPLOYMENT"

echo "==> checking production URLs through nginx"
assert_serves "http://$SLUG.$DOMAIN:$PORT/"
assert_serves "http://main--$SLUG.$DOMAIN:$PORT/"
PROD_IMMUTABLE=$(deployment_url "$PROD_DEPLOYMENT" immutableUrl)
assert_serves "$PROD_IMMUTABLE"

echo "==> preparing a commit on the preview branch"
git -C fixtures/sample-app branch -f "$PREVIEW_BRANCH" HEAD
PREVIEW_SHA=$(git -C fixtures/sample-app rev-parse "$PREVIEW_BRANCH")

echo "==> deploying preview branch ($PREVIEW_BRANCH)"
PREVIEW_DEPLOYMENT=$(deploy_ref "refs/heads/$PREVIEW_BRANCH" "$PREVIEW_SHA")
echo "    deployment: $PREVIEW_DEPLOYMENT"

echo "==> checking preview URLs through nginx"
assert_serves "http://$PREVIEW_BRANCH--$SLUG.$DOMAIN:$PORT/"
PREVIEW_IMMUTABLE=$(deployment_url "$PREVIEW_DEPLOYMENT" immutableUrl)
assert_serves "$PREVIEW_IMMUTABLE"

echo "==> checking the preview deploy left production alone"
assert_serves "http://$SLUG.$DOMAIN:$PORT/"
assert_serves "$PROD_IMMUTABLE"

echo "==> promoting the preview deployment to production"
curl -sf -b "$COOKIES" -X POST "$API/api/deployments/$PREVIEW_DEPLOYMENT/promote" >/dev/null
for _ in $(seq 1 60); do
  CURRENT=$(curl -sf -b "$COOKIES" "$API/api/projects/$PROJECT_ID" | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).currentDeploymentId))")
  [ "$CURRENT" != "$PROD_DEPLOYMENT" ] && break
  sleep 2
done
[ "$CURRENT" != "$PROD_DEPLOYMENT" ] || { echo "promote never took effect" >&2; exit 1; }
assert_serves "http://$SLUG.$DOMAIN:$PORT/"

echo "==> e2e OK"
