---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# Every bound is finite

## Context and Problem Statement

1.0.0 accepted `none` / `inf` / `infinity` on every `--max-*` flag, on `--max-input-size` and on
`inflate --max-output`, mapping it to `Infinity` with a one-shot `warning:` line (suppressed by
`--quiet`). An unbounded limit is never what an untrusted archive deserves, the warning
disappeared exactly in the unattended runs where it mattered, and — until ADR 0001 — the value
could come from a planted configuration file. pkinative-cli has never accepted an unbounded
form; the engine's own `ZipLimits` treat `Infinity` as a caller decision the CLI should not make
on a user's behalf by a single word.

## Decision Outcome

- Every size and count parsed by `src/utils/sizes.ts` is a positive, finite, exactly
  representable integer. `none`, `inf` and `infinity` are refused with `E_USAGE` and a remedy
  naming an explicit value (`--max-entries 10000000`, `--max-total-size 64g`).
- The "disabled bound" warning is gone with the form it warned about; `doctor` and
  `schema limits` always report numbers.
- Raising a bound for trusted input stays one explicit flag away, with a number that is visible
  in the script and in review.

### Consequences

- Good: no command runs without every bound in force; a reviewer reads the actual ceiling.
- Bad: a script that passed `--max-ratio none` fails with exit 2 on 1.1.0 and must pass a number.
  Recorded as a security fix with its migration in the CHANGELOG.
