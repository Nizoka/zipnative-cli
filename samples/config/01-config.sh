#!/usr/bin/env bash
# config/01-config.sh — .zipnativerc.json: presentation defaults only
#
# A config file supplies DEFAULT values for PRESENTATION flags only — format,
# fields, json, pretty, quiet, no-color, progress, strict, long, summary — and
# an explicit CLI flag always wins. Top-level keys apply to every command, a
# key named after a command scopes its object to that command, and a key
# applies only where the command declares the flag. Any other key (an input,
# an output, an opt-out such as overwrite / skip-unsafe, a --max-* bound,
# codec) is refused with E_USAGE naming the file: a .zipnativerc.json planted
# in a cloned repository can never relax a guard. Discovery walks up from the
# current directory; --config <file> names one and --no-config ignores them.
#
# samples/input/config/.zipnativerc.json:
#   { "pretty": true, "list": { "format": "json", "long": true },
#     "inspect": { "format": "json", "summary": true } }
# samples/input/config-unsafe/.zipnativerc.json (refused):
#   { "extract": { "overwrite": true, "skip-unsafe": true } }
#
# Usage:
#   bash samples/config/01-config.sh
#
# Output: samples/output/config/01-archive.zip, 01-list.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/config"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

CONFIG="$INPUT_DIR/config/.zipnativerc.json"
UNSAFE="$INPUT_DIR/config-unsafe/.zipnativerc.json"
ARCHIVE="$OUTPUT_DIR/01-archive.zip"

echo "→ Build an archive hermetically (--no-config):"
zn create "$INPUT_DIR/text" --no-config --deterministic --output "$ARCHIVE" --overwrite --quiet

echo ""
echo "→ Config file:"
cat "$CONFIG"

echo ""
echo "→ list --config … (format json + long come from the file; an info: line names it):"
zn list "$ARCHIVE" --config "$CONFIG" > "$OUTPUT_DIR/01-list.json"
head -c 300 "$OUTPUT_DIR/01-list.json"; echo " …"

echo ""
echo "→ CLI flags win: --format text overrides the file's json:"
zn list "$ARCHIVE" --config "$CONFIG" --format text

echo ""
echo "→ Discovery: run from the config's directory and it is picked up (inspect → a JSON --summary):"
(cd "$INPUT_DIR/config" && zn inspect "$ARCHIVE")

echo ""
echo "→ A planted config that tries to relax a guard is REFUSED (exit 2, E_USAGE, file named):"
set +e
zn extract --input "$ARCHIVE" --output-dir "$OUTPUT_DIR/01-extracted" --config "$UNSAFE" --json
echo "exit code: $? (expected 2)"
set -e

echo ""
echo "→ --no-config is the escape hatch (and the posture for unattended runs):"
zn extract --input "$ARCHIVE" --output-dir "$OUTPUT_DIR/01-extracted" --no-config --overwrite --json
