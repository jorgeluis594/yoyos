#!/bin/sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
mkdir -p "$test_dir/scripts" "$test_dir/bin" "$test_dir/.generated" "$test_dir/android/libs" "$test_dir/ios/Frameworks/WhatsAppGo.xcframework"
cp "$source_dir/scripts/build-go.sh" "$test_dir/scripts/build-go.sh"
cat > "$test_dir/bin/go" <<'EOF'
#!/bin/sh
echo 'go version go1.0.0 test'
EOF
chmod +x "$test_dir/bin/go"

for target in android ios all; do
  mkdir -p "$test_dir/ios/Frameworks/WhatsAppGo.xcframework"
  touch "$test_dir/android/libs/WhatsAppGo.aar" "$test_dir/ios/Frameworks/WhatsAppGo.xcframework/Info.plist" "$test_dir/.generated/build-info.txt"
  if PATH="$test_dir/bin:$PATH" sh "$test_dir/scripts/build-go.sh" "$target" >/dev/null 2>&1; then
    echo "expected $target prerequisite failure" >&2
    exit 1
  fi
  test ! -e "$test_dir/.generated/build-info.txt"
  if test "$target" = android || test "$target" = all; then
    test ! -e "$test_dir/android/libs/WhatsAppGo.aar"
  fi
  if test "$target" = ios || test "$target" = all; then
    test ! -e "$test_dir/ios/Frameworks/WhatsAppGo.xcframework"
  fi
done
