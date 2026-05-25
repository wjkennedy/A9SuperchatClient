#!/usr/bin/env sh
set -eu

ENV_FILE="${ENV_FILE:-.env.a9superchat}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.irc.yml}"
LOCAL_TUNNEL_COMPOSE_FILE="${LOCAL_TUNNEL_COMPOSE_FILE:-docker-compose.irc.local-tunnel.yml}"

usage() {
  cat <<'EOF'
Usage: scripts/irc-stack.sh <command>

Commands:
  start     Start or update the IRC stack.
  stop      Stop and remove the IRC stack containers.
  restart   Stop, then start the IRC stack.
  status    Show IRC stack container status.
  logs      Follow IRC stack logs.

Environment:
  ENV_FILE      Defaults to .env.a9superchat
  COMPOSE_FILE  Defaults to docker-compose.irc.yml
  TUNNEL_MODE   token or local. Defaults to value in ENV_FILE, then token.
EOF
}

require_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE. Copy .env.a9superchat.example and fill CLOUDFLARED_TOKEN." >&2
    exit 1
  fi
}

require_tunnel_token() {
  require_env_file
  if ! grep -Eq '^CLOUDFLARED_TOKEN=.' "$ENV_FILE"; then
    echo "CLOUDFLARED_TOKEN is required in $ENV_FILE." >&2
    exit 1
  fi
}

tunnel_mode() {
  mode="${TUNNEL_MODE:-}"
  if [ -z "$mode" ] && [ -f "$ENV_FILE" ]; then
    mode="$(grep -E '^TUNNEL_MODE=' "$ENV_FILE" | tail -n 1 | sed 's/^TUNNEL_MODE=//' || true)"
  fi
  echo "${mode:-token}"
}

compose_files() {
  mode="$(tunnel_mode)"
  if [ "$mode" = "local" ]; then
    printf '%s\n' -f "$COMPOSE_FILE" -f "$LOCAL_TUNNEL_COMPOSE_FILE"
  else
    printf '%s\n' -f "$COMPOSE_FILE"
  fi
}

compose() {
  # shellcheck disable=SC2046
  docker compose --env-file "$ENV_FILE" $(compose_files) "$@"
}

require_tunnel_config() {
  require_env_file
  mode="$(tunnel_mode)"
  case "$mode" in
    token)
      require_tunnel_token
      ;;
    local)
      scripts/prepare-cloudflared-irc-config.sh
      ;;
    *)
      echo "Unsupported TUNNEL_MODE=$mode. Use token or local." >&2
      exit 1
      ;;
  esac
}

command="${1:-}"

case "$command" in
  start)
    require_tunnel_config
    compose up -d --build
    ;;
  stop)
    require_env_file
    compose down
    ;;
  restart)
    require_tunnel_config
    compose down
    compose up -d --build
    ;;
  status)
    require_env_file
    compose ps
    ;;
  logs)
    require_env_file
    compose logs -f inspircd a9sysop cloudflared
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 1
    ;;
esac
