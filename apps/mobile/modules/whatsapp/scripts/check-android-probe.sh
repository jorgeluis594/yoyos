#!/bin/sh
set -eu
module_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

if ! timeout 15m ./gradlew :yoyos-whatsapp:connectedDebugAndroidTest; then
  adb logcat -d -t 500
  exit 1
fi

test_apk=$(find "$module_dir/android/build/outputs/apk/androidTest" -type f -name '*.apk' -print -quit 2>/dev/null || true)
test -n "$test_apk" || { echo 'Android instrumentation APK is missing' >&2; exit 1; }
adb install -r "$test_apk"
instrumentation=$(adb shell pm list instrumentation | sed -n '/AndroidJUnitRunner/ s/^instrumentation:\([^ ]*\).*/\1/p' | head -1 | tr -d '\r')
test -n "$instrumentation" || { adb shell pm list instrumentation; exit 1; }
run_id="$(date +%s)-$$"
for phase in cipher write sync close replace directorySync response; do
  crash_output=$(mktemp)
  recovery_output=$(mktemp)
  timeout 45s adb shell am instrument -w -e class expo.modules.whatsapp.StateStoreCrashInstrumentedTest\#crashAtPublicationBoundary -e phase "$phase" -e runId "$run_id" "$instrumentation" > "$crash_output" 2>&1 || true
  if grep -q 'OK (1 test)' "$crash_output" ||
     ! timeout 90s adb shell am instrument -w -e class expo.modules.whatsapp.StateStoreCrashInstrumentedTest\#recoverAfterPublicationCrash -e phase "$phase" -e runId "$run_id" "$instrumentation" > "$recovery_output" 2>&1 ||
     ! grep -q 'OK (1 test)' "$recovery_output"; then
    cat "$crash_output" "$recovery_output"
    rm -f "$crash_output" "$recovery_output"
    exit 1
  fi
  echo "Recovered Android publication crash at $phase"
  rm -f "$crash_output" "$recovery_output"
done

adb install app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.yoyos.whatsappnativeprobe/.MainActivity
marker_found=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 &&
     adb shell cat /sdcard/window.xml | grep -q 'bridge-ok'; then
    marker_found=1
    break
  fi
  sleep 3
done
if test "$marker_found" != 1; then
  adb shell cat /sdcard/window.xml || true
  adb logcat -d -t 500
  exit 1
fi

enospc_output=$(mktemp)
if ! timeout 10m adb shell am instrument -w -e class expo.modules.whatsapp.StateStoreInstrumentedTest\#enospcDuringSecondCopyKeepsPublishedState -e enospc true "$instrumentation" > "$enospc_output" 2>&1 ||
   ! grep -q 'OK (1 test)' "$enospc_output"; then
  cat "$enospc_output"
  rm -f "$enospc_output"
  exit 1
fi
echo 'Verified Android second-copy ENOSPC'
rm -f "$enospc_output"
