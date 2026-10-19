#!/usr/bin/env bash
# list/05-range.sh — read an archive larger than memory, by byte ranges (--range)
#
# By default list / cat / verify load the whole archive, bounded by
# --max-input-size. --range reads a regular file by byte ranges through one
# descriptor (zipnative 1.1 openZipRange): list fetches only the central
# directory, cat only the entries it prints, verify one entry at a time. The
# demo shrinks --max-input-size to 1 KiB to show the difference on a small
# archive. A whole-entry fetch (cat --raw, verify) is bounded by
# --max-entry-compressed-size; stdin is refused (no random access).
#
# Usage:
#   bash samples/list/05-range.sh
#
# Output: samples/output/list/05-range.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/list"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/05-range.zip"
zn create "$INPUT_DIR" --output "$ZIP" --overwrite --quiet

echo "→ Buffered: the archive is above --max-input-size 1k (exit 1, E_LIMIT) — expected:"
zn list --input "$ZIP" --max-input-size 1k --json --summary || echo "  exit $?"

echo ""
echo "→ --range: only the central directory is read:"
zn list --input "$ZIP" --range --max-input-size 1k --json --summary

echo ""
echo "→ cat and verify by range too:"
zn cat --input "$ZIP" --entry input/text/readme.txt --range --max-input-size 1k
zn verify --input "$ZIP" --range --max-input-size 1k --json --summary
