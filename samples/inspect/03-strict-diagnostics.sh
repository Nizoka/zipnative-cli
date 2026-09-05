#!/usr/bin/env bash
# inspect/03-strict-diagnostics.sh — engine diagnostics and --strict escalation
#
# zipnative reports odd-but-legal shapes as DIAGNOSTICS (info/warning) rather
# than errors: here a self-extractor-style stub is prepended to a valid
# archive, which yields ZIP_PREPENDED_DATA. Without --strict the report still
# succeeds and lists it; with --strict the FIRST diagnostic is escalated to
# E_CHECK_FAILED (zipCode ZIP_STRICT_DIAGNOSTIC) before any output byte, so a
# CI gate can refuse anything that is not a pristine archive. --strict is
# global — `verify --strict` and `list --strict` behave the same way.
#
# Usage:
#   bash samples/inspect/03-strict-diagnostics.sh
#
# Output: samples/output/inspect/03-prepended.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/inspect"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/archive.zip"
PRE="$OUTPUT_DIR/03-prepended.zip"
if [ ! -f "$ZIP" ]; then
  zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" --deterministic --output "$ZIP" --quiet
fi

echo "→ Prepending a 17-byte shell stub to the archive:"
node -e '
const fs = require("node:fs");
const [src, dst] = process.argv.slice(1);
fs.writeFileSync(dst, Buffer.concat([Buffer.from("#!/bin/sh\nexit 0\n"), fs.readFileSync(src)]));
' "$ZIP" "$PRE"
echo "  ✓ $PRE"

echo ""
echo "→ inspect (lenient): succeeds, reports prependedData + the diagnostic:"
zn inspect --input "$PRE" --format json --fields archive.prependedData,diagnostics

echo ""
echo "→ inspect --strict: the diagnostic is escalated to E_CHECK_FAILED:"
zn inspect --input "$PRE" --strict --json --summary || echo "  exit $?"

echo ""
echo "→ verify --strict fails the same way (E_VERIFY_FAILED, 1 diagnostic):"
zn verify --input "$PRE" --strict || echo "  exit $?"
