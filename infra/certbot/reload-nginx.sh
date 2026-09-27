#!/bin/sh
set -eu
nginx_id=$(docker ps -q --filter 'label=launchpad.role=nginx' | head -n 1)
if [ -z "$nginx_id" ]; then
  echo 'nginx container not found; certificate will be loaded on its next start' >&2
  exit 0
fi
docker exec "$nginx_id" nginx -t
docker exec "$nginx_id" nginx -s reload
