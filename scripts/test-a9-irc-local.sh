#!/usr/bin/env sh
set -eu

echo "Checking local IRC TCP listener on localhost:6667..."
{
  printf 'NICK localtest%d\r\n' "$$"
  printf 'USER localtest 0 * :A9 local smoke test\r\n'
  sleep 1
  printf 'QUIT :local smoke test complete\r\n'
} | nc -w 4 127.0.0.1 6667 | sed -n '1,20p'

echo
echo "Checking local WebSocket listener on localhost:8097..."
{
  printf 'GET / HTTP/1.1\r\n'
  printf 'Host: 127.0.0.1:8097\r\n'
  printf 'Connection: Upgrade\r\n'
  printf 'Upgrade: websocket\r\n'
  printf 'Sec-WebSocket-Version: 13\r\n'
  printf 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
  printf 'Sec-WebSocket-Protocol: text.ircv3.net, binary.ircv3.net\r\n'
  printf '\r\n'
} | nc -w 4 127.0.0.1 8097 | sed -n '1,8p'
