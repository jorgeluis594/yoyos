#!/bin/sh
set -eu

if ! timeout 15m ./gradlew :yoyos-whatsapp:connectedDebugAndroidTest; then
  adb logcat -d -t 500
  exit 1
fi

adb install app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.yoyos.whatsappnativeprobe/.MainActivity
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 &&
     adb shell cat /sdcard/window.xml | grep -q 'bridge-ok'; then
    exit 0
  fi
  sleep 3
done
adb shell cat /sdcard/window.xml || true
adb logcat -d -t 500
exit 1
