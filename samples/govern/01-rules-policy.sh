#!/usr/bin/env bash
# govern/01-rules-policy.sh — the AI-governance / HITL contract
#
# `govern rules` prints the human/agent protocol (agents are DRAFTSMEN, never
# autonomous submitters: no runtime dependencies, no anti-goals, no weakened
# security default, a local reproduction for every bug, a human review before
# anything is submitted under a human identity). `govern policy` prints the
# same contract as machine-readable JSON — agents that scan repository
# configuration on start-up read this once and honour it.
#
# Usage:
#   bash samples/govern/01-rules-policy.sh
#
# Output: samples/output/govern/policy.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/samples/output/govern"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

echo "→ zipnative govern rules:"
zn govern rules

echo ""
echo "→ zipnative govern policy --pretty (saved to policy.json):"
zn govern policy --pretty | tee "$OUTPUT_DIR/policy.json"

echo ""
echo "→ The three policy flags an agent must check before drafting anything:"
node -e '
const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).policy;
for (const k of ["runtime_dependencies_allowed", "autonomous_github_writes_allowed", "human_in_the_loop_mandatory"]) console.log("  " + k.padEnd(34) + String(p[k]));
' "$OUTPUT_DIR/policy.json"
