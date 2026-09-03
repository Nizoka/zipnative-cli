#!/usr/bin/env bash
# extract/01-basic.sh — extract to a directory, secure by default
#
# --output-dir is REQUIRED (created if missing). Every entry name is passed
# through sanitizeEntryPath() and re-checked for containment under the root,
# so zip-slip, absolute paths, drive letters, device names and symlink
# entries are refused without any opt-in. --json returns the counts and the
# skipped list; UTF-8 names round-trip as-is.
#
# Usage:
#   bash samples/extract/01-basic.sh
#
# Output: samples/output/extract/archive.zip, 01-basic/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/extract"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
DEST="$OUTPUT_DIR/01-basic"
if [ ! -f "$ZIP" ]; then
  echo "→ Building the sample archive…"
  zn create "$INPUT_DIR/text" "$INPUT_DIR/unicode" --output "$ZIP" --quiet
fi
rm -rf "$DEST"

echo "→ Extracting into $DEST:"
zn extract --input "$ZIP" --output-dir "$DEST" --json

echo ""
echo "→ Extracted tree:"
(cd "$DEST" && find . -type f | sort | sed 's/^/  /')

echo ""
echo "→ Byte check against the source:"
if cmp -s "$INPUT_DIR/text/readme.txt" "$DEST/text/readme.txt"; then
  echo "  ✓ text/readme.txt identical"
else
  echo "  ✗ mismatch" >&2; exit 1
fi
