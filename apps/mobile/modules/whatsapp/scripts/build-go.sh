#!/bin/sh
set -eu

module_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
target=${1:-}
case "$target" in android|ios|all) ;; *) echo 'usage: build-go.sh android|ios|all' >&2; exit 2 ;; esac

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
test -f "$module_dir/patches/pre-decrypt-context.patch" || fail 'required whatsmeow patch missing'

if test "$target" = android || test "$target" = all; then
  rm -f "$module_dir/android/libs/WhatsAppGo.aar"
  command -v javac >/dev/null 2>&1 || fail 'JDK required for Android'
  test -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" || fail 'Android SDK required'
  android_sdk=${ANDROID_HOME:-$ANDROID_SDK_ROOT}
  test -d "$android_sdk/platforms/android-36" || fail 'Android API 36 required'
  test -d "$android_sdk/build-tools/36.0.0" || fail 'Android build-tools 36.0.0 required'
  test -d "$android_sdk/ndk/27.1.12297006" || fail 'Android NDK 27.1.12297006 required'
  export ANDROID_NDK_HOME="$android_sdk/ndk/27.1.12297006"
fi
if test "$target" = ios || test "$target" = all; then
  rm -rf "$module_dir/ios/Frameworks/WhatsAppGo.xcframework"
  test "$(uname -s)" = Darwin || fail 'iOS requires macOS'
  command -v xcodebuild >/dev/null 2>&1 || fail 'Xcode required'
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
export PATH="$build_dir:$PATH"

upstream_dir=$(go list -m -f '{{.Dir}}' go.mau.fi/whatsmeow)
test -f "$upstream_dir/go.mod" || fail 'pinned whatsmeow source missing from module cache'
cp -R "$upstream_dir" "$build_dir/whatsmeow"
chmod -R u+w "$build_dir/whatsmeow"
cd "$build_dir/whatsmeow"
git apply --check "$module_dir/patches/pre-decrypt-context.patch" || fail 'patch does not match pinned revision'
git apply "$module_dir/patches/pre-decrypt-context.patch"
cd "$module_dir/go"
cp -R . "$build_dir/go"
cd "$build_dir/go"
go mod edit -replace="go.mau.fi/whatsmeow=$build_dir/whatsmeow"
# gomobile init installs gobind@latest; bind only needs its work directory.
export GOMODCACHE="$(go env GOMODCACHE)"
export GOPATH="$build_dir/gopath"
mkdir -p "$GOPATH/pkg/gomobile"
if test "$target" = android || test "$target" = all; then
  gomobile bind -target=android/arm64,android/amd64 -androidapi=24 -javapkg=expo.modules.whatsapp.go -o "$build_dir/WhatsAppGo.aar" ./bridge
  unzip -l "$build_dir/WhatsAppGo.aar" | grep -q 'jni/arm64-v8a/libgojni.so' || fail 'Android arm64 binding missing'
  unzip -l "$build_dir/WhatsAppGo.aar" | grep -q 'jni/x86_64/libgojni.so' || fail 'Android amd64 binding missing'
fi
if test "$target" = ios || test "$target" = all; then
  gomobile bind -target=ios/arm64,iossimulator/arm64,iossimulator/amd64 -iosversion=16.4 -prefix=YYWhatsAppGo -o "$build_dir/WhatsAppGo.xcframework" ./bridge
  test -f "$build_dir/WhatsAppGo.xcframework/Info.plist" || fail 'iOS framework incomplete'
fi

if test "$target" = android || test "$target" = all; then
  mkdir -p "$module_dir/android/libs"
  mv "$build_dir/WhatsAppGo.aar" "$module_dir/android/libs/WhatsAppGo.aar"
fi
if test "$target" = ios || test "$target" = all; then
  mkdir -p "$module_dir/ios/Frameworks"
  mv "$build_dir/WhatsAppGo.xcframework" "$module_dir/ios/Frameworks/WhatsAppGo.xcframework"
fi
{
  echo "Go: $(go version)"
  echo "whatsmeow: $expected_meow"
  echo "x/mobile: $expected_mobile"
  echo "source: $(git -C "$module_dir" rev-parse HEAD)"
  echo "target: $target"
  echo "gomobile: $($build_dir/gomobile version)"
} > "$module_dir/.generated/build-info.txt"
