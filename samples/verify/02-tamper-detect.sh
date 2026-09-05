#!/usr/bin/env bash
# verify/02-tamper-detect.sh — a flipped payload byte fails verification
#
# The archive is built with --method store so a payload byte can be flipped
# in place without breaking the DEFLATE stream: the structure stays valid,
# only the CRC-32 no longer matches. `verify` reports the entry as FAIL
# (crc) and exits 1 with E_VERIFY_FAILED — the second call is EXPECTED to
# fail. `cat` on the tampered entry fails with E_DATA at the end of the
# stream for the same reason.
#
# Usage:
#   bash samples/verify/02-tamper-detect.sh
#
# Output: samples/output/verify/02-tampered.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/verify"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/stored.zip"
BAD="$OUTPUT_DIR/02-tampered.zip"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" --method store --output "$ZIP" --quiet
fi

echo "→ Flipping one byte inside text/readme.txt's stored payload:"
node -e '
const fs = require("node:fs");
const [src, dst] = process.argv.slice(1);
const buf = Buffer.from(fs.readFileSync(src));
const i = buf.indexOf("zipnative-cli sample input");
if (i === -1) { console.error("payload not found"); process.exit(1); }
buf[i] ^= 0xff;
fs.writeFileSync(dst, buf);
console.log("  flipped byte at offset " + i);
' "$ZIP" "$BAD"

echo ""
echo "→ verify (expect FAIL on text/readme.txt, exit 1):"
zn verify --input "$BAD" || echo "  exit $?"

echo ""
echo "→ Agent view — E_VERIFY_FAILED in the envelope:"
zn verify --input "$BAD" --json --summary || echo "  exit $?"

echo ""
echo "→ cat refuses the entry at the end of the stream (E_DATA):"
zn cat --input "$BAD" --entry text/readme.txt --json >/dev/null || echo "  exit $?"
