#!/usr/bin/env sh
set -eu

ENV_FILE="${ENV_FILE:-.env.a9superchat}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.a9superchat.example first." >&2
  exit 1
fi

get_env() {
  key="$1"
  grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | sed "s/^${key}=//"
}

TUNNEL_ID="${CLOUDFLARED_TUNNEL_ID:-$(get_env CLOUDFLARED_TUNNEL_ID || true)}"
HOSTNAME="${CLOUDFLARED_DNS_HOSTNAME:-$(get_env CLOUDFLARED_DNS_HOSTNAME || true)}"

HOSTNAME="${HOSTNAME:-irc.a9group.net}"

if [ -z "$TUNNEL_ID" ]; then
  echo "CLOUDFLARED_TUNNEL_ID is required." >&2
  echo "The CNAME target should be: <tunnel-id>.cfargotunnel.com" >&2
  exit 1
fi

echo "Routing ${HOSTNAME} to Cloudflare tunnel ${TUNNEL_ID}..."
echo "Equivalent DNS CNAME: ${HOSTNAME} -> ${TUNNEL_ID}.cfargotunnel.com"

cloudflared tunnel route dns "$TUNNEL_ID" "$HOSTNAME"
