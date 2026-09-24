#!/usr/bin/env bash
# PreToolUse guard for the frontend-dev agent: writes are allowed inside frontend/ only.
# enforced here rather than trusted to the prompt, so parallel frontend work cannot touch backend, infra, or docs.

input=$(cat)
file_path=$(jq -r '.tool_input.file_path // empty' <<<"$input")
allowed="${CLAUDE_PROJECT_DIR:-$(pwd)}/frontend/"

case "$(realpath -m "$file_path")/" in
    "$(realpath -m "$allowed")"/*) exit 0 ;;
esac

jq -n --arg p "$file_path" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("frontend-dev may only write inside frontend/; refused: " + $p)
  }
}'
exit 0
