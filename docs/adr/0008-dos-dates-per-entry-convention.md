---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# DOS dates: a per-entry convention, so the engine's `dosTimeMode` is not adopted

## Context and Problem Statement

A DOS timestamp is wall-clock fields without a zone. zipnative 1.0 encoded a `Date` through its
local getters, so 1.0.0 of the CLI, to make a pinned build hash the same on every host, rebuilt
each explicit date (`--date <ISO>`, a manifest `date`) as a local `Date` carrying the instant's
UTC fields. It filed the ask upstream; zipnative 1.1 answered with `dosTimeMode: 'local' |
'utc'` (issue #9), one mode per call — per archive on the writer, per open on the reader.

Adopting `dosTimeMode: 'utc'` looked like retiring the compensation. Measured against the CLI's
contract, it is not equivalent:

- The CLI's convention is **per entry**. Explicit dates store UTC fields (reproducible across
  hosts); host-derived times — `--date now`, `--mtime` — store the **local** wall-clock, like every
  other archiver, so `extract --preserve-mtime` restores them on the same host. One archive can
  hold both (a manifest with ISO dates and `"now"`, `--date <ISO>` with `--mtime` files).
- `'utc'` on the writer would change the bytes `--mtime` and `--date now` write today.
- `'utc'` on the reader would shift `lastModified` (JSON) and `--preserve-mtime` by the host's
  offset for every archive written in local time by other tools (Python's `zipfile`, Java,
  Windows Explorer write local time without a UT extra).

## Decision Outcome

- The CLI keeps the engine default `'local'` and its own ISO → UTC-fields normalisation
  (`parseIsoDateUtc` in `src/utils/zipops.ts`). The 37-archive veraZIP corpus is byte-identical to
  the 1.0.0 build.
- What 1.1 does replace: the CLI's own "outside the DOS range" warning. The engine now clamps an
  out-of-range date to the DOS epoch / maximum and reports `ZIP_TIMESTAMP_CLAMPED` through the
  diagnostic sink (an error under `--strict`), for explicit dates and `--mtime` alike.
- `DosTimeMode` is bridged and graded `type` in the export ledger, with this reason.

### Consequences

- Good: no archive the CLI writes changes bytes, and no timestamp it reads shifts, in a minor
  release.
- Neutral: the engine ask is answered and recorded as not adoptable for this convention; a future
  major could move every surface to UTC at once, deliberately.
