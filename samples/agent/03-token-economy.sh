#!/usr/bin/env bash
# agent/03-token-economy.sh — smaller reports: --summary, --fields, compact JSON
#
# Full reports are verbose by design. For an LLM loop every byte is a token:
# --summary collapses a report to its headline numbers, --fields keeps only
# the named dot-paths (array elements are projected), and --json makes the
# output compact (single line) unless --pretty is added. The script prints
# the byte count of each variant side by side.
#
# Usage:
#   bash samples/agent/03-token-economy.sh
#
# Output: samples/output/agent/03-*.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/agent"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$OUTPUT_DIR/03-archive.zip"
zn create "$INPUT_DIR" --deterministic --output "$ZIP" --quiet

size() { printf '  %-42s %6s bytes\n' "$1" "$(wc -c < "$2")"; }

zn inspect --input "$ZIP" --format json --entries           > "$OUTPUT_DIR/03-full-pretty.json"
zn inspect --input "$ZIP" --json --entries                  > "$OUTPUT_DIR/03-full-compact.json"
zn inspect --input "$ZIP" --json                            > "$OUTPUT_DIR/03-no-entries.json"
zn inspect --input "$ZIP" --json --summary                  > "$OUTPUT_DIR/03-summary.json"
zn inspect --input "$ZIP" --json --fields archive.bytes,determinism.deterministic > "$OUTPUT_DIR/03-fields.json"
zn list    --input "$ZIP" --json --fields entries.name      > "$OUTPUT_DIR/03-list-names.json"

# NOTE: --summary and --fields do not combine — when both are passed the
# summary shape wins and --fields is ignored. Project the FULL report instead.
echo "→ Same archive, six report sizes:"
size "inspect --format json --entries (pretty)" "$OUTPUT_DIR/03-full-pretty.json"
size "inspect --json --entries (compact)"       "$OUTPUT_DIR/03-full-compact.json"
size "inspect --json"                           "$OUTPUT_DIR/03-no-entries.json"
size "inspect --json --summary"                 "$OUTPUT_DIR/03-summary.json"
size "inspect --json --fields a.b,c.d"          "$OUTPUT_DIR/03-fields.json"
size "list --json --fields entries.name"        "$OUTPUT_DIR/03-list-names.json"

echo ""
echo "→ The smallest one:"
cat "$OUTPUT_DIR/03-fields.json"

echo ""
echo "→ --pretty re-indents any compact report when a human is reading:"
zn inspect --input "$ZIP" --json --summary --pretty
