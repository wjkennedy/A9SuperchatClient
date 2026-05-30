## Atlassian Rovo MCP
When connected to `atlassian-rovo-mcp`:
- MUST use Jira project key = `FIRC` (override if provided at runtime).
- MUST use cloudId = `https://<your-site>.atlassian.net` unless a concrete cloudId is explicitly supplied.
- MUST cap search/list calls with `maxResults: 10` or `limit: 10`.
- MUST create execution issues with labels: `forgellm-irc`, `execution-plan`.
- MUST create hierarchy in this order: Initiative -> Epic -> Story -> Task.
- MUST link children to parents using the platform-supported hierarchy fields first; if unavailable, add explicit issue links.

## Execution Backlog Source
- Primary source: `docs/jira-backlog/forgellm-irc-backlog.json`
- Execution procedure: `docs/execution/forgellm-irc-execution-tracking.md`
