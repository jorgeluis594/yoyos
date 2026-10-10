#!/bin/sh
set -eu

module_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
target=${1:-}
case "$target" in android|ios|all) ;; *) echo 'usage: build-go.sh android|ios|all' >&2; exit 2 ;; esac

rm -f "$module_dir/.generated/build-info.txt"
if test "$target" = android || test "$target" = all; then
  rm -f "$module_dir/android/libs/WhatsAppGo.aar"
fi
if test "$target" = ios || test "$target" = all; then
  rm -rf "$module_dir/ios/Frameworks/WhatsAppGo.xcframework"
fi

export GOTOOLCHAIN=local
export GOPROXY=off
expected_meow=v0.0.0-20261006124319-9399289b022b
expected_mobile=v0.0.0-20260908204917-8b95e45f8d3e
expected_go=go1.26.5

fail() { echo "WhatsApp Go build: $*" >&2; exit 1; }
command -v go >/dev/null 2>&1 || fail 'Go 1.26.5 is required'
test "$(go version | awk '{print $3}')" = "$expected_go" || fail "expected $expected_go"
command -v git >/dev/null 2>&1 || fail 'git is required for patch validation'
test "$(cd "$module_dir/go" && go list -m -f '{{.Version}}' go.mau.fi/whatsmeow)" = "$expected_meow" || fail 'whatsmeow revision changed'
test "$(cd "$module_dir/go" && go list -m -f '{{.Version}}' golang.org/x/mobile)" = "$expected_mobile" || fail 'x/mobile revision changed'
test -f "$module_dir/patches/wa08-history-batch.patch" || fail 'required history batch patch missing'
test -f "$module_dir/patches/pre-decrypt-context.patch" || fail 'required whatsmeow patch missing'
test -f "$module_dir/patches/wa05-socket-ownership.patch" || fail 'required socket ownership patch missing'

if test "$target" = android || test "$target" = all; then
  command -v javac >/dev/null 2>&1 || fail 'JDK required for Android'
  test -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" || fail 'Android SDK required'
  android_sdk=${ANDROID_HOME:-$ANDROID_SDK_ROOT}
  test -d "$android_sdk/platforms/android-36" || fail 'Android API 36 required'
  test -d "$android_sdk/build-tools/36.0.0" || fail 'Android build-tools 36.0.0 required'
  test -d "$android_sdk/ndk/27.1.12297006" || fail 'Android NDK 27.1.12297006 required'
  export ANDROID_NDK_HOME="$android_sdk/ndk/27.1.12297006"
fi
if test "$target" = ios || test "$target" = all; then
  test "$(uname -s)" = Darwin || fail 'iOS requires macOS'
  command -v xcodebuild >/dev/null 2>&1 || fail 'Xcode required'
  command -v python3 >/dev/null 2>&1 || fail 'Python 3 required to inspect the framework'
  xcodebuild -version >/dev/null 2>&1 || fail 'full Xcode required'
  xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1 || fail 'iPhoneOS SDK required'
  xcrun --sdk iphonesimulator --show-sdk-path >/dev/null 2>&1 || fail 'iPhoneSimulator SDK required'
fi

mkdir -p "$module_dir/.generated"
build_dir=$(mktemp -d "$module_dir/.generated/build.XXXXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
cd "$module_dir/go"
go mod verify || fail 'Go dependencies failed verification'
go build -mod=readonly -o "$build_dir/gomobile" golang.org/x/mobile/cmd/gomobile
go build -mod=readonly -o "$build_dir/gobind" golang.org/x/mobile/cmd/gobind
for tool in gomobile gobind; do
  go version -m "$build_dir/$tool" | awk -v expected="$expected_mobile" '$1 == "mod" && $2 == "golang.org/x/mobile" && $3 == expected { found = 1 } END { exit !found }' || fail "$tool revision changed"
done
export PATH="$build_dir:$PATH"

upstream_dir=$(go list -m -f '{{.Dir}}' go.mau.fi/whatsmeow)
test -f "$upstream_dir/go.mod" || fail 'pinned whatsmeow source missing from module cache'
cp -R "$upstream_dir" "$build_dir/whatsmeow"
chmod -R u+w "$build_dir/whatsmeow"
cd "$build_dir/whatsmeow"
# Apply as plain patches on the copy: never let git find the Yoyos repository above it and skip files it cannot resolve.
export GIT_CEILING_DIRECTORIES="$build_dir"
git apply --check "$module_dir/patches/pre-decrypt-context.patch" || fail 'patch does not match pinned revision'
git apply "$module_dir/patches/pre-decrypt-context.patch"
git apply --check "$module_dir/patches/wa05-socket-ownership.patch" || fail 'socket ownership patch does not match pinned revision'
git apply "$module_dir/patches/wa05-socket-ownership.patch"
git apply --check "$module_dir/patches/wa08-history-batch.patch" || fail 'history batch patch does not match pinned revision'
git apply "$module_dir/patches/wa08-history-batch.patch"
cd "$module_dir/go"
cp -R . "$build_dir/go"
cd "$build_dir/go"
go mod edit -replace="go.mau.fi/whatsmeow=$build_dir/whatsmeow"
# `gomobile init` would fetch gobind from the network at an unpinned revision; bind only needs a work directory.
export GOMODCACHE="$(go env GOMODCACHE)"
export GOPATH="$build_dir/gopath"
mkdir -p "$GOPATH/pkg/gomobile"
if test "$target" = android || test "$target" = all; then
  android_bind='gomobile bind -target=android/arm64,android/amd64 -androidapi=24 -javapkg=expo.modules.whatsapp.go -o WhatsAppGo.aar ./bridge'
  gomobile bind -target=android/arm64,android/amd64 -androidapi=24 -javapkg=expo.modules.whatsapp.go -o "$build_dir/WhatsAppGo.aar" ./bridge
  test "$(unzip -Z1 "$build_dir/WhatsAppGo.aar" | awk -F/ '$1 == "jni" && $2 != "" { print $2 }' | sort -u)" = "$(printf 'arm64-v8a\nx86_64')" || fail 'unexpected Android ABI set'
  unzip -p "$build_dir/WhatsAppGo.aar" classes.jar > "$build_dir/classes.jar"
  jar tf "$build_dir/classes.jar" | grep -q '^expo/modules/whatsapp/go/bridge/Bridge.class$' || fail 'Java binding prefix missing'
fi
if test "$target" = ios || test "$target" = all; then
  ios_bind='gomobile bind -target=ios/arm64,iossimulator/arm64,iossimulator/amd64 -iosversion=16.4 -prefix=YYWhatsAppGo -o WhatsAppGo.xcframework ./bridge'
  gomobile bind -target=ios/arm64,iossimulator/arm64,iossimulator/amd64 -iosversion=16.4 -prefix=YYWhatsAppGo -o "$build_dir/WhatsAppGo.xcframework" ./bridge
  test -f "$build_dir/WhatsAppGo.xcframework/Info.plist" || fail 'iOS framework incomplete'
  python3 - "$build_dir/WhatsAppGo.xcframework/Info.plist" <<'PY' || fail 'unexpected iOS architecture set'
import plistlib
import sys

with open(sys.argv[1], 'rb') as source:
    libraries = plistlib.load(source)['AvailableLibraries']
device = {arch for lib in libraries if lib['SupportedPlatform'] == 'ios' and 'SupportedPlatformVariant' not in lib for arch in lib['SupportedArchitectures']}
simulator = {arch for lib in libraries if lib.get('SupportedPlatformVariant') == 'simulator' for arch in lib['SupportedArchitectures']}
assert device == {'arm64'} and simulator == {'arm64', 'x86_64'}
PY
fi

if test "$target" = android || test "$target" = all; then
  mkdir -p "$module_dir/android/libs"
  mv "$build_dir/WhatsAppGo.aar" "$module_dir/android/libs/WhatsAppGo.aar"
fi
if test "$target" = ios || test "$target" = all; then
  mkdir -p "$module_dir/ios/Frameworks"
  mv "$build_dir/WhatsAppGo.xcframework" "$module_dir/ios/Frameworks/WhatsAppGo.xcframework"
fi
# Hash of everything the binaries are built from (Go sources, patches and this script), so a rebuild after an
# input change is visible in the record (IT-BLD-07).
input_hash() {
  (cd "$module_dir" && find go patches scripts/build-go.sh -type f 2>/dev/null | LC_ALL=C sort | while read -r file; do
    if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$file"; else sha256sum "$file"; fi
  done) | if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi | cut -d' ' -f1
}
{
  echo "Go: $(go version)"
  echo "whatsmeow: $expected_meow"
  echo "x/mobile: $expected_mobile"
  echo "source: $(git -C "$module_dir" rev-parse HEAD)"
  # A dirty tree means the artifacts do not correspond to a commit.
  if test -n "$(git -C "$module_dir" status --porcelain -- . 2>/dev/null)"; then echo "source-tree: dirty"; else echo "source-tree: clean"; fi
  echo "inputs-sha256: $(input_hash)"
  echo "target: $target"
  test -z "${android_bind:-}" || echo "command: $android_bind"
  test -z "${ios_bind:-}" || echo "command: $ios_bind"
  go version -m "$build_dir/gomobile"
  go version -m "$build_dir/gobind"
} > "$module_dir/.generated/build-info.txt"
