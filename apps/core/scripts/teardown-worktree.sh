#!/usr/bin/env bash
# Removes the Docker resources (containers, volumes, networks, built images) of a worktree and
# releases the host ports setup-worktree.sh reserved for it.
# Usage: teardown-worktree.sh [worktree-path]   (defaults to the worktree containing this script)
# Works from labels, so it also runs after the worktree directory was deleted.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
worktree="${1:-$script_dir/../../..}"
worktree="$(cd "$worktree" 2>/dev/null && pwd -P || echo "$worktree")"
main_root="$(dirname "$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)")"

# Same normalization Docker Compose applies to the directory name.
compose_project() {
  basename "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | sed 's/^[^a-z0-9]*//'
}

# Compose also reads COMPOSE_PROJECT_NAME from the worktree's .env.
env_project="$(awk -F= '$1 == "COMPOSE_PROJECT_NAME" { print $2 }' "$worktree/.env" 2>/dev/null || true)"
project="${COMPOSE_PROJECT_NAME:-${env_project:-$(compose_project "$worktree")}}"
[ -n "$project" ] || { echo "Cannot derive a compose project from: $worktree" >&2; exit 1; }

# The main checkout shares its compose project with day-to-day development data.
if [ "$worktree" = "$main_root" ] || [ "$project" = "$(compose_project "$main_root")" ]; then
  echo "Refusing to tear down the main checkout's compose project '$project'" >&2
  exit 1
fi

label="label=com.docker.compose.project=$project"
echo "Tearing down Docker resources of compose project '$project'"
docker ps -aq --filter "$label" | xargs docker rm -fv >/dev/null 2>&1 || true
docker volume ls -q --filter "$label" | xargs docker volume rm >/dev/null 2>&1 || true
docker network ls -q --filter "$label" | xargs docker network rm >/dev/null 2>&1 || true
# Built images carry no project label; compose names them <project>-<service>.
for service in migrate web worker; do
  docker image rm -f "$project-$service" >/dev/null 2>&1 || true
done

# Rewritten in place under the same lock setup-worktree.sh takes, so a concurrent setup keeps its slot.
registry="$main_root/.worktree-ports"
if [ -f "$registry" ]; then
  exec 9>>"$registry"
  if command -v flock >/dev/null; then flock 9; fi
  remaining="$(awk -F'\t' -v w="$worktree" '$1 != w' "$registry")"
  printf '%s' "${remaining:+$remaining$'\n'}" > "$registry"
fi
