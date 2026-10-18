#!/usr/bin/env bash
# inspect/04-canonical-form.sh — the engine's determinism verdict and its offenders
#
# `inspect` measures determinism with zipnative 1.1 analyzeDeterminism():
# `deterministic` (epoch timestamps + canonical order + UTF-8 flags — the
# archive rebuilds byte-for-byte) and `canonicalForm` (also canonical extra
# fields and version-made-by 0x032D — the form `--deterministic` writes).
# `offenders` names every entry that breaks it and why (timestamp, order,
# utf8-flag, extra-field, version-made-by); a data-descriptor offender is
# informational only — the streamed layout is what `canonicalLayout` gates.
# `--check canonical-form` turns the verdict into a gate —
# the second call below is EXPECTED to fail: the dates are pinned, but not
# to the DOS epoch.
#
# Usage:
#   bash samples/inspect/04-canonical-form.sh
#
# Output: samples/output/inspect/04-canonical.zip, 04-dated.zip, 04-offenders.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/inspect"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

CANONICAL="$OUTPUT_DIR/04-canonical.zip"
DATED="$OUTPUT_DIR/04-dated.zip"
zn create "$INPUT_DIR/text" --deterministic --output "$CANONICAL" --overwrite --quiet
zn create "$INPUT_DIR/text" --date 2024-01-02T03:04:06Z --output "$DATED" --overwrite --quiet

echo "→ --deterministic writes the canonical form:"
zn inspect --input "$CANONICAL" --summary --check canonical-form,deterministic

echo ""
echo "→ A pinned non-epoch date is reproducible run-to-run, yet not the canonical form — the offenders say why:"
zn inspect --input "$DATED" --format json --fields determinism | tee "$OUTPUT_DIR/04-offenders.json"

echo ""
echo "→ The gate fails (exit 1, E_CHECK_FAILED):"
zn inspect --input "$DATED" --summary --check canonical-form || echo "  exit $?"
