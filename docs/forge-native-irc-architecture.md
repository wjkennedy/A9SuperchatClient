# Forge-Native IRC Architecture

SuperChat should become a hybrid Forge app: Forge provides identity, product context, storage, Rovo actions, audit, and admin configuration; a remote relay provides persistent IRC/WSS sessions, channel fanout, DCC-like transfer, and MCP bridge execution.

## Interaction Model

- Primary: UI-driven Custom UI global page in Jira and Confluence.
- Secondary: event/API-driven incident intake through Forge web triggers and product events.
- AI path: Rovo Agent plus Forge actions for channel invite, triage questions, transcript distillation, and Jira/Confluence updates.
- Job path: asynchronous transcript summarization, RCA creation, and best-practice updates.

Custom UI is justified because an IRC client needs persistent input focus, dense transcript rendering, channel/nick panes, IRC formatting, keyboard command handling, WSS client logic, and mobile layout control.

## Product Surfaces

- Jira global page: daily IRC client and incident-room entry point.
- Confluence global page: knowledge work and channel-to-page distillation.
- Jira admin page: relay URL, allowed networks, retention, Rovo/MCP bridge policy, and DCC policy.
- Modal console shell: the Custom UI can run as a Quake-style overlay toggled with `~`, keeping IRC available as an ambient tool while users work in Jira or Confluence.
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

## Remote Relay Boundary

Forge functions cannot be the IRC daemon connection holder. Persistent sockets, high-frequency fanout, DCC-like flows, MCP server calls, and binary transfer belong in a remote relay.

Forge frontend surfaces enforce CSP inside the Atlassian product frame. Direct browser WSS connections only work for hosts declared in `permissions.external.fetch.client`; arbitrary IRC network entry should therefore go through the relay, unless each network is deliberately added to the manifest.

The relay should expose:

- WSS endpoint for the Custom UI.
- Tenant-scoped session broker keyed by Forge installation/cloud ID.
- IRC adapter for WebSocket-capable networks and optional server-side TCP/TLS IRC.
- Message policy engine for channel allowlists, redaction, and audit sampling.
- MCP adapter that turns approved IRC bot commands into tool calls.
- Agent adapter that maps Rovo action requests to channel messages and maps channel responses back to queued jobs.

Forge should call the relay with signed, installation-scoped credentials. The browser should receive short-lived relay tokens from a resolver, not long-lived secrets.

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

Example P1 flow:

1. Jira Service Management P1 issue enters triage.
2. Automation or web trigger invokes SuperChat incident ingest.
3. Forge fetches issue summary/status/priority with `asApp`.
4. Rovo triage action posts a scoped question into `#p1` through the relay.
5. Level 2, engineering, or another agent replies in IRC.
6. Relay stores/audits the response envelope.
7. A transcript job distills facts into an RCA draft or Confluence best-practice update.

## Security Rules

- No Atlassian API calls from Custom UI.
- No permanent relay secret in the browser.
- Admin-gate relay, MCP, DCC, and retention configuration.
- Start read-only for Jira/Confluence scopes; add write scopes only for RCA page creation, issue comments, or attachment writes.
- Redact secrets before storing or forwarding transcripts.
- Avoid global realtime channels for sensitive incident content unless a signed token scopes subscribers to the tenant/channel.

## Current Scaffold

This repository now includes:

- `manifest.yml`: Jira/Confluence global pages, Jira admin page, Rovo agent/actions, and incident ingest web trigger.
- `src/index.js`: resolver bootstrap, settings persistence, Rovo triage action, summary queue stub, and incident ingest handler.
- `src/frontend/index.jsx`: UI Kit native shell for navigation, setup, Rovo controls, audit status, WebSocket testing, and a native chat console.
- `resources/rovo/prompts/incident-agent.txt`: first Rovo prompt.
- `tests/index.test.js`: resolver and permission-boundary-style unit tests with mocked Forge APIs.

The existing `superchat/` static client remains in the repository as a reference implementation, but the Forge app now renders the active chat console natively in UI Kit. The native console includes channel navigation, active-channel nick lists, a streaming transcript log, bottom message entry, and context actions for inviting agents, asking triage questions, and distilling the selected channel. The next implementation step is moving richer IRC affordances from the reference client into the native console incrementally, including scrollback search, formatting, and command history.

The Custom UI shell now includes an in-frame console modal. `~` or backquote toggles the console when focus is outside a text field, `Ctrl+~` toggles while typing, and `Esc` closes it.

The native UI Kit setup panel includes a WebSocket tester for validating IRC WebSocket endpoints before connecting the main client. Tester presets must be reflected in Forge `permissions.external.fetch.client` so browser CSP permits those WSS origins.

The Agents tab exposes native UI Kit controls for the high-value workflows: invite a Rovo agent into a channel, ask a Jira-grounded triage question in IRC, and queue a channel distillation job. The resolvers validate channel names, enforce the `allowRovoInvites` setting, fetch Jira issue context for triage questions, and persist queued relay/audit envelopes.

The legacy IRC renderer used inline style attributes for mIRC colors and nick coloring. The native UI Kit console avoids that CSP exception; a later hardening pass should add bounded formatting support through UI Kit-safe token rendering.
