#!/usr/bin/env bash
# extract/04-refusals.sh — the guards you hit on ordinary archives
#
# Extraction refuses rather than guesses. This script shows the two guards a
# normal archive trips: overwriting an existing file (E_IO, until you pass
# --overwrite) and the opt-in tolerance flags --skip-unsafe / --skip-symlinks
# (which skip hostile entries instead of aborting — nothing unsafe is ever
# written). The hostile shapes themselves — zip-slip names, absolute paths,
# symlink entries, overlapping local headers, duplicate paths, zip bombs —
# are exercised byte-for-byte in tests/integration/refusal-posture.test.ts;
# each is refused with E_SECURITY / E_LIMIT plus the engine's ZIP_* zipCode.
#
# Usage:
#   bash samples/extract/04-refusals.sh
#
# Output: samples/output/extract/04-refusals/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/extract"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
DEST="$OUTPUT_DIR/04-refusals"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" "$INPUT_DIR/unicode" --output "$ZIP" --quiet
fi
rm -rf "$DEST"

echo "→ [1/4] First extraction succeeds:"
zn extract --input "$ZIP" --output-dir "$DEST" --json

echo ""
echo "→ [2/4] Second extraction into the same directory is REFUSED (E_IO):"
zn extract --input "$ZIP" --output-dir "$DEST" --json || echo "  exit $?"

echo ""
echo "→ [3/4] --overwrite makes it explicit:"
zn extract --input "$ZIP" --output-dir "$DEST" --overwrite --json

echo ""
echo "→ [4/4] --skip-unsafe --skip-symlinks: tolerate hostile entries by skipping them"
echo "        (this archive has none, so skipped stays empty):"
zn extract --input "$ZIP" --output-dir "$DEST" --overwrite --skip-unsafe --skip-symlinks --json

echo ""
echo "Refusal catalogue (E_SECURITY + zipCode): ZIP_PATH_TRAVERSAL, ZIP_SYMLINK_REJECTED,"
echo "ZIP_EXTRACT_DUPLICATE_PATH, ZIP_ENTRY_OVERLAP, ZIP_CD_LFH_MISMATCH; bounds (E_LIMIT):"
echo "--max-entry-size, --max-total-size, --max-ratio … — see zipnative schema errors."
