#!/usr/bin/env bash
# create/02-store-vs-deflate.sh — --method store vs deflate, --level, --store-ext
#
# `store` keeps every payload verbatim (fast, zero compression — and what the
# tamper demo in verify/02 relies on); `deflate` is the default at level 6.
# --store-ext keeps already-compressed extensions uncompressed inside an
# otherwise deflated archive. The sizes are compared at the end.
#
# Usage:
#   bash samples/create/02-store-vs-deflate.sh
#
# Output: samples/output/create/02-store.zip, 02-deflate-9.zip, 02-store-ext.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/create"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

echo "→ --method store (no compression):"
zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" --method store --output "$OUTPUT_DIR/02-store.zip" --json

echo ""
echo "→ --method deflate --level 9 (maximum compression):"
zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" --method deflate --level 9 --output "$OUTPUT_DIR/02-deflate-9.zip" --json

echo ""
echo "→ deflate everything except *.bin (--store-ext bin):"
zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" --store-ext bin --output "$OUTPUT_DIR/02-store-ext.zip" --json

echo ""
echo "→ Per-entry methods in the mixed archive:"
zn list --input "$OUTPUT_DIR/02-store-ext.zip"

echo ""
echo "→ Archive sizes:"
wc -c "$OUTPUT_DIR/02-store.zip" "$OUTPUT_DIR/02-deflate-9.zip" "$OUTPUT_DIR/02-store-ext.zip" | sed 's/^/  /'
