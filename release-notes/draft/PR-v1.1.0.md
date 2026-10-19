# feat: zipnative-cli 1.1.0 — zipnative 1.1.0 parity and hardening

<!-- Draft for human review (HITL). Branch: release/v1.1.0 → main. Paste from "## Description". -->

## Description

zipnative-cli 1.1.0 on **zipnative 1.1.0** (`^1.1.0`, still the only runtime dependency). The
release covers three things:

- **Engine parity:** 106/106 exports bridged and every one reachable — new flags on the existing
  commands, and two new commands, `canonicalize` and `merge` (17 commands).
- **Runtime hardening** to the pkinative-cli level.
- **Release integrity** at the level of zipnative 1.1.0.

Inputs that 1.0.0 accepted and ignored or misread are now refused. They ship as security fixes
with a migration (CHANGELOG `### Security`). Everything else is additive: the envelopes, the
`E_*` codes, the exit codes and the `ZIP_*` mapping are unchanged, and the 37 archives of the
1.0.0 veraZIP corpus are byte-identical.

Release notes: [release-notes/v1.1.0.md](../v1.1.0.md). Decisions:
[docs/adr/](../../docs/adr/README.md) (ADRs 0001–0012). The independent reviews and the audit
are summarised below (§Independent audit); the triage of the open PRs and alerts is the table
under §Human follow-ups.

## Related Issues

Supersedes #1, #3, #4, #5, #7 (one commit moves every `codeql-action` step together) and #11
(the engine is bumped by hand). Closes #10 (`@types/node` majors ignored: the floor is Node 22).
Resolves Dependabot alerts #1, #3 and Scorecard alerts #3, #8; prepares #1 (rulesets as code).
Upstream: closes the CLI's engine asks answered by zipnative 1.1.0
([zipnative#9](https://github.com/Nizoka/zipnative/issues/9)–[#12](https://github.com/Nizoka/zipnative/issues/12)).

## Commits

| Commit | Scope |
|---|---|
| `ci(deps)` | `codeql-action` v4.37.9 on all four steps, `scorecard-action` v2.4.4 |
| `feat(core)` | 106-export bridge, `--zip64`, `--name-encoding`, `--timeout`, `--progress`, `analyzeDeterminism`, `--long` timestamps / unix ids, `stream --codec` via `createDecompressor`, compensations removed, `scripts/sync-engine-data.mjs` |
| `fix(security)` | presentation-only config, strict invocation, finite bounds, one-descriptor reads, `lstat` + `wx` / temp + rename writes, terminal-safe text, the early-error unlink fix, ADRs 0001–0008 |
| `ci(supply-chain)` | four-job publish (five after the review fixes), `scripts/gate.mjs`, harden-runner / `--ignore-scripts` everywhere, zizmor / actionlint / reuse, audit + OSV, dependency review, rulesets, SECURITY-INSIGHTS, security.txt, ADR 0009 |
| `test(fuzz)` | seeded parser fuzzing (one bug found and fixed), stricter `tsconfig` / ESLint, veraZIP re-port (`WF/DESCRIPTOR-WIDTH`), corpus 39, docs link / anchor / EOL tests, ADR 0010 |
| `chore(release)` | 1.1.0: CHANGELOG, ROADMAP, release notes, docs refresh, four new samples, `typescript-eslint` 8.71.1 |
| `fix(review)` | findings of two independent pre-PR reviews (correctness, security), each reproduced first: `stream --timeout` no longer exits 0 with a truncated file, a timeout in a decompressor is `E_LIMIT`, config `false` never turns a switch on, `batch` accepts the create flags it forwards, one deadline per process, FIFO reads bounded in memory, per-field terminal escaping (LF, invisible characters, remedies), the consumer check moved to a read-only fifth publish job, manifest `comment-file` anchored |
| `fix(security)` (2nd review) | strict switch values (`--overwrite=flase` was ON), bounded `batch --task verify`, mode-strict `batch`, process-wide flags refused in tasks, `--workers` 0–64, prototype-free aliases, `extract` file/dir conflict and missing `--entry` refused up front |
| `fix(control)` | `--timeout` fires while an input is stalled (stdin, pipes, FIFOs) |
| `fix(contract)` | schemas match the output (conformance test), typed `schema manifest`, safety facts in `inspect --summary`, failing names in `verify` errors, `verify --name-encoding`, compact `schema` under `--json`, text-mode failure lines |
| `chore(supply-chain)` | Node security floor `^22.17.1 || >=24.4.1` + `node-floor` gate step, network-module denylist in the bundle probe, no `mcp` keyword |
| `docs` | second-review fixes to the contract docs, exact migration notes, `### Security`, AI-instruction lists, count pins |
| `feat(core)` | every export reachable: `canonicalize`, `merge`, `--range` (+ `--max-entry-compressed-size`), manifest `raw` entries — 17 commands |
| `fix(review)` (counter-verification) | `canonicalize` counts hostile names (`unsafeNames`, `encrypted`) and warns, a `raw` DEFLATE payload refuses trailing bytes, `ZIPNATIVE_*` values strict, docs |
| `chore(agents)` | the `release-audit` Claude Code skill tracked under `.claude/skills/`, a tracked `.claude/settings.json` (attribution off, the GitHub and npm writes denied), `.audit/` ignored, `tests/tools/agent-settings.test.ts` |
| `chore(release)` | the review and triage reports moved out of the tree (`.audit/1.1.0/`, `.github/drafts/`), summarised here |
| `fix(audit)` | the 29 actionable findings of `/release-audit` (§Independent audit): a bound is never a verdict in `verify`, a missing file is `E_IO`, the env-switch envelope, `zip64Entries`, remedies, CRC shapes, batch rows, the documentation findings |
| `docs(release)` | the audit verdict and the final figures in this draft |
| `chore(release)` | the release date 2026-10-20 and the dates derived from it (1.0.x security fixes until 2027-04-20, `security.txt` `Expires` 2027-10-20) |
| `fix(audit)` (release day) | the round-4 findings: `batch --task verify` parses the bounds once before the pool, the raw `ZIPNATIVE_JSON` is still judged under `--json` and the refusal names the command, the instruction files counted by the docs test, the licensing sentence, ADR 0009's five jobs, the `batch --dry-run` wording |
| `docs(release)` (release day) | the round-4 verdict, the triage re-read and the 2026-10-20 figures in this draft |
| `test(io)` | CodeQL `js/insecure-temporary-file` on the PR: a unit test handed the shared temp root itself to `readFileOrStdin`; it now uses a private `mkdtemp` directory and asserts `E_IO` (no `src/` change) |

## Behaviour changes (reviewer attention)

1. `.zipnativerc.json`: only `format`, `fields`, `json`, `pretty`, `quiet`, `no-color`,
   `progress`, `strict`, `long` and `summary` are allowed; any other key is `E_USAGE` naming the
   file (ADR 0001).
2. An undeclared, repeated or surplus flag or operand is `E_USAGE` (exit 2) before any input is
   read, including for every `batch` task (ADR 0003).
3. `none` / `inf` on a bound is `E_USAGE` (ADR 0002).
4. Text errors read `error E_X (ZIP_Y): message` (1.0.0 printed the bare message).
5. A manifest `comment-file` resolves against the manifest directory (was the current
   directory) and is refused on `..`; a manifest task cannot carry `timeout`.

No security default was loosened. `dosTimeMode` is deliberately not adopted (ADR 0008).
`maxEntryCompressedSize` is behind `--max-entry-compressed-size` (ADR 0011, superseding 0007).

## Independent audit

Agent-run, on the local branch, before the maintainer's own pass. Round 1: two independent
pre-PR reviews (correctness, security) of the branch diff. Round 2: two independent reviewers
over seven criteria — A (conformance and product: standards against pkinative-cli and
pdfnative-cli, coverage of the core, the AI instructions, every documented figure, measured
token cost) and B (adversarial: the surface diff from the published 1.0.0, a hardening matrix
against pkinative-cli, attacks on the binary and the workflows) — and a third, separate
verifier that reproduced every finding and ruled it CONFIRMED, REJECTED or DEFER. Round 2b: a
fourth agent re-ran the original scenario of every confirmed finding on the built binary.
Round 3: `/release-audit` (the family's audit skill, ported in this release: two auditors, an
adversarial verifier, an autonomy pass, a second verifier, a GO/NO-GO ledger) at HEAD.

| Round | Verdict | Confirmed | Resolution |
|---|---|---|---|
| 1 | — | every finding reproduced on the built binary (the `stream --timeout` hang, a decompressor timeout, config `false`, batch create flags, one deadline per process, FIFO reads, per-field escaping, the consumer job, manifest `comment-file`) | fixed in `e2e820e`, one regression test per finding (`tests/integration/review-fixes-1-1.test.ts`, `built-binary-smoke.test.ts`) |
| 2 | **Met** on all seven criteria | 31 findings: 23 confirmed (3 in part), 5 deferred to 1.2 (ROADMAP), 1 rejected, 2 rejected in part; 3 majors — `--overwrite=flase` was ON, the published schemas rejected real output, `--timeout` did not fire on a stalled pipe — plus a bounded `batch --task verify` | fixed in `aba500a` → `0536020`, one regression test per finding (`tests/integration/review2-1-1.test.ts`, `tests/commands/schema-conformance.test.ts`); the 11 last engine exports exposed (`canonicalize`, `merge`, `--range`, manifest `raw`) |
| 2b | every finding **closed**, no regression | 3 minors: `canonicalize` carried hostile names silently, a `raw` DEFLATE payload could hide trailing bytes, docs gaps; nits: `ZIPNATIVE_*` values strict | fixed in `887254f` |
| 3 | **GO** | `/release-audit` at `99bf8c3`: 238 rows over three reports (A 129, B 63, D 46); verifier 1 over A + B: 13 confirmed, 1 rejected, 2 duplicate, 2 raised; verifier 2 over D: 11 confirmed, 2 downgraded, 1 duplicate, 2 raised — **0 blockers, 5 majors, 23 minors, 2 notes**. Majors: `verify` reported an intact entry over a `--max-*` bound as a CRC / size failure on every path (the engine's verifiers swallow the refusal — drafted upstream), SECURITY.md denied the ninth bound its flag, the docs said streamed entries > 4 GiB were refused (they take `--zip64`), a missing file was `E_RUNTIME` on two paths | all 29 actionable rows fixed in `b04f15f`, one regression test per code finding (`tests/integration/audit-1-1.test.ts`, `core-surfaces-1-1`, the built-binary smoke test); the one note needs no action; 0 waived |
| 4 (release day) | **GO** | the round-3 fixes re-audited at `9eaecd9`: closure 29 / 29 (one observation), the diff `99bf8c3..HEAD` re-read hunk by hunk, release-day bookkeeping (versions, dates, no tag, 1.1.0 unpublished, `npm audit` 0, 10 tarball files, the five engine drafts), the triage re-read through `gh api`, and a 96-row 2026 standards sweep (Scorecard, OSPS Baseline, SLSA, Keep a Changelog, Conventional Commits, clig.dev, llms.txt, REUSE, RFC 9116, CITATION.cff, npm metadata, the ten native proofs); verifier 3: 13 confirmed, 2 downgraded, 0 rejected, 1 raised — **0 blockers, 2 majors** (a `b04f15f` regression: a malformed `--max-*` on `batch --task verify` became a per-row `E_USAGE` with exit 1 instead of the exit-2 refusal, with and without `--dry-run`), 7 minors (the raw `ZIPNATIVE_JSON` shadowed by `--json`, `command: null` in that envelope, the instruction files' "15 commands", the inbound = outbound sentence, ADR 0009 "four jobs", the `batch --dry-run` wording, the triage delta), 7 notes | the 9 actionable rows fixed in `64089ac` with their regression tests (`audit-1-1.test.ts`, the built-binary smoke test, `COUNTED_DOCS` now counts the `.github/` instruction files); the notes are ROADMAP 1.2 items or pre-existing; 0 waived |

The seven criteria after round 2b:

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | 2026 state of the art, native philosophy | met; family hygiene deferred | attested five-job release, SBOMs, harden-runner, CodeQL, zizmor, actionlint, reuse, OSV, rulesets as code, SECURITY-INSIGHTS, security.txt, a Node security floor, an offline gate step; `docs.yml`, a Deno/Bun job, `THREAT_MODEL.md` are 1.2 |
| 2 | No breaking change unless justified | met | no undocumented break in the surface diff; every narrowing under CHANGELOG `### Security` with its migration |
| 3 | Full core coverage | met | 106 / 106 exports reachable; `docs/data/core-exports.json` grades none `bridged` |
| 4 | AI instructions current and economical | met; size budget deferred | CLAUDE.md, copilot-instructions, AGENTS.md corrected; the 94 KB budget is a 1.2 target |
| 5 | Hardening at pkinative-cli level | met | strict switch values, every read bounded, the deadline on stalled inputs, per-field escaping, no registry code next to the signing identity |
| 6 | Documentation factual and complete | met | every count pinned by a test; schemas checked against real output |
| 7 | Autonomous agent driving, token savings | met | `schema manifest` publishes arity, repeatability, path flags and operands; errors and summaries carry the facts a second call used to fetch; bytes measured per task |

Ledger: `.audit/1.1.0/` (local, git-ignored) — `review-v1.1.0.md` (round 2, every finding with
its verdict and commit), `corpus-1.0.0.sha256`, then the round-3 files `brief.md`,
`auditor-a.md`, `auditor-b.md`, `verifier-1.md`, `auditor-d.md`, `verifier-2.md`, `ledger.md`,
`verdict.md`; the release-day round under `round-4/` (`brief.md`, `auditor-c.md`, `auditor-e.md`,
`verifier-3.md`, `ledger.md`, `verdict.md`).

`/release-audit release-notes/v1.1.0.md` — **GO** on 2026-10-20 (`round-4/verdict.md`: blockers
open 0, majors open 0, waived 0; gate 15 / 15 at `64089ac`; next: the maintainer's review of this
branch). The agent-autonomy pass re-measured the
token table: `--summary` / `--fields` cut stdout by 75–94 % against text (88–98 % against the full
`--json` report); bare `--json` is text-sized on `inspect` and 2.8–2.9× on `list` / `verify` —
the gain is the projection levers', as AGENTS.md §3 says.

## Validation (what actually ran, on Windows 11, Node 22.23.2)

- [x] `npm run typecheck:all` clean; `npm run lint` 0 errors
- [x] `npm run test:coverage` — 1387 passed, 9 skipped, 76 files; 95.91 / 91.48 / 97.81 / 96.77
      (thresholds 95 / 91 / 97 / 96)
- [x] `npm run validate:zip` — 37 PASS + 4 XFAIL; the 37 inherited archives are byte-identical
      to the 1.0.0 build (SHA-256 compared)
- [x] `node scripts/gate.mjs --publish --require-all` — every step green (reproducible build,
      bundle probe, 10-file tarball, install smoke test)
- [x] `node samples/run-all.js --clean` — 96 / 96
- [x] Built-binary smoke tests:
  - `create --parallel`, `doctor` (deflate tier `node-zlib`, `maxEntryCompressedSize` in the
    limits), `schema diagnostics` (12 codes), `create --stdin-name --zip64`,
    `list --name-encoding shift_jis`;
  - `inspect --check canonical-form` (pass and fail), `--timeout 1ms` → `E_LIMIT`, `--progress`;
  - `--timeout 60ms` mid-entry on a 64 MiB entry: `stream -d`, `stream --cat`, `extract` → `E_LIMIT`,
    exit 1, no partial file (1.1.0-dev exited 0 with a truncated file);
  - refusals: `--overwite` / `--constructor x` → `E_USAGE`, `--max-entries none` → `E_USAGE`,
    a planted config → `E_USAGE`, `--overwrite` over a symlink replaces the link.
- [ ] CI green on the PR (all required contexts in `.github/rulesets/main.json`)

## Human follow-ups (not performed by any agent)

- Import `.github/rulesets/main.json` and `tags.json`.
- Create the `npm-publish` environment with a required reviewer, and bind npm Trusted
  Publishing to `publish.yml` with that environment.
- After the merge, the open PRs and alerts (read on 2026-10-18 and re-read on 2026-10-20 with
  read-only `gh api` calls; nothing was posted, closed or dismissed):

  | Item | Verdict | Action after merge |
  |---|---|---|
  | PRs #1, #3, #4, #5, #7 (`codeql-action` ×4, `scorecard-action`) | integrated in `5c09933`, same SHAs | close as superseded |
  | PR #10 (`@types/node` 26) | rejected: the floor is Node 22, majors ignored in `dependabot.yml` | close |
  | PR #11 (dev group, `zipnative` included) | redone by hand (`a01d7c4` + the release commit); `zipnative` is bumped on its own | close |
  | PRs #12 (`ip-address` 10.7.0 → 10.7.4), #13 (`http-cache-semantics` 4.2.0 → 4.3.0), opened 2026-10-18 | both packages are gone from the branch lockfile | close as superseded |
  | Dependabot #1 `ip-address`, #3 `http-cache-semantics` (dev-only) | gone from the lockfile; `npm audit` 0 | auto-close |
  | Dependabot #4 `brace-expansion` < 1.1.21 (GHSA-q2hr-2g5m-vwhr, medium, dev transitive; opened 2026-10-18) | the branch lockfile holds 1.1.21 / 5.0.12; `npm audit` 0 | auto-close |
  | Scorecard #1 Branch-Protection | rulesets as code | import `main.json` + `tags.json` |
  | Scorecard #2 Token-Permissions `publish.yml` | needed: `contents: write` scoped to `attest` (ADR 0009) | dismiss "won't fix" |
  | Scorecard #3 Token-Permissions `codeql.yml`, #8 Vulnerabilities | fixed on the branch | auto-close |
  | Scorecard #4 Code-Review, #5 Maintained | solo maintainer; repository under 90 days | dismiss or leave; #5 re-scores after 2026-12-01 |
  | Scorecard #6 CII-Best-Practices | human registration | register at bestpractices.dev |
  | Scorecard #7 Fuzzing | seeded fuzzing (ADR 0010); no `fast-check` by decision | dismiss "won't fix" |

  Comment texts: `.github/drafts/triage-v1.1.0.md` (local).
- Confirm the 1.0.x security-fix window (SECURITY.md: until 2027-04-20) and the release date in
  CHANGELOG / CITATION / release notes before tagging `v1.1.0`.
- Engine-side drafts in `.github/drafts/` (local, git-ignored) for the zipnative maintainer.

## Checklist

- [x] Tests pass (`npm run test`)
- [x] Type check passes (`npm run typecheck:all`)
- [x] Lint passes (`npm run lint`)
- [x] New code has tests (coverage thresholds raised, not lowered)
- [x] CHANGELOG.md updated
- [x] No breaking changes to the agent contract; the three narrowed inputs are documented with
      their migration
- [x] Binary smoke test passes (`node dist/cli.cjs --help` outputs all 17 commands)
- [x] veraZIP gate passes (`npm run validate:zip` locally; CI on Linux + Windows)
- [x] No ZIP parsing logic in the CLI
- [x] No security default loosened silently
- [x] Docs counts updated (`tests/docs/consistency.test.ts` green)
- [x] The audit ledger is summarised above with a fix commit for every confirmed blocker and
      major (`b04f15f`, `64089ac`; verdict GO on 2026-10-20, 0 waived)

## AI assistance

Drafted with AI assistance under [.github/AGENT_RULES.md](../../.github/AGENT_RULES.md) and
CLAUDE.md. The agent worked on a local branch only and made no GitHub writes; it read alerts
and PRs with read-only `gh api` calls. The quality gates above were run locally. Every
deviation from the plan is recorded in an ADR or in ROADMAP:

- `dosTimeMode` not adopted (ADR 0008);
- the Node floor is `^22.17.1 || >=24.4.1` (Windows path CVEs; second review);
- no `stream --codec` sample: the CLI cannot write a custom-method archive, so the case is
  covered by tests;
- runner labels stay `-latest`, as in the sibling repositories.

Before this draft, two independent review agents (correctness and security) read the branch
diff. Every finding was reproduced on the built binary, fixed, and pinned by a test
(`tests/integration/review-fixes-1-1.test.ts`, `built-binary-smoke.test.ts`). The engine-side
cause of the `stream --timeout` hang is a local draft for zipnative
(`.github/drafts/upstream-forward-reader-abort-hang.md`).

Human review gate applies.
