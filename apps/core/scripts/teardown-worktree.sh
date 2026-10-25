#!/usr/bin/env bash
# Removes the Docker resources (containers, volumes, networks, built images) of a worktree and
# releases the host ports setup-worktree.sh reserved for it. Registered worktrees whose directory
# no longer exists are torn down too, so a skipped or failed teardown does not leave resources behind.
# Usage: teardown-worktree.sh [worktree-path]   (defaults to the worktree containing this script)
# Works from labels, so it also runs after the worktree directory was deleted.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
worktree="${1:-$script_dir/../../..}"
worktree="$(cd "$worktree" 2>/dev/null && pwd -P || echo "$worktree")"
main_root="$(dirname "$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)")"
registry="$main_root/.worktree-ports"

# Same normalization Docker Compose applies to the directory name.
compose_project() {
  basename "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | sed 's/^[^a-z0-9]*//'
}

main_project="$(compose_project "$main_root")"

# Compose also reads COMPOSE_PROJECT_NAME from the worktree's .env.
env_project="$(awk -F= '$1 == "COMPOSE_PROJECT_NAME" { print $2 }' "$worktree/.env" 2>/dev/null || true)"
project="${COMPOSE_PROJECT_NAME:-${env_project:-$(compose_project "$worktree")}}"
[ -n "$project" ] || { echo "Cannot derive a compose project from: $worktree" >&2; exit 1; }

# The main checkout shares its compose project with day-to-day development data.
if [ "$worktree" = "$main_root" ] || [ "$project" = "$main_project" ]; then
  echo "Refusing to tear down the main checkout's compose project '$project'" >&2
  exit 1
fi

# Without access to the Docker socket every removal would fail, so stop before touching the registry.
if ! docker info >/dev/null 2>&1; then
  echo "Cannot reach Docker as $(id -un) (groups: $(id -Gn)); nothing was removed." >&2
  echo "Start this process from a session that belongs to the docker group and run the teardown again." >&2
  exit 1
fi

# Containers write the bind-mounted source as root (e.g. apps/core/build), which keeps git from
# deleting the worktree; hand those files back to the host user with the project's own image.
reclaim_ownership() {
  local dir="$1" image="$2"
  [ -d "$dir/apps/core" ] || return 0
  docker image inspect "$image" >/dev/null 2>&1 || return 0
  docker run --rm --user 0 --entrypoint sh -v "$dir:/w" "$image" \
    -c 'find /w/apps/core /w/shared -xdev ! -uid "$1" -exec chown -h "$1:$2" {} +' sh "$(id -u)" "$(id -g)"
}

teardown_project() {
  local project="$1" dir="$2" label="label=com.docker.compose.project=$1" status=0
  echo "Tearing down Docker resources of compose project '$project'"
  reclaim_ownership "$dir" "$project-web" || status=1
  docker ps -aq --filter "$label" | xargs -r docker rm -fv >/dev/null || status=1
  docker volume ls -q --filter "$label" | xargs -r docker volume rm >/dev/null || status=1
  docker network ls -q --filter "$label" | xargs -r docker network rm >/dev/null || status=1
  # Built images carry no project label; compose names them <project>-<service>.
  for service in migrate web worker; do
    if docker image inspect "$project-$service" >/dev/null 2>&1; then
      docker image rm -f "$project-$service" >/dev/null || status=1
    fi
  done
  return "$status"
}

released=()
failed=0
if teardown_project "$project" "$worktree"; then released+=("$worktree"); else failed=1; fi

if [ -f "$registry" ]; then
  while IFS=$'\t' read -r path _; do
    [ -n "$path" ] && [ "$path" != "$worktree" ] && [ ! -e "$path" ] || continue
    orphan="$(compose_project "$path")"
    [ -n "$orphan" ] && [ "$orphan" != "$main_project" ] || continue
    if teardown_project "$orphan" "$path"; then released+=("$path"); else failed=1; fi
  done < "$registry"
fi

# Rewritten in place under the same lock setup-worktree.sh takes, so a concurrent setup keeps its slot.
# A worktree whose teardown failed keeps its line, so the next teardown retries it.
if [ -f "$registry" ] && [ "${#released[@]}" -gt 0 ]; then
  exec 9>>"$registry"
  if command -v flock >/dev/null; then flock 9; fi
  remaining="$(printf '%s\n' "${released[@]}" | awk -F'\t' 'NR == FNR { drop[$0]; next } !($1 in drop)' - "$registry")"
  printf '%s' "${remaining:+$remaining$'\n'}" > "$registry"
fi

exit "$failed"
