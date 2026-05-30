#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKLOG_JSON="$ROOT_DIR/docs/jira-backlog/forgellm-irc-backlog.json"
PROJECT_KEY="${1:-FIRC}"
SITE_URL="${2:-https://<your-site>.atlassian.net}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

initiative_summary="$(jq -r '.initiative.summary' "$BACKLOG_JSON")"
initiative_desc="$(jq -r '.initiative.description' "$BACKLOG_JSON")"

cat <<PROMPT
Use Atlassian Rovo MCP tools to create the Jira execution hierarchy for ForgeLLM-IRC.

Constraints:
- Jira project key: $PROJECT_KEY
- Cloud/site: $SITE_URL
- Labels on every issue: forgellm-irc, execution-plan
- Create hierarchy exactly: Initiative -> Epic -> Story -> Task
- Prefer native hierarchy fields; if unavailable, create issue links to preserve structure.
- Return a final table with created keys by hierarchy.

Create Initiative:
- Summary: $initiative_summary
- Description: $initiative_desc

Create the following epics, stories, and tasks exactly as listed in JSON:
$(jq -r '.epics[] | "\nEpic: " + .summary + "\n" + (.stories[] | "  Story: " + .summary + "\n" + (.tasks[] | "    Task: " + .))' "$BACKLOG_JSON")

After creation:
1. Confirm each story belongs to correct epic.
2. Confirm each task belongs to correct story.
3. Report any hierarchy fallback (issue links used instead of native fields).
PROMPT
