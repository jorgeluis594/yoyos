#!/bin/sh
# Runs the AI evals (evals/README.md). A run that can call a model is paid: without EVAL_PAID=1 it prints the estimate and stops. With
# EVAL_MODELS=fake every stage answers from the case expectations, at zero cost, with no key and no database. With both provider keys and
# EVAL_PAID=1, it prepares the test database like run-tests.sh and runs every suite against it. Never used by CI.
set -eu

if [ -n "${CI:-}" ]; then
  echo "AI evals never run in CI." >&2
  exit 1
fi

# The gate reads the shell only: a paid run is a decision of whoever types the command, never of a file.
if [ "${EVAL_MODELS:-}" != fake ] && [ "${EVAL_PAID:-}" != 1 ]; then
  pnpm exec tsx evals/scripts/paid-gate.ts || exit 1
fi

# A variable set in the shell wins, even when empty, as in evals/lib/eval-env.ts; otherwise .env decides.
has_key() {
  if printenv "$1" >/dev/null; then
    [ -n "$(printenv "$1")" ]
  else
    grep -Eq "^$1=.+" .env 2>/dev/null
  fi
}

if [ "${EVAL_MODELS:-}" != fake ] && has_key OPENAI_API_KEY && has_key CLAUDE_API_KEY; then
  core_test_port=${CORE_TEST_PORT:-55433}
  admin_database_url=postgresql://core:core@127.0.0.1:${core_test_port}/core_test
  log=$(mktemp)
  trap 'rm -f "$log"' EXIT
  quiet() { "$@" >"$log" 2>&1 || { cat "$log" >&2; return 1; }; }
  if [ "${CORE_TEST_EXTERNAL_SERVICES:-0}" != 1 ]; then
    quiet docker compose -f ../../compose.yaml up -d --wait db_test
  fi
  quiet psql "$admin_database_url" -v ON_ERROR_STOP=1 -v app_password=core_app_local -f scripts/create-role.sql
  DATABASE_URL="$admin_database_url" quiet pnpm exec tsx scripts/migrate.ts
  quiet psql "$admin_database_url" -v ON_ERROR_STOP=1 -v app_password=core_app_local -v dbname=core_test -f scripts/provision-role.sql
  export DATABASE_URL=postgresql://core_app:core_app_local@127.0.0.1:${core_test_port}/core_test
fi

exec pnpm exec vitest run --config vitest.evals.config.ts "$@"
