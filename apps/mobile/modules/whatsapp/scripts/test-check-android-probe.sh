#!/bin/sh
set -eu

module_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
mkdir -p "$test_dir/bin"

cat > "$test_dir/bin/timeout" <<'EOF'
#!/bin/sh
shift
"$@"
EOF
cat > "$test_dir/gradlew" <<'EOF'
#!/bin/sh
test "${MOCK_GRADLE_FAIL:-0}" != 1
EOF
cat > "$test_dir/bin/find" <<'EOF'
#!/bin/sh
echo /tmp/mock-androidTest.apk
EOF
cat > "$test_dir/bin/adb" <<'EOF'
#!/bin/sh
case "$*" in
  'install -r /tmp/mock-androidTest.apk') ;;
  'shell pm list instrumentation') echo 'instrumentation:expo.modules.whatsapp.test/androidx.test.runner.AndroidJUnitRunner (target=expo.modules.whatsapp)' ;;
  *crashAtPublicationBoundary*)
    if test "${MOCK_CRASH_SUCCESS:-0}" = 1; then echo 'OK (1 test)'; else echo 'INSTRUMENTATION_RESULT: shortMsg=Process crashed.'; fi ;;
  shell\ am\ instrument*) echo 'OK (1 test)' ;;
  'shell cat /sdcard/window.xml')
    if test "${MOCK_MARKER:-1}" = 1; then echo 'bridge-ok'; else echo 'pending'; fi ;;
  'logcat -d -t 500') echo 'diagnostic log' ;;
esac
EOF
cat > "$test_dir/bin/sleep" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$test_dir/bin/timeout" "$test_dir/bin/find" "$test_dir/bin/adb" "$test_dir/bin/sleep" "$test_dir/gradlew"

(
  cd "$test_dir"
  PATH="$test_dir/bin:$PATH" sh "$module_dir/scripts/check-android-probe.sh" > "$test_dir/result"
  if MOCK_GRADLE_FAIL=1 PATH="$test_dir/bin:$PATH" sh "$module_dir/scripts/check-android-probe.sh" > "$test_dir/result"; then
    echo 'instrumentation failure was accepted' >&2
    exit 1
  fi
  if MOCK_CRASH_SUCCESS=1 PATH="$test_dir/bin:$PATH" sh "$module_dir/scripts/check-android-probe.sh" > "$test_dir/result"; then
    echo 'missing process kill was accepted' >&2
    exit 1
  fi
  if MOCK_MARKER=0 PATH="$test_dir/bin:$PATH" sh "$module_dir/scripts/check-android-probe.sh" > "$test_dir/result"; then
    echo 'missing app marker was accepted' >&2
    exit 1
  fi
  test "$(tail -1 "$test_dir/result")" = 'diagnostic log'
)
