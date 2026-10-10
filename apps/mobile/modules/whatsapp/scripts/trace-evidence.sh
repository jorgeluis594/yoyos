#!/bin/sh
# Regenerates TRACEABILITY.md and traceability.json from the code and from a fresh run of the non-native
# tests (Go with -race through test-go.sh, and Jest). Nothing native is executed.
#   sh scripts/trace-evidence.sh            run the tests, then rewrite the matrix
#   sh scripts/trace-evidence.sh --check    run the tests, then fail if the committed matrix is stale
set -eu

module_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
mobile_dir=$(CDPATH= cd -- "$module_dir/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# test-go.sh keeps going to the next command only when the previous one passed; a failure is kept in the JSON.
WA_GO_TEST_FLAGS=-json sh "$module_dir/scripts/test-go.sh" > "$work/go.json" || echo "go tests failed: the matrix will show the failing cases" >&2
(cd "$mobile_dir" && pnpm exec jest modules/whatsapp src/composition/whatsapp-options --json --outputFile="$work/jest.json" > /dev/null 2>&1) || echo "jest failed: the matrix will show the failing cases" >&2
cd "$module_dir"
# Shell tests that need no native toolchain (fake gomobile/jar/xcodebuild/adb): each script is one test, judged by its exit status.
printf '{' > "$work/sh.json"
separator=''
for script in scripts/test-build-go-cleanup.sh scripts/test-build-go-contract.sh scripts/test-check-android-probe.sh; do
  if sh "$script" > /dev/null 2>&1; then result=pass; else result=fail; fi
  printf '%s"%s":"%s"' "$separator" "$script" "$result" >> "$work/sh.json"
  separator=','
done
printf '}' >> "$work/sh.json"
node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/trace-matrix.ts --go-json "$work/go.json" --jest-json "$work/jest.json" --sh-json "$work/sh.json" "$@"
