#!/usr/bin/env bash
# extract/02-filter-and-flat.sh — --include/--exclude globs, --entry, --flat
#
# Globs (*, **, ?) select entries by name; --entry names them exactly; --flat
# drops directories and writes basenames only. Two entries collapsing onto
# the same flat path are refused (ZIP_EXTRACT_DUPLICATE_PATH) unless
# --on-duplicate first|last says which one wins. Filtered entries are
# reported as skipped (reason "filtered") on stderr.
#
# Usage:
#   bash samples/extract/02-filter-and-flat.sh
#
# Output: samples/output/extract/02-markdown/, 02-flat/, 02-entry/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/extract"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" "$INPUT_DIR/unicode" --output "$ZIP" --quiet
fi
rm -rf "$OUTPUT_DIR/02-markdown" "$OUTPUT_DIR/02-flat" "$OUTPUT_DIR/02-entry"

echo "→ Only Markdown (--include '**/*.md'), tree preserved:"
zn extract --input "$ZIP" --output-dir "$OUTPUT_DIR/02-markdown" --include '**/*.md' --quiet
(cd "$OUTPUT_DIR/02-markdown" && find . -type f | sort | sed 's/^/  /')

echo ""
echo "→ Everything except *.txt, flattened (--exclude + --flat):"
zn extract --input "$ZIP" --output-dir "$OUTPUT_DIR/02-flat" --exclude '**/*.txt' --flat --quiet
ls "$OUTPUT_DIR/02-flat" | sed 's/^/  /'

echo ""
echo "→ A single named entry (--entry):"
zn extract --input "$ZIP" --output-dir "$OUTPUT_DIR/02-entry" --entry 'unicode/café/résumé.txt' --json
