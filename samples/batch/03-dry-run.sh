#!/usr/bin/env bash
# batch/03-dry-run.sh — validate a batch plan without executing it
#
# --dry-run validates everything up front — manifest structure, the command
# whitelist, the "@id" reference graph and the codec-load policy — then
# prints the plan and stops. In directory mode it lists the archives that
# WOULD be created (each `create` runs its own dry run). Nothing is written.
#
# Usage:
#   bash samples/batch/03-dry-run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/batch"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

STAGE="$OUTPUT_DIR/03-dry-run"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "$INPUT_DIR/batch/tasks.json" "$STAGE/tasks.json"
cp -r "$INPUT_DIR/text" "$STAGE/text"

echo "→ Manifest plan (text):"
zn batch --manifest "$STAGE/tasks.json" --dry-run

echo ""
echo "→ Manifest plan (JSON, agent mode):"
zn batch --manifest "$STAGE/tasks.json" --dry-run --json --pretty

echo ""
echo "→ Directory-mode plan (--summary):"
zn batch --input-dir "$INPUT_DIR" --output-dir "$STAGE/never-created" --dry-run --format json --summary --quiet

echo ""
if [ -e "$STAGE/out" ] || [ -e "$STAGE/never-created" ]; then
  echo "  ✗ dry run wrote output" >&2; exit 1
else
  echo "  ✓ nothing was written"
fi
