#!/bin/sh
set -eu

cd "$(dirname "$0")"
go mod download go.mau.fi/whatsmeow
upstream_dir=$(go list -m -f '{{.Dir}}' go.mau.fi/whatsmeow)
probe_dir=$(mktemp -d "${TMPDIR:-/tmp}/whatsapp-context-hook.XXXXXX")
trap 'rm -rf "$probe_dir"' EXIT HUP INT TERM
cp -R "$upstream_dir/." "$probe_dir/"
chmod -R u+w "$probe_dir"
cp pre-decrypt-context.patch testdata/async-ack-observer.patch testdata/context-hook_test.go "$probe_dir/"
cd "$probe_dir"
git apply --check pre-decrypt-context.patch
git apply pre-decrypt-context.patch
git apply --check async-ack-observer.patch
git apply async-ack-observer.patch
gofmt -w client.go message.go receipt.go store/store.go context-hook_test.go
# Use the selected Go version, not upstream's newer toolchain directive.
GOTOOLCHAIN=local go test -race -run '^TestRecovery(ContextHook|StorageFailure)$' .
GOTOOLCHAIN=local go vet .
