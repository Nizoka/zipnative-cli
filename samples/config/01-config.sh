#!/usr/bin/env bash
# config/01-config.sh — .zipnativerc.json default flags (--config / --no-config)
#
# A config file supplies DEFAULT flag values; an explicit CLI flag always
# wins. Top-level keys apply to every command, a key named after a command
# scopes its object to that command. Discovery walks up from the current
# directory; --config <file> names one explicitly and --no-config ignores
# them all. `codec` is refused from config files (it executes user code).
#
# samples/input/config/.zipnativerc.json:
#   { "create": { "deterministic": true, "level": 9 }, "extract": { "overwrite": true } }
#
# Usage:
#   bash samples/config/01-config.sh
#
# Output: samples/output/config/01-with-config.zip, 01-no-config.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/config"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

CONFIG="$INPUT_DIR/config/.zipnativerc.json"

echo "→ Config file:"
cat "$CONFIG"

echo ""
echo "→ create --config … (deterministic + level 9 come from the file):"
zn create "$INPUT_DIR/text" --config "$CONFIG" --output "$OUTPUT_DIR/01-with-config.zip" --json

echo ""
echo "→ Same build with --no-config (built-in defaults: level 6, node-zlib tier):"
zn create "$INPUT_DIR/text" --no-config --output "$OUTPUT_DIR/01-no-config.zip" --json

echo ""
echo "→ Discovery: run from the config's directory and it is picked up automatically:"
(cd "$INPUT_DIR/config" && zn create "$INPUT_DIR/text" --output "$OUTPUT_DIR/01-discovered.zip" --json)

echo ""
echo "→ CLI flags win: --level 1 overrides the file's level 9:"
zn create "$INPUT_DIR/text" --config "$CONFIG" --level 1 --output "$OUTPUT_DIR/01-override.zip" --json

echo ""
echo "→ The extract section makes --overwrite the default for this config:"
zn extract --input "$OUTPUT_DIR/01-with-config.zip" --output-dir "$OUTPUT_DIR/01-extracted" --config "$CONFIG" --quiet
zn extract --input "$OUTPUT_DIR/01-with-config.zip" --output-dir "$OUTPUT_DIR/01-extracted" --config "$CONFIG" --json
