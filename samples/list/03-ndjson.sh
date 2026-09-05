#!/usr/bin/env bash
# list/03-ndjson.sh — one JSON object per entry (--format ndjson)
#
# NDJSON streams one row per line — ideal for `grep`, `jq -c`, or feeding a
# log pipeline without holding the whole report in memory. Combined with
# --include/--exclude it doubles as a cheap archive query language.
#
# Usage:
#   bash samples/list/03-ndjson.sh
#
# Output: samples/output/list/03-ndjson.ndjson

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

echo "→ --format ndjson (saved to 03-ndjson.ndjson):"
zn list --input "$ZIP" --format ndjson | tee "$OUTPUT_DIR/03-ndjson.ndjson"

echo ""
echo "→ Only Markdown entries, name and CRC (ndjson + --exclude + a shell filter):"
zn list --input "$ZIP" --format ndjson --exclude '**/*.txt' \
  | sed -E 's/.*"name":"([^"]*)".*"crc32":"([^"]*)".*/  \2  \1/'
