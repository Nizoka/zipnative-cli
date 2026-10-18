---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# No flag without an effect: `maxEntryCompressedSize` is reported, not flagged

## Context and Problem Statement

zipnative 1.1 adds a ninth `ZipLimits` key, `maxEntryCompressedSize` (1 GiB + 1 MiB, CWE-770).
The engine consults it only in the byte-range reader (`openZipRange`), which bounds how much one
entry may fetch from a range source. No zipnative-cli 1.1.0 command reads through the range
reader: every random-access command holds the archive in memory, bounded by `--max-input-size`.
The CLI's eight `--max-*` flags map one-to-one onto `ZipLimits`, so symmetry suggests a ninth.

## Decision Outcome

- No `--max-entry-compressed-size` flag in 1.1.0. A flag that is accepted and changes nothing is
  a report that lies — the CLI's own rule ("reported truthfully") applies to its flags too.
- The bound is still visible: `ENGINE_ONLY_LIMITS` in `src/utils/limits.ts` feeds `doctor`
  (`limits.data.maxEntryCompressedSize`) and `schema limits` (with its default and the reason it
  has no flag), and the knowledge base §8 records it.
- When a command starts reading through the range reader (ROADMAP "1.2 candidates"), the flag
  arrives with it.

### Consequences

- Good: every flag the CLI accepts does something; the engine's full limit vocabulary is still
  inspectable.
- Neutral: `LIMIT_FLAGS` (8) and `LIMIT_KEYS` (9) differ by design; the tests pin both.
