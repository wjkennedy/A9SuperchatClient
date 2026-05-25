# A9 Superchat InspIRCd And Cloudflare Tunnel Runbook

This runbook brings up the A9 Superchat IRC network endpoint at `irc.a9group.net` using:

- InspIRCd for IRC and IRC-over-WebSocket.
- Cloudflare Tunnel for public `wss://irc.a9group.net`.
- A9SysOp for IRC-to-Forge/Rovo bot callbacks.

## Topology

```text
Browser / A9 Superchat
  wss://irc.a9group.net
        |
        v
Cloudflare Tunnel
        |
        v
inspircd:8097  IRC over WebSocket

A9SysOp bot
        |
        v
inspircd:6667  internal IRC
        |
        v
Forge webtriggers for Rovo actions
```

The public browser path is WSS at Cloudflare. Inside Docker, cloudflared forwards to the InspIRCd WebSocket listener on plain HTTP/WebSocket.

## Host And Port Matrix

| Layer | Host | Port | Scheme | Purpose |
| --- | --- | ---: | --- | --- |
| Forge manifest client egress | `irc.a9group.net` | `443` | `wss` | Browser IRC-over-WebSocket from A9 Superchat |
| A9 Superchat default config | `irc.a9group.net` | `443` | `wss` | Default Connect target |
| A9 Superchat tester preset | `irc.a9group.net` | implicit `443` | `wss` | Setup pane endpoint validation |
| Cloudflare public hostname | `irc.a9group.net` | `443` | `wss` | Public TLS termination and WebSocket upgrade |
| Cloudflare tunnel service target | `inspircd` | `8097` | `http` / `ws` | Internal Docker WebSocket forwarding target |
| InspIRCd WebSocket listener | `inspircd` | `8097` | `ws` | IRC-over-WebSocket listener inside Docker |
| InspIRCd plain IRC listener | `inspircd` | `6667` | `irc` | Internal bot/server IRC |
| A9SysOp IRC target | `inspircd` | `6667` | `irc` | Bot connection inside Docker |
| Optional host-published local WS | `localhost` | `8097` | `ws` | Local non-Forge debugging |
| Optional host-published local IRC | `localhost` | `6667` | `irc` | Local IRC client debugging |

Do not expose public `wss://irc.a9group.net:8097`. The public browser endpoint should stay on standard WSS port `443`; Cloudflare forwards internally to `inspircd:8097`.

If A9 Superchat attempts `wss://irc.a9group.net:8097`, reset the saved Connect settings or use the A9 InspIRCd tester preset again. The public browser URL is `wss://irc.a9group.net`; `8097` is only the Docker-internal Cloudflare origin target.

## Files

```text
docker-compose.irc.yml
docker-compose.irc.local-tunnel.yml
docker/inspircd/a9superchat.conf
docker/inspircd/motd.txt
docker/cloudflared/config.yml.example
docker/a9sysop/Dockerfile
.env.a9superchat.example
scripts/start-a9-irc-stack.sh
scripts/irc-stack.sh
scripts/prepare-cloudflared-irc-config.sh
scripts/route-cloudflared-irc-dns.sh
scripts/check-a9-irc-public.sh
scripts/test-a9-irc-local.sh
```

## Cloudflare Tunnel

There are two supported cloudflared modes.

### Token Mode

Token mode uses a remotely managed tunnel token:

```sh
cloudflare/cloudflared:latest tunnel --no-autoupdate run --token "$CLOUDFLARED_TOKEN"
```

In token mode, cloudflared does not read local ingress rules. The `CLOUDFLARED_TOKEN` points at the remote Cloudflare Zero Trust configuration, so the public hostname and service target must be correct in the Cloudflare dashboard.

In Cloudflare Zero Trust, configure the public hostname:

```text
Hostname: irc.a9group.net
Service:  http://inspircd:8097
```

The `inspircd` hostname resolves inside the Docker Compose network. Do not use `localhost` here when cloudflared runs as a container. In the cloudflared container, `localhost` means the cloudflared container itself, not the InspIRCd container.

Incorrect remote tunnel targets:

```text
tcp://localhost:8097
tcp://localhost:6667
tcp://localhost:443
```

Correct remote tunnel target for browser WSS:

```text
http://inspircd:8097
```

Cloudflare receives public `wss://irc.a9group.net` and forwards the WebSocket upgrade over plain HTTP to InspIRCd's internal WebSocket listener.

### Local-Managed Mode

Local-managed mode lets the repo-generated cloudflared config own the ingress rules:

```yaml
tunnel: <cloudflare-tunnel-id>
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: irc.a9group.net
    service: http://inspircd:8097
  - service: http_status:404
```

Use this mode when you want cloudflared in Docker to make the correct service mapping happen from local config instead of relying on dashboard ingress.

Requirements:

- `docker/cloudflared/credentials.json` from a Cloudflare named tunnel.
- `CLOUDFLARED_TUNNEL_ID` in `.env.a9superchat`.
- DNS route for `irc.a9group.net` to the tunnel.

Prepare local-managed config:

```sh
TUNNEL_MODE=local scripts/prepare-cloudflared-irc-config.sh
```

Start local-managed tunnel mode:

```sh
TUNNEL_MODE=local npm run irc:start
```

The wrapper automatically includes `docker-compose.irc.local-tunnel.yml`, generates `docker/cloudflared/config.yml`, and mounts the credentials/config files into the cloudflared container.

### DNS Route

Cloudflared can create the DNS route when your local Cloudflare CLI is authenticated:

```sh
npm run irc:tunnel:route-dns
```

That runs:

```sh
cloudflared tunnel route dns "$CLOUDFLARED_TUNNEL_ID" "$CLOUDFLARED_DNS_HOSTNAME"
```

For the current tunnel, the DNS record should be a CNAME:

```text
irc.a9group.net -> 23588bbe-9c23-4259-b4ce-a15b5261a08f.cfargotunnel.com
```

If using a remotely managed token without local Cloudflare credentials, create that public hostname/DNS route in Cloudflare Zero Trust instead.

The DNS record for `irc.a9group.net` must be created by the Cloudflare Tunnel public hostname. A public test should return a WebSocket upgrade:

```sh
curl --max-time 8 -i --http1.1 \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Sec-WebSocket-Protocol: text.ircv3.net, binary.ircv3.net' \
  https://irc.a9group.net/
```

Expected result:

```text
HTTP/1.1 101 Switching Protocols
Sec-WebSocket-Protocol: text.ircv3.net
```

If DNS does not resolve, fix the Cloudflare public hostname/DNS record first. If DNS resolves but the tunnel logs `dial tcp 127.0.0.1:*`, fix the tunnel service target to `http://inspircd:8097`.

Use the public checker:

```sh
npm run irc:check:public
```

For request-level tunnel troubleshooting, set:

```text
CLOUDFLARED_LOGLEVEL=debug
```

Then restart and watch logs:

```sh
npm run irc:restart
npm run irc:logs
```

If the Forge client attempts to connect and cloudflared logs nothing, the browser request is not reaching the tunnel. Check public DNS and Forge CSP/egress deployment.

If the browser console reports a `connect-src` Content Security Policy violation, redeploy and upgrade the Forge app so `manifest.yml` includes `wss://irc.a9group.net` and `wss://irc.a9group.net:443`.

## Environment

Create a local env file:

```sh
cp .env.a9superchat.example .env.a9superchat
```

Fill:

```text
CLOUDFLARED_TOKEN=<Cloudflare tunnel token>
CLOUDFLARED_TUNNEL_ID=<Cloudflare tunnel id for local-managed mode>
CLOUDFLARED_HOSTNAME=irc.a9group.net
CLOUDFLARED_SERVICE=http://inspircd:8097
CLOUDFLARED_DNS_HOSTNAME=irc.a9group.net
CLOUDFLARED_LOGLEVEL=info
SUPERCHAT_COMMAND_URL=<Forge superchat-irc-command URL>
SUPERCHAT_EVENT_URL=<Forge superchat-irc-event URL>
SUPERCHAT_INCIDENT_INGEST_URL=<Forge incident ingest URL>
SUPERCHAT_BOT_TOKEN=<shared token, optional but required for production>
```

Retrieve Forge webtrigger URLs after deploying the Forge app:

```sh
forge webtrigger get-url --key superchat-irc-command
forge webtrigger get-url --key superchat-irc-event
forge webtrigger get-url --key superchat-incident-ingest
```

If `SUPERCHAT_BOT_TOKEN` is set in Forge, set the same value in `.env.a9superchat`. A9SysOp sends it as `x-superchat-bot-token`.

## Start

```sh
scripts/start-a9-irc-stack.sh
```

Or:

```sh
npm run irc:start
```

Equivalent command:

```sh
docker compose --env-file .env.a9superchat -f docker-compose.irc.yml up -d --build
```

Wrapper commands:

```sh
scripts/irc-stack.sh start
scripts/irc-stack.sh stop
scripts/irc-stack.sh restart
scripts/irc-stack.sh status
scripts/irc-stack.sh logs
```

NPM aliases:

```sh
npm run irc:start
npm run irc:stop
npm run irc:restart
npm run irc:status
npm run irc:logs
```

## Validate

Check containers:

```sh
docker compose --env-file .env.a9superchat -f docker-compose.irc.yml ps
```

Watch logs:

```sh
docker compose --env-file .env.a9superchat -f docker-compose.irc.yml logs -f inspircd a9sysop cloudflared
```

Local smoke test:

```sh
scripts/test-a9-irc-local.sh
```

That checks:

- `localhost:6667` plain IRC
- `ws://localhost:8097` IRC-over-WebSocket

If A9SysOp logs `getaddrinfo ENOTFOUND inspircd`, it is not running on the `a9superchat-irc` Compose network. Start it through `docker compose` or, if running locally with `npm run bot`, set:

```sh
IRC_SERVER=127.0.0.1 IRC_PORT=6667 IRC_TLS=false npm run bot
```

From A9 Superchat Setup, use the `A9 InspIRCd` WebSocket tester preset:

```text
wss://irc.a9group.net
```

Then use `Use URL for Connect`, save settings, and open Connect.

## A9SysOp

A9SysOp joins:

```text
#a9superchat
#atlassian
```

Address it in-channel:

```text
A9SysOp: help
A9SysOp: invite A9 Superchat Channel Operator
A9SysOp: ask CS-123 What evidence is missing?
A9SysOp: distill rca
```

If Forge webtrigger URLs are not configured, A9SysOp still connects to IRC and reports that Forge callbacks are not configured when addressed.

## Forge Manifest

The Forge client egress list includes:

```yaml
- address: "wss://irc.a9group.net"
- address: "wss://irc.a9group.net:443"
```

The default A9 Superchat connection is:

```text
wss://irc.a9group.net:443
```

Cloudflare should accept both `wss://irc.a9group.net` and `wss://irc.a9group.net:443`.

## Stop

```sh
npm run irc:stop
```

## Production Notes

- Replace the placeholder InspIRCd `diepass` and `restartpass`.
- Keep Cloudflare and Forge bot tokens outside git.
- Configure channel allowlists before opening agent/MCP actions broadly.
- Rate-limit bot callbacks at both the bot and Forge edge.
- Treat channel logs as sensitive operational data.
