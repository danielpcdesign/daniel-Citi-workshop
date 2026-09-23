#!/usr/bin/env bash
# PreToolUse guard for the docs-keeper agent: writes are allowed to *.md files only.
# enforced here rather than trusted to the agent's prompt, since a prompt is a request, not a control.

input=$(cat)
file_path=$(jq -r '.tool_input.file_path // empty' <<<"$input")

if [[ "$file_path" == *.md ]]; then
    exit 0
fi

jq -n --arg p "$file_path" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("docs-keeper may only write .md files; refused: " + $p)
  }
}'
exit 0
