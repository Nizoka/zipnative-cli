#!/usr/bin/env bash
# inspect/01-report.sh — forensic archive report (text and JSON)
#
# `inspect` opens the archive EAGERLY: every local header is cross-checked
# against the central directory and an overlap table is built before anything
# is printed. The report covers archive facts, per-method statistics, a
# determinism verdict and every diagnostic the parse emitted. --entries adds
# the long-form entry rows, --extra dumps extra-field payloads as hex.
#
# Usage:
#   bash samples/inspect/01-report.sh
#
# Output: samples/output/inspect/archive.zip, 01-report.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/inspect"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
if [ ! -f "$ZIP" ]; then
  echo "→ Building a deterministic sample archive…"
  zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" --deterministic --output "$ZIP" --quiet
fi

echo "→ Text report:"
zn inspect --input "$ZIP"

echo ""
echo "→ JSON report with entries (saved to 01-report.json):"
zn inspect --input "$ZIP" --format json --entries > "$OUTPUT_DIR/01-report.json"
head -c 600 "$OUTPUT_DIR/01-report.json"; echo " …"

echo ""
echo "→ Just the determinism block:"
zn inspect --input "$ZIP" --format json --fields determinism
