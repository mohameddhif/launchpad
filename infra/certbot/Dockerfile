# Certbot plus the Docker CLI: DNS-01 renewal asks nginx to reload after a certificate changes.
FROM docker:27-cli
RUN apk add --no-cache python3 py3-pip \
  && pip install --no-cache-dir --break-system-packages certbot certbot-dns-cloudflare
COPY infra/certbot/entrypoint.sh /usr/local/bin/certbot-renewer
COPY infra/certbot/reload-nginx.sh /usr/local/bin/reload-nginx
RUN chmod +x /usr/local/bin/certbot-renewer /usr/local/bin/reload-nginx
ENTRYPOINT ["/usr/local/bin/certbot-renewer"]
