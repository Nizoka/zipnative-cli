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

Release notes: [release-notes/v1.1.0.md](../v1.1.0.md). Second review (two independent reviewers + a verifier, every finding with its verdict): [release-notes/draft/review-v1.1.0.md](review-v1.1.0.md). Decisions:
[docs/adr/](../../docs/adr/README.md) (ADRs 0001–0010). Triage of the open PRs and alerts:
[release-notes/draft/triage-v1.1.0.md](triage-v1.1.0.md).

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

## Test plan

- [x] `npm run typecheck:all` clean; `npm run lint` 0 errors
- [x] `npm run test:coverage` — 1368 passed, 9 skipped, 74 files; 95.92 / 91.77 / 97.78 / 96.83
      (thresholds 95 / 91 / 97 / 96)
- [x] `npm run validate:zip` — 37 PASS + 4 XFAIL; the 37 inherited archives are byte-identical
      to the 1.0.0 build (SHA-256 compared)
- [x] `node scripts/gate.mjs --publish --require-all` — every step green (reproducible build,
      bundle probe, 10-file tarball, install smoke test)
- [x] `node samples/run-all.js --clean` — 83 / 83
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
- After the merge: close the superseded PRs and dismiss / confirm the alerts as listed in the
  triage draft. Register at bestpractices.dev.
- Confirm the 1.0.x security-fix window (SECURITY.md: until 2027-04-18) and the release date in
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
- [x] Binary smoke test passes (`node dist/cli.cjs --help` outputs all 15 commands)
- [x] veraZIP gate passes (`npm run validate:zip` locally; CI on Linux + Windows)
- [x] No ZIP parsing logic in the CLI
- [x] No security default loosened silently
- [x] Docs counts updated (`tests/docs/consistency.test.ts` green)

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
