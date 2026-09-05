# v1.0.0 — the agent-grade ZIP CLI on zipnative 1.0.0

> **Branch:** release/v1.0.0 → main
> **Type:** First release (establishes the 1.x machine contract: envelopes, `E_*` classes, the `ZIP_*` mapping, exit codes, schema subjects)
> **zipnative:** ^1.0.0 (sole runtime dependency; external in the bundle, `zipnative/worker` included)
> **Support policy:** Node.js >= 22; CI matrix Ubuntu 22 + 24, Windows 22 + 24 (blocking), macOS 22; veraZIP Linux + Windows on every PR

## Summary

1. Fifteen commands in four groups over zipnative's frozen 1.0 surface — Create & modify
   (`create`, `modify`), Read & extract (`list`, `inspect`, `cat`, `extract`, `stream`),
   Integrity & codecs (`verify`, `crc32`, `inflate`), Automation & meta (`batch`, `doctor`,
   `schema`, `completion`, `govern`).
2. A thin dispatch layer with **no ZIP parsing of its own**: every core call goes through
   `src/core-bridge/index.ts` and is wrapped by `mapZipError` / `guard`, the only place that
   reads the engine's `err.code`.
3. The agent contract: `--json` envelopes carrying `code` (13 stable `E_*` classes) **and**
   `zipCode` (the 39 frozen `ZIP_*` causes, verbatim) plus `entryName` / `detail`;
   `--dry-run` on seven commands; `--strict`; `--summary` / `--fields` / compact JSON; the
   eight `--max-*` bounds plus `--max-input-size`; 22 schema subjects and a capability
   manifest; `doctor`; `llms.txt`, `AGENTS.md` and `docs/data/errors.json` in the tarball.
4. Secure-by-default extraction with the CLI as the proven filesystem trust boundary
   (one sink: `safeJoin` containment, realpath re-check against planted links, exclusive
   opens, uniform overwrite refusal, case-fold check, partial-file removal, signal cleanup,
   symlinks never materialised, skip-not-write opt-outs) over the engine's refusals.
5. `stream` over unseekable input with the trust caveat explicit; `modify` append-only vs
   `--compact` with the data-remanence and 7-Zip caveats surfaced and every re-emitted entry
   verified; `batch --manifest` pipelines with a codec-load policy and one stdout document
   under `--json`.
6. The veraZIP conformance gate: the ISO/IEC 21320-1:2015 validator vendored from the engine
   (commit `4f1bc36`), independent by construction, over a 37-archive corpus written by the
   built CLI (33 PASS + 4 XFAIL) — blocking in CI on Linux and Windows on every PR and
   pre-publish.
7. Governance and supply chain: CI on three OSes, CodeQL, Scorecard, Dependabot, Trusted
   Publishing with provenance, an attested SBOM and a verified bin-only tarball, the
   AI-governance / HITL files mirrored by `govern` and pinned by a test, agent guidance files
   for the coding assistants the ecosystem supports.
8. Two independent audits (A: CLI / UX / supply chain, B: engine coverage) arbitrated into 74
   accepted findings, implemented in eight batches on this branch (below); six deferred to the
   roadmap, one rejected.

## Changes

### package.json
- `name` zipnative-cli, `version` 1.0.0, `dependencies.zipnative` `^1.0.0`, `engines.node`
  `>=22`, `bin.zipnative` → `dist/cli.cjs`, `files` = `dist` (no maps), `LICENSE`, `README.md`,
  `AGENTS.md`, `llms.txt`, `docs/data/errors.json`; `publishConfig.provenance`; no `module` /
  `types` / `sideEffects` (bin-only); `repository.url` `git+https://…`.
- Scripts: `build` (tsup → `dist/cli.cjs` only), `test`, `test:coverage`, `lint` (`src/` and
  `tests/`), `typecheck:all`, `corpus:zip`, `validate:zip` (= build + corpus + validator).

### src/core-bridge/index.ts
- Selective re-exports grouped like the engine's own `src/index.ts` (the 77-export ledger
  mapped in `docs/KNOWLEDGE_BASE.md` §8); `ensureCodecsReady()` (memoised
  `initNodeZipCodecs`) and `loadParallelZip()` (lazy `zipnative/worker` import with the
  worker script resolved through the exports map).

### Commands (`src/commands/`)
- `create.ts` — plan (walk / manifest / stdin) → `createZip` | `createParallelZip` →
  `toBytes()` | `stream()`; every name pre-checked with `sanitizeEntryPath`; `--order
  insertion` = argv order; `--comment-file`; manifest `extraFields` / `commentBase64`;
  `--parallel` refuses writer-shaping codec modules; envelope `layout` / `tier`.
- `modify.ts` — eager open, fixed-order edits through `createZipModifier`, `verifyEntry()` on
  every re-emitted entry, `save()` | `saveCompact()`; `--in-place` via an exclusive temp file
  + rename; `--comment-file`; manifest `mode` / `extraFields` / `commentBase64`.
- `list.ts`, `inspect.ts` (eager open, stats, determinism verdict split into `deterministic`
  / `canonicalLayout`, 19 `--check` assertions, `commentHex`), `cat.ts` (`readEntryStream` /
  `readEntryRaw`, sync-only codec fallback), `extract.ts` (two-phase sink, `--skip-unsupported`),
  `stream.ts` (`iterateZipEntries`; attribute flags refused; `trust: "local-headers-only"`;
  summary `descriptorEntries` / `bytesKnown`).
- `verify.ts` (`verifyZip` + counters, `--entry` via `verifyEntry`, `E_VERIFY_FAILED` with
  `zipCode`), `crc32.ts`, `inflate.ts` (`createInflator` with a mandatory bound; `--sync` /
  `--method`; `bytesConsumed`).
- `batch.ts` (directory create / verify with a 1–64 pool; `--manifest` pipelines; one stdout
  document under `--json` via `captureStdout`), `doctor.ts` (limits as numbers), `schema.ts`
  (22 subjects, including `errors` and `manifest`), `completion.ts` (the `COMMANDS` table,
  `PATH_FLAGS`, four shells), `govern.ts`.

### Utilities (`src/utils/`)
- `ziperr.ts` — `ZIP_TO_CLI` (39 codes → class + exit, `satisfies Record<ZipErrorCode, …>`),
  `ZIP_DIAGNOSTIC_CODES` (11), `mapZipError` / `guard`, `isFsError`.
- `error.ts` (13 `E_*` codes, `CliError` with `zipCode` / `entryName` / `detail`),
  `agent.ts` (envelopes, `emitStatus`, `progress`), `diagnostics.ts` (the sink),
  `limits.ts` (eight CWE-tagged flags + `--max-input-size`), `engine.ts` (`prepareEngine`),
  `codecs.ts` (`--codec` loader, `overridesBuiltin`), `io.ts` (`validatePath` for manifest
  values, `safeJoin`, bounded reads, exclusive writes, `captureStdout`, 50 MB cap, streams),
  `sink.ts` (the one extraction sink), `inflight.ts` (signal cleanup), `flags.ts` (the
  boolean-flag table), `zipops.ts` (UTC dates, modes, extra fields), `entryfmt.ts`
  (`rawNameHex`, `commentHex`, 4-digit `unixMode`), `walk.ts` (`preserveInputOrder`),
  `glob.ts`, `sizes.ts`, `manifest.ts`, `projection.ts`, `config.ts` (`codec` refused),
  `version.ts`, `governance.ts`, `colors.ts` (stderr, `FORCE_COLOR`, `TERM=dumb`), `args.ts`.

### Wiring (single source of truth respected)
- `src/index.ts` — USAGE for 15 commands + the global block (exit codes, environment),
  `COMMAND_USAGE`, `loadCommand()`, global flags → `ZIPNATIVE_*` env, config merge, the EPIPE
  guard, the signal handler, the agent error envelope.
- `src/commands/completion.ts` — `COMMANDS` (with `group`), `GLOBAL_FLAGS`, `PATH_FLAGS`,
  `DRY_RUN_COMMANDS`; `src/utils/flags.ts` `BOOLEAN_FLAGS`; `src/utils/projection.ts`
  `PROJECTED_COMMANDS`; `src/utils/manifest.ts` `MANIFEST_COMMANDS`; `src/utils/config.ts`
  `KNOWN_COMMANDS`.

### scripts/ & workflows (veraZIP, CI)
- `scripts/generate-zip-corpus.mjs` — drives the **built** CLI (plus the raw builder for
  canaries) to write 37 archives + `manifest.json` to `test-output/zip/`: 33 conformant
  (every writer path incl. binary comments, `--order insertion`, manifest `extraFields`;
  3 hostile-but-conformant with `refusedBy`) + 4 raw-crafted negatives (`WF/ENTRY-OVERLAP`,
  `WF/CD-COUNT`, `WF/LFH-SIZE-MISMATCH`, `WF/LFH-NAME-MISMATCH`).
- `scripts/validate-zip.mjs` — vendored from `zipnative/scripts/validate-zip.ts` (commit
  `4f1bc36`, hashes recorded in the header); raw parser, never imports the engine; level 0
  always, level 1 foreign tools SKIP when absent, `VERAZIP_REQUIRED=1` fail-closed; exit
  0/1/2/3; coverage canary over `REQUIRED_NEGATIVE_CHECKS`.
- `scripts/helpers/interop-tools.mjs` — bsdtar / unzip / 7z / python-zipfile / jar integrity
  checkers with per-tool exit contracts.
- `.github/workflows/`: `ci.yml` (Ubuntu 22/24, Windows 22/24, macOS 22; docs changes run
  the suite), `verazip.yml` (blocking, Linux + Windows, no path filter), `publish.yml` (the
  full gate, veraZIP, attested SBOM, tarball verification, Trusted Publishing), `codeql.yml`,
  `scorecard.yml`; `dependabot.yml`; `ai-governance.json`, `AGENT_RULES.md`,
  `drafts/README.md` + two upstream drafts, `ISSUE_TEMPLATE/config.yml`,
  `copilot-instructions.md`.

### Samples
- `samples/<command>/` `.sh` + `.ps1` pairs (41 demos), `samples/agent/` (the recommended
  loop), `samples/run-all.js` (73 jobs), `samples/README.md`. All offline.

### Docs
- README (badges, What's new, Highlights, Supported Features with the security-defaults
  table, Conformance status, Quick Start, Command Reference from the USAGE strings, Global
  options with the limit defaults, environment, memory and exit codes, Driving from AI
  agents, Security), `docs/KNOWLEDGE_BASE.md` (12 sections incl. the 39-code mapping and the
  77-export map), `AGENTS.md`, `llms.txt`, `CHANGELOG.md` (every audit finding tagged),
  `ROADMAP.md`, `SECURITY.md`, `CONTRIBUTING.md` (veraZIP, CI matrix, branch protection,
  pinned docs), `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`,
  `release-notes/TEMPLATE.md`, `release-notes/v1.0.0.md`, `docs/data/core-exports.json`,
  `docs/data/errors.json`.

### Tests
- In-process vitest suites per command and util (`tests/helpers/capture.ts`), the
  engine-independent `tests/helpers/raw-zip-builder.ts` for adversarial shapes, two
  foreign-provenance interop fixtures (`tests/fixtures/README.md` + policy test), one spawn
  smoke test against `dist/cli.cjs` (incl. EPIPE and SIGINT), the veraZIP vendor test,
  `tests/utils/governance-sync.test.ts`, and `tests/docs/consistency.test.ts` (command
  counts, `E_*` codes, the `ZIP_*` mapping, the 77-export map, the limits table, the schema
  subjects, USAGE ↔ `COMMANDS` ↔ README / KB tables, status enum ↔ `emitStatus` callers,
  CITATION version, environment variables, tarball paths).
- **1202 tests, 61 files, all green** (1193 passed + 9 platform-conditional skips).
  Coverage statements 96.32 / branches 92.52 / functions 97.93 / lines 96.91 against the
  enforced thresholds 93 / 88 / 94 / 93.

## The audit pass, batch by batch

Two independent audits (A: CLI, UX, agent contract, supply chain; B: engine coverage) were
arbitrated into 81 canonical findings (four merged pairs): 74 accepted, 6 deferred
(A-11 lazy engine require, A-25 fuzz tests, A-36 one governance schema, B-21 manifest
`externalAttributes`, B-39 `list --extra`, B-42 inflate-tier visibility — all on the roadmap),
1 rejected (B-44). Each batch is one commit on this branch.

- **B1 — parser and process contract** (`456a854`; A-01, A-03, A-08, A-29, A-37): the
  boolean-flag table (`utils/flags.ts`) so a boolean never consumes the next token and global
  flags work before the command name; EPIPE → exit 0; TTY guard on implicit stdin; unknown
  command → exit 2 / `E_USAGE`; `--format, -f` everywhere; ≤ 80-column USAGE; `-lq` refused.
- **B2 — dates** (`ecda18a`; A-02, B-31): ISO dates are UTC wall-clock and time-zone
  independent; clamp warnings (1980–2107, odd seconds, `--chunk-size` range).
- **B3 — sink hardening and input bound** (`efb4c1e`; A-06, A-07, A-09, A-14, A-16, A-22,
  A-26): one sink module with realpath containment and exclusive opens; `--max-input-size`;
  uniform `--overwrite` policy on every writer; argv `..` accepted (manifest values still
  checked); threat-model rows.
- **B4 — `modify` verification and codec truth** (`9640bdc`; B-02, B-03, B-07 + B-41,
  B-33): eager open + `verifyEntry()` on every re-emitted entry, no opt-out; honest codec
  claims (a method 0/8 module shapes the writer); `create --parallel` refuses writer-shaping
  modules; `modify` envelope `tier`.
- **B5 — engine coverage** (`31dc1c3`; B-01, B-04, B-05, B-06, B-14, B-15, B-16, B-17, B-18,
  B-43): `--order insertion` = argv order; manifest `extraFields`, `mode`, `commentBase64`;
  `--comment-file`; `rawNameHex` / `commentHex`; `verify --entry`; `extract
  --skip-unsupported`; `cat` sync-codec fallback; `inflate` `bytesConsumed`; three corpus
  entries (37 archives).
- **B6 — agent contract** (`5c2e9fc`; A-05, A-12, A-13, A-21, A-30, B-19 + A-46, B-29, B-36,
  B-37, B-40): one stdout document for `batch --json`; env-driven dry-run; colours on
  stderr; unsafe names are `E_INPUT`; `doctor` limits as numbers; `stream --summary`
  markers; no empty `entryName`; 4-digit `unixMode`; `zipCode` on every `E_NOT_FOUND`.
- **B7 — hygiene** (`6f1f05b`; A-10, A-23, A-31, A-38, A-40, A-43, B-32): governance sync
  test; remedies in every refusal; dead exports removed; SIGINT / SIGTERM cleanup; path
  completions; `--concurrency` cap; `--chunk-size` with `--stdin-name`.
- **B8 — CI and packaging** (`857261c`; A-04, A-27, A-33, A-41, A-42, A-44): docs changes run
  CI; macOS job and Windows 22/24; coverage ratchet; attested SBOM and tarball verification;
  CJS-only bin package; lint covers tests.
- **Step 2** (`ce41623`): `inspect` separates reproducibility from layout
  (`canonicalLayout`, `--check canonical-layout`); `create` reports `layout`.
- **Documentation pass** (A-15, A-18, A-19, A-20, A-24, A-28, A-32, A-34, A-35, A-39, A-45,
  B-20, B-23–B-28, B-30, B-34, B-35, B-38, B-45): README / KB / AGENTS / llms.txt aligned,
  consistency-test relations extended, CONTRIBUTING branch protection, release notes with
  Security first, roadmap sentences for every deferred item, `ISSUE_TEMPLATE/config.yml`, the
  two upstream drafts.

## Test plan

Every command below was run on this branch at HEAD and must be green again on the PR:

- `npm run typecheck:all` — clean
- `npm run lint` — 0 errors (`src/` and `tests/`)
- `npm run test:coverage` — 1193 passed + 9 skipped across 61 files; statements 96.32 /
  branches 92.52 / functions 97.93 / lines 96.91 ≥ thresholds 93 / 88 / 94 / 93
- `npm run build` — `dist/cli.cjs` only (no `dist/cli.js`, no `.d.ts`, no maps)
- `npx vitest run tests/integration/built-binary-smoke.test.ts` — post-build spawn suite
  (`--help`, `--version --json`, `schema manifest` = 15 commands, EPIPE exit 0, SIGINT exit 130
  on POSIX)
- `npm run validate:zip` — **33 PASS + 4 XFAIL, 0 FAIL**, exit 0 (level 1 with the tools
  present; `VERAZIP_REQUIRED=1` in CI)
- `node samples/run-all.js` — 73/73
- `npm pack --dry-run` — 7 files, 120.0 kB packed
- `npm audit --audit-level=high` — 0 vulnerabilities
- Built-binary drive: `create --deterministic` → `inspect --check deterministic` →
  `verify --strict` → `extract` → `crc32` cross-check; `create --parallel` resolves the worker
  script from the bundle; `doctor` reports `deflate-tier: node-zlib`; `create --stream` is
  `deterministic: true`, `canonicalLayout: false`
- Zero-network guarantee: no `net` / `http` / `fetch` / `dns` import anywhere in `src/`

## Human follow-ups (not performed by any agent)

- Push the branch, open this PR, tag `v1.0.0`, create the GitHub Release (the publish
  workflow runs on the published release).
- Configure npm **Trusted Publishing** for `zipnative-cli` (repository `Nizoka/zipnative-cli`,
  workflow `publish.yml`) — the 0.0.1 placeholder was token-published, so the OIDC trust
  relationship does not exist yet.
- Apply the branch protection recorded in CONTRIBUTING.md (required checks `ci (22)`,
  `ci (24)`, `windows (22)`, `windows (24)`, `macos`, `verazip-linux`, `verazip-windows`).
- Enable GitHub Discussions on this repository (SUPPORT.md and `ISSUE_TEMPLATE/config.yml`
  point at the engine's board until then); decide on a `security@zipnative.dev` inbox
  (SECURITY.md names the shared `security@pdfnative.dev` fallback today).
- File the four upstream engine notes drafted locally in `.github/drafts/` (git-ignored, on
  the release machine) under your own identity after review: DOS time encoded from local
  getters (the CLI compensates with UTC wall-clock components); `iterateZipEntries().data()`
  pumping a registered custom-method entry through the inflater instead of refusing before
  the first byte; the node-zlib inflate tier leaking raw `Z_DATA_ERROR` / `Z_BUF_ERROR`
  instead of `ZIP_DEFLATE_*` (the CLI maps them in `ziperr.ts`); `verifyEntry()` not
  reporting the `skipped` reason `verifyZip()` knows (the CLI re-derives it). Each passes
  `govern verify-issue`.
- Follow-up PR in `zipnative` (ecosystem.json, README, ROADMAP) announcing the CLI.

## Backward compatibility

- First release — the surface documented here is the 1.x baseline: envelope fields, the 13
  `E_*` classes, the 39-entry `ZIP_*` mapping, exit codes (0/1/2, plus 130/143 on signals) and
  the 22 schema subjects are frozen for 1.x; additions are minor, changes are major.
- The engine's `deterministic: true` bytes are never post-processed by the CLI, so
  `create --deterministic` output inherits zipnative's frozen byte contract.

## Out of scope (recorded in ROADMAP)

- `zipnative-mcp` (separate repository).
- Read-only AES decryption — blocked on a core crypto-provider seam (the engine's non-goals).
- Streamed entries > 4 GiB — blocked on the core's per-entry `zip64` streaming ADR.
- Custom-method entries in `stream` — waits on the engine (upstream draft).
- `--explain <ZIP_CODE>`, a `deflate` command, `inspect --diff`, `create --from-list`,
  `--store-symlinks` and manifest `externalAttributes`, `list --extra`, inflate-tier visibility
  in `doctor`, user-level config, positional arguments in manifest tasks, lazy engine require,
  fuzz tests, `noUncheckedIndexedAccess`, one ecosystem governance schema, man pages,
  `scripts/verify-docs.mjs`, veraZIP sync automation.

## Self-review checklist

- [ ] `npm run typecheck:all` clean
- [ ] `npm run lint` 0 errors (src and tests)
- [ ] `npm run test:coverage` green, thresholds (93 / 88 / 94 / 93) met
- [ ] `npm run build` + built-binary smoke test (`node dist/cli.cjs --help`, every command,
      `schema manifest`, `create --parallel`, `doctor` on the `node-zlib` tier)
- [ ] `npm run validate:zip` passes locally (33 PASS + 4 XFAIL, exit 0) and in `verazip.yml`
- [ ] No ZIP parsing in the CLI — every core call through `src/core-bridge/index.ts` and
      wrapped by `mapZipError` / `guard`
- [ ] No security default loosened (traversal, symlinks, duplicates, every `ZipLimits` bound,
      `--max-input-size`, `safeJoin` + realpath containment, exclusive opens, overwrite
      refusal, `modify` verification, `--codec` argv-only, manifest codec gate)
- [ ] 77/77 engine exports mapped in `docs/KNOWLEDGE_BASE.md` §8 (`docs/data/core-exports.json`)
- [ ] 39/39 engine codes mapped in `ZIP_TO_CLI` and documented (`docs/data/errors.json`,
      AGENTS.md); 11/11 diagnostics listed
- [ ] `tests/docs/consistency.test.ts` and `tests/utils/governance-sync.test.ts` green
- [ ] CHANGELOG.md (Keep a Changelog, every audit id tagged) and release-notes/v1.0.0.md dated
- [ ] No new runtime dependency (`zipnative` remains the only one); no socket anywhere
- [ ] Docs + samples + completions + schemas cover the whole 15-command surface
- [ ] No autonomous GitHub writes — this draft is committed for human review (HITL)
