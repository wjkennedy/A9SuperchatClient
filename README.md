# A9 Superchat

A9 Superchat is a Forge-native IRC client for Jira and Confluence, built around UI Kit surfaces, Jira/Confluence identity, Rovo agent workflows, and IRC over WebSocket.

The app brings IRC-style incident collaboration into Atlassian Cloud while keeping the important operational actions close to the chat: invite an agent, ask a triage question, distill a channel, and preserve bounded audit events for later RCA work.

## Current Features

- Native Forge UI Kit app shell for Jira and Confluence.
- Native IRC console with channel navigation, active-channel nick list, streaming transcript log, and bottom message entry.
- WebSocket IRC connection support for declared WSS origins.
- Editable IRC nick prefilled from Atlassian identity.
- Default channels: `#a9superchat` and `#atlassian`.
- Native WebSocket tester in Setup with Ergo, InspIRCd, and UnrealIRCd presets.
- Forge storage-backed user settings.
- Rovo agent workflows from the chat context:
  - invite an agent to the active channel
  - ask a Jira-grounded triage question
  - queue channel distillation for RCA or best-practice output
- Resolver-backed validation and audit/queue envelopes for agent actions.
- Rovo action module stubs for agent-driven triage and channel summaries.

## Forge Surfaces

- Jira global page: main A9 Superchat client.
- Confluence global page: same native app shell for Confluence users.
- Jira admin page: native configuration surface.
- Web trigger: incident intake entry point.
- Rovo agent/actions: incident triage and channel summary workflows.

## Project Layout

```text
src/
  index.js              # Forge resolvers, storage, Rovo actions, web trigger handlers
  frontend/index.jsx    # Native UI Kit app shell and IRC console
resources/rovo/         # Rovo prompt resources
tests/                  # Jest resolver tests
superchat/              # Original static client retained as reference code
manifest.yml            # Forge modules, resources, scopes, egress
deploy-production.sh
```

## Development

```sh
npm install
npm test
npm run lint
```

Deploy to Forge:

```sh
forge deploy
forge install
```

Production helper:

```sh
./deploy-production.sh
```

## WebSocket And CSP Notes

Forge frontend CSP only permits browser WebSocket connections to hosts declared in `permissions.external.fetch.client`.

The current manifest includes:

- `wss://testnet.ergo.chat`
- `wss://testnet.inspircd.org:8097`
- `wss://irc.unrealircd.org:7000`
- `wss://irc.unrealircd.org:8000`
- `*.superchat-relay.example.com`

For arbitrary IRC networks, use the planned relay instead of adding every network directly to the manifest. The relay is also the right boundary for persistent sessions, DCC-style file sharing, MCP tool calls, and cross-agent bridge work.

## Testing

```sh
npm test
```

The test suite covers:

- settings sanitization
- unsafe relay URL rejection
- Jira-backed Rovo triage queueing
- Jira identity bootstrap
- agent invite queueing
- invite blocking when disabled
- channel summary queueing

## Architecture

See [docs/forge-native-irc-architecture.md](docs/forge-native-irc-architecture.md) for the current architecture notes, including relay boundaries, Rovo/MCP/IRC bot responsibilities, file-sharing constraints, and future hardening work.

## Known Limits

- The native UI Kit console intentionally starts with a bounded IRC feature set.
- mIRC colors, command history, scrollback search, richer channel mode handling, and advanced nick UX still need to be moved over from the original static client.
- Direct browser WSS works only for manifest-declared hosts.
- Long-lived production IRC sessions should move behind a remote relay.
