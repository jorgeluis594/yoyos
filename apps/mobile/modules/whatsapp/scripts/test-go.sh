#!/bin/sh
set -eu

module_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
export GOTOOLCHAIN=local
export GOPROXY=off
source_dir=$(go env GOMODCACHE)/go.mau.fi/whatsmeow@v0.0.0-20261006124319-9399289b022b
test -f "$source_dir/go.mod"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
cp -R "$source_dir" "$work/whatsmeow"
chmod -R u+w "$work/whatsmeow"
git -C "$work/whatsmeow" apply --check "$module_dir/patches/pre-decrypt-context.patch"
git -C "$work/whatsmeow" apply "$module_dir/patches/pre-decrypt-context.patch"
cp -R "$module_dir/go" "$work/go"
cd "$work/go"
go mod edit -replace="go.mau.fi/whatsmeow=$work/whatsmeow"
go test -race ./... -count=1
go vet ./...
cd "$work/whatsmeow"
go test . -run 'TestRecoveryContextHook|TestRecoveryStorageFailure|TestControlledTransportAttempt' -count=1
