#!/bin/sh
set -eu

case "${1:-}" in
  integration|e2e) ;;
  *) echo "Usage: $0 integration|e2e" >&2; exit 2 ;;
esac

export TEST_ADMIN_DATABASE_URL=postgresql://core:core@127.0.0.1:55433/core_test
export DATABASE_URL=postgresql://core_app:core_app_local@127.0.0.1:55433/core_test

docker compose -f ../../compose.yaml up -d --wait db_test
DATABASE_URL="$TEST_ADMIN_DATABASE_URL" pnpm exec prisma migrate deploy
psql "$TEST_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v app_password=core_app_local -v dbname=core_test -f scripts/provision-role.sql

exec pnpm "test:$1"
