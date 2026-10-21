#!/usr/bin/env bash
# Removes the Docker resources (containers, volumes, networks, built images) of a worktree.
# Usage: teardown-worktree.sh [worktree-path]   (defaults to the worktree containing this script)
# Works from labels, so it also runs after the worktree directory was deleted.
set -euo pipefail

worktree="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"

# The main checkout shares its compose project with day-to-day development data.
git_dir="$(git -C "$worktree" rev-parse --absolute-git-dir 2>/dev/null || true)"
if [ -n "$git_dir" ] && [ "$git_dir" = "$(git -C "$worktree" rev-parse --path-format=absolute --git-common-dir)" ]; then
  echo "Refusing to tear down the main checkout: $worktree" >&2
  exit 1
fi

# Same normalization Docker Compose applies to the directory name.
project="${COMPOSE_PROJECT_NAME:-$(basename "$worktree" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | sed 's/^[^a-z0-9]*//')}"
[ -n "$project" ] || { echo "Cannot derive a compose project from: $worktree" >&2; exit 1; }
label="label=com.docker.compose.project=$project"

echo "Tearing down Docker resources of compose project '$project'"
docker ps -aq --filter "$label" | xargs docker rm -fv >/dev/null 2>&1 || true
docker volume ls -q --filter "$label" | xargs docker volume rm >/dev/null 2>&1 || true
docker network ls -q --filter "$label" | xargs docker network rm >/dev/null 2>&1 || true
# Built images carry no project label; compose names them <project>-<service>.
for service in migrate web worker; do
  docker image rm -f "$project-$service" >/dev/null 2>&1 || true
done

# Release the host ports setup-worktree.sh reserved for this worktree.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
registry="$(dirname "$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)")/.worktree-ports"
if [ -f "$registry" ]; then
  worktree_path="$(cd "$worktree" 2>/dev/null && pwd || echo "$worktree")"
  awk -F'\t' -v w="$worktree_path" '$1 != w' "$registry" > "$registry.tmp" && mv "$registry.tmp" "$registry"
fi
