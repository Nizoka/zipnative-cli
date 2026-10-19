#!/usr/bin/env bash
# list/04-name-encoding.sh — decode legacy (non-UTF-8) entry names
#
# A name stored WITHOUT the UTF-8 flag (bit 11) is, by the APPNOTE, CP437 —
# but many legacy producers wrote the local code page instead. The committed
# samples/input/legacy/shift-jis-names.zip holds one entry whose name
# 日本語/挨拶.txt was written in Shift_JIS by .NET's System.IO.Compression
# (a foreign producer, see samples/README.md). The default CP437 decoding
# shows mojibake; `--name-encoding shift_jis` (zipnative 1.1 nameDecoder, any
# WHATWG label the runtime knows) decodes it. The row then reports
# nameEncoding "custom" and `--long` keeps the stored bytes in rawNameHex.
# `extract` / `stream` decode BEFORE the name is sanitised, so a decoded name
# passes the same guards.
#
# Usage:
#   bash samples/list/04-name-encoding.sh
#
# Output: samples/output/list/04-name-encoding.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/list"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ZIP="$INPUT_DIR/legacy/shift-jis-names.zip"

echo "→ Default decoding (CP437) — the Shift_JIS bytes read as mojibake:"
zn list --input "$ZIP"

echo ""
echo "→ --name-encoding shift_jis:"
zn list --input "$ZIP" --name-encoding shift_jis

echo ""
echo "→ JSON: the decoded name, nameEncoding \"custom\" and the stored bytes:"
zn list --input "$ZIP" --name-encoding shift_jis --long --format json \
  --fields entries.name,entries.nameEncoding,entries.rawNameHex | tee "$OUTPUT_DIR/04-name-encoding.json"
