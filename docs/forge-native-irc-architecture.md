# Forge-Native IRC Architecture

A9 Superchat is a Forge-native IRC client and agent bridge: Forge provides identity, product context, storage, Rovo actions, audit, UI Kit surfaces, and bot callback endpoints; a persistent IRC bot or future relay provides long-lived IRC/WSS sessions, channel fanout, DCC-like transfer, and MCP bridge execution.

## Interaction Model

- Primary: UI-driven UI Kit global page in Jira and Confluence.
- Secondary: event/API-driven incident intake and IRC bot callbacks through Forge web triggers and product events.
- AI path: Rovo Agent plus Forge actions for channel invite, triage questions, transcript distillation, and Jira/Confluence updates.
- Job path: asynchronous transcript summarization, RCA creation, and best-practice updates.

UI Kit is the default surface because A9 Superchat should feel native inside Atlassian Cloud. The current console uses native components for channel navigation, transcript display, action buttons, setup controls, and agent workflows. Any future Custom UI surface should be limited to rendering needs UI Kit cannot satisfy.

## Product Surfaces

- Jira global page: daily IRC client and incident-room entry point.
- Confluence global page: knowledge work and channel-to-page distillation.
- Jira admin page: relay URL, allowed networks, retention, Rovo/MCP bridge policy, and DCC policy.
- Modal console shell: a future overlay can be toggled with `~`, keeping IRC available as an ambient tool while users work in Jira or Confluence.
- Future Jira issue panel: issue-scoped channel launcher, transcript links, RCA status, and active agent participants.
- Future Confluence macro: embed an incident transcript summary or RCA page status.

## Identity

Forge should derive identity from Jira first, then Confluence, then Forge context. The generated IRC nick should be a sanitized display-name default, but users need an override because IRC nick policy varies by network.

Use `asUser` for user-visible identity and permission-sensitive reads. Use `asApp` for background incident intake, queued Rovo actions, and app-owned audit records.

## Storage Model

- User settings: per-account Forge storage, keyed by account ID.
- Site settings: app-scoped Forge storage for relay URL, allowed IRC networks, retention, and bridge policy.
- Channel audit: retained event envelopes, not full unrestricted logs by default.
- Transcript jobs: queue state for RCA and best-practice generation.
- File metadata: Forge storage records pointing to Atlassian attachments or remote relay object storage, never raw unbounded binaries in Forge storage.

Retention should default short. Channel logs are operational records that can contain customer data, credentials, or incident-sensitive material.

## Persistent Bot And Relay Boundary

Forge functions cannot be the IRC daemon connection holder. Persistent sockets, high-frequency fanout, DCC-like flows, MCP server calls, and binary transfer belong in a persistent IRC bot or remote relay.

Forge frontend surfaces enforce CSP inside the Atlassian product frame. Direct browser WSS connections only work for hosts declared in `permissions.external.fetch.client`; arbitrary browser-connected IRC network entry therefore requires adding each network deliberately to the manifest.

The first production bridge can be a persistent IRC bot rather than a full relay. It should hold the IRC session, watch channel events and commands, call Forge webtriggers, and translate returned `irc-message` actions back into IRC. A full relay can later take over browser session persistence, fanout, DCC-like file transfer, MCP execution, and server-side TCP/TLS IRC.

The bot/relay should expose or support:

- Optional WSS endpoint for future browser fanout if direct IRC WSS is not enough.
- Tenant-scoped session broker keyed by Forge installation/cloud ID.
- IRC adapter for WebSocket-capable networks and optional server-side TCP/TLS IRC.
- Message policy engine for channel allowlists, redaction, and audit sampling.
- Forge webtrigger callbacks for IRC commands and channel events.
- MCP adapter that turns approved IRC bot commands into tool calls.
- Agent adapter that maps Rovo action requests to channel messages and maps channel responses back to queued jobs.

A future relay should use signed, installation-scoped credentials. The browser should receive short-lived relay tokens from a resolver, not long-lived secrets.

## DCC And File Sharing

Classic DCC is not a good fit for Forge or browsers because it assumes direct peer connectivity and arbitrary TCP/file transfer. The Forge-ready equivalent should be:

- Upload through Jira issue attachments or Confluence attachments when product context exists.
- Use remote relay object storage for channel-only files, with short-lived signed URLs.
- Post IRC CTCP-style notices that point to governed HTTPS/WSS transfer links.
- Keep DCC disabled by default until admin policy, malware scanning, retention, and audit are implemented.

## Rovo, Agents, And IRC Bots

The bot model should deliberately blur Rovo Agent, MCP tool, and IRC bot, but permission boundaries must stay explicit.

- Rovo Agent: decides what to ask or summarize, grounded in Jira/Confluence context.
- Forge action: validates inputs, fetches permitted product context, and queues relay work.
- IRC bot persona: posts concise channel messages and collects replies.
- MCP bridge: executes approved external skills only when the channel, tenant, and command policy allow it.
- Webtrigger callbacks: let the persistent IRC bot ask Forge what to do when it sees `/invite`, `ask`, `distill`, `help`, joins, and invite events.

Example P1 flow:

1. Jira Service Management P1 issue enters triage.
2. Automation or web trigger invokes SuperChat incident ingest.
3. Forge fetches issue summary/status/priority with `asApp`.
4. Rovo triage action posts a scoped question into `#p1` through the bot/relay.
5. Level 2, engineering, or another agent replies in IRC.
6. Relay stores/audits the response envelope.
7. A transcript job distills facts into an RCA draft or Confluence best-practice update.

## Security Rules

- No Atlassian API calls from the frontend.
- No permanent relay secret in the browser.
- Admin-gate relay, MCP, DCC, and retention configuration.
- Start read-only for Jira/Confluence scopes; add write scopes only for RCA page creation, issue comments, or attachment writes.
- Redact secrets before storing or forwarding transcripts.
- Avoid global realtime channels for sensitive incident content unless a signed token scopes subscribers to the tenant/channel.

## Current Scaffold

This repository now includes:

- `manifest.yml`: Jira/Confluence global pages, Jira admin page, Rovo agent/actions, incident ingest webtrigger, IRC command webtrigger, and IRC event webtrigger.
- `src/index.js`: resolver bootstrap, settings persistence, Rovo triage action, summary queue stub, incident ingest handler, IRC command callback, and IRC event callback.
- `src/irc-utils.js`: Forge-side IRC channel normalization and secret redaction helpers.
- `src/frontend/index.jsx`: UI Kit native shell for navigation, setup, Rovo controls, audit status, WebSocket testing, and a native chat console.
- `SuperchatServer/`: backend runtime split containing the persistent Node IRC bot, IRC helper library, InspIRCd, gateway, Cloudflare Tunnel config, and operational scripts.
- `resources/rovo/prompts/incident-agent.txt`: first Rovo prompt.
- `tests/index.test.js`: resolver and permission-boundary-style unit tests with mocked Forge APIs.

The existing `superchat/` static client remains in the repository as a reference implementation, but the Forge app now renders the active chat console natively in UI Kit. The native console includes channel navigation, unread/mention indicators, topic headers, active-channel nick lists, a streaming transcript log, bottom message entry, common IRC commands, and context actions for inviting agents, asking triage questions, and distilling the selected channel. Console state is persisted locally so channel state, transcript, active window, input draft, nick lists, and reconnect intent survive refresh/navigation. Because there is no relay, refresh still tears down the browser WebSocket; the app restores the visible state and reconnects/rejoins automatically rather than preserving the same socket. The next implementation step is moving richer IRC affordances from the reference client into the native console incrementally, including scrollback search, formatting, and command history.

The native UI Kit console is the active chat surface. A future overlay can reuse the same console state and actions for `~`/backquote toggling if Forge module placement allows it.

The native UI Kit setup panel includes a WebSocket tester for validating IRC WebSocket endpoints before connecting the main client. Tester presets must be reflected in Forge `permissions.external.fetch.client` so browser CSP permits those WSS origins.

The Agents tab exposes native UI Kit controls for the high-value workflows: invite a Rovo agent into a channel, ask a Jira-grounded triage question in IRC, and queue a channel distillation job. The resolvers validate channel names, enforce the `allowRovoInvites` setting, fetch Jira issue context for triage questions, and persist queued relay/audit envelopes.

The bot callback endpoints expose the same workflows to IRC itself. The included persistent bot calls the command webtrigger for `help`, `context`, `invite`, `ask`, and `distill`; it calls the event webtrigger for joins and IRC invite events. Forge returns bounded `irc-message` actions so the bot can welcome new joiners, activate browser-prepared context, acknowledge agent invites, and post queued Rovo triage text back into the channel. If `SUPERCHAT_BOT_TOKEN` is set, callbacks require the same value in the `x-superchat-bot-token` header. Production exposure should also set `SUPERCHAT_ALLOWED_CHANNELS` and `SUPERCHAT_CALLBACK_RATE_LIMIT_PER_MINUTE`, which are enforced inside the Forge webtrigger handlers.

The browser context handoff uses IRC as the SMS-like transport instead of as a data dump. A UI button calls `prepareBotContext`, which stores a short-lived Forge context bundle containing page metadata and recent visible channel lines. The browser then sends only `A9SysOp: context <id>` into IRC over its existing WebSocket connection. The persistent bot receives that addressed command, calls Forge, and Forge activates the context for that tenant/channel. This keeps RAG payloads in Forge storage while letting IRC trigger multi-agent and multi-bot automation.

The legacy IRC renderer used inline style attributes for mIRC colors and nick coloring. The native UI Kit console avoids that CSP exception; a later hardening pass should add bounded formatting support through UI Kit-safe token rendering.
