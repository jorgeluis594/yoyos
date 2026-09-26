#!/usr/bin/env bash
set -euo pipefail

worktree_path="${1:?Usage: $0 <worktree-path>}"
cd "$worktree_path"

docker compose build migrate web
docker compose run --rm web pnpm seed
