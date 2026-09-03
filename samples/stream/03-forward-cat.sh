#!/usr/bin/env bash
# stream/03-forward-cat.sh — pull one entry out of a pipe (stream --cat)
#
# `stream --cat <name>` writes the named entry's decoded bytes to stdout as
# soon as its local header passes by — no seeking, no central directory.
# --cat is repeatable; entries are emitted in archive order. Handy for
# `curl … | zipnative stream --cat manifest.json` style one-liners.
#
# Usage:
#   bash samples/stream/03-forward-cat.sh
#
# Output: samples/output/stream/03-forward-cat.md

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

echo "→ cat archive.zip | zipnative stream --cat text/notes.md:"
cat "$ZIP" | zn stream --cat text/notes.md --quiet | tee "$OUTPUT_DIR/03-forward-cat.md"

echo ""
if cmp -s "$OUTPUT_DIR/03-forward-cat.md" "$INPUT_DIR/text/notes.md"; then
  echo "  ✓ identical to samples/input/text/notes.md"
else
  echo "  ✗ mismatch" >&2; exit 1
fi

echo ""
echo "→ Two entries, in archive order, piped straight into crc32:"
cat "$ZIP" | zn stream --cat text/readme.txt --cat text/notes.md --quiet | zn crc32
