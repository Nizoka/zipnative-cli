#!/usr/bin/env bash
# create/05-stdin-stream.sh — pipe stdin into an entry with --stdin-name --stream
#
# `--stdin-name <name>` turns whatever arrives on stdin into one entry.
# `--stream` selects the constant-memory writer: the entry is compressed as it
# arrives and written with a data descriptor (sizes and CRC after the payload),
# so nothing is buffered. The resulting layout is valid for every reader but
# is NOT byte-identical to the buffered writer — `inspect` reports the data
# descriptor and `deterministic: false` for that reason.
#
# Usage:
#   bash samples/create/05-stdin-stream.sh
#
# Output: samples/output/create/05-stdin-stream.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/create"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/05-stdin-stream.zip"

echo "→ Piping samples/input/binary/pattern.bin into an entry named data/pattern.bin:"
cat "$INPUT_DIR/binary/pattern.bin" | zn create --stdin-name data/pattern.bin --stream --chunk-size 1k --output "$ZIP" --json

echo ""
echo "→ The entry carries a data descriptor (flag D):"
zn list --input "$ZIP" --long

echo ""
echo "→ Round trip — the CRC of the extracted bytes matches the original:"
zn cat --input "$ZIP" --entry data/pattern.bin | zn crc32
zn crc32 "$INPUT_DIR/binary/pattern.bin"
