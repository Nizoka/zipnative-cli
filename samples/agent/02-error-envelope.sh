#!/usr/bin/env bash
# agent/02-error-envelope.sh — deterministic failures via the JSON error envelope
#
# Every failure under --json is one JSON object on stderr with a stable E_*
# `code` (branch on the CLASS), zipnative's frozen ZIP_* `zipCode` (the exact
# CAUSE, verbatim from the engine), the `entryName` when one is involved and
# a structured `detail`. Exit codes: 2 for usage errors, 1 for everything
# else. Every call below is EXPECTED to fail.
#
# Usage:
#   bash samples/agent/02-error-envelope.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/agent"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/02-archive.zip"
zn create "$INPUT_DIR/text" --output "$ZIP" --quiet

echo "→ E_NOT_FOUND — a named entry does not exist (entryName carried):"
zn cat --input "$ZIP" --entry missing.txt --json; echo "  exit $?"

echo ""
echo "→ E_PARSE + zipCode — the bytes are not a ZIP (ZIP_EOCD_NOT_FOUND):"
zn list --input "$INPUT_DIR/text/readme.txt" --json; echo "  exit $?"

echo ""
echo "→ E_IO — the file does not exist:"
zn list --input "$OUTPUT_DIR/does-not-exist.zip" --json; echo "  exit $?"

echo ""
echo "→ E_USAGE — missing required argument (exit 2):"
zn create --json; echo "  exit $?"

echo ""
echo "→ E_INPUT — a manifest that would not extract safely:"
printf '{"entries":[{"name":"../escape.txt","data":"x"}]}' > "$OUTPUT_DIR/02-bad-manifest.json"
zn create --from-manifest "$OUTPUT_DIR/02-bad-manifest.json" --output "$OUTPUT_DIR/02-never.zip" --json; echo "  exit $?"

echo ""
echo "→ E_DATA + zipCode + detail — CRC mismatch on a tampered STORED entry:"
zn create "$INPUT_DIR/text" --method store --output "$OUTPUT_DIR/02-stored.zip" --quiet
node -e '
const fs = require("node:fs"); const [src, dst] = process.argv.slice(1);
const b = Buffer.from(fs.readFileSync(src)); b[b.indexOf("zipnative-cli sample input")] ^= 0xff; fs.writeFileSync(dst, b);
' "$OUTPUT_DIR/02-stored.zip" "$OUTPUT_DIR/02-tampered.zip"
zn cat --input "$OUTPUT_DIR/02-tampered.zip" --entry text/readme.txt --json >/dev/null; echo "  exit $?"

echo ""
echo "Branch on error.code first, then on error.zipCode — see the README's agent loop."
