#!/usr/bin/env bash
# Runs the .github/workflows/ci.yml checks locally on what this branch changed compared
# with its parent branch, including uncommitted and untracked files.
# Usage: scripts/ci.sh [--fast] [parent-branch]   (default parent: main)
#   --fast  skips the core integration and E2E tests (they need Docker, psql and Chromium).
# Lint and dependency rules get the changed files; tests run only those affected by them
# (vitest --changed, jest --changedSince). Typecheck, E2E and the landing build cannot be
# narrowed to files, so they run whole when their package changed.
# Requires: Node 24 and pnpm 12.5.1 on PATH.
# CI_MAX_WORKERS (default 50%) caps core unit test workers; all of them can exhaust memory.
set -euo pipefail

fast=0
parent=main
for arg in "$@"; do
  case "$arg" in
    --fast) fast=1 ;;
    -*) echo "Usage: $0 [--fast] [parent-branch]" >&2; exit 2 ;;
    *) parent="$arg" ;;
  esac
done

root="$(git rev-parse --show-toplevel)"
cd "$root"
base="$(git merge-base HEAD "$parent")"
changed="$( {
  git diff --name-only --diff-filter=d "$base"
  git ls-files --others --exclude-standard
} | sort -u)"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
failed=()

# step <label> <directory> <command...>: prints the output only when the command fails.
step() {
  local label="$1" dir="$2"
  shift 2
  if (cd "$dir" && "$@") >"$log" 2>&1; then
    echo "✔ $label"
  else
    echo "✘ $label"
    sed 's/^/    /' "$log"
    failed+=("$label")
  fi
}

skip() { echo "- $1 (skipped: $2)"; }

touched() { grep -qE "$1" <<<"$changed"; }

# sources <path-regex> <prefix-to-strip> [<path-regex> <prefix-to-add>]: changed source files
# under a package, relative to it; with the optional pair, root shared/ files as well.
sources() {
  grep -E "^$1/.+\.(ts|tsx|js|jsx|mjs|cjs)$" <<<"$changed" | sed "s#^$2##" || true
  if [ $# -gt 2 ]; then
    grep -E "^$3/.+\.(ts|tsx|js|jsx|mjs|cjs)$" <<<"$changed" | sed "s#^#$4#" || true
  fi
}

lint() { [ $# -eq 0 ] || pnpm exec eslint --no-warn-ignored "$@"; }

# A partial cruise reports every unreached baseline entry as stale; hide that hint so
# nobody shrinks the baseline from it.
deps() {
  [ $# -eq 0 ] && return 0
  pnpm exec depcruise "$@" --config .dependency-cruiser.cjs --ignore-known 2>&1 \
    | { grep -v "stale known violations" || true; }
}

if [ -z "$changed" ]; then
  echo "No changes against $parent."
  exit 0
fi
echo "Checking changes against $parent ($(git rev-parse --short "$base"))"

shared_changed=0
touched "^shared/" && shared_changed=1
core=0; mobile=0; landing=0
touched "^(apps/core|apps/mobile|shared)/" && core=1 # core contract tests import mobile
touched "^(apps/mobile|shared)/" && mobile=1
touched "^(landing|shared)/" && landing=1

if [ $((core + mobile + landing)) -gt 0 ]; then
  step "shared: install" shared pnpm install --frozen-lockfile
fi

if [ "$core" = 1 ]; then
  echo "core"
  mapfile -t core_lint < <(sources apps/core apps/core/ | grep -v "^\.dependency-cruiser")
  mapfile -t core_deps < <(sources apps/core apps/core/ shared ../../ | grep -v "^\.dependency-cruiser")
  step "core: install" apps/core pnpm install --frozen-lockfile
  if [ "$shared_changed" = 1 ]; then
    step "shared: tests" apps/core bash -c 'pnpm exec tsx --test ../../shared/*.test.mjs ../../shared/contracts/*.test.mjs'
  fi
  step "core: prisma generate" apps/core env DATABASE_URL=postgresql://core_app:core_app_local@127.0.0.1:55433/core_test pnpm prisma:generate
  step "core: lint (${#core_lint[@]} files)" apps/core lint "${core_lint[@]}"
  step "core: typecheck" apps/core pnpm typecheck
  step "core: dependency rules (${#core_deps[@]} files)" apps/core deps "${core_deps[@]}"
  step "core: unit tests" apps/core sh scripts/run-tests.sh unit --changed "$base" --maxWorkers="${CI_MAX_WORKERS:-50%}"
  if [ "$fast" = 1 ]; then
    skip "core: integration and E2E tests" "--fast"
  else
    step "core: image model" apps/core pnpm models:fetch
    step "core: integration tests" apps/core sh scripts/run-tests.sh integration --changed "$base" --passWithNoTests
    if touched "^(apps/core|shared)/"; then
      step "core: E2E tests" apps/core sh scripts/run-tests.sh e2e
    else
      step "core: E2E tests" apps/core sh scripts/run-tests.sh e2e --changed "$base" --passWithNoTests
    fi
  fi
fi

if [ "$mobile" = 1 ]; then
  echo "mobile"
  mapfile -t mobile_lint < <(sources apps/mobile apps/mobile/ | grep -v "^\.dependency-cruiser")
  mapfile -t mobile_deps < <(sources apps/mobile apps/mobile/ shared ../../ | grep -v "^\.dependency-cruiser")
  step "mobile: install" apps/mobile pnpm install --frozen-lockfile
  step "mobile: lint (${#mobile_lint[@]} files)" apps/mobile lint "${mobile_lint[@]}"
  step "mobile: typecheck" apps/mobile pnpm typecheck
  step "mobile: dependency rules (${#mobile_deps[@]} files)" apps/mobile deps "${mobile_deps[@]}"
  step "mobile: tests" apps/mobile sh ../core/scripts/run-tests.sh mobile --changedSince="$base" --passWithNoTests
fi

if [ "$landing" = 1 ]; then
  echo "landing"
  mapfile -t landing_lint < <(sources landing landing/)
  step "landing: install" landing pnpm install --frozen-lockfile
  [ -f landing/.env ] || cp landing/.env.example landing/.env
  step "landing: lint (${#landing_lint[@]} files)" landing lint "${landing_lint[@]}"
  step "landing: typecheck" landing pnpm typecheck
  step "landing: tests" landing pnpm exec vitest run --project unit --changed "$base" --passWithNoTests
  step "landing: build" landing pnpm build
  step "landing: build tests" landing pnpm test:build
fi

if [ "${#failed[@]}" -gt 0 ]; then
  echo "Failed: ${failed[*]}"
  exit 1
fi
echo "Todo OK"
