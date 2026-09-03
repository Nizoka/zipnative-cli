#!/usr/bin/env bash
# govern/02-verify-issue.sh — gate an issue/PR draft against the HITL policy
#
# `govern verify-issue <draft.md>` validates a locally-authored draft BEFORE a
# human reviews and submits it. It PASSES a compliant draft (exit 0) and
# BLOCKS a non-compliant one (exit 1, E_POLICY): proposing a runtime
# dependency (`npm install some-lib`) or omitting a fenced reproduction block
# are errors; a missing environment / expected-behaviour section or an
# anti-goal proposal is a warning. A passing check is necessary but NOT
# sufficient — a human still reviews and submits under their own identity.
#
# Usage:
#   bash samples/govern/02-verify-issue.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$ROOT_DIR/samples/input"

zn() { if command -v zipnative >/dev/null 2>&1; then zipnative "$@"; else node "$ROOT_DIR/dist/cli.cjs" "$@"; fi; }

echo "→ [1/2] Verifying a COMPLIANT draft (expect PASS / exit 0)…"
if zn govern verify-issue "$INPUT_DIR/govern/draft-good.md"; then
  echo "  ✓ draft-good.md passed."
else
  echo "  ✗ Unexpected failure on draft-good.md" >&2
  exit 1
fi

echo ""
echo "→ [2/2] Verifying a NON-COMPLIANT draft (expect BLOCK / exit 1)…"
if zn govern verify-issue "$INPUT_DIR/govern/draft-bad.md"; then
  echo "  ✗ draft-bad.md unexpectedly passed" >&2
  exit 1
else
  echo "  ✓ draft-bad.md was correctly blocked (exit $?)."
fi

echo ""
echo "→ Agent view — report on stdout, E_POLICY envelope on stderr:"
zn govern verify-issue --input "$INPUT_DIR/govern/draft-bad.md" --json --pretty || echo "  exit $?"

echo ""
echo "→ Drafts can also arrive on stdin (--input -):"
cat "$INPUT_DIR/govern/draft-good.md" | zn govern verify-issue --input - --format json
