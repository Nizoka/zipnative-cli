#!/usr/bin/env bash
# list/02-json-fields.sh — JSON report, --summary and --fields projection
#
# --format json emits the full entries report (shape: `zipnative schema
# entries`). --summary collapses it to counts and sizes; --fields keeps only
# the named dot-paths — `entries.name,entries.uncompressedSize` projects every
# array element. Under --json the output is compact (one line) unless --pretty.
#
# Usage:
#   bash samples/list/02-json-fields.sh
#
# Output: samples/output/list/02-json-fields.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/list"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" "$INPUT_DIR/unicode" --output "$ZIP" --quiet
fi

echo "→ --format json --summary:"
zn list --input "$ZIP" --format json --summary

echo ""
echo "→ --fields entries.name,entries.uncompressedSize (saved to 02-json-fields.json):"
zn list --input "$ZIP" --format json --fields entries.name,entries.uncompressedSize | tee "$OUTPUT_DIR/02-json-fields.json"

echo ""
echo "→ Agent mode: --json makes the same report compact, --pretty re-indents it:"
zn list --input "$ZIP" --json --summary
zn list --input "$ZIP" --json --pretty --fields entries.name
