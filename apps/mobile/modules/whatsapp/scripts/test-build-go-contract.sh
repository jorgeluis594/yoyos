#!/bin/sh
# IT-BLD-01, IT-BLD-03, IT-BLD-05, IT-BLD-08 (and the failure side of IT-BLD-02/04): drives the real build-go.sh
# end to end with fake `go` list/build answers, a fake gomobile, jar, javac, xcodebuild, xcrun and uname. It needs
# no Android SDK, NDK, Xcode or device, but it does use the real Go toolchain and the module cache that test-go.sh
# already requires (the pinned whatsmeow source is patched for real, on a copy). It proves the script's checks and
# bookkeeping, NOT that gomobile produces working binaries.
set -eu

source_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
real_go=$(command -v go) || { echo 'IT-BLD: a real Go toolchain is required (same as test-go.sh)' >&2; exit 1; }
export GOTOOLCHAIN=local GOPROXY=off
meow=v0.0.0-20261006124319-9399289b022b
mobile=v0.0.0-20260908204917-8b95e45f8d3e
upstream=$("$real_go" env GOMODCACHE)/go.mau.fi/whatsmeow@$meow
test -f "$upstream/go.mod" || { echo "pinned whatsmeow source missing from the module cache: $upstream" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
failures=0
check() { # check <description> <command...>
  description=$1; shift
  if "$@"; then :; else echo "FAILED: $description" >&2; failures=$((failures + 1)); fi
}

new_module() { # fresh module copy: scripts, patches and the go.mod/go.sum of the real module
  rm -rf "$work/module"
  mkdir -p "$work/module/scripts" "$work/module/go" "$work/bin" "$work/sdk/platforms/android-36" "$work/sdk/build-tools/36.0.0" "$work/sdk/ndk/27.1.12297006"
  cp "$source_dir/scripts/build-go.sh" "$work/module/scripts/build-go.sh"
  cp -R "$source_dir/patches" "$work/module/patches"
  cp "$source_dir/go/go.mod" "$source_dir/go/go.sum" "$work/module/go/"
  mkdir -p "$work/module/go/bridge" && echo 'package bridge' > "$work/module/go/bridge/bridge.go"
  cp "$source_dir/.gitignore" "$work/module/.gitignore"
  git -C "$work/module" init -q && git -C "$work/module" add -A && git -C "$work/module" -c user.email=t@t -c user.name=t commit -q -m seed
  : > "$work/calls.log"
}

# The fake `go`: answers the queries build-go.sh makes, logs every call with the environment that matters, and
# builds the "tools" as marker files. FAKE_* variables select the failure under test.
write_fakes() {
  cat > "$work/bin/go" <<EOF
#!/bin/sh
echo "go \$* [GOTOOLCHAIN=\${GOTOOLCHAIN:-} GOPROXY=\${GOPROXY:-}]" >> "$work/calls.log"
case "\$1 \$2" in
  "version -m") case "\${FAKE_TOOL_REVISION:-$mobile}" in none) ;; *) printf '\\tpath\\tgolang.org/x/mobile/cmd/tool\\n\\tmod\\tgolang.org/x/mobile\\t%s\\n' "\${FAKE_TOOL_REVISION:-$mobile}" ;; esac; exit 0 ;;
esac
case "\$1" in
  version) echo "go version \${FAKE_GO_VERSION:-go1.26.5} fake/arch" ;;
  list)
    case "\$*" in
      *go.mau.fi/whatsmeow*"{{.Dir}}"*|*"{{.Dir}}"*go.mau.fi/whatsmeow*) echo "\${FAKE_WHATSMEOW_DIR:-$upstream}" ;;
      *go.mau.fi/whatsmeow*) echo "\${FAKE_MEOW_VERSION:-$meow}" ;;
      *golang.org/x/mobile*) echo "\${FAKE_MOBILE_VERSION:-$mobile}" ;;
    esac ;;
  mod) case "\$2" in verify) test -z "\${FAKE_VERIFY_FAILS:-}" ;; edit) : ;; esac ;;
  build) while [ \$# -gt 0 ]; do if [ "\$1" = -o ]; then out=\$2; fi; shift; done; cp "$work/gomobile-behavior.sh" "\$out"; chmod +x "\$out" ;;
  env) echo "$work/gomodcache" ;;
  *) echo "unexpected go call: \$*" >> "$work/unexpected.log" ;;
esac
EOF
  cat > "$work/bin/gomobile" <<EOF
#!/bin/sh
echo "gomobile \$*" >> "$work/calls.log"
EOF
  # gomobile is built by the script into its own directory and shadows this one; the fake `go build` creates an
  # empty marker, so the bind step is driven by the wrapper below instead.
  cat > "$work/bin/jar" <<'EOF'
#!/bin/sh
exec unzip -Z1 "$2"
EOF
  for tool in javac xcodebuild xcrun; do printf '#!/bin/sh\nexit 0\n' > "$work/bin/$tool"; done
  printf '#!/bin/sh\necho Darwin\n' > "$work/bin/uname"
  chmod +x "$work/bin/"*
}

# Replace the marker gomobile the script builds with one that creates the requested artifact.
install_gomobile_behavior() {
  cat > "$work/gomobile-behavior.sh" <<EOF
#!/bin/sh
echo "gomobile \$*" >> "$work/calls.log"
while [ \$# -gt 0 ]; do case "\$1" in -o) out=\$2 ;; -target=*) target=\${1#-target=} ;; esac; shift; done
case "\$out" in
  *.aar)
    python3 - "\$out" "\${FAKE_ABIS:-arm64-v8a x86_64}" "\${FAKE_CLASS:-expo/modules/whatsapp/go/bridge/Bridge.class}" <<'PY'
import io, sys, zipfile
out, abis, cls = sys.argv[1:4]
jar = io.BytesIO()
with zipfile.ZipFile(jar, 'w') as z:
    z.writestr(cls, b'x')
with zipfile.ZipFile(out, 'w') as z:
    z.writestr('classes.jar', jar.getvalue())
    for abi in abis.split():
        z.writestr('jni/%s/libgojni.so' % abi, b'x')
PY
    ;;
  *.xcframework)
    mkdir -p "\$out"
    python3 - "\$out/Info.plist" "\${FAKE_DEVICE_ARCHS:-arm64}" "\${FAKE_SIM_ARCHS:-arm64 x86_64}" <<'PY'
import plistlib, sys
path, device, sim = sys.argv[1:4]
libs = [{'SupportedPlatform': 'ios', 'SupportedArchitectures': device.split()},
        {'SupportedPlatform': 'ios', 'SupportedPlatformVariant': 'simulator', 'SupportedArchitectures': sim.split()}]
with open(path, 'wb') as f:
    plistlib.dump({'AvailableLibraries': libs}, f)
PY
    ;;
esac
EOF
}

run_build() { # run_build <target> [VAR=value ...] -> exit status of build-go.sh
  target=$1; shift
  (
    cd "$work/module"
    for assignment in "$@"; do export "$assignment"; done
    export ANDROID_HOME="$work/sdk"
    PATH="$work/bin:$PATH" sh scripts/build-go.sh "$target" > "$work/out.log" 2>&1
  )
}
published() { test -e "$work/module/android/libs/WhatsAppGo.aar" || test -e "$work/module/ios/Frameworks/WhatsAppGo.xcframework"; }
message() { grep -q "$1" "$work/out.log"; }

mkdir -p "$work/bin"
write_fakes
install_gomobile_behavior

# --- success path: every target, with the effective tools recorded (IT-BLD-01, IT-BLD-05, IT-BLD-08) ---------------
new_module
before_cache=$(mktemp "$work/marker.XXXXXX")
check 'all targets build with the fakes' run_build all
check 'the Android AAR is published' test -f "$work/module/android/libs/WhatsAppGo.aar"
check 'the iOS XCFramework is published' test -f "$work/module/ios/Frameworks/WhatsAppGo.xcframework/Info.plist"
check 'build-info.txt exists' test -f "$work/module/.generated/build-info.txt"
info="$work/module/.generated/build-info.txt"
check 'IT-BLD-08 records the Go version' grep -q '^Go: go version go1.26.5' "$info"
check 'IT-BLD-08 records whatsmeow and x/mobile' sh -c "grep -q '^whatsmeow: $meow' '$info' && grep -q '^x/mobile: $mobile' '$info'"
check 'IT-BLD-08 records the source commit' sh -c "grep -q \"^source: \$(git -C '$work/module' rev-parse HEAD)\" '$info'"
check 'IT-BLD-08 records the target' grep -q '^target: all' "$info"
check 'IT-BLD-08 records the effective tools (go version -m)' grep -q 'golang.org/x/mobile' "$info"
check 'IT-BLD-08 records the bind commands' sh -c "grep -q '^command: gomobile bind -target=android/arm64,android/amd64' '$info' && grep -q '^command: gomobile bind -target=ios/arm64' '$info'"
check 'IT-BLD-08 records a clean tree: build outputs are ignored, so they do not make it dirty' grep -qx 'source-tree: clean' "$info"
check 'IT-BLD-07 records a hash of the Go sources, patches and script' grep -Eq '^inputs-sha256: [0-9a-f]{64}$' "$info"
clean_hash=$(grep '^inputs-sha256:' "$info")
# IT-BLD-01: pinned toolchain, no implicit downloads or upgrades.
check 'IT-BLD-01 every go call ran with GOTOOLCHAIN=local and GOPROXY=off' sh -c "! grep '^go ' '$work/calls.log' | grep -v 'GOTOOLCHAIN=local GOPROXY=off'"
check 'IT-BLD-01 dependencies were verified' grep -q '^go mod verify' "$work/calls.log"
check 'IT-BLD-01 no go get, install, mod download, tidy or update' sh -c "! grep -E '^go (get|install|mod (download|tidy)|mod edit -require)' '$work/calls.log'"
check 'IT-BLD-01 gomobile init is never run' sh -c "! grep -q 'gomobile init' '$work/calls.log'"
check 'IT-BLD-01 no unexpected go call' test ! -e "$work/unexpected.log"
check 'IT-BLD-01 the module go.mod and go.sum are untouched' sh -c "cmp '$source_dir/go/go.mod' '$work/module/go/go.mod' && cmp '$source_dir/go/go.sum' '$work/module/go/go.sum'"
check 'IT-BLD-01 the script never names @latest or an upgrade' sh -c "! grep -E '@latest|go get|go install|go mod tidy' '$source_dir/scripts/build-go.sh'"
# IT-BLD-05: only the agreed targets, versions and prefixes.
check 'IT-BLD-05 Android binds arm64 and amd64 with API 24 and the Java prefix' grep -q 'gomobile bind -target=android/arm64,android/amd64 -androidapi=24 -javapkg=expo.modules.whatsapp.go' "$work/calls.log"
check 'IT-BLD-05 iOS binds the device arm64 and both simulators with 16.4 and the ObjC prefix' grep -q 'gomobile bind -target=ios/arm64,iossimulator/arm64,iossimulator/amd64 -iosversion=16.4 -prefix=YYWhatsAppGo' "$work/calls.log"
check 'IT-BLD-05 no extra target is requested' sh -c "! grep -E 'gomobile bind' '$work/calls.log' | grep -E 'armeabi|386|android/arm( |,)|ios/(amd64|x86)|macos|maccatalyst'"
# IT-BLD-03: the cache is never written; patches apply to a copy.
check 'IT-BLD-03 the module cache was not modified' sh -c "test -z \"\$(find '$upstream' -newer '$before_cache' | head -1)\""

# --- IT-BLD-08 / IT-BLD-07: an uncommitted change is recorded as dirty and changes the input hash ---------------------
new_module
echo '// changed' >> "$work/module/go/bridge/bridge.go"
check 'a build over a modified tree succeeds' run_build android
check 'IT-BLD-08 a modified tree is recorded as dirty' grep -qx 'source-tree: dirty' "$work/module/.generated/build-info.txt"
check 'IT-BLD-07 a changed input changes the recorded hash' sh -c "! grep -qx '$clean_hash' '$work/module/.generated/build-info.txt'"
new_module
check 'IT-BLD-07 the same inputs record the same hash' run_build android
check 'IT-BLD-07 the hash is reproducible' grep -qx "$clean_hash" "$work/module/.generated/build-info.txt"

# --- IT-BLD-03: a patch that does not apply stops the build without publishing anything -------------------------------
new_module
mkdir -p "$work/other" && printf 'module example.com/other\n' > "$work/other/go.mod"
if run_build all FAKE_WHATSMEOW_DIR="$work/other"; then echo 'FAILED: IT-BLD-03 a patch that does not apply must stop the build' >&2; failures=$((failures + 1)); fi
check 'IT-BLD-03 the failure names the patch' message 'patch does not match pinned revision'
check 'IT-BLD-03 nothing is published after a patch failure' sh -c "! test -e '$work/module/android/libs/WhatsAppGo.aar' && ! test -e '$work/module/ios/Frameworks/WhatsAppGo.xcframework' && ! test -e '$work/module/.generated/build-info.txt'"
check 'IT-BLD-03 upstream is not substituted: gomobile was never invoked' sh -c "! grep -q 'gomobile bind' '$work/calls.log'"

# --- each missing patch is reported as such (WA-14 review minor 10) -------------------------------------------------
for patch in pre-decrypt-context wa05-socket-ownership wa08-history-batch; do
  new_module
  rm "$work/module/patches/$patch.patch"
  if run_build android; then echo "FAILED: a missing $patch patch must stop the build" >&2; failures=$((failures + 1)); fi
  check "a missing $patch patch is named as missing" message 'patch missing'
done

# --- IT-BLD-01: tool and dependency drift stops the build ----------------------------------------------------------
for drift in 'FAKE_GO_VERSION=go1.25.0:expected go1.26.5' 'FAKE_MEOW_VERSION=v0.0.0-other:whatsmeow revision changed' 'FAKE_MOBILE_VERSION=v0.0.0-other:x/mobile revision changed' 'FAKE_TOOL_REVISION=v0.0.0-other:revision changed' 'FAKE_VERIFY_FAILS=1:failed verification'; do
  new_module
  if run_build android "${drift%%:*}"; then echo "FAILED: IT-BLD-01 drift ${drift%%:*} must stop the build" >&2; failures=$((failures + 1)); fi
  check "IT-BLD-01 ${drift%%:*} is reported" message "${drift#*:}"
  check "IT-BLD-01 ${drift%%:*} publishes nothing" sh -c "! test -e '$work/module/android/libs/WhatsAppGo.aar'"
done

# --- IT-BLD-05: wrong ABIs, architectures or prefixes are refused --------------------------------------------------
new_module
if run_build android 'FAKE_ABIS=arm64-v8a x86_64 armeabi-v7a'; then echo 'FAILED: IT-BLD-05 an extra ABI must stop the build' >&2; failures=$((failures + 1)); fi
check 'IT-BLD-05 an extra ABI is reported' message 'unexpected Android ABI set'
check 'IT-BLD-05 nothing is published with a wrong ABI set' sh -c "! test -e '$work/module/android/libs/WhatsAppGo.aar'"
new_module
if run_build android 'FAKE_ABIS=arm64-v8a'; then echo 'FAILED: IT-BLD-05 a missing ABI must stop the build' >&2; failures=$((failures + 1)); fi
check 'IT-BLD-05 a missing ABI is reported' message 'unexpected Android ABI set'
new_module
if run_build android 'FAKE_CLASS=com/example/wrong/Bridge.class'; then echo 'FAILED: IT-BLD-05 a wrong Java prefix must stop the build' >&2; failures=$((failures + 1)); fi
check 'IT-BLD-05 a wrong Java prefix is reported' message 'Java binding prefix missing'
new_module
if run_build ios 'FAKE_SIM_ARCHS=arm64'; then echo 'FAILED: IT-BLD-05 a missing simulator slice must stop the build' >&2; failures=$((failures + 1)); fi
check 'IT-BLD-05 a missing simulator slice is reported' message 'unexpected iOS architecture set'
new_module
if run_build ios 'FAKE_DEVICE_ARCHS=arm64 x86_64'; then echo 'FAILED: IT-BLD-05 an extra device slice must stop the build' >&2; failures=$((failures + 1)); fi
check 'IT-BLD-05 an extra device slice is reported' message 'unexpected iOS architecture set'
check 'IT-BLD-05 nothing is published with a wrong iOS slice set' sh -c "! test -e '$work/module/ios/Frameworks/WhatsAppGo.xcframework'"

# --- a failed rebuild must not leave the previous artifact looking new (IT-BLD-04, failure side) -----------------------
new_module
run_build android
before=$(cksum < "$work/module/android/libs/WhatsAppGo.aar")
if run_build android 'FAKE_ABIS=arm64-v8a'; then failures=$((failures + 1)); fi
check 'IT-BLD-04 a failed rebuild removes the previous AAR and build-info' sh -c "! test -e '$work/module/android/libs/WhatsAppGo.aar' && ! test -e '$work/module/.generated/build-info.txt'"
test -n "$before"

if test "$failures" -gt 0; then echo "$failures check(s) failed" >&2; exit 1; fi
echo 'build-go.sh contract checks passed'
