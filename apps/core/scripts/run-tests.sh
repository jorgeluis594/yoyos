#!/bin/sh
set -eu

case "${1:-}" in
  unit|integration|e2e|mobile) ;;
  *) echo "Usage: $0 unit|integration|e2e|mobile" >&2; exit 2 ;;
esac

test_log=$(mktemp)
trap 'rm -f "$test_log"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

quiet() {
  if "$@" >"$test_log" 2>&1; then
    return 0
  else
    test_status=$?
    cat "$test_log" >&2
    return "$test_status"
  fi
}

case "$1" in
  unit)
    shift
    quiet pnpm exec vitest run --project unit --passWithNoTests "$@"
    echo "Todo OK"
    exit 0
    ;;
  mobile)
    shift
    quiet pnpm exec jest --runInBand --silent --reporters=summary "$@"
    echo "Todo OK"
    exit 0
    ;;
esac

core_test_port=${CORE_TEST_PORT:-55433}
admin_database_url=postgresql://core:core@127.0.0.1:${core_test_port}/core_test
export MIGRATION_TEST_DATABASE_URL="$admin_database_url"
app_database_url=postgresql://core_app:core_app_local@127.0.0.1:${core_test_port}/core_test
export DATABASE_URL=$app_database_url
export BETTER_AUTH_SECRET=integration-test-secret-at-least-32-characters
export EMAIL_TRANSPORT=smtp
export EMAIL_FROM='Yoyos <cuentas@yoyos.test>'
export SMTP_HOST=localhost
export SMTP_PORT=${MAILPIT_SMTP_PORT:-1025}
export MAILPIT_URL=http://127.0.0.1:${MAILPIT_UI_PORT:-8025}
if [ "$1" = e2e ]; then
  export BETTER_AUTH_URL=http://127.0.0.1:${CORE_E2E_PORT:-4173}
else
  export BETTER_AUTH_URL=http://localhost:3000
fi

quiet docker compose -f ../../compose.yaml up -d --wait db_test mailpit
quiet psql "$admin_database_url" -v ON_ERROR_STOP=1 -v app_password=core_app_local -f scripts/create-role.sql
DATABASE_URL="$admin_database_url" quiet pnpm exec prisma migrate deploy
quiet psql "$admin_database_url" -v ON_ERROR_STOP=1 -c 'TRUNCATE TABLE public."jwks"'
quiet psql "$admin_database_url" -v ON_ERROR_STOP=1 -v app_password=core_app_local -v dbname=core_test -f scripts/provision-role.sql
export DATABASE_URL=$app_database_url

test_project=$1
shift
if [ "$test_project" = e2e ]; then
  quiet pnpm --silent build
fi
quiet pnpm exec vitest run --project "$test_project" "$@"
echo "Todo OK"
