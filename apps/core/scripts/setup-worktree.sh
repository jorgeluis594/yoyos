#!/usr/bin/env bash
# Prepares a checkout for development: in a linked worktree it copies the env files of the main
# checkout and reserves its own host ports, then builds, migrates, seeds and starts the stack.
# Usage: setup-worktree.sh   (Orca runs it after creating a worktree)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"
main_root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

# Each worktree gets a slot N and publishes its ports at default + N; the main checkout keeps slot 0.
reserve_slot() {
  local registry="$main_root/.worktree-ports" slot
  touch "$registry"
  if command -v flock >/dev/null; then exec 9>>"$registry"; flock 9; fi

  slot="$(awk -F'\t' -v w="$repo_root" '$1 == w { print $2 }' "$registry")"
  if [ -z "$slot" ]; then
    slot=1
    while awk -F'\t' -v s="$slot" '$2 == s { found = 1 } END { exit !found }' "$registry" || ports_in_use "$slot"; do
      slot=$((slot + 1))
    done
    printf '%s\t%s\n' "$repo_root" "$slot" >> "$registry"
  fi
  echo "$slot"
}

ports_in_use() {
  command -v ss >/dev/null || return 1
  ss -ltn | grep -qE ":($((3000 + $1))|$((1025 + $1))|$((8025 + $1))|$((55433 + $1))) "
}

write_ports() {
  local slot="$1" web_port=$((3000 + $1))
  grep -vE '^(WEB_PORT|BETTER_AUTH_URL|MAILPIT_SMTP_PORT|MAILPIT_UI_PORT|CORE_TEST_PORT)=' .env > .env.tmp || true
  cat >> .env.tmp <<EOF
WEB_PORT=$web_port
BETTER_AUTH_URL=http://localhost:$web_port
MAILPIT_SMTP_PORT=$((1025 + slot))
MAILPIT_UI_PORT=$((8025 + slot))
CORE_TEST_PORT=$((55433 + slot))
EOF
  mv .env.tmp .env
}

if [ "$repo_root" != "$main_root" ]; then
  for env_file in .env apps/core/.env apps/mobile/.env; do
    if [ ! -f "$env_file" ] && [ -f "$main_root/$env_file" ]; then cp "$main_root/$env_file" "$env_file"; fi
  done
  write_ports "$(reserve_slot)"
fi

docker compose build migrate web
docker compose run --rm web sh -c 'pnpm exec prisma generate && pnpm seed'
docker compose up -d

web_port="$(awk -F= '$1 == "WEB_PORT" { print $2 }' .env 2>/dev/null)"
echo "Ready: http://localhost:${web_port:-3000}"
