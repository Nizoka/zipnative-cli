#!/usr/bin/env bash
# merge/01-merge-and-split.sh — merge archives, split one, without recompression
#
# `merge` copies each entry's COMPRESSED bytes into a new archive (zipnative
# 1.1 addFromReader) — no recompression — after verifying it (CRC-32 and size,
# one decompress pass, no opt-out): a lying source is refused, never
# laundered. A name present in two sources is refused unless
# --on-duplicate first|last picks one. "Split" is a filtered merge of one
# archive (--include / --exclude).
#
# Usage:
#   bash samples/merge/01-merge-and-split.sh
#
# Output: samples/output/merge/text.zip, unicode.zip, all.zip, md-only.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/merge"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

zn create "$INPUT_DIR/text" --output "$OUTPUT_DIR/text.zip" --overwrite --quiet
zn create "$INPUT_DIR/unicode" --output "$OUTPUT_DIR/unicode.zip" --overwrite --quiet

echo "→ Merge two archives (every entry verified, nothing recompressed):"
zn merge "$OUTPUT_DIR/text.zip" "$OUTPUT_DIR/unicode.zip" -o "$OUTPUT_DIR/all.zip" --overwrite --json
zn list --input "$OUTPUT_DIR/all.zip"

echo ""
echo "→ Split — keep only the Markdown files of the merged archive:"
zn merge "$OUTPUT_DIR/all.zip" --include '**/*.md' -o "$OUTPUT_DIR/md-only.zip" --overwrite --json
zn list --input "$OUTPUT_DIR/md-only.zip"

echo ""
echo "→ The same archive twice is a duplicate-name refusal (exit 1, E_INPUT) — expected:"
zn merge "$OUTPUT_DIR/text.zip" "$OUTPUT_DIR/text.zip" -o "$OUTPUT_DIR/dup.zip" --json || echo "  exit $?"
