#!/usr/bin/env sh
set -eu

HOSTNAME="${1:-irc.a9group.net}"

echo "Checking DNS for ${HOSTNAME}..."
DNS_RESULT=""
if command -v dig >/dev/null 2>&1; then
  DNS_RESULT="$(dig +short "$HOSTNAME" 2>/dev/null || true)"
fi
if [ -z "$DNS_RESULT" ] && command -v nslookup >/dev/null 2>&1; then
  DNS_RESULT="$(nslookup "$HOSTNAME" 2>/dev/null | sed -n '/^Name:/,$p' || true)"
fi
if [ -z "$DNS_RESULT" ] && command -v getent >/dev/null 2>&1; then
  DNS_RESULT="$(getent hosts "$HOSTNAME" 2>/dev/null || true)"
fi

if [ -z "$DNS_RESULT" ]; then
  echo "No DNS answer for ${HOSTNAME}."
  echo "Expected CNAME target for a named tunnel: <tunnel-id>.cfargotunnel.com"
  exit 1
fi

printf '%s\n' "$DNS_RESULT"

echo
echo "Checking public WebSocket upgrade..."
{
  printf 'GET / HTTP/1.1\r\n'
  printf 'Host: %s\r\n' "$HOSTNAME"
  printf 'Connection: Upgrade\r\n'
  printf 'Upgrade: websocket\r\n'
  printf 'Sec-WebSocket-Version: 13\r\n'
  printf 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
  printf 'Sec-WebSocket-Protocol: text.ircv3.net, binary.ircv3.net\r\n'
  printf '\r\n'
} | openssl s_client -quiet -servername "$HOSTNAME" -connect "${HOSTNAME}:443" 2>/dev/null | sed -n '1,10p'
