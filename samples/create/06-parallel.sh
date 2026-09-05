#!/usr/bin/env bash
# create/06-parallel.sh — worker-pool deflate with --parallel
#
# `--parallel` fans per-entry deflate out across a worker pool
# (zipnative/worker). Output is byte-identical to the sequential writer for
# the same codec tier, which the script proves with a byte comparison.
# --workers caps the pool, --min-job-size keeps tiny entries on the main
# thread (lowered here so the small sample tree actually reaches a worker).
#
# Usage:
#   bash samples/create/06-parallel.sh
#
# Output: samples/output/create/06-sequential.zip, 06-parallel.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/create"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

SEQ="$OUTPUT_DIR/06-sequential.zip"
PAR="$OUTPUT_DIR/06-parallel.zip"

echo "→ Sequential writer:"
zn create "$INPUT_DIR" --output "$SEQ" --json

echo ""
echo "→ Parallel writer (2 workers, entries >= 1 KiB dispatched):"
zn create "$INPUT_DIR" --parallel --workers 2 --min-job-size 1k --output "$PAR" --json

echo ""
if cmp -s "$SEQ" "$PAR"; then
  echo "  ✓ parallel output is byte-identical to the sequential writer"
else
  echo "  ✗ outputs differ" >&2
  exit 1
fi
