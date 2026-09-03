#!/usr/bin/env bash
# create/01-basic.sh — Build a ZIP from a directory tree
#
# The simplest invocation: one or more paths in, one archive out. Directories
# are walked recursively; entry names are relative to each input's parent
# directory (so the tree lands as text/…). Defaults are already reproducible:
# canonical entry order, DOS-epoch timestamps, UTF-8 names, deflate level 6.
#
# Prerequisites:
#   - zipnative-cli on PATH (npm install -g zipnative-cli) or a local build
#     (npm run build) — the script falls back to dist/cli.cjs automatically
#
# Usage:
#   bash samples/create/01-basic.sh
#
# Output: samples/output/create/01-basic.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/create"
mkdir -p "$OUTPUT_DIR"

# zipnative from PATH when installed, else the local build.
zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/01-basic.zip"

echo "→ Archiving samples/input/text and samples/input/unicode…"
zn create "$INPUT_DIR/text" "$INPUT_DIR/unicode" --output "$ZIP"
echo "  ✓ Written: $ZIP"

echo ""
echo "→ Contents:"
zn list --input "$ZIP"

echo ""
echo "→ Same build, entry names rebased with --base and --prefix (dry run):"
zn create "$INPUT_DIR/text" --base "$INPUT_DIR/text" --prefix docs/ --dry-run
