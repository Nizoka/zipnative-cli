#!/usr/bin/env bash
# agent/01-json-and-dry-run.sh — agent mode: --json status envelope + --dry-run
#
# In agent mode (--json) the CLI keeps the primary artefact on stdout and
# emits ONE JSON envelope on stderr: { ok: true, command, … } on success,
# { ok: false, command, error: { code, message, zipCode?, entryName?,
# detail? } } on failure. --dry-run validates inputs and prints the plan
# without writing a byte (create, extract, modify, stream, cat, inflate,
# batch). Numeric exit codes (0/1/2) are the same in every mode.
#
# Usage:
#   bash samples/agent/01-json-and-dry-run.sh
#
# Output: samples/output/agent/01-status.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/agent"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

NEVER="$OUTPUT_DIR/01-never-written.zip"
ZIP="$OUTPUT_DIR/01-status.zip"
rm -f "$NEVER"

echo "→ --dry-run --json: plan on stdout, envelope (dryRun: true) on stderr, no file:"
zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" --output "$NEVER" --dry-run --json
[ ! -e "$NEVER" ] && echo "  ✓ $NEVER was not written"

echo ""
echo "→ Real build: success envelope carries bytes, tier, entries, diagnostics:"
zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" --output "$ZIP" --json

echo ""
echo "→ The envelope is stderr; stdout stays clean for data — capture them separately:"
ENVELOPE="$(zn extract --input "$ZIP" --output-dir "$OUTPUT_DIR/01-extracted" --overwrite --json 2>&1 >/dev/null)"
echo "  envelope: $ENVELOPE"

echo ""
echo "→ --pretty indents the envelope for humans:"
zn cat --input "$ZIP" --entry text/readme.txt --dry-run --json --pretty
