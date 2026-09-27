#!/bin/sh
set -eu

: "${DEPLOY_DOMAIN:?DEPLOY_DOMAIN is required}"
: "${CERTBOT_EMAIL:?CERTBOT_EMAIL is required}"
: "${CLOUDFLARE_DNS_API_TOKEN:?CLOUDFLARE_DNS_API_TOKEN is required}"

credentials=/run/certbot/cloudflare.ini
mkdir -p /run/certbot
umask 077
printf 'dns_cloudflare_api_token = %s\n' "$CLOUDFLARE_DNS_API_TOKEN" > "$credentials"

# --keep-until-expiring makes the command safe on every container restart.
certbot certonly --non-interactive --agree-tos --keep-until-expiring \
  --email "$CERTBOT_EMAIL" --dns-cloudflare --dns-cloudflare-credentials "$credentials" \
  -d "$DEPLOY_DOMAIN" -d "*.$DEPLOY_DOMAIN"
/usr/local/bin/reload-nginx

while :; do
  sleep 12h
  certbot renew --non-interactive --deploy-hook /usr/local/bin/reload-nginx
done
