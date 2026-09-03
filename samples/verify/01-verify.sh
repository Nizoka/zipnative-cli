#!/usr/bin/env bash
# verify/01-verify.sh — deep integrity verification in one call
#
# `verify` decompresses every entry and checks CRC-32, declared sizes and
# local-header agreement, then reports per-entry verdicts plus diagnostics.
# Encrypted entries are honestly reported as skipped, never faked as
# verified. Exit 0 when ok, 1 / E_VERIFY_FAILED otherwise (see 02).
#
# Usage:
#   bash samples/verify/01-verify.sh
#
# Output: samples/output/verify/stored.zip, 01-verify.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/verify"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/stored.zip"
if [ ! -f "$ZIP" ]; then
  echo "→ Building a STORED archive (payloads verbatim — see 02 for why):"
  zn create "$INPUT_DIR/text" --method store --output "$ZIP" --quiet
fi

echo "→ Text verdict:"
zn verify --input "$ZIP"

echo ""
echo "→ JSON report (saved to 01-verify.json):"
zn verify --input "$ZIP" --format json | tee "$OUTPUT_DIR/01-verify.json"

echo ""
echo "→ Agent one-liner (--json --summary):"
zn verify --input "$ZIP" --json --summary
