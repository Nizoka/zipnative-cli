#!/usr/bin/env bash
# schema/01-schema.sh — JSON Schemas and the capability manifest for agents
#
# `zipnative schema <subject>` prints a draft 2020-12 JSON Schema for every
# input (create-manifest, modify-manifest, batch-manifest) and output
# (entries, inspect, verify, stream, batch, doctor, govern-verify, crc32,
# the status/error envelopes), plus `errors` (E_* codes, the ZIP_* → E_*
# mapping and diagnostics) and `manifest` (the capability manifest: every
# command, flag and code). Agents fetch these once and validate against them.
#
# Usage:
#   bash samples/schema/01-schema.sh
#
# Output: samples/output/schema/*.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/samples/output/schema"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

echo "→ Subjects:"
zn schema list

echo ""
echo "→ Saving the manifests, the error catalogue and the capability manifest:"
for subject in create-manifest modify-manifest batch-manifest errors manifest status error; do
  zn schema "$subject" > "$OUTPUT_DIR/$subject.json"
  printf '  %-18s %6s bytes\n' "$subject" "$(wc -c < "$OUTPUT_DIR/$subject.json")"
done

echo ""
echo "→ E_* codes and their exit codes (from schema errors):"
zn schema errors --json | node -e '
const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
for (const c of s.cli) console.log("  " + c.code.padEnd(16) + " exit " + c.exitCode);
console.log("  ZIP_* → E_* mappings: " + Object.keys(s.zipnativeToCli).length);
'

echo ""
echo "→ An unknown subject is a usage error (exit 2, E_USAGE):"
zn schema bogus --json || echo "  exit $?"
