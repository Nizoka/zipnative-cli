#!/usr/bin/env bash
# create/08-zip64-stream.sh — stream an entry with a Zip64 local header (--zip64)
#
# A streamed entry's size is unknown when its local header is written, so by
# default the streaming writer uses 4-byte sizes and refuses an entry that
# grows past 4 GiB (ZIP_UNSUPPORTED_ZIP64_STREAMING). `--zip64` (zipnative 1.1
# AddEntryOptions.zip64) writes every streamed entry with a Zip64 extra in the
# local header and the 24-byte data descriptor, so it may exceed 4 GiB. It
# requires a streamed input (`--stream` or `--stdin-name`): buffered entries
# are already Zip64 when they need it.
#
# Usage:
#   bash samples/create/08-zip64-stream.sh
#
# Output: samples/output/create/08-zip64-stream.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/create"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/08-zip64-stream.zip"

echo "→ Streaming samples/input/binary/pattern.bin as a Zip64 entry:"
cat "$INPUT_DIR/binary/pattern.bin" | zn create --stdin-name data/pattern.bin --stream --zip64 --output "$ZIP" --overwrite --json

echo ""
echo "→ The entry carries a data descriptor and Zip64 (flags D and Z):"
zn list --input "$ZIP" --long

echo ""
echo "→ inspect asserts it:"
zn inspect --input "$ZIP" --summary --check zip64
