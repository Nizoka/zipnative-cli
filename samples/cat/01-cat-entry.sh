#!/usr/bin/env bash
# cat/01-cat-entry.sh — stream entries to stdout (decoded, and --raw)
#
# `cat` writes one or more entries to stdout in order (like `unzip -p`). The
# CRC is verified at the END of the stream, so a corrupt entry can already
# have produced bytes when E_DATA fires — with --output the partial file is
# removed. --raw emits the COMPRESSED payload untouched (zero-copy), which
# `inflate` can decode back. --dry-run resolves the entries and reports
# their sizes without emitting anything.
#
# Usage:
#   bash samples/cat/01-cat-entry.sh
#
# Output: samples/output/cat/archive.zip, 01-readme.txt, 01-readme.deflate

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/cat"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" --output "$ZIP" --quiet
fi

echo "→ cat text/notes.md to the terminal:"
zn cat --input "$ZIP" --entry text/notes.md

echo ""
echo "→ Two entries concatenated, positional form, into a file:"
zn cat "$ZIP" text/readme.txt text/with-dash_and.dots.txt --output "$OUTPUT_DIR/01-two-entries.txt"
wc -c "$OUTPUT_DIR/01-two-entries.txt" | sed 's/^/  /'

echo ""
echo "→ --dry-run: sizes only, nothing emitted:"
zn cat --input "$ZIP" --entry text/readme.txt --dry-run --json

echo ""
echo "→ --raw: the compressed DEFLATE payload, then inflate it back:"
zn cat --input "$ZIP" --entry text/readme.txt --raw --output "$OUTPUT_DIR/01-readme.deflate"
zn inflate --input "$OUTPUT_DIR/01-readme.deflate" --output "$OUTPUT_DIR/01-readme.txt" --json
if cmp -s "$OUTPUT_DIR/01-readme.txt" "$INPUT_DIR/text/readme.txt"; then
  echo "  ✓ raw payload inflates to the original bytes"
else
  echo "  ✗ mismatch" >&2; exit 1
fi
