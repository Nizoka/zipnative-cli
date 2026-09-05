#!/usr/bin/env bash
# batch/02-manifest-pipeline.sh — create → verify → inspect → extract → crc32
#
# `batch --manifest tasks.json` runs an ordered pipeline of whitelisted
# commands (create, list, inspect, extract, cat, verify, stream, modify,
# crc32, inflate — never batch/govern/schema/completion/doctor). A flag value
# "@<id>" is replaced by the resolved output of an EARLIER task; relative
# paths resolve against the MANIFEST's directory and may not climb out of it
# with `..`. Tasks run sequentially and fail fast (--continue-on-error keeps
# independent tasks going); a `codec` flag is refused unless the batch
# invocation carries --allow-codec-load.
#
# Because the manifest anchors its paths, the script stages tasks.json and
# the text tree together under samples/output/batch/02-pipeline/ and runs
# the pipeline there (outputs land in 02-pipeline/out/).
#
# Usage:
#   bash samples/batch/02-manifest-pipeline.sh
#
# Output: samples/output/batch/02-pipeline/out/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/batch"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

STAGE="$OUTPUT_DIR/02-pipeline"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "$INPUT_DIR/batch/tasks.json" "$STAGE/tasks.json"
cp -r "$INPUT_DIR/text" "$STAGE/text"

echo "→ Manifest (paths are relative to its own directory):"
cat "$STAGE/tasks.json"

echo ""
echo "→ Running the pipeline:"
zn batch --manifest "$STAGE/tasks.json" --format json

echo ""
echo "→ Artefacts:"
(cd "$STAGE/out" && find . -type f | sort | sed 's/^/  /')
