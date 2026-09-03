# v1.0.0 — the agent-grade ZIP CLI on zipnative 1.0.0

> **Branch:** release/v1.0.0 → main
> **Type:** First release (establishes the 1.x machine contract: envelopes, `E_*` classes, the `ZIP_*` mapping, exit codes, schema subjects)
> **zipnative:** ^1.0.0 (sole runtime dependency; external in the bundle, `zipnative/worker` included)
> **Support policy:** Node.js >= 22; CI matrix Ubuntu 22 + 24, Windows 22

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
   eight `--max-*` bounds; 22 schema subjects and a capability manifest; `doctor`; `llms.txt`;
   `docs/data/core-exports.json` and `docs/data/errors.json`.
4. Secure-by-default extraction with the CLI as the proven filesystem trust boundary
   (`safeJoin` containment, overwrite refusal, case-fold check, partial-file removal, symlinks
   never materialised, skip-not-write opt-outs) over the engine's refusals.
5. `stream` over unseekable input with the trust caveat explicit; `modify` append-only vs
   `--compact` with the data-remanence and 7-Zip caveats surfaced; `batch --manifest`
   pipelines with a codec-load policy.
6. The veraZIP conformance gate: the ISO/IEC 21320-1:2015 validator vendored from the engine
   (commit `4f1bc36`), independent by construction, over a 34-archive corpus written by the
   built CLI — blocking in CI on Linux and Windows and pre-publish.
7. Governance and supply chain: CI, CodeQL, Scorecard, Dependabot, Trusted Publishing with
   provenance and SBOM, the AI-governance / HITL files mirrored by `govern`, `CLAUDE.md`.

## Changes

### package.json
- `name` zipnative-cli, `version` 1.0.0, `dependencies.zipnative` `^1.0.0`, `engines.node`
  `>=22`, `bin.zipnative` → `dist/cli.cjs`, `files` incl. `llms.txt`, `publishConfig.provenance`.
- Scripts: `build`, `test`, `test:coverage`, `lint`, `typecheck:all`, `corpus:zip`,
  `validate:zip` (= build + corpus + validator).

### src/core-bridge/index.ts
- Selective re-exports grouped like the engine's own `src/index.ts` (the 77-export ledger
  mapped in `docs/KNOWLEDGE_BASE.md` §8); `ensureCodecsReady()` (memoised
  `initNodeZipCodecs`) and `loadParallelZip()` (lazy `zipnative/worker` import with the
  worker script resolved through the exports map).

### Commands (`src/commands/`)
- `create.ts` — plan (walk / manifest / stdin) → `createZip` | `createParallelZip` →
  `toBytes()` | `stream()`; every name pre-checked with `sanitizeEntryPath`.
- `modify.ts` — fixed-order edits through `createZipModifier`; `save()` | `saveCompact()`;
  `--in-place` via temp file + rename.
- `list.ts`, `inspect.ts` (eager open, stats, determinism verdict, 19 `--check` assertions),
  `cat.ts` (`readEntryStream` / `readEntryRaw`), `extract.ts` (two-phase sink),
  `stream.ts` (`iterateZipEntries`; attribute flags refused; `trust: "local-headers-only"`).
- `verify.ts` (`verifyZip` + counters, `E_VERIFY_FAILED` with `zipCode`), `crc32.ts`,
  `inflate.ts` (`createInflator` with a mandatory bound; `--sync` / `--method`).
- `batch.ts` (directory create / verify with a pool; `--manifest` pipelines), `doctor.ts`,
  `schema.ts` (22 subjects, including `errors` and `manifest`), `completion.ts` (the `COMMANDS` table,
  four shells), `govern.ts`.

### Utilities (`src/utils/`)
- `ziperr.ts` — `ZIP_TO_CLI` (39 codes → class + exit, `satisfies Record<ZipErrorCode, …>`),
  `ZIP_DIAGNOSTIC_CODES` (11), `mapZipError` / `guard` / `guardAsync`, `isFsError`.
- `error.ts` (13 `E_*` codes, `CliError` with `zipCode` / `entryName` / `detail`),
  `agent.ts` (envelopes, `emitStatus`, `progress`), `diagnostics.ts` (the sink),
  `limits.ts` (eight CWE-tagged flags), `engine.ts` (`prepareEngine`), `codecs.ts`
  (`--codec` loader), `io.ts` (`validatePath`, `safeJoin`, 50 MB cap, streams),
  `zipops.ts`, `entryfmt.ts`, `walk.ts`, `glob.ts`, `sizes.ts`, `manifest.ts`,
  `projection.ts`, `config.ts` (`codec` refused), `version.ts`, `governance.ts`, `colors.ts`,
  `args.ts`.

### Wiring (single source of truth respected)
- `src/index.ts` — USAGE for 15 commands + the global block, `COMMAND_USAGE`, `loadCommand()`,
  global flags → `ZIPNATIVE_*` env, config merge, the agent error envelope.
- `src/commands/completion.ts` — `COMMANDS` (with `group`), `GLOBAL_FLAGS`,
  `DRY_RUN_COMMANDS`; `src/utils/projection.ts` `PROJECTED_COMMANDS`;
  `src/utils/manifest.ts` `MANIFEST_COMMANDS`; `src/utils/config.ts` `KNOWN_COMMANDS`.

### scripts/ & workflows (veraZIP)
- `scripts/generate-zip-corpus.mjs` — drives the **built** CLI (plus the raw builder for
  canaries) to write 34 archives + `manifest.json` to `test-output/zip/`: 30 conformant
  (every writer path; 3 hostile-but-conformant with `refusedBy`) + 4 raw-crafted negatives
  (`WF/ENTRY-OVERLAP`, `WF/CD-COUNT`, `WF/LFH-SIZE-MISMATCH`, `WF/LFH-NAME-MISMATCH`).
- `scripts/validate-zip.mjs` — vendored from `zipnative/scripts/validate-zip.ts` (commit
  `4f1bc36`, hashes recorded in the header); raw parser, never imports the engine; level 0
  always, level 1 foreign tools SKIP when absent, `VERAZIP_REQUIRED=1` fail-closed; exit
  0/1/2/3; coverage canary over `REQUIRED_NEGATIVE_CHECKS`.
- `scripts/helpers/interop-tools.mjs` — bsdtar / unzip / 7z / python-zipfile / jar integrity
  checkers with per-tool exit contracts.
- `.github/workflows/`: `ci.yml`, `verazip.yml` (blocking, Linux + Windows), `publish.yml`
  (Trusted Publishing, SBOM, the veraZIP gate re-run), `codeql.yml`, `scorecard.yml`;
  `dependabot.yml`; `ai-governance.json`, `AGENT_RULES.md`, `drafts/README.md`,
  `copilot-instructions.md`.

### Samples
- `samples/<command>/` `.sh` + `.ps1` pairs for all 15 commands, `samples/agent/` (the
  recommended loop), `samples/run-all.js`, `samples/README.md`. All offline.

### Docs
- README (badges incl. the veraZIP workflow, What's new, Highlights, Supported Features with
  the security-defaults table, Conformance status, Quick Start, Command Reference from the
  USAGE strings, Global options with the limit defaults, Driving from AI agents, Security),
  `docs/KNOWLEDGE_BASE.md` (12 sections incl. the 39-code mapping and the 77-export map),
  `AGENTS.md`, `CLAUDE.md`, `llms.txt`, `CHANGELOG.md`, `ROADMAP.md`, `SECURITY.md`,
  `CONTRIBUTING.md` (veraZIP section), `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`,
  `release-notes/TEMPLATE.md`, `release-notes/v1.0.0.md`, `docs/data/core-exports.json`,
  `docs/data/errors.json`.

### Tests
- In-process vitest suites per command and util (`tests/helpers/capture.ts`), the
  engine-independent `tests/helpers/raw-zip-builder.ts` for adversarial shapes, two
  foreign-provenance interop fixtures (`tests/fixtures/README.md` + policy test), one spawn
  smoke test against `dist/cli.cjs`, the veraZIP vendor test, and
  `tests/docs/consistency.test.ts` (command counts, `E_*` codes, the `ZIP_*` mapping, the
  77-export map, the limits table, the schema subjects).
- **1063 tests, 45 files, all green.** Coverage above the enforced thresholds
  (statements 85 / branches 75 / functions 85 / lines 85).

## Independent audit (this release)

- **Surface audit before implementation** — the engine's 77-export `api.json` and 39-code
  `errors.json` were walked export by export and code by code against the planned command
  surface; every export has a CLI touchpoint (KB §8) and every code a class + exit mapping
  (`ZIP_TO_CLI`), with the two engine-side refusals the CLI cannot reach (`ZIP_LIMIT_INVALID`
  pre-validated away, `ZIP_INVALID_OPTION` only via a CLI bug) documented as such.
- **Conformance review** — the corpus generator's writer paths were cross-checked against the
  engine's own 29-conformant sample corpus and its 4 negatives; the hostile-but-conformant
  archives carry an explicit `refusedBy` expectation so "conformant but refused" is asserted,
  not assumed.
- **Docs-vs-code review** — every flag documented in README / KB exists in a USAGE string and
  in the `COMMANDS` table; `tests/docs/consistency.test.ts` keeps it that way.

## Validation

- `npm run typecheck:all` — clean · `npm run lint` — 0 errors ·
  `npm run test:coverage` — 1063/1063 (8 platform-skipped), statements 97 % / branches 92 % / functions 99 % / lines 98 %, thresholds met · `npm run build` — ok ·
  `npm audit --audit-level=high` — 0 vulnerabilities.
- Built-binary smoke (`node dist/cli.cjs`): `--version --json` = 1.0.0 / zipnative 1.0.0,
  `--help` (15 commands, four groups), `doctor` (`deflate-tier: node-zlib`, workers
  available), `schema manifest` (15 commands, 13 `E_*`, 39 `ZIP_*`, 11 diagnostics, 22
  subjects), completions for the four shells, and an end-to-end
  create `--deterministic` → inspect `--check deterministic` → verify `--strict` → extract
  → crc32 cross-check round-trip; `create --parallel` resolves the worker script from the
  bundle.
- `node samples/run-all.js` green; `.sh` / `.ps1` samples executed on Git Bash and PowerShell.
- `npm run validate:zip`: **30 PASS + 4 XFAIL**, exit 0 locally (level 1 with the tools
  present); the same gate blocking in `verazip.yml` on Linux and Windows with
  `VERAZIP_REQUIRED=1`, and pre-publish.
- Zero-network guarantee: no `net` / `http` / `fetch` / `dns` import anywhere in `src/`.

## Backward compatibility

- First release — the surface documented here is the 1.x baseline: envelope fields, the 13
  `E_*` classes, the 39-entry `ZIP_*` mapping, exit codes (0/1/2) and the 22 schema subjects
  are frozen for 1.x; additions are minor, changes are major.
- The engine's `deterministic: true` bytes are never post-processed by the CLI, so
  `create --deterministic` output inherits zipnative's frozen byte contract.

## Out of scope (recorded in ROADMAP)

- `zipnative-mcp` (separate repository).
- Read-only AES decryption — blocked on a core crypto-provider seam.
- Streamed entries > 4 GiB — blocked on the core's per-entry `zip64` streaming ADR.
- `--explain <ZIP_CODE>`, a `deflate` command, `inspect --diff`, `create --from-list`,
  `--store-symlinks`, positional arguments in manifest tasks, man pages,
  `scripts/verify-docs.mjs`.

## Self-review checklist

- [ ] `npm run typecheck:all` clean
- [ ] `npm run lint` 0 errors
- [ ] `npm run test:coverage` green, thresholds (85 / 75 / 85 / 85) met
- [ ] `npm run build` + built-binary smoke test (`node dist/cli.cjs --help`, every command,
      `schema manifest`, `create --parallel`, `doctor` on the `node-zlib` tier)
- [ ] `npm run validate:zip` passes locally (30 PASS + 4 XFAIL, exit 0) and in `verazip.yml`
- [ ] No ZIP parsing in the CLI — every core call through `src/core-bridge/index.ts` and
      wrapped by `mapZipError` / `guard`
- [ ] No security default loosened (traversal, symlinks, duplicates, every `ZipLimits` bound,
      `safeJoin` containment, overwrite refusal, `--codec` argv-only, manifest codec gate)
- [ ] 77/77 engine exports mapped in `docs/KNOWLEDGE_BASE.md` §8 (`docs/data/core-exports.json`)
- [ ] 39/39 engine codes mapped in `ZIP_TO_CLI` and documented (`docs/data/errors.json`,
      AGENTS.md); 11/11 diagnostics listed
- [ ] `tests/docs/consistency.test.ts` green (counts, codes, mapping, exports, limits, subjects)
- [ ] CHANGELOG.md (Keep a Changelog) and release-notes/v1.0.0.md dated
- [ ] No new runtime dependency (`zipnative` remains the only one); no socket anywhere
- [ ] Docs + samples + completions + schemas cover the whole 15-command surface
- [ ] No autonomous GitHub writes — this draft is committed for human review (HITL)
