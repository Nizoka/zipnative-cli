#!/usr/bin/env bash
# stream/02-forward-extract.sh — extract from a pipe (stream --output-dir)
#
# The same containment guards as `extract` apply (sanitizeEntryPath + root
# check, --skip-unsafe, --overwrite, --on-duplicate, --flat), but with no
# central directory --preserve-mode / --allow-symlinks / --skip-symlinks are
# unavailable and --skip-unsupported is the escape hatch for encrypted or
# unknown-method entries. The script compares the streamed files with a
# regular `extract` of the same archive — they are byte-identical.
#
# Usage:
#   bash samples/stream/02-forward-extract.sh
#
# Output: samples/output/stream/02-extract/, 02-forward-extract/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/stream"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
REF="$OUTPUT_DIR/02-extract"
FWD="$OUTPUT_DIR/02-forward-extract"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" --output "$ZIP" --quiet
fi
rm -rf "$REF" "$FWD"

echo "→ Reference: extract from the file on disk:"
zn extract --input "$ZIP" --output-dir "$REF" --quiet

echo "→ Forward: cat archive.zip | zipnative stream --output-dir …:"
cat "$ZIP" | zn stream --output-dir "$FWD" --json

echo ""
for f in text/readme.txt text/notes.md text/with-dash_and.dots.txt; do
  if cmp -s "$REF/$f" "$FWD/$f"; then echo "  ✓ $f identical"; else echo "  ✗ $f differs" >&2; exit 1; fi
done

echo ""
echo "→ --dry-run plans the extraction without touching the disk:"
cat "$ZIP" | zn stream --output-dir "$OUTPUT_DIR/02-never-created" --include '**/*.md' --dry-run --json
