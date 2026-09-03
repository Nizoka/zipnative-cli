#!/usr/bin/env bash
# extract/03-dry-run-plan.sh — plan an extraction without writing anything
#
# --dry-run resolves and validates every entry (names, containment, filters,
# limits) and prints the plan — one `plan <name> <size>` line per entry in
# text mode, a status envelope with dryRun: true under --json. The output
# directory is never created. Agents use this to preview what an untrusted
# archive WOULD do before committing to disk.
#
# Usage:
#   bash samples/extract/03-dry-run-plan.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/extract"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
DEST="$OUTPUT_DIR/03-never-created"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" "$INPUT_DIR/unicode" --output "$ZIP" --quiet
fi
rm -rf "$DEST"

echo "→ Text plan:"
zn extract --input "$ZIP" --output-dir "$DEST" --dry-run

echo ""
echo "→ JSON envelope for a filtered plan:"
zn extract --input "$ZIP" --output-dir "$DEST" --include '**/*.md' --dry-run --json

echo ""
if [ -e "$DEST" ]; then
  echo "  ✗ --dry-run created $DEST" >&2; exit 1
else
  echo "  ✓ nothing was written ($DEST does not exist)"
fi
