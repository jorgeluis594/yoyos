#!/usr/bin/env bash
# Starts one Orca worktree per Yoyos Todoist task labelled listo-agente, each with a
# coordinator agent running the implement-task skill, and moves the task to
# "Tomado por agente".
# Usage: scripts/dispatch-agent-tasks.sh [--dry-run] [--limit <n>]
# Requires: td (authenticated), orca (runtime reachable), jq.
set -euo pipefail

project="Yoyos"
ready_label="listo-agente"
taken_section="Tomado por agente"
done_section="Terminado"
agent="claude"
model="claude-opus-5-5"

dry_run=false
limit=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --limit) limit="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_id="$(orca repo show --repo "path:$repo_root" --json | jq -r '.result.repo.id')" \
  || { echo "Repo not registered in Orca or runtime unreachable: $repo_root" >&2; exit 1; }

section_ids="$(td section list "$project" --json | jq -c --arg taken "$taken_section" --arg done "$done_section" \
  '[.results[] | select(.name == $taken or .name == $done) | .id]')"
taken_section_id="$(td section list "$project" --json | jq -r --arg taken "$taken_section" '.results[] | select(.name == $taken) | .id')"
[ -n "$taken_section_id" ] || { echo "Section not found: $taken_section" >&2; exit 1; }

# Each worktree is tagged with its task in the Orca comment; a tagged task is never launched twice.
dispatched="$(orca worktree list --json | jq -c '[.result.worktrees[].comment | capture("todoist:(?<id>[A-Za-z0-9]+)")? | .id]')"

tasks="$(td task list --project "$project" --label "$ready_label" --all --json | jq -c \
  --argjson skip_sections "$section_ids" --argjson dispatched "$dispatched" \
  '[.results[] | select(.parentId == null)
    | select((.sectionId as $s | $skip_sections | index($s)) | not)
    | select((.id as $id | $dispatched | index($id)) | not)]')"
[ "$limit" -gt 0 ] && tasks="$(jq -c --argjson n "$limit" '.[:$n]' <<<"$tasks")"

count="$(jq length <<<"$tasks")"
if [ "$count" -eq 0 ]; then
  echo "No tasks labelled $ready_label to dispatch."
  exit 0
fi

jq -c '.[]' <<<"$tasks" | while read -r task; do
  id="$(jq -r .id <<<"$task")"
  title="$(jq -r .content <<<"$task")"
  url="$(jq -r .webUrl <<<"$task")"
  remaining_labels="$(jq -r --arg ready "$ready_label" '[.labels[] | select(. != $ready)] | join(",")' <<<"$task")"
  # The topic names the worktree and the implement-task integration branch jorgeluis594/<topic>.
  topic="$(iconv -f utf-8 -t ascii//TRANSLIT <<<"$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | cut -c1-40 | sed 's/^-*//; s/-*$//')"
  topic="${topic:-task-$id}"
  branch="jorgeluis594/$topic"

  prompt="Use the implement-task skill to implement Todoist task id:$id ($url).
This Orca worktree, on branch $branch, is the task's integration worktree; do not create another one.
The task is already in \"$taken_section\". End the title of the pull request to main with [td:$id]."

  echo "Dispatching $id: $title"
  if git -C "$repo_root" show-ref --quiet "refs/heads/$branch"; then
    echo "  skipped: branch $branch already exists" >&2
    continue
  fi
  if $dry_run; then
    echo "  would create worktree '$topic' on $branch with $agent ($model) and move the task to '$taken_section'"
    continue
  fi

  # Orca turns '/' in names into '-', so the branch is renamed before the agent starts.
  path="$(orca worktree create --repo "id:$repo_id" --name "$topic" --no-parent \
    --comment "todoist:$id $url" --json | jq -r '.result.worktree.path')"
  git -C "$path" branch -m "$branch"
  orca agent launch --worktree "path:$path" --agent "$agent" --model "$model" --prompt "$prompt" --json >/dev/null

  td task move "id:$id" --section "id:$taken_section_id" --quiet
  if [ -n "$remaining_labels" ]; then
    td task update "id:$id" --labels "$remaining_labels" --quiet
  else
    td task update "id:$id" --no-labels --quiet
  fi
  td comment add "id:$id" --quiet \
    --content "Tomada por agente el $(date '+%Y-%m-%d %H:%M'). Worktree de Orca: $path, rama $branch."
  echo "  worktree created at $path on $branch; task moved to '$taken_section'"
done
