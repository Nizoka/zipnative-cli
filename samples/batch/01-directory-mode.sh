#!/usr/bin/env bash
# batch/01-directory-mode.sh — one archive per subfolder, then verify them all
#
# `batch --input-dir <dir> --output-dir <dir>` turns every IMMEDIATE
# subdirectory of the input into <output-dir>/<name>.zip through the full
# `create` command — every create flag (--deterministic, --method, --level,
# --order, --date, --comment …) is honoured — with a bounded worker pool
# (--concurrency, default 4; --fail-fast stops scheduling after the first
# failure). `--task verify` then verifies every *.zip in a directory.
#
# Usage:
#   bash samples/batch/01-directory-mode.sh
#
# Output: samples/output/batch/01-archives/*.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/batch"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

ARCHIVES="$OUTPUT_DIR/01-archives"
rm -rf "$ARCHIVES"

echo "→ samples/input/* subfolders → one deterministic archive each (2 workers):"
zn batch --input-dir "$INPUT_DIR" --output-dir "$ARCHIVES" --deterministic --concurrency 2
ls "$ARCHIVES" | sed 's/^/  /'

echo ""
echo "→ Verify the whole folder (--task verify, JSON summary):"
zn batch --input-dir "$ARCHIVES" --task verify --format json --summary --quiet

echo ""
echo "→ One of them:"
zn list --input "$ARCHIVES/unicode.zip"
