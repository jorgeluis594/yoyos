#!/bin/sh
set -eu
cd "$(dirname "$0")"

[ "$(sh quiet-run.sh sh -c 'echo noisy; echo warning >&2')" = 'Todo OK' ]
[ -z "$(QUIET_SUCCESS=1 sh quiet-run.sh sh -c 'echo setup')" ]
status=0
output=$(sh quiet-run.sh sh -c 'echo failed >&2; exit 7' 2>&1) || status=$?
[ "$status" = 7 ]
[ "$output" = failed ]
echo 'Todo OK'
