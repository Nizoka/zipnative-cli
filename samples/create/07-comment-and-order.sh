#!/usr/bin/env bash
# create/07-comment-and-order.sh — archive/entry comments, --order, --date
#
# --comment sets the archive comment, --entry-comment <name>=<text> a
# per-entry one. --order insertion keeps the argv order (directories walk
# name-sorted) instead of the
# canonical raw-name-byte sort, and --date pins every timestamp to an ISO
# instant (DOS time has 2-second resolution) instead of the epoch default —
# both are legitimate choices that `inspect` will report as non-deterministic.
#
# Usage:
#   bash samples/create/07-comment-and-order.sh
#
# Output: samples/output/create/07-comment-and-order.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/create"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/07-comment-and-order.zip"

echo "→ Building with comments, insertion order and a fixed date:"
zn create "$INPUT_DIR/text" \
  --comment "built by samples/create/07-comment-and-order.sh" \
  --entry-comment "text/readme.txt=the readme" \
  --order insertion \
  --date 2024-01-02T03:04:06Z \
  --output "$ZIP" --json

echo ""
echo "→ inspect shows the comment and the (intentionally) non-epoch dates:"
zn inspect --input "$ZIP" --format json --fields archive.comment,determinism,stats.earliestDate

echo ""
echo "→ Entry comments travel in the central directory (inspect --entries):"
zn inspect --input "$ZIP" --format json --entries --fields entries.name,entries.comment
