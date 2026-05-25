#!/usr/bin/env sh
set -eu

ENV_FILE="${ENV_FILE:-.env.a9superchat}"
CONFIG_FILE="${CONFIG_FILE:-docker/cloudflared/config.yml}"
CREDENTIALS_FILE="${CREDENTIALS_FILE:-docker/cloudflared/credentials.json}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.a9superchat.example first." >&2
  exit 1
fi

get_env() {
  key="$1"
  grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | sed "s/^${key}=//"
}

TUNNEL_ID="${CLOUDFLARED_TUNNEL_ID:-$(get_env CLOUDFLARED_TUNNEL_ID || true)}"
HOSTNAME="${CLOUDFLARED_HOSTNAME:-$(get_env CLOUDFLARED_HOSTNAME || true)}"
SERVICE="${CLOUDFLARED_SERVICE:-$(get_env CLOUDFLARED_SERVICE || true)}"

HOSTNAME="${HOSTNAME:-irc.a9group.net}"
SERVICE="${SERVICE:-http://inspircd:8097}"

if [ -z "$TUNNEL_ID" ]; then
  echo "CLOUDFLARED_TUNNEL_ID is required for local-managed tunnel mode." >&2
  exit 1
fi

if [ ! -f "$CREDENTIALS_FILE" ]; then
  echo "Missing $CREDENTIALS_FILE." >&2
  echo "Create or copy the Cloudflare tunnel credentials JSON there." >&2
  exit 1
fi

mkdir -p "$(dirname "$CONFIG_FILE")"

cat > "$CONFIG_FILE" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: ${HOSTNAME}
    service: ${SERVICE}
  - service: http_status:404
EOF

echo "Wrote $CONFIG_FILE"
echo "Tunnel hostname: ${HOSTNAME}"
echo "Tunnel service:  ${SERVICE}"
