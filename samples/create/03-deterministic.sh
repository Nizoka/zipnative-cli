#!/usr/bin/env bash
# create/03-deterministic.sh — reproducible builds: same inputs → same SHA-256
#
# Timestamps and entry order are pinned by default, but the DEFAULT deflate
# path goes through node:zlib, whose bytes are only stable per zlib build.
# `--deterministic` pins zipnative's pure-TS encoder instead, so the archive
# hashes identically on every runtime and platform. The script builds the
# same tree twice and compares the hashes, then asserts the property with
# `inspect --check deterministic`.
#
# Usage:
#   bash samples/create/03-deterministic.sh
#
# Output: samples/output/create/03-deterministic-a.zip, 03-deterministic-b.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"
OUTPUT_DIR="$ROOT_DIR/samples/output/create"
mkdir -p "$OUTPUT_DIR"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

A="$OUTPUT_DIR/03-deterministic-a.zip"
B="$OUTPUT_DIR/03-deterministic-b.zip"

echo "→ Build #1:"
zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" "$INPUT_DIR/unicode" --deterministic --output "$A" --json
echo "→ Build #2:"
zn create "$INPUT_DIR/text" "$INPUT_DIR/binary" "$INPUT_DIR/unicode" --deterministic --output "$B" --json

echo ""
HA="$(sha256 "$A")"
HB="$(sha256 "$B")"
echo "  sha256(a) = $HA"
echo "  sha256(b) = $HB"
if [ "$HA" = "$HB" ]; then
  echo "  ✓ byte-identical (tier: pure-pinned)"
else
  echo "  ✗ hashes differ" >&2
  exit 1
fi

echo ""
echo "→ CI gate — inspect --check deterministic,epoch-timestamps,canonical-order:"
zn inspect --input "$A" --check deterministic,epoch-timestamps,canonical-order --summary --format json
