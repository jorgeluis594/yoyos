#!/bin/sh
# IT-SEG-03: Go-side cost of the snapshots and confirmations (latency, bytes crossing the boundary, Go heap),
# against an in-memory container double and WITHOUT the race detector, which distorts memory and time.
# It measures nothing native (no encryption, fsync or replacement, no Kotlin/Swift heap, no device).
#   sh scripts/measure-go.sh [output.json]     default: MEASUREMENTS.json next to the README
set -eu

module_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
out=${1:-$module_dir/MEASUREMENTS.json}
case $out in /*) ;; *) out=$PWD/$out ;; esac
WA_GO_RACE= WA_MEASURE=1 WA_MEASURE_OUT=$out WA_GO_TEST_FLAGS='-run TestITSEG03MeasureSnapshotCost -v' sh "$module_dir/scripts/test-go.sh"
