#!/usr/bin/env bash
# doctor/01-doctor.sh — environment / capability preflight
#
# `doctor` checks the CLI and engine versions, Node >= 22, the active deflate
# tier (node-zlib expected; pure under --pure-codecs), the tier pinned by
# --deterministic, platform streaming codecs, worker-thread availability for
# `create --parallel`, registered codecs, the effective security limits and
# the command count. Exit 0 when every check passes. Always offline.
#
# Usage:
#   bash samples/doctor/01-doctor.sh
#
# Output: samples/output/doctor/01-doctor.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/samples/output/doctor"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

echo "→ Text report:"
zn doctor

echo ""
echo "→ JSON report (saved to 01-doctor.json):"
zn doctor --format json > "$OUTPUT_DIR/01-doctor.json"
head -c 400 "$OUTPUT_DIR/01-doctor.json"; echo " …"

echo ""
echo "→ With overridden limits and the pure-TS codec tier:"
zn doctor --pure-codecs --max-entries 500 --max-total-size 2g | grep -E 'deflate-tier|limits'

echo ""
echo "→ Version, machine-readable:"
zn --version --json
