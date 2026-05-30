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
