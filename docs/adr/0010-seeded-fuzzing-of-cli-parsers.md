---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# Seeded fuzzing of the CLI-owned parsers; coverage-guided fuzzing stays in the engine

## Context and Problem Statement

Every byte of ZIP structure is parsed by the engine, which carries its own fuzzing. The CLI still
owns a set of parsers that read untrusted or hand-typed text: argv (`parseArgs` and the
invocation contract), byte sizes, counts and durations, globs, `--fields` projections, `batch`
manifests, `.zipnativerc.json`, `--name-encoding` labels, and the terminal escaper. Up to 1.0.0
their suites were example-based only (ROADMAP A-25), so an input nobody thought of could still
escape as a `TypeError` or a `SyntaxError` and reach the user as `E_RUNTIME`.

## Decision Outcome

- `tests/fuzz/parsers.test.ts` drives each of those parsers with a seeded PRNG (the raw
  builder's, no dependency: no `fast-check`) and checks one invariant: the parser returns, or
  throws a `CliError` with exit 1 or 2. For the escaper the property is that its output carries
  no control or bidi character and that escaping is stable; for globs, that matching stays fast
  (no catastrophic backtracking); for projections and manifests, that `__proto__` never reaches
  `Object.prototype`.
- It runs with the rest of the suite (1 500 inputs per target, fixed seed, so a failure
  reproduces). `FUZZ_SEED` and `FUZZ_RUNS` widen a campaign locally (`FUZZ_RUNS=20000`).
- The first campaigns found one real bug: a glob character class with a range out of order
  (`--include '[h-%]'`) surfaced the RegExp `SyntaxError` as `E_RUNTIME`; `compileGlob` now
  refuses it as a usage error, and a unit test pins the case.
- Coverage-guided fuzzing of the ZIP format stays in the engine; the CLI never parses ZIP bytes.

### Consequences

- Good: a parser change that lets a hostile input crash the process fails CI.
- Neutral: the seeded campaign is a lower bound, not a proof; longer campaigns are cheap to run.
