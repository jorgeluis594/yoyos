#!/bin/sh
set -eu

test_log=$(mktemp)
trap 'rm -f "$test_log"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if "$@" >"$test_log" 2>&1; then
  if [ "${QUIET_SUCCESS:-0}" != 1 ]; then
    echo "Todo OK"
  fi
else
  test_status=$?
  cat "$test_log" >&2
  exit "$test_status"
fi
