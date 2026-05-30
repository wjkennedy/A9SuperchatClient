# ForgeLLM-IRC Execution Tracking (MCP-First)

This package operationalizes `ForgeLLM-IRC.json` into a Jira hierarchy and execution backlog, with Atlassian Rovo MCP as the preferred execution path.

## Included Assets

- `docs/jira-backlog/forgellm-irc-backlog.json`
  - Source-of-truth backlog structure for initiative, epics, stories, and tasks.
- `scripts/render-mcp-jira-backlog-prompt.sh`
  - Renders a deterministic prompt for any MCP-capable client connected to Atlassian Rovo MCP.
- `AGENTS.md`
  - MCP execution defaults (project key, labels, hierarchy rules).
- `scripts/create-jira-execution-backlog.sh`
  - REST fallback when MCP tooling is unavailable.

## Preferred Path: Atlassian Rovo MCP

1. Ensure your MCP client is connected to `https://mcp.atlassian.com/v1/mcp`.
2. Ensure Atlassian admin settings allow your MCP client/domain and (if needed) API-token auth.
3. Render the creation prompt:

```bash
cd superchat
./scripts/render-mcp-jira-backlog-prompt.sh FIRC https://<your-site>.atlassian.net
```

4. Paste the output into your MCP-capable client and execute.

## MCP Security/Access Notes

- First-use org/site admin authorization may be required.
- Existing Jira permissions still apply to every tool call.
- IP allowlisting can block MCP traffic unless your source IP is allowed.

## REST Fallback

If MCP is unavailable, use:

```bash
cd superchat
./scripts/create-jira-execution-backlog.sh
```

with the environment variables documented in that script.

## Incident Ingest Runbook (FIRC-27)

This runbook applies to the Forge `incidentIngest` webtrigger path.

### Contract

- Accepts JSON payload with:
  - `channel` (IRC channel, default `#incident`)
  - `question` (optional triage text)
  - `issueKey` (optional Jira key)
  - `traceId` / `trace` metadata (optional)
- Optional headers:
  - `x-superchat-signature`: `sha256=<hex hmac>`
  - `x-idempotency-key`: caller-provided replay key
  - `x-trace-id`: fallback trace identifier

### Security

- If `SUPERCHAT_INGEST_SECRET` is set, signature validation is required.
- Signature failures return `401` and are logged as `incident-ingest-rejected`.

### Reliability and Replay Safety

- Dedupe key precedence:
  1. `x-idempotency-key`
  2. payload fingerprint hash (`ingest-fingerprint:*`)
- Ingest lifecycle states:
  - `processing`: first request accepted and currently in-flight
  - `complete`: request finished; retries return `duplicate: true`
  - `failed`: previous attempt failed; subsequent retry can re-attempt processing
- Concurrent retries during `processing` return `202 { ok: true, retryLater: true }`.

### Trace Translation Persistence

- Translation envelopes persist under `trace-translation:*`.
- Retention is bounded by `SUPERCHAT_TRACE_RETENTION_DAYS` (clamped 1..30, default 14).
- Stored record includes `createdAt`, `expiresAt`, normalized fields, and confidence metadata.

### Operational Checks

1. Verify malformed payloads return `400` and emit `incident-ingest-invalid`.
2. Verify duplicate payload retries return `202` with either `duplicate` or `retryLater`.
3. Verify signed payloads succeed/fail according to secret and HMAC header.
4. Verify translation envelope records include bounded retention fields.
