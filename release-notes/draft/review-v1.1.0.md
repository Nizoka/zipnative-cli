# zipnative-cli 1.1.0 — second review: findings, verdicts, fixes

_Draft for the maintainer (HITL). Branch `release/v1.1.0`; reviewed at `e2e820e`, fixed in
`aba500a` → `0536020`._

## Method

- **Two independent reviewers**, working read-only, each on all seven criteria, from different
  angles:
  - **A — conformance and product.** Standards against pkinative-cli and pdfnative-cli, coverage
    of the core, the AI instructions, every documented figure checked against the binary, and
    measured token cost.
  - **B — adversarial.** The surface diff from the published 1.0.0 to 1.1.0, a hardening matrix
    against pkinative-cli, and attacks on the binary and the workflows.
- **A third, separate agent (the verifier)** reproduced every finding itself and ruled it
  CONFIRMED, REJECTED or DEFER.
- **Framing decisions given to all three agents** — challenged only if shown unsafe:
  - the three input narrowings are security fixes (ADRs 0001–0003);
  - HITL applies to GitHub writes;
  - `dosTimeMode` is not adopted (ADR 0008);
  - runners use `-latest`;
  - no `fast-check` (ADR 0010).
- **Maintainer decision (2026-10-18):** expose the 11 core exports still graded "bridged" in
  1.1.0 (M-17).

**Totals:** 31 findings — 30 merged, plus one the verifier found (N-1). 23 confirmed (three of
them in part), 5 deferred, 1 rejected, 2 rejected in part.

## The seven criteria — verdict after the fixes

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | 2026 state of the art, native philosophy | **Met; family hygiene gaps deferred** | Supply-chain parity is reached or exceeded — attested five-job release, SBOMs, harden-runner everywhere, CodeQL, zizmor, actionlint, reuse, OSV, rulesets as code, SECURITY-INSIGHTS, security.txt. Added: a Node security floor and a gate step that enforces offline. Deferred to 1.2: `docs.yml`, a Deno/Bun job, a PR template, `THREAT_MODEL.md` (M-16). |
| 2 | No breaking change unless justified | **Met** | Reviewer B's surface diff found **no undocumented break**. The narrowings (switch values, batch modes, `extract --entry`, `--workers`) are security or typo fixes, each listed under CHANGELOG `### Security` with its migration. The migration notes are now exact (M-25). |
| 3 | Full core coverage | **Met** | 106 / 106 exports reachable. `canonicalize`, `merge`, `--range` and manifest `raw` entries close the last 11 (M-17). `core-exports.json` grades none `bridged`. |
| 4 | AI instructions current and economical | **Met; size budget deferred** | CLAUDE.md, copilot-instructions and AGENTS.md are corrected (M-11, M-12, M-13). The 94 KB AI-facing text is a 1.2 target with stated budgets (M-14, M-15). |
| 5 | Hardening at pkinative level | **Met** | Switch values are now strict (M-01). Every read is bounded, including batch verify (N-1). The deadline holds on stalled inputs (M-03). Escaping is per field, invisible characters included. A pipe read is bounded in memory. No registry code runs next to the signing identity. |
| 6 | Documentation factual and complete | **Met** | Every count is pinned by tests: commands, demos, diagnostics, corpus, ADRs, links, schemas against real output (`schema-conformance.test.ts`). |
| 7 | Autonomous agent driving, token savings | **Met** | See "Token measurements" below. `schema manifest` now publishes arity, repeatability, path flags and operands (M-05). Errors and summaries carry the facts an agent used to need a second call for (M-04, M-06). |

## Findings

| Id | Source | Sev | Finding | Verdict | Commit |
|---|---|---|---|---|---|
| N-1 | verifier | major | `batch --task verify` ignored `--max-input-size` | CONFIRMED — bounded one-descriptor read | `aba500a` |
| M-01 | A-01 + B-01 | major | `--overwrite=flase` read as ON | CONFIRMED — 8 accepted spellings, otherwise `E_USAGE` (no echo) | `aba500a` |
| M-02 | A-02 + B-03 | major | Published schemas rejected real output | CONFIRMED — schemas fixed + conformance test | `2a5cdc5` |
| M-03 | B-02 | major | `--timeout` never fired on a stalled pipe | CONFIRMED — `addAbortSignal` + stdin abort + dispatcher grace | `d6d24c8` |
| M-04 | A-04 | minor | Safety summary had no hazard facts | CONFIRMED — `unsafeNames`, `symlinks`, `duplicateNames` | `2a5cdc5` |
| M-05 | A-03 | minor | `schema manifest` lacked arity, operands and 130/143 | CONFIRMED | `2a5cdc5` |
| M-06 | A-05 | minor | Verify failure did not name the entries; batch rows had no `zipCode` | CONFIRMED | `aba500a`, `2a5cdc5` |
| M-07 | A-06 | nit | `--summary` / `--fields` silently ignored in text mode | CONFIRMED (warning); `{}` on unknown path REJECTED (documented) | `2a5cdc5` |
| M-08 | A-07 | minor | `verify` / `modify` lacked `--name-encoding` | CONFIRMED for verify; modify DEFER (1.2) | `2a5cdc5` |
| M-09 | A-08 | minor | Host-time-zone `lastModified` undocumented | CONFIRMED — AGENTS + ADR 0008 | `8d428ed` |
| M-10 | A-09 | minor | `schema` output pretty under `--json` | CONFIRMED | `2a5cdc5` |
| M-11 | A-10 | minor | Stale counts (41 demos, 11 codes, 30 + 3, 37-archive) | CONFIRMED + count pins | `8d428ed` |
| M-12 | A-11 | minor | Garbled AGENTS §7 step 5 | CONFIRMED | `8d428ed` |
| M-13 | A-12 | minor | CLAUDE.md / copilot lists lagging | CONFIRMED | `8d428ed` |
| M-14 | A-13 | minor | AI text is 94 KB | DEFER — ROADMAP budgets | — |
| M-15 | A-14 | minor | AGENTS.md role vs family; `.claude/` untracked | DEFER (1.2; `.claude/` is the maintainer's call) | — |
| M-16 | A-15 + B | minor | Family hygiene files | DEFER (OpenSSF badge item REJECTED: human registration) | — |
| M-17 | A-16 | minor | 11 exports unreachable | CONFIRMED — canonicalize, merge, `--range`, raw entries | `0536020` |
| M-18 | A-17 | nit | `DosTimeMode` graded `type` | REJECTED — decided and documented (ADR 0008) | — |
| M-19 | A-18 | nit | CHANGELOG headings not Keep a Changelog | CONFIRMED — `### Security` | `8d428ed` |
| M-20 | A-19 | nit | Engine vocabulary in messages, dead doc path | DEFER — engine draft (`upstream-message-vocabulary.md`) | — |
| M-21 | A-20 | nit | `-l` suggestion, `command: null`, empty text-mode failures | CONFIRMED | `aba500a`, `2a5cdc5` |
| M-22 | A-21 | nit | `mcp` keyword | CONFIRMED | `6f147b6` |
| M-23 | B-04 | minor | batch accepted flags its mode ignores; process-wide task flags | CONFIRMED | `aba500a` |
| M-24 | B-05 | minor | `--workers` unbounded | CONFIRMED — 0–64 | `aba500a` |
| M-25 | B-06 | minor | Migration notes inexact | CONFIRMED | `8d428ed` |
| M-26 | B-07 | nit | Alias table inherits `Object.prototype` | CONFIRMED | `aba500a` |
| M-27 | B-08 | minor | `f` + `f/child` surfaced as `E_RUNTIME` | CONFIRMED — planned `E_IO` | `aba500a` |
| M-28 | B-09 | minor | `extract --entry <missing>` exited 0 | CONFIRMED — `E_NOT_FOUND` | `aba500a` |
| M-29 | B-10 | minor | No Node security floor | CONFIRMED — `^22.17.1 \|\| >=24.4.1` + `node-floor` | `6f147b6` |
| M-30 | B-11 | nit | "Offline" not enforced by a gate | CONFIRMED — network-module denylist | `6f147b6` |

**Deliberate deviation from the plan.** `--range` ships on `list`, `cat` and `verify`, not on
`inspect`. The determinism verdict of `inspect` (`analyzeDeterminism`) is measured over the
archive's bytes, so `inspect --range` would be a flag with half an effect (ADR 0011).

## Token measurements (bytes, stdout / stderr, `--no-config`)

| Agent task | Before the review | After | Effect |
|---|---|---|---|
| "Is it safe to extract?" (zip-slip archive) | `inspect --json --summary` 158 / 0, **no hazard field**; a second call (`--check safe-names`, 179 / 193) was needed | one call, 206 / 0, `unsafeNames: 1` | one call instead of two, about 60 % fewer bytes, and the answer is in the payload |
| "Which entries failed?" (CRC lie) | `verify --json --summary` 64 / 114, no name; the full report (about 1 KB) was needed | 64 / 185: `entryName`, `detail.failedEntries` | no second call |
| Tool schema discovery | `schema manifest --json` 10 768 B pretty, flag names only; `--help` scraping needed | 11 420 B compact, with arity / repeatable / path flags / operands (17 428 B if pretty) | the arity costs +6 % instead of +62 %, and no `--help` scraping |
| Names only (11 entries) | `list --json --fields entries.name` 260 B | unchanged | — |
| Why did it fail? | envelopes with `code` / `zipCode` / `remedy` | unchanged, plus `zipCode` on batch rows | — |

## Verification

- `node scripts/gate.mjs --publish --require-all` — 15 / 15 (adds `node-floor`).
- Tests: 1368 passed, 9 skipped, in 74 files. Coverage 95.92 / 91.77 / 97.78 / 96.83 against
  thresholds of 95 / 91 / 97 / 96.
- veraZIP: 41 archives, 37 PASS + 4 XFAIL. The 37 archives inherited from 1.0.0 are
  byte-identical.
- `node samples/run-all.js --clean`: 96 / 96 jobs.
- **Counter-verification.** A fourth, independent agent re-ran the original scenario of every
  confirmed finding on the built binary (`0536020`). Every one is **closed** (M-19 was closed in
  part and has been completed since). It found **no regression** in the samples, the documented
  invocations, healthy runs under `--timeout`, or multi-line output. It raised three minor
  findings, all fixed in the closing commit:
  1. `canonicalize` carried hostile names over silently. It now counts them in `unsafeNames`
     (along with `encrypted`) and prints a `warning:` line. ADR 0012 and the docs now say that
     reproducible is not safe to extract.
  2. A manifest `raw` DEFLATE payload could hide bytes after the end of its stream. Those bytes
     are now refused, and a stored payload must be exactly the declared size.
  3. Some docs did not mention `raw`, `--range` or `--max-entry-compressed-size`.

  Nits fixed in the same commit:
  - The `ZIPNATIVE_*` environment switches now take the same eight spellings as the flags.
    `ZIPNATIVE_DRY_RUN=true` used to be silently off, so the run wrote its output.
  - Smaller fixes:
    - the `--dry-run` help line;
    - the batch sample comments;
    - two "eight `--max-*`" leftovers;
    - the `canonicalize --date` message;
    - merge's internal-duplicate message;
    - the CHANGELOG, which now uses Keep a Changelog types only.

  Noted and left as they are:
  - `schema manifest` does not list value enums (`--on-duplicate`, `--order`).
  - `detail.failedEntries` is a comma-joined string, because `ErrorDetail` is scalar.
  - `verify --range --strict` reports a strict diagnostic only in the error message.
  - Batch directory mode validates create flags per row. This predates 1.1.0.
