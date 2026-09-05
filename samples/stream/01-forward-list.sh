#!/usr/bin/env bash
# stream/01-forward-list.sh — list an archive arriving on a pipe
#
# `stream` is the forward-only reader for UNSEEKABLE input (a pipe, a
# network body): it parses local headers as they arrive and never needs the
# central directory. Trust caveat: without the central directory nothing
# cross-checks names, sizes or methods, so every JSON output carries
# trust: "local-headers-only" and a warning is printed. Entries written with
# a data descriptor show 0 sizes/CRC in the rows (the values only follow the
# payload). Prefer `list`/`inspect` whenever the whole file is on disk.
#
# Usage:
#   bash samples/stream/01-forward-list.sh
#
# Output: samples/output/stream/archive.zip, 01-forward-list.ndjson

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/stream"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" --output "$ZIP" --quiet
fi

echo "→ cat archive.zip | zipnative stream   (text table, default --list):"
cat "$ZIP" | zn stream

echo ""
echo "→ NDJSON rows as they arrive (saved to 01-forward-list.ndjson):"
cat "$ZIP" | zn stream --list --format ndjson --quiet | tee "$OUTPUT_DIR/01-forward-list.ndjson"

echo ""
echo "→ --json --summary carries the trust marker:"
cat "$ZIP" | zn stream --json --summary
