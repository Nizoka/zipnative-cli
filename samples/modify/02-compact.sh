#!/usr/bin/env bash
# modify/02-compact.sh — canonical rewrite with --compact (true deletion)
#
# --compact re-emits the archive canonically: removed data is truly gone,
# offsets are rebuilt, the single central directory sits at the end — and
# untouched entries are STILL copied compressed as-is (no recompression).
# The script removes an entry both ways and compares sizes and diagnostics.
#
# Usage:
#   bash samples/modify/02-compact.sh
#
# Output: samples/output/modify/02-append.zip, 02-compact.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/modify"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

BASE="$OUTPUT_DIR/base.zip"
if [ ! -f "$BASE" ]; then
  zn create "$INPUT_DIR/text" --output "$BASE" --quiet
fi

echo "→ Remove text/notes.md, append-only (default):"
zn modify --input "$BASE" --output "$OUTPUT_DIR/02-append.zip" --remove text/notes.md --json

echo ""
echo "→ Remove text/notes.md, --compact:"
zn modify --input "$BASE" --output "$OUTPUT_DIR/02-compact.zip" --remove text/notes.md --compact --json

echo ""
echo "→ Sizes (base → append-only grows, compact shrinks):"
wc -c "$BASE" "$OUTPUT_DIR/02-append.zip" "$OUTPUT_DIR/02-compact.zip" | sed 's/^/  /'

echo ""
echo "→ inspect: multipleEocd is true only for the append-only file:"
zn inspect --input "$OUTPUT_DIR/02-append.zip"  --format json --fields archive.bytes,archive.multipleEocd,diagnostics
zn inspect --input "$OUTPUT_DIR/02-compact.zip" --format json --fields archive.bytes,archive.multipleEocd,diagnostics

echo ""
echo "→ Both still verify:"
zn verify --input "$OUTPUT_DIR/02-append.zip"  --json --summary
zn verify --input "$OUTPUT_DIR/02-compact.zip" --json --summary
