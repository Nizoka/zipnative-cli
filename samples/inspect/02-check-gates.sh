#!/usr/bin/env bash
# inspect/02-check-gates.sh — CI assertions with --check (pass, then fail)
#
# --check turns the report into a gate. Assertions are repeatable and
# comma-separable: deterministic, epoch-timestamps, canonical-order,
# utf8-names, no-data-descriptor, no-zip64, no-encryption, no-symlinks,
# safe-names, no-duplicates, no-diagnostics, store-only, deflate-only, max-entries=N,
# min-entries=N, max-uncompressed=<size>, max-ratio=N, has=<name>,
# method=store|deflate. Any failure prints the report and exits 1 with
# E_CHECK_FAILED — the second call below is EXPECTED to fail.
#
# Usage:
#   bash samples/inspect/02-check-gates.sh
#
# Output: samples/output/inspect/02-check-pass.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/inspect"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" --deterministic --output "$ZIP" --quiet
fi

echo "→ Passing gate (deterministic, no encryption, ≤ 10 entries, has readme):"
zn inspect --input "$ZIP" \
  --check deterministic,no-encryption,no-symlinks,safe-names,max-entries=10 \
  --check has=text/readme.txt \
  --summary --format json | tee "$OUTPUT_DIR/02-check-pass.json"
echo "  ✓ exit 0 — checksPassed: true"

echo ""
echo "→ Failing gate — the archive is deflated, so 'store-only' cannot hold:"
zn inspect --input "$ZIP" --check store-only --summary --json || echo "  exit $? (E_CHECK_FAILED, envelope above on stderr)"

echo ""
echo "→ Same failure in text mode — every check verdict is listed:"
zn inspect --input "$ZIP" --check store-only,max-uncompressed=1k --format text || echo "  exit $?"
