#!/usr/bin/env bash
# modify/01-append-only.sh — --add / --replace / --remove without recompression
#
# `modify` never recompresses untouched entries. Edits apply in a FIXED order
# regardless of argv order: remove → rename → replace → add/add-dir → comment.
# The DEFAULT save is APPEND-ONLY: the original bytes are kept verbatim, new
# payloads and a fresh central directory are appended. Consequences:
#   • the file only grows — removed/replaced content REMAINS RECOVERABLE
#     (data remanence) and `list` reports ZIP_MULTIPLE_EOCD on the result;
#   • 7-Zip's CLI is known to mis-read this layout.
# Pass --compact (see 02) whenever either matters.
#
# Usage:
#   bash samples/modify/01-append-only.sh
#
# Output: samples/output/modify/base.zip, 01-append-only.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/modify"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

BASE="$OUTPUT_DIR/base.zip"
OUT="$OUTPUT_DIR/01-append-only.zip"
if [ ! -f "$BASE" ]; then
  zn create "$INPUT_DIR/text" --output "$BASE" --quiet
fi

echo "→ Before:"
zn list --input "$BASE"

echo ""
echo "→ modify: add extra/pattern.bin, replace text/readme.txt, remove the dotted file:"
zn modify --input "$BASE" --output "$OUT" \
  --add "extra/pattern.bin=$INPUT_DIR/binary/pattern.bin" \
  --replace "text/readme.txt=$INPUT_DIR/text/notes.md" \
  --remove text/with-dash_and.dots.txt \
  --json

echo ""
echo "→ After (note the ZIP_MULTIPLE_EOCD info line — the old central directory is still inside):"
zn list --input "$OUT"

echo ""
echo "→ Sizes — append-only output is LARGER than base + new payload:"
wc -c "$BASE" "$OUT" | sed 's/^/  /'
echo "  The removed entry's bytes are still in the file: pass --compact to truly drop them (02)."
