#!/usr/bin/env bash
# completion/01-generate.sh — shell completion scripts (bash|zsh|fish|powershell)
#
# The scripts are self-contained and generated from the CLI's own command /
# flag table, so they are always in sync with `--help`. Install by sourcing
# the output:
#   zipnative completion bash > /etc/bash_completion.d/zipnative
#   zipnative completion zsh  > "${fpath[1]}/_zipnative"
#   zipnative completion fish > ~/.config/fish/completions/zipnative.fish
#   zipnative completion powershell >> $PROFILE
#
# Usage:
#   bash samples/completion/01-generate.sh
#
# Output: samples/output/completion/zipnative.{bash,zsh,fish,ps1}

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/samples/output/completion"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

for shell in bash zsh fish powershell; do
  ext="$shell"; [ "$shell" = "powershell" ] && ext="ps1"
  zn completion "$shell" > "$OUTPUT_DIR/zipnative.$ext"
  printf '  %-10s → %s (%s lines)\n' "$shell" "zipnative.$ext" "$(wc -l < "$OUTPUT_DIR/zipnative.$ext")"
done

echo ""
echo "→ Head of the bash script:"
head -n 8 "$OUTPUT_DIR/zipnative.bash"

echo ""
echo "→ Try it in this shell: source it, then type 'zipnative cr<TAB>':"
echo "  source $OUTPUT_DIR/zipnative.bash"

echo ""
echo "→ Missing shell argument is a usage error (exit 2):"
zn completion || echo "  exit $?"
