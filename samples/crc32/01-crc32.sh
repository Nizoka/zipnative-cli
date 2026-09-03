#!/usr/bin/env bash
# crc32/01-crc32.sh — CRC-32 of files and stdin, --expect as a gate
#
# `crc32` computes the IEEE CRC-32 (the ZIP checksum) in 64 KiB chunks —
# constant memory for any size. Files are positionals or --input; with none,
# stdin is read. --expect <hex> turns a single input into an assertion (exit
# 1 / E_CHECK_FAILED on mismatch — the last call is EXPECTED to fail) and
# --seed continues a running checksum.
#
# Usage:
#   bash samples/crc32/01-crc32.sh
#
# Output: samples/output/crc32/01-crc32.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/crc32"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

echo "→ Files (text: <crc>  <bytes>  <file>):"
zn crc32 "$INPUT_DIR/text/readme.txt" "$INPUT_DIR/binary/pattern.bin"

echo ""
echo "→ stdin:"
cat "$INPUT_DIR/text/readme.txt" | zn crc32

echo ""
echo "→ JSON (saved to 01-crc32.json):"
zn crc32 "$INPUT_DIR/text/readme.txt" --format json | tee "$OUTPUT_DIR/01-crc32.json"

echo ""
CRC="$(zn crc32 "$INPUT_DIR/text/readme.txt" | cut -d' ' -f1)"
echo "→ --expect $CRC (matches → exit 0):"
zn crc32 "$INPUT_DIR/text/readme.txt" --expect "$CRC" && echo "  ✓ match"

echo ""
echo "→ --expect deadbeef (mismatch → exit 1, E_CHECK_FAILED with both CRCs in detail):"
zn crc32 "$INPUT_DIR/text/readme.txt" --expect deadbeef --json || echo "  exit $?"
