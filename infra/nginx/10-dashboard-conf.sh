#!/bin/sh
set -eu

: "${DASHBOARD_DOMAIN:?DASHBOARD_DOMAIN is required}"
conf=/etc/nginx/conf.d/00-dashboard.conf

if [ "${TLS_ENABLED:-false}" = "true" ]; then
  cat > "$conf" <<EOF
server {
    listen 80;
    server_name ${DASHBOARD_DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DASHBOARD_DOMAIN};
    ssl_certificate     /etc/nginx/certs/live/${DEPLOY_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/live/${DEPLOY_DOMAIN}/privkey.pem;
    location / {
        proxy_pass http://dashboard:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
else
  cat > "$conf" <<EOF
server {
    listen 80;
    server_name ${DASHBOARD_DOMAIN};
    location / {
        proxy_pass http://dashboard:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
fi
