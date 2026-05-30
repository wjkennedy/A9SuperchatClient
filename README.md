# A9 Superchat

A9 Superchat is a Forge-native IRC client for Jira and Confluence, built around UI Kit surfaces, Jira/Confluence identity, Rovo agent workflows, and IRC over WebSocket.

The app brings IRC-style incident collaboration into Atlassian Cloud while keeping the important operational actions close to the chat: invite an agent, ask a triage question, distill a channel, and preserve bounded audit events for later RCA work.

## Current Features

- Native Forge UI Kit app shell for Jira and Confluence.
- Native IRC console with channel navigation, active-channel nick list, streaming transcript log, and bottom message entry.
- Unread and mention indicators on channel buttons.
- Channel topic/header support.
- IRC command coverage for `/join`, `/part`, `/msg`, `/me`, `/topic`, `/names`, `/whois`, `/invite`, `/raw`, and `/quote`.
- Soft session persistence: channel state, nick lists, transcript, active window, draft input, and reconnect intent survive refresh/navigation.
- Saved autoconnect option: when connection config is present, the app opens Connect and reconnects/rejoins automatically.
- WebSocket IRC connection support for declared WSS origins.
- Editable IRC nick prefilled from Atlassian identity.
- Default channels: `#a9superchat` and `#atlassian`.
- Native WebSocket tester in Setup with Ergo, InspIRCd, and UnrealIRCd presets.
- Forge storage-backed user settings.
- Bot callback webtriggers for IRC-side `/invite`, `ask`, `distill`, `help`, join welcomes, and invite events.
- Persistent `A9SysOp` IRC bot runtime that connects over real TCP/TLS IRC, calls Forge webtriggers, and translates Forge actions back into IRC.
- Browser-to-bot context handoff: the UI stores bounded RAG context in Forge, sends a short context ID through IRC, and lets `A9SysOp` load it through the normal webtrigger path.
- Production callback controls for shared bot token, channel allowlist, redaction, and storage-backed per-minute throttling.
- Rovo agent workflows from the chat context:
  - invite an agent to the active channel
  - ask a Jira-grounded triage question
  - queue channel distillation for RCA or best-practice output
- Resolver-backed validation and audit/queue envelopes for agent actions.
- Rovo action module stubs for agent-driven triage and channel summaries.
- Purpose-built Rovo Agent: `A9 Superchat Channel Operator`, tailored to demonstrate and operate the IRC/Jira/Confluence workflow.

## Forge Surfaces

- Jira global page: main A9 Superchat client.
- Confluence global page: same native app shell for Confluence users.
- Jira admin page: native configuration surface.
- Web triggers: incident intake, IRC command callback, and IRC event callback entry points.
- Rovo agent/actions: incident triage and channel summary workflows.

## IRC Bot Callback Contract

A persistent IRC bot can call Forge webtriggers when channel activity should cross into the A9 Superchat/Rovo layer. The bot remains the IRC socket holder; Forge validates and records bounded envelopes, fetches Jira context when needed, queues agent work, and returns IRC-ready actions.

Supported command callback payload:

```json
{
  "channel": "#a9superchat",
  "actorNick": "ada",
  "command": "ask",
  "args": ["CS-123", "What evidence is missing?"]
}
```

Supported commands:

- `help`: returns the available A9 commands.
- `context ID`: loads a browser-prepared Forge context bundle for the channel without dumping the context into IRC.
- `invite [agent name]`: queues a Rovo/agent invite for the channel.
- `ask ISSUE-123 question`: fetches Jira issue context and queues a focused triage message.
- `distill [format]`: queues an RCA, timeline, handoff, best-practice, or summary job.

Supported event callback payload:

```json
{
  "channel": "#a9superchat",
  "type": "join",
  "actorNick": "ada",
  "botNick": "A9Rovo"
}
```

Supported events:

- `join`: returns a short welcome action for new channel members.
- `invite`: queues an invite for `A9 Superchat Channel Operator` or the supplied `agentName`.

The webtrigger responses include `actions` with `type: "irc-message"`, `channel`, optional `target`, and `text`. The IRC bot should translate those actions into `PRIVMSG` or notice behavior appropriate for the network.

If `SUPERCHAT_BOT_TOKEN` is configured in Forge environment variables, the bot must send that value in the `x-superchat-bot-token` header. Without that variable, the callbacks remain open for local development and should not be exposed as production bot endpoints.

For public bot endpoints, also configure:

```text
SUPERCHAT_ALLOWED_CHANNELS=#a9superchat,#atlassian,#p1
SUPERCHAT_CALLBACK_RATE_LIMIT_PER_MINUTE=6
```

Run the included persistent IRC bot with real Forge webtrigger URLs:

```sh
cd SuperchatServer
IRC_SERVER=irc.libera.chat \
IRC_PORT=6697 \
IRC_TLS=true \
IRC_NICK=A9SysOp \
IRC_CHANNELS=#a9superchat,#atlassian \
SUPERCHAT_COMMAND_URL=<superchat-irc-command URL> \
SUPERCHAT_EVENT_URL=<superchat-irc-event URL> \
SUPERCHAT_BOT_TOKEN=<shared callback token> \
npm run bot
```

The browser context flow is:

1. In the Forge UI, connect to IRC and choose a channel.
2. Press `Summon A9SysOp`.
3. Forge stores a short-lived context bundle containing page metadata and recent visible channel lines.
4. The browser sends `A9SysOp: context <id>` to IRC over the existing WebSocket connection.
5. The persistent IRC bot sees that channel message, calls `superchat-irc-command`, and Forge activates the context for that channel.

## Project Layout

```text
src/
  index.js              # Forge resolvers, storage, Rovo actions, web trigger handlers
  irc-utils.js          # Forge-side IRC channel and redaction helpers
  frontend/index.jsx    # Native UI Kit app shell and IRC console
resources/rovo/         # Rovo prompt resources
tests/                  # Jest resolver tests
superchat/              # Original static client retained as reference code
manifest.yml            # Forge modules, resources, scopes, egress
deploy-production.sh
SuperchatServer/        # Backend runtime: IRC bot, InspIRCd, gateway, tunnel config, scripts
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

- `wss://irc.a9group.net`
- `wss://irc.a9group.net:809`
- `wss://irc.a9group.net:443`
- `wss://testnet.ergo.chat`
- `wss://testnet.inspircd.org:8097`
- `wss://irc.unrealircd.org:7000`
- `wss://irc.unrealircd.org:8000`
- `*.superchat-relay.example.com`

For arbitrary browser-connected IRC networks, add the exact WSS origin to the manifest before deployment. A persistent IRC bot is the right first boundary for always-on channel presence, Rovo callbacks, MCP tool calls, and cross-agent bridge work.

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
- IRC command webtrigger behavior
- IRC event webtrigger join and invite behavior
- bot command parsing, action translation, allowlist, rate-limit, and redaction behavior

## Architecture

See [docs/forge-native-irc-architecture.md](docs/forge-native-irc-architecture.md) for the current architecture notes, including persistent bot boundaries, Rovo/MCP/IRC bot responsibilities, file-sharing constraints, and future hardening work.

See [docs/irc-bot-manifestation-guide.md](docs/irc-bot-manifestation-guide.md) for the persistent IRC bot setup guide, webtrigger payloads, command behavior, and deployment checklist.

See [SuperchatServer/docs/irc-inspircd-cloudflare-runbook.md](SuperchatServer/docs/irc-inspircd-cloudflare-runbook.md) for bootstrapping the A9 InspIRCd container, A9SysOp, and the Cloudflare Tunnel for `wss://irc.a9group.net`.

See [docs/execution/forgellm-irc-execution-tracking.md](docs/execution/forgellm-irc-execution-tracking.md) for the Jira execution hierarchy and scripted backlog provisioning workflow.

## Known Limits

- The native UI Kit console intentionally starts with a bounded IRC feature set.
- Refresh/navigation still tears down the browser-owned WebSocket; the app restores state and reconnects automatically, rather than preserving the same underlying IRC socket.
- mIRC colors, command history, scrollback search, richer channel mode handling, and advanced nick UX still need to be moved over from the original static client.
- Direct browser WSS works only for manifest-declared hosts.
- Long-lived production IRC presence should be handled by a persistent IRC bot; the browser console restores and reconnects its own UI session.
- Production bot callbacks should set `SUPERCHAT_BOT_TOKEN` and use tenant/channel allowlists before public exposure.
- The included bot needs a real IRC network and real Forge webtrigger URLs; it is not a local relay substitute.
