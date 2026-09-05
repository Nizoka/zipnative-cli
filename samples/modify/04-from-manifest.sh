#!/usr/bin/env bash
# modify/04-from-manifest.sh — declarative edits with --from-manifest
#
# A modify manifest lists { op, name, to?, path|data|dataBase64?, method?,
# level?, comment?, date? } edits plus an optional archive comment; `path`
# resolves against the MANIFEST's directory (no `..` escapes). It is mutually
# exclusive with the --add/--replace/… flags. See
# samples/input/manifest/edits.json and `zipnative schema modify-manifest`.
#
# Usage:
#   bash samples/modify/04-from-manifest.sh
#
# Output: samples/output/modify/04-from-manifest.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/modify"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

BASE="$OUTPUT_DIR/base.zip"
OUT="$OUTPUT_DIR/04-from-manifest.zip"
if [ ! -f "$BASE" ]; then
  zn create "$INPUT_DIR/text" --output "$BASE" --quiet
fi

echo "→ Manifest:"
cat "$INPUT_DIR/manifest/edits.json"

echo ""
echo "→ Applying it (--compact):"
zn modify --input "$BASE" --output "$OUT" --from-manifest "$INPUT_DIR/manifest/edits.json" --compact --json

echo ""
echo "→ Result:"
zn list --input "$OUT" --long
zn inspect --input "$OUT" --format json --fields archive.comment
