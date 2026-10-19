#!/usr/bin/env bash
# canonicalize/01-canonicalize.sh — make any archive reproducible, without recompression
#
# `canonicalize` rewrites an archive from any producer into zipnative's
# canonical deterministic form (zipnative 1.1 canonicalizeZip): timestamps
# pinned (the DOS epoch, or --date), entries sorted by raw name bytes, names
# re-encoded as UTF-8, extra fields and comments dropped. Payloads are copied
# bit for bit — nothing is recompressed or decoded, so run `verify` first when
# integrity matters. Running it twice yields the same bytes.
#
# Here the input is the committed foreign archive (bsdtar), which is neither
# reproducible nor in the canonical form.
#
# Usage:
#   bash samples/canonicalize/01-canonicalize.sh
#
# Output: samples/output/canonicalize/01-canonical.zip, 01-again.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/samples/output/canonicalize"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

SRC="$ROOT_DIR/tests/fixtures/interop/bsdtar-basic.zip"
OUT="$OUTPUT_DIR/01-canonical.zip"
AGAIN="$OUTPUT_DIR/01-again.zip"

echo "→ The foreign archive is not in the canonical form:"
zn inspect --input "$SRC" --summary --format json

echo ""
echo "→ canonicalize (the envelope reports the verdicts measured on the OUTPUT):"
zn canonicalize "$SRC" -o "$OUT" --overwrite --json

echo ""
echo "→ The gate now passes:"
zn inspect --input "$OUT" --summary --check canonical-form

echo ""
echo "→ Idempotent — canonicalising the output changes nothing:"
zn canonicalize "$OUT" -o "$AGAIN" --overwrite --json
cmp "$OUT" "$AGAIN" && echo "  ✓ identical bytes"
