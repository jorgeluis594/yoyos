#!/usr/bin/env bash
# Asks Grok Bot for an image through its webhook. The PNG is generated asynchronously and
# written by Grok Bot at the output path sent in the request; this script only sends the
# request and prints {"request_id","output_path"} so the caller can wait for that file.
# Usage: scripts/request-grok-image.sh [--output <absolute path under the worktree>] "<description>"
# Requires: curl, jq, git, uuidgen (or /proc/sys/kernel/random/uuid), realpath.
# Config: GROK_BOT_IMAGE_WEBHOOK_URL and GROK_BOT_IMAGE_WEBHOOK_SECRET, from the environment or
#   from ~/.config/yoyos/grok-image.env (override the file path with GROK_IMAGE_ENV_FILE).
#   See scripts/grok-image.env.example.
# The worktree root is the one containing the caller's current directory (git rev-parse
# --show-toplevel), so run it from inside the worktree that needs the image.
# Default output: <worktree root>/.grok-inbox/<request_id>.png (gitignored).
set -euo pipefail

fail() { echo "request-grok-image: $*" >&2; exit 1; }

output=""
description=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output)
      [ $# -ge 2 ] || fail "--output needs a value"
      output="$2"; shift ;;
    --*) fail "Unknown option: $1" ;;
    *)
      [ -z "$description" ] || fail "Only one description is accepted"
      description="$1" ;;
  esac
  shift
done
[ -n "${description//[[:space:]]/}" ] || fail "Missing description. Usage: request-grok-image.sh [--output <path>] \"<description>\""

env_file="${GROK_IMAGE_ENV_FILE:-$HOME/.config/yoyos/grok-image.env}"
# Values already set in the environment win over the env file.
env_url="${GROK_BOT_IMAGE_WEBHOOK_URL:-}"
env_secret="${GROK_BOT_IMAGE_WEBHOOK_SECRET:-}"
if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi
[ -z "$env_url" ] || GROK_BOT_IMAGE_WEBHOOK_URL="$env_url"
[ -z "$env_secret" ] || GROK_BOT_IMAGE_WEBHOOK_SECRET="$env_secret"
[ -n "${GROK_BOT_IMAGE_WEBHOOK_URL:-}" ] || fail "GROK_BOT_IMAGE_WEBHOOK_URL is not set (environment or $env_file)"
[ -n "${GROK_BOT_IMAGE_WEBHOOK_SECRET:-}" ] || fail "GROK_BOT_IMAGE_WEBHOOK_SECRET is not set (environment or $env_file)"

root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run it from inside a git worktree"
root="$(realpath -m "$root")"

if command -v uuidgen >/dev/null; then
  request_id="$(uuidgen | tr 'A-Z' 'a-z')"
elif [ -r /proc/sys/kernel/random/uuid ]; then
  request_id="$(cat /proc/sys/kernel/random/uuid)"
else
  fail "Cannot generate a request id: install uuidgen"
fi

if [ -z "$output" ]; then
  output="$root/.grok-inbox/$request_id.png"
fi
case "$output" in
  /*) ;;
  *) fail "--output must be an absolute path: $output" ;;
esac
output="$(realpath -m "$output")"
[ ! -d "$output" ] || fail "--output must be a file path, not a directory: $output"
case "$output" in
  *.png) ;;
  *) fail "--output must end in .png: $output" ;;
esac
case "$output" in
  "$root"/*) ;;
  *) fail "--output must be under the worktree root $root: $output" ;;
esac
mkdir -p "$(dirname "$output")"

template_file="$(dirname "$(realpath "${BASH_SOURCE[0]}")")/grok-image-prompt-template.txt"
[ -f "$template_file" ] || fail "Missing prompt template: $template_file"
prompt="$(cat "$template_file")"$'\n\n'"$description"

payload="$(jq -n --arg request_id "$request_id" --arg output_path "$output" --arg prompt "$prompt" \
  '{request_id: $request_id, output_path: $output_path, prompt: $prompt, format: "png"}')"

response="$(curl --silent --show-error --fail-with-body --connect-timeout 10 --max-time 60 \
  --request POST "$GROK_BOT_IMAGE_WEBHOOK_URL" \
  --header "Content-Type: application/json" \
  --header @- \
  --data "$payload" <<<"Authorization: Bearer $GROK_BOT_IMAGE_WEBHOOK_SECRET")" || fail "Webhook request failed${response:+: $response}"

echo "$response" | jq -e --arg id "$request_id" \
  '.ok == true and .accepted == true and .request_id == $id' >/dev/null 2>&1 \
  || fail "Webhook did not accept the request: $response"

jq -nc --arg request_id "$request_id" --arg output_path "$output" \
  '{request_id: $request_id, output_path: $output_path}'
