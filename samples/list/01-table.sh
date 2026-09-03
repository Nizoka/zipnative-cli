#!/usr/bin/env bash
# list/01-table.sh — human-readable listing (text table), --long, --validate eager
#
# `list` reads only the central directory — nothing is decompressed. --long
# adds POSIX mode and the general-purpose flags (U = UTF-8 names, D = data
# descriptor); --validate eager cross-checks every local header up front.
# NOTE: -l takes no value, but the parser treats `-l <file>` as a flag with a
# value — pass the archive with --input or put --long after the positional.
#
# Usage:
#   bash samples/list/01-table.sh
#
# Output: samples/output/list/archive.zip, 01-table.txt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/list"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
if [ ! -f "$ZIP" ]; then
  echo "→ Building the sample archive…"
  zn create "$INPUT_DIR/text" "$INPUT_DIR/unicode" --output "$ZIP" --quiet
fi

echo "→ zipnative list --input archive.zip:"
zn list --input "$ZIP"

echo ""
echo "→ --long --validate eager (saved to 01-table.txt):"
zn list --input "$ZIP" --long --validate eager | tee "$OUTPUT_DIR/01-table.txt"

echo ""
echo "→ Filter by glob (--include '**/*.txt'):"
zn list --input "$ZIP" --include '**/*.txt'
