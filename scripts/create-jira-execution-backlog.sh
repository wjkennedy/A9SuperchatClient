#!/usr/bin/env bash
set -euo pipefail

# Creates ForgeLLM-IRC execution backlog in Jira Cloud using REST API.
# Required env:
#   JIRA_BASE_URL (e.g. https://your-site.atlassian.net)
#   JIRA_EMAIL
#   JIRA_API_TOKEN
#   JIRA_PROJECT_KEY (existing project key)
# Optional env:
#   JIRA_PROJECT_NAME (for local labeling/logging)
#   ISSUE_TYPE_INITIATIVE (default: Initiative)
#   ISSUE_TYPE_EPIC (default: Epic)
#   ISSUE_TYPE_STORY (default: Story)
#   ISSUE_TYPE_TASK (default: Task)
#   CREATE_PROJECT=true to attempt project creation before issue creation.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKLOG_JSON="$ROOT_DIR/docs/jira-backlog/forgellm-irc-backlog.json"

: "${JIRA_BASE_URL:?JIRA_BASE_URL is required}"
: "${JIRA_EMAIL:?JIRA_EMAIL is required}"
: "${JIRA_API_TOKEN:?JIRA_API_TOKEN is required}"
: "${JIRA_PROJECT_KEY:?JIRA_PROJECT_KEY is required}"

ISSUE_TYPE_INITIATIVE="${ISSUE_TYPE_INITIATIVE:-Initiative}"
ISSUE_TYPE_EPIC="${ISSUE_TYPE_EPIC:-Epic}"
ISSUE_TYPE_STORY="${ISSUE_TYPE_STORY:-Story}"
ISSUE_TYPE_TASK="${ISSUE_TYPE_TASK:-Task}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

AUTH_HEADER="Authorization: Basic $(printf '%s:%s' "$JIRA_EMAIL" "$JIRA_API_TOKEN" | base64)"
CONTENT_HEADER="Content-Type: application/json"

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sS -X "$method" \
      -H "$AUTH_HEADER" \
      -H "$CONTENT_HEADER" \
      --data "$data" \
      "$JIRA_BASE_URL$path"
  else
    curl -sS -X "$method" \
      -H "$AUTH_HEADER" \
      -H "$CONTENT_HEADER" \
      "$JIRA_BASE_URL$path"
  fi
}

fail_if_error() {
  local response="$1"
  if jq -e '.errorMessages or .errors' >/dev/null 2>&1 <<<"$response"; then
    echo "Jira API error:" >&2
    echo "$response" | jq . >&2
    exit 1
  fi
}

issue_type_id() {
  local name="$1"
  local resp
  resp="$(api GET "/rest/api/3/issuetype")"
  fail_if_error "$resp"
  jq -r --arg name "$name" '.[] | select(.name == $name) | .id' <<<"$resp" | head -n1
}

find_field_id() {
  local field_name="$1"
  local resp
  resp="$(api GET "/rest/api/3/field")"
  fail_if_error "$resp"
  jq -r --arg n "$field_name" '.[] | select(.name == $n) | .id' <<<"$resp" | head -n1
}

create_project_if_requested() {
  if [[ "${CREATE_PROJECT:-false}" != "true" ]]; then
    return
  fi
  : "${JIRA_PROJECT_NAME:?JIRA_PROJECT_NAME is required when CREATE_PROJECT=true}"
  local payload
  payload="$(jq -n \
    --arg key "$JIRA_PROJECT_KEY" \
    --arg name "$JIRA_PROJECT_NAME" \
    '{
      key: $key,
      name: $name,
      projectTypeKey: "software",
      projectTemplateKey: "com.pyxis.greenhopper.jira:gh-simplified-scrum-classic",
      assigneeType: "PROJECT_LEAD"
    }')"
  local resp
  resp="$(api POST "/rest/api/3/project" "$payload")"
  if jq -e '.key' >/dev/null 2>&1 <<<"$resp"; then
    echo "Created project: $(jq -r '.key' <<<"$resp")"
    return
  fi
  if jq -e '.errors.key' >/dev/null 2>&1 <<<"$resp"; then
    echo "Project appears to exist already; continuing."
    return
  fi
  fail_if_error "$resp"
}

create_issue() {
  local summary="$1"
  local desc="$2"
  local issue_type_id="$3"
  local extra_fields_json="${4:-{}}"

  local payload
  payload="$(jq -n \
    --arg projectKey "$JIRA_PROJECT_KEY" \
    --arg summary "$summary" \
    --arg desc "$desc" \
    --arg issueTypeId "$issue_type_id" \
    --argjson extras "$extra_fields_json" \
    '{
      fields: ({
        project: { key: $projectKey },
        summary: $summary,
        issuetype: { id: $issueTypeId },
        description: {
          type: "doc",
          version: 1,
          content: [
            { type: "paragraph", content: [ { type: "text", text: $desc } ] }
          ]
        },
        labels: ["forgellm-irc", "execution-plan"]
      } + $extras)
    }')"

  local resp
  resp="$(api POST "/rest/api/3/issue" "$payload")"
  fail_if_error "$resp"
  jq -r '.key' <<<"$resp"
}

link_issue() {
  local outward_key="$1"
  local inward_key="$2"
  local rel_type="${3:-Relates}"
  local payload
  payload="$(jq -n \
    --arg t "$rel_type" \
    --arg out "$outward_key" \
    --arg in "$inward_key" \
    '{type:{name:$t}, outwardIssue:{key:$out}, inwardIssue:{key:$in}}')"
  local resp
  resp="$(api POST "/rest/api/3/issueLink" "$payload")"
  if jq -e '.errorMessages or .errors' >/dev/null 2>&1 <<<"$resp"; then
    echo "Warn: could not link $outward_key -> $inward_key"
  fi
}

create_project_if_requested

INITIATIVE_ID="$(issue_type_id "$ISSUE_TYPE_INITIATIVE")"
EPIC_ID="$(issue_type_id "$ISSUE_TYPE_EPIC")"
STORY_ID="$(issue_type_id "$ISSUE_TYPE_STORY")"
TASK_ID="$(issue_type_id "$ISSUE_TYPE_TASK")"

for t in INITIATIVE_ID EPIC_ID STORY_ID TASK_ID; do
  if [[ -z "${!t}" ]]; then
    echo "Could not resolve issue type ID for ${t}" >&2
    exit 1
  fi
done

PARENT_LINK_FIELD_ID="$(find_field_id "Parent Link")"
EPIC_LINK_FIELD_ID="$(find_field_id "Epic Link")"

initiative_summary="$(jq -r '.initiative.summary' "$BACKLOG_JSON")"
initiative_desc="$(jq -r '.initiative.description' "$BACKLOG_JSON")"
initiative_key="$(create_issue "$initiative_summary" "$initiative_desc" "$INITIATIVE_ID")"
echo "Created Initiative: $initiative_key"

jq -c '.epics[]' "$BACKLOG_JSON" | while read -r epic; do
  epic_summary="$(jq -r '.summary' <<<"$epic")"
  epic_name="$(jq -r '.name' <<<"$epic")"

  epic_extras='{}'
  if [[ -n "$PARENT_LINK_FIELD_ID" ]]; then
    epic_extras="$(jq -n --arg f "$PARENT_LINK_FIELD_ID" --arg v "$initiative_key" '{($f):$v}')"
  fi
  epic_key="$(create_issue "$epic_summary" "$epic_name" "$EPIC_ID" "$epic_extras")"
  echo "Created Epic: $epic_key ($epic_name)"

  if [[ -z "$PARENT_LINK_FIELD_ID" ]]; then
    link_issue "$initiative_key" "$epic_key" "Relates"
  fi

  jq -c '.stories[]' <<<"$epic" | while read -r story; do
    story_summary="$(jq -r '.summary' <<<"$story")"
    story_extras='{}'
    if [[ -n "$EPIC_LINK_FIELD_ID" ]]; then
      story_extras="$(jq -n --arg f "$EPIC_LINK_FIELD_ID" --arg v "$epic_key" '{($f):$v}')"
    else
      story_extras="$(jq -n --arg v "$epic_key" '{parent:{key:$v}}')"
    fi

    story_key="$(create_issue "$story_summary" "$story_summary" "$STORY_ID" "$story_extras")"
    echo "  Created Story: $story_key"

    if [[ -z "$EPIC_LINK_FIELD_ID" ]]; then
      link_issue "$epic_key" "$story_key" "Relates"
    fi

    jq -r '.tasks[]' <<<"$story" | while read -r task_summary; do
      task_extras="$(jq -n --arg v "$story_key" '{parent:{key:$v}}')"
      task_key="$(create_issue "$task_summary" "$task_summary" "$TASK_ID" "$task_extras")"
      echo "    Created Task: $task_key"
    done
  done
done

echo "Backlog creation complete for project: $JIRA_PROJECT_KEY"
