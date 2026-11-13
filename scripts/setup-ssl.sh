#!/usr/bin/env bash
# ==============================================================================
# SalonFlow SaaS Automated SSL/TLS Setup & Let's Encrypt Runner
# ==============================================================================
set -euo pipefail

CERTS_DIR="./docker/nginx/certs"
CERTBOT_DIR="./docker/nginx/certbot"
NGINX_CONF="./docker/nginx/nginx.conf"
NGINX_SSL_CONF="./docker/nginx/nginx.ssl.conf"

mkdir -p "${CERTS_DIR}" "${CERTBOT_DIR}"

DOMAIN="${1:-${SALONFLOW_DOMAIN:-}}"
MODE="${2:-auto}"

echo "======================================================================"
echo " SalonFlow Production SSL/TLS Configuration"
echo "======================================================================"

if [ -z "${DOMAIN}" ]; then
  echo "Usage: ./scripts/setup-ssl.sh <your-domain.com> [auto|certbot|self-signed]"
  echo "No domain provided. Checking existing certificates in ${CERTS_DIR}..."
fi

if [ -f "${CERTS_DIR}/fullchain.pem" ] && [ -f "${CERTS_DIR}/privkey.pem" ]; then
  echo "[SSL] Found valid certificates in ${CERTS_DIR}:"
  openssl x509 -in "${CERTS_DIR}/fullchain.pem" -noout -subject -dates || true
  echo "[SSL] Enabling SSL configuration (nginx.ssl.conf -> nginx.conf)..."
  cp "${NGINX_SSL_CONF}" "${NGINX_CONF}"
  echo "[SSL] SSL/TLS configuration is active! Reload Nginx via: docker compose -f docker-compose.prod.yml restart proxy"
  exit 0
fi

if [ "${MODE}" = "self-signed" ] || [ -z "${DOMAIN}" ]; then
  echo "[SSL] Generating fallback self-signed TLS certificates for local/staging verification..."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "${CERTS_DIR}/privkey.pem" \
    -out "${CERTS_DIR}/fullchain.pem" \
    -subj "/C=IN/ST=Maharashtra/L=Mumbai/O=SalonFlow/CN=localhost"
  echo "[SSL] Self-signed certificates generated successfully in ${CERTS_DIR}."
  exit 0
fi

if [ "${MODE}" = "certbot" ] || [ "${MODE}" = "auto" ]; then
  echo "[SSL] Requesting Let's Encrypt certificate for ${DOMAIN} via certbot..."
  if ! command -v certbot &> /dev/null; then
    echo "ERROR: certbot CLI is not installed on host. Install via: apt install certbot" >&2
    echo "Falling back to generating self-signed certificate for staging..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout "${CERTS_DIR}/privkey.pem" \
      -out "${CERTS_DIR}/fullchain.pem" \
      -subj "/C=IN/ST=Maharashtra/L=Mumbai/O=SalonFlow/CN=${DOMAIN}"
    exit 0
  fi

  certbot certonly --webroot -w "${CERTBOT_DIR}" \
    -d "${DOMAIN}" \
    --agree-tos \
    --non-interactive \
    --register-unsafely-without-email \
    --force-renewal

  cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${CERTS_DIR}/fullchain.pem"
  cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "${CERTS_DIR}/privkey.pem"
  chmod 600 "${CERTS_DIR}/privkey.pem"
  cp "${NGINX_SSL_CONF}" "${NGINX_CONF}"
  echo "[SSL] Production Let's Encrypt certificate deployed and SSL proxy enabled!"
fi
