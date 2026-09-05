#!/usr/bin/env bash
# create/04-from-manifest.sh — declarative archives with --from-manifest
#
# A JSON manifest names every entry explicitly: a file `path` (relative to the
# MANIFEST's directory — `..` segments are refused), inline `data`,
# `dataBase64`, an explicit `directory`, plus per-entry `method`, `level`,
# `comment`, `date` and POSIX `mode`. See samples/input/manifest/entries.json
# and `zipnative schema create-manifest` for the full shape. An empty
# manifest is valid and yields an empty (22-byte) archive.
#
# Usage:
#   bash samples/create/04-from-manifest.sh
#
# Output: samples/output/create/04-from-manifest.zip, 04-empty.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/create"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

echo "→ Manifest:"
cat "$INPUT_DIR/manifest/entries.json"

echo ""
echo "→ Building from the manifest:"
zn create --from-manifest "$INPUT_DIR/manifest/entries.json" --output "$OUTPUT_DIR/04-from-manifest.zip" --json

echo ""
echo "→ Result (note the 0755 mode on bin/run.sh and the explicit directory entry):"
zn list --input "$OUTPUT_DIR/04-from-manifest.zip" --long

echo ""
echo "→ An empty manifest is valid:"
zn create --from-manifest "$INPUT_DIR/manifest/empty.json" --output "$OUTPUT_DIR/04-empty.zip" --json
wc -c "$OUTPUT_DIR/04-empty.zip" | sed 's/^/  /'
