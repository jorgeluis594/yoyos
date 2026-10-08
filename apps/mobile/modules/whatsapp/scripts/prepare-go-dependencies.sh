#!/bin/sh
set -eu

module_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
export GOTOOLCHAIN=local
test "$(go version | awk '{print $3}')" = go1.26.5 || { echo 'Go 1.26.5 required' >&2; exit 1; }
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/whatsapp-go-dependencies.XXXXXXXX")
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

cd "$module_dir/go"
go mod download all
upstream=$(go list -m -f '{{.Dir}}' go.mau.fi/whatsmeow)
cp -R "$upstream" "$work_dir/whatsmeow"
chmod -R u+w "$work_dir/whatsmeow"
(cd "$work_dir/whatsmeow" && go mod tidy -compat=1.15 && go mod download all)

cp -R "$module_dir/go" "$work_dir/go"
cd "$work_dir/go"
go mod edit -replace="go.mau.fi/whatsmeow=$work_dir/whatsmeow"
go mod tidy -compat=1.15
go mod download all
