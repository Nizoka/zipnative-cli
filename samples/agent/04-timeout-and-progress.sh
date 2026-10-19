#!/usr/bin/env bash
# agent/04-timeout-and-progress.sh — a deadline (--timeout) and progress events (--progress)
#
# `--timeout <duration>` (500, 500ms, 30s, 5m, 1h) arms one deadline for the
# whole run, starting with the process. Past it the run stops at the next
# chunk or entry boundary with E_LIMIT — detail { limit: "timeout",
# configured, observed } in milliseconds — and the file being written is
# removed. It is a bound like the --max-* flags, so it needs no new error
# class. A 1 ms deadline below is always already past when the writer starts:
# the failure is deterministic.
#
# `--progress` (or ZIPNATIVE_PROGRESS=1) prints the engine's progress
# snapshots on stderr where the engine measures them (create --stream /
# --stdin-name / --parallel, extract without --buffered, stream, cat): a
# throttled text line, or under --json one NDJSON {"type":"progress",...}
# object per update before the final envelope. stdout is never touched.
#
# Usage:
#   bash samples/agent/04-timeout-and-progress.sh
#
# Output: samples/output/agent/04-progress.zip, 04-progress.ndjson

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/agent"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

echo "→ --timeout 1ms: E_LIMIT (detail.limit \"timeout\"), and no partial file is left:"
zn create "$INPUT_DIR" --stream --timeout 1ms --output "$OUTPUT_DIR/04-timed-out.zip" --json || echo "  exit $?"
[ -e "$OUTPUT_DIR/04-timed-out.zip" ] && echo "  unexpected: output left behind" || echo "  ✓ 04-timed-out.zip does not exist"

echo ""
echo "→ --progress in text mode (stderr):"
zn create "$INPUT_DIR" --stream --progress --output "$OUTPUT_DIR/04-progress.zip" --overwrite

echo ""
echo "→ --quiet silences it (nothing printed):"
zn create "$INPUT_DIR" --stream --progress --quiet --output "$OUTPUT_DIR/04-progress.zip" --overwrite

echo ""
echo "→ --progress under --json: NDJSON events, then the status envelope (all on stderr):"
zn create "$INPUT_DIR" --stream --progress --json --output "$OUTPUT_DIR/04-progress.zip" --overwrite 2> "$OUTPUT_DIR/04-progress.ndjson"
cat "$OUTPUT_DIR/04-progress.ndjson"
