#!/usr/bin/env bash
# inflate/01-inflate.sh — decompress a raw DEFLATE stream, bounded by --max-output
#
# `inflate` feeds zipnative's resumable inflater chunk by chunk (constant
# memory) and reports bytesIn / bytesOut / leftover. --max-output is a hard
# bound (default: the effective --max-entry-size, 1 GiB) — exceeding it is
# E_DATA / ZIP_INFLATE_OUTPUT_OVERFLOW, which is how a decompression bomb is
# stopped before it fills the disk. The bounded call is EXPECTED to fail.
# The raw stream is produced with node:zlib's deflateRawSync (RFC 1951).
#
# Usage:
#   bash samples/inflate/01-inflate.sh
#
# Output: samples/output/inflate/readme.deflate, 01-readme.txt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/inflate"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

RAW="$OUTPUT_DIR/readme.deflate"
OUT="$OUTPUT_DIR/01-readme.txt"

echo "→ Producing a raw DEFLATE stream with node:zlib:"
node -e '
const fs = require("node:fs"), zlib = require("node:zlib");
const [src, dst] = process.argv.slice(1);
fs.writeFileSync(dst, zlib.deflateRawSync(fs.readFileSync(src), { level: 9 }));
' "$INPUT_DIR/text/readme.txt" "$RAW"
wc -c "$INPUT_DIR/text/readme.txt" "$RAW" | sed 's/^/  /'

echo ""
echo "→ --dry-run reports the plan:"
zn inflate --input "$RAW" --dry-run --json

echo ""
echo "→ inflate to a file:"
zn inflate --input "$RAW" --output "$OUT" --json
if cmp -s "$OUT" "$INPUT_DIR/text/readme.txt"; then echo "  ✓ round trip identical"; else echo "  ✗ mismatch" >&2; exit 1; fi

echo ""
echo "→ inflate from stdin to stdout (first line):"
cat "$RAW" | zn inflate | head -n 1

echo ""
echo "→ --max-output 16: the 200-byte result exceeds the bound → E_DATA:"
zn inflate --input "$RAW" --max-output 16 --json >/dev/null || echo "  exit $?"
