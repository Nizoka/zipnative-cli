#!/usr/bin/env bash
# modify/03-rename-and-comment.sh — --rename, --add-dir, --comment, --in-place
#
# --rename <from>=<to> rewrites an entry's name (the payload is copied, not
# recompressed); --add-dir adds an explicit directory entry; --comment sets
# the archive comment ("" clears it). --in-place writes back to the input
# path through a temp file + rename, so a crash never leaves a half-written
# archive behind. --dry-run validates the edits and writes nothing.
#
# Usage:
#   bash samples/modify/03-rename-and-comment.sh
#
# Output: samples/output/modify/03-rename-and-comment.zip, 03-in-place.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/modify"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

BASE="$OUTPUT_DIR/base.zip"
OUT="$OUTPUT_DIR/03-rename-and-comment.zip"
IP="$OUTPUT_DIR/03-in-place.zip"
if [ ! -f "$BASE" ]; then
  zn create "$INPUT_DIR/text" --output "$BASE" --quiet
fi

echo "→ --dry-run first: the plan, nothing written:"
zn modify --input "$BASE" --output "$OUT" --rename text/notes.md=text/NOTES.md --dry-run --json

echo ""
echo "→ Rename + directory entry + archive comment (--compact for a clean layout):"
zn modify --input "$BASE" --output "$OUT" \
  --rename text/notes.md=text/NOTES.md \
  --add-dir text/attachments \
  --comment "renamed by samples/modify/03-rename-and-comment.sh" \
  --compact --json
zn list --input "$OUT"
zn inspect --input "$OUT" --format json --fields archive.comment

echo ""
echo "→ --in-place on a copy (temp file + atomic rename):"
cp "$BASE" "$IP"
zn modify --input "$IP" --in-place --comment "edited in place" --compact --json
zn inspect --input "$IP" --format json --fields archive.comment
