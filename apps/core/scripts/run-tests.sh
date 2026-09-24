#!/bin/sh
set -eu

case "${1:-}" in
  integration|e2e) ;;
  *) echo "Usage: $0 integration|e2e" >&2; exit 2 ;;
esac

core_test_port=${CORE_TEST_PORT:-55433}
admin_database_url=postgresql://core:core@127.0.0.1:${core_test_port}/core_test
export DATABASE_URL=postgresql://core_app:core_app_local@127.0.0.1:${core_test_port}/core_test
export BETTER_AUTH_SECRET=integration-test-secret-at-least-32-characters

docker compose -f ../../compose.yaml up -d --wait db_test
DATABASE_URL="$admin_database_url" pnpm exec prisma migrate deploy
psql "$admin_database_url" -v ON_ERROR_STOP=1 -c 'TRUNCATE TABLE public."jwks"'
psql "$admin_database_url" -v ON_ERROR_STOP=1 -v app_password=core_app_local -v dbname=core_test -f scripts/provision-role.sql

exec pnpm "test:$1"
