# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] – 2026-09-03

Built on **zipnative 1.0.0** — the engine's first stable release, whose 77-export API, 39-code
error vocabulary and `deterministic: true` output bytes are frozen under semver. This is the
first release of the CLI: **15 commands** in four groups over that frozen surface, a thin
dispatch layer with no ZIP parsing of its own, an agent contract that carries the engine's
`ZIP_*` codes verbatim next to 13 stable `E_*` classes, secure-by-default extraction with the
CLI as the proven filesystem trust boundary, and a blocking ISO/IEC 21320-1:2015 conformance
gate (veraZIP) over every archive the CLI writes. Offline in every mode — no command can open a
socket. Zero extra runtime dependencies. Node.js ≥ 22.

### Added

#### Commands

- **`create`** — build a deterministic ZIP from files, directories, stdin (`--stdin-name`) or a
  JSON manifest (`--from-manifest`, schema subject `create-manifest`) through `createZip`:
  canonical entry order, DOS-epoch timestamps and UTF-8 names by default; `--deterministic`
  pins the pure-TS encoder (identical SHA-256 on every runtime, reported as
  `tier: "pure-pinned"`); `--stream` (constant-memory writer: file inputs are streamed
  through `addStream()`, data-descriptor layout, same content as the buffered layout but
  not the same bytes; entries > 4 GiB refused with `ZIP_UNSUPPORTED_ZIP64_STREAMING`); `--parallel` / `--workers` / `--min-job-size` /
  `--job-timeout` (`createParallelZip` from `zipnative/worker`, loaded lazily with an explicit
  `workerUrl`); `--method`, `--level`, `--order canonical|insertion`, `--date epoch|now|<ISO>`,
  `--mtime`, `--comment`, `--entry-comment`, `--preserve-mode`, `--store-ext`, `--base`,
  `--prefix`, `--dir-entries`, `--include` / `--exclude` globs, `--follow-symlinks` (symlinks
  are skipped with a warning by default and never written as symlink entries), `--dry-run`
  (the plan). Every entry name is pre-checked with the engine's `sanitizeEntryPath()`.
- **`modify`** — incremental edits through `createZipModifier`: `--remove`, `--rename`,
  `--replace`, `--add`, `--add-dir`, `--comment`, or `--from-manifest` (schema subject
  `modify-manifest`), applied in a fixed order; untouched entries are never recompressed. The
  default save is append-only (original bytes verbatim — removed content remains recoverable,
  and 7-Zip's CLI mis-reads the layout; an `info:` line says so); `--compact` (`saveCompact`)
  for true deletion; `--in-place` (temp file + rename); `--method` / `--level` /
  `--deterministic` / `--date` for new payloads; `--dry-run`.
- **`list`** — entries without decompressing anything (`openZip`): `text` (an `unzip -l`
  table) | `json` | `ndjson`, `--long`, `--validate lazy|eager`, `--include` / `--exclude`,
  `--summary`, `--fields`.
- **`inspect`** — forensic report over an eagerly opened archive (every local header
  cross-checked, overlap table built): archive facts, per-method statistics, a determinism
  verdict, every diagnostic; `--entries` / `--entry` / `--extra`; 19 repeatable `--check`
  assertions (`deterministic`, `epoch-timestamps`, `canonical-order`, `utf8-names`,
  `no-data-descriptor` / `canonical-layout`, `no-zip64`, `zip64`, `no-encryption`, `no-symlinks`, `no-duplicates`,
  `no-diagnostics`, `store-only`, `deflate-only`, `max-entries=N`, `min-entries=N`,
  `max-uncompressed=<size>`, `max-ratio=N`, `has=<name>`, `method=…`) that print the report
  then exit 1 / `E_CHECK_FAILED`; `--summary`, `--fields`.
- **`cat`** — stream one or more entries to stdout or `--output` by random access
  (`readEntryStream`), `--raw` for the compressed payload (`readEntryRaw`), `--no-verify-crc`,
  `--dry-run`; the CRC is verified at the end of the stream and a partial `--output` file is
  removed on failure.
- **`extract`** — write entries to `--output-dir` with the engine's guards on by default
  (`extractZipStream`; `--buffered` for `extractZip`): zip-slip / device names, symlinks,
  overlaps, CD/LFH mismatch, duplicate paths and bombs are refused with their `ZIP_*` code.
  Two-phase sink: plan (every destination re-proved under the root with `safeJoin`, existing
  files refused without `--overwrite`, case-fold collisions refused on win32 / darwin) then
  write with backpressure (partial files removed on failure). Opt-outs are skip-not-write:
  `--skip-unsafe`, `--skip-symlinks`, `--allow-symlinks` (target text as a regular file — a
  symlink is never materialised), `--on-duplicate error|first|last`; `--include` / `--exclude`
  / `--entry`, `--flat`, `--preserve-mode` (never setuid/setgid/sticky), `--preserve-mtime`,
  `--dry-run`.
- **`stream`** — forward-only reader for unseekable input via `iterateZipEntries`: `--list`
  (default; text | json | ndjson, rows emitted as entries arrive), `--output-dir`
  (`sanitizeEntryPath` + `safeJoin` on every name), `--cat`; `--skip-unsafe`,
  `--skip-unsupported`, `--overwrite`, `--on-duplicate`, `--flat`, `--preserve-mtime`,
  `--dry-run`. The trust caveat is explicit: `--preserve-mode` / `--allow-symlinks` /
  `--skip-symlinks` are refused (attributes live only in the central directory), every JSON
  output carries `trust: "local-headers-only"`, and a `warning:` line is printed at start.
- **`verify`** — one-call deep verification via `verifyZip`: the engine's
  `ZipVerificationReport` plus `failed` / `skipped` / `strict`; encrypted entries are honestly
  `skipped`; exit 1 / `E_VERIFY_FAILED` with `zipCode = report.error.code` for structural
  refusals; `--strict` also fails on any diagnostic; `--summary`, `--fields`.
- **`crc32`** — CRC-32 of files or stdin in 64 KiB chunks through the engine's incremental
  `crc32()`; `--seed`, `--expect` (exit 1 / `E_CHECK_FAILED` with
  `detail: { expectedCrc, actualCrc }`), `--format text|json`.
- **`inflate`** — raw DEFLATE (RFC 1951) or registered-codec decoder with a **mandatory**
  output bound (`--max-output`, default = the effective `--max-entry-size`): the resumable
  `createInflator` fed chunk by chunk (constant memory, trailing bytes reported as
  `leftover`), `--sync`, `--method deflate|store|<id>`, `--allow-trailing`, `--dry-run`.
- **`batch`** — directory mode (`--task create`: every subdirectory through the full `create`
  command with a bounded `--concurrency` pool; `--task verify`: every `*.zip` verified;
  `--fail-fast`) and manifest mode (`--manifest tasks.json`, schema subject `batch-manifest`):
  a strictly pre-validated, sequential, fail-fast pipeline of 10 whitelisted manifest commands
  with `"@<id>"` output references, `--continue-on-error`, and a codec-load policy
  (`--allow-codec-load` required for any `codec` task flag). Manifests are size-capped
  (50 MB), bounded to 1 000 tasks, and their path values get the same traversal check as
  direct flags. `--summary`, `--fields`, `--dry-run`.
- **`doctor`** — offline environment / capability preflight: CLI, Node (≥ 22), zipnative
  (package version vs the engine's `VERSION` export), `deflate-tier` (`node-zlib` expected),
  `deflate-pinned` (the `--deterministic` tier), `web-streams`, `workers` (`create
  --parallel`), `codecs`, the effective `limits`, and the command count; text or
  `--format json`; exit 0/1.
- **`schema`** — 22 versioned JSON Schema subjects (Draft 2020-12, `$id` embeds the CLI
  version): `create-manifest`, `modify-manifest`, `batch-manifest`, `entries`,
  `entries-summary`, `inspect`, `inspect-summary`, `verify`, `verify-summary`, `stream`,
  `stream-summary`, `batch`, `batch-summary`, `doctor`, `govern-verify`, `crc32`, `status`,
  `error`, `errors` (the `E_*` codes, the 39-entry `ZIP_*` → `E_*` map and the diagnostic
  codes), `limits`, `diagnostics`, and the capability `manifest`.
- **`completion`** — `bash`, `zsh`, `fish` and `powershell` scripts generated from the
  `COMMANDS` table (the single source of truth shared with `schema manifest` and `doctor`).
- **`govern`** — the zipnative ecosystem's AI-governance / Human-in-the-Loop contract:
  `govern rules`, `govern policy`, `govern verify-issue <draft.md>` (exit 1 / `E_POLICY` on a
  runtime-dependency proposal or a missing reproduction block; anti-goal proposals and
  missing recommended fields are warnings). Fully offline.

#### Global options

- **`--json`** (agent mode), **`--pretty`**, **`--dry-run`** (7 commands), **`--strict`** (the
  first engine diagnostic → `ZIP_STRICT_DIAGNOSTIC` → `E_CHECK_FAILED` before any output
  byte), **`--quiet`** / `-q`, **`--no-color`** (+ `NO_COLOR`), **`--config <file>`** /
  **`--no-config`** (`.zipnativerc.json`, discovered cwd-upward, global + per-command
  sections, flags win, 1 MB cap), **`--version --json`** (`{ name, version, zipnative }`).
- **Eight `--max-*` security bounds** mapping one-to-one onto the engine's CWE-tagged
  `ZipLimits` (`--max-entries`, `--max-entry-size`, `--max-total-size`, `--max-ratio`,
  `--max-name-bytes`, `--max-extra-bytes`, `--max-comment-bytes`, `--max-cd-bytes`) with the
  engine's defaults (100000 / 1 GiB / 8 GiB / 1024:1 / 4096 / 65535 / 65535 / 256 MiB), a
  `<size>` grammar (`512k`, `1m`, `8g`, `1GiB`), and `none` to disable a bound with a visible
  warning; values are pre-validated so `ZIP_LIMIT_INVALID` is unreachable from the CLI.
- **`--pure-codecs`** (skip `node:zlib`, run the pure-TS tier) and **`--codec <module>`** (load
  an ESM module exporting `{ codecs: ZipCodec[] }` and optional `inflateImpl` / `deflateImpl`;
  read-side only; the CLI's only dynamic import of user code — argv only, refused from config
  files, refused inside manifests without `--allow-codec-load`).

#### Agent surface

- **`--json` envelopes** — on failure a single stderr line
  `{ ok: false, command, error: { code, message, zipCode?, entryName?, detail? } }`; on
  success a status line for `create` / `modify` / `extract` / `stream` / `cat` / `inflate` /
  `crc32` carrying command-specific facts (`bytes`, `entries`, `skipped`, `tier`, `layout`,
  `trust`, …) and the engine's `diagnostics[]`.
- **13 stable `E_*` classes** — `E_USAGE`, `E_INPUT`, `E_PARSE`, `E_IO`, `E_SECURITY`,
  `E_DATA`, `E_LIMIT`, `E_UNSUPPORTED`, `E_NOT_FOUND`, `E_VERIFY_FAILED`, `E_CHECK_FAILED`,
  `E_POLICY`, `E_RUNTIME` — and the **39 frozen `ZIP_*` causes carried verbatim** as
  `error.zipCode` through a single typed mapping (`ZIP_TO_CLI`, `satisfies
  Record<ZipErrorCode, …>` so a core minor bump adding a code fails `tsc`); `entryName` and
  code-specific `detail` (`{ limit, configured, observed }`, `{ feature }`,
  `{ expectedCrc, actualCrc }`) when the engine knows them.
- **Diagnostics bridge** — the 11 engine diagnostic codes surface as `warning:` / `info:`
  lines on stderr (text), as `diagnostics[]` arrays under `--json`, or as a hard error under
  `--strict`; deduplicated per `(code, entryName)`.
- **Token economy** — compact JSON under `--json` (`--pretty` opts out), `--summary`
  (canonical minimal verdicts for `list`, `inspect`, `verify`, `stream`, `batch`, each
  schema-pinned), `--fields a,b.c` dot-path projection, NDJSON listings.
- **Self-description** — `schema manifest` (commands with groups and flags, global flags,
  dry-run / projected / manifest command lists, `E_*` / `ZIP_*` / diagnostic codes, limits,
  schema subjects), `schema errors`, `schema limits`, and [`llms.txt`](llms.txt) shipped in
  the npm package. [`docs/data/core-exports.json`](docs/data/core-exports.json) lists the
  77 engine exports and [`docs/data/errors.json`](docs/data/errors.json) the 39 + 11 codes
  with `raisedWhen` / `remedy` and the CLI mapping per code; `docs/KNOWLEDGE_BASE.md` §8 maps
  every export to a CLI touchpoint and `tests/docs/consistency.test.ts` pins the docs to the
  code.
- **[AGENTS.md](AGENTS.md)** documents the full contract, the recommended agent loop
  (`doctor` → `inspect --summary` → `extract --dry-run` → `extract` → branch on
  `code` / `zipCode`), and the safety notes for unattended use.

#### Conformance gate (veraZIP)

- **`npm run validate:zip`** — build, `npm run corpus:zip` (`scripts/generate-zip-corpus.mjs`
  drives the **built** CLI plus an engine-independent raw builder to write a 34-archive corpus
  to `test-output/zip/` with a manifest), then `scripts/validate-zip.mjs` — the ISO/IEC
  21320-1:2015 validator **vendored from zipnative** (`scripts/validate-zip.ts`, commit
  `4f1bc36`) — raw-parses every archive with its own EOCD / central-directory / local-header
  reader and never imports the engine. 30 conformant archives cover every writer path
  (buffered, `--stream`, `--parallel`, `--deterministic`, `modify` append-only and
  `--compact`, manifests, `batch`), including 3 **hostile-but-conformant** archives
  (zip-slip, a Windows device name, duplicate paths) that PASS the ISO profile and that
  `extract` must **refuse** — both facts are checked; 4 **raw-crafted negative canaries**
  (`WF/ENTRY-OVERLAP`, `WF/CD-COUNT`, `WF/LFH-SIZE-MISMATCH`, `WF/LFH-NAME-MISMATCH`) must be
  rejected with their declared check id (an unexpected pass, XPASS, is fatal), and a coverage
  canary fails the run if any required check id has no canary or a manifest file is missing.
- **Levels and outcomes** — level 0 (ISO clauses + APPNOTE well-formedness cross-checks)
  needs no external tool and always runs; level 1 re-tests every conformant archive with the
  foreign integrity tools present on the machine (`bsdtar`, `unzip`, `7z`, `python -m
  zipfile`, `jar` — `scripts/helpers/interop-tools.mjs`, vendored from the engine's
  `tests/helpers/interop-tools.ts`) and SKIPs absent tools visibly; `VERAZIP_REQUIRED=1`
  fails closed (exit 3 INFRA) when no level-1 tool is usable. Outcomes PASS / FAIL / XFAIL /
  XPASS / INFRA per file; exit 0 ok/skip · 1 conformance · 2 no corpus · 3 infra;
  `VERAZIP_REPORT_DIR`, `VERAZIP_TOOLS` knobs. Per-file JSON reports and a `summary.json`.
- **Blocking in CI** — `.github/workflows/verazip.yml` on Linux and Windows with
  `VERAZIP_REQUIRED=1`, and again as a pre-publish gate in `publish.yml`. No dependency
  added — the validator is a script, the foreign tools are external.

#### Governance & supply chain

- **Workflows** — `ci.yml` (typecheck, lint, tests with coverage thresholds 85 / 75 / 85 /
  85, build and built-binary smoke on Ubuntu Node 22 + 24 and Windows Node 22),
  `verazip.yml`, `publish.yml` (npm Trusted Publishing / OIDC with provenance attestations
  and a CycloneDX SBOM attached to the GitHub Release), `codeql.yml`, `scorecard.yml`,
  Dependabot.
- **AI-governance / HITL** — `.github/ai-governance.json`, `.github/AGENT_RULES.md` and
  `.github/drafts/README.md`, mirrored by the `govern` command; `CLAUDE.md` for Claude Code
  contributors; `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`,
  `CITATION.cff`.
- **Tests** — in-process vitest suites (stdout / stderr captured) for every command and
  util, an engine-independent raw ZIP builder for adversarial shapes (never committed — see
  `tests/fixtures/README.md`), two foreign-provenance interop fixtures, one spawn smoke test
  against the built binary, and `tests/docs/consistency.test.ts`. 1063 tests across
  45 files (statements 97 %, branches 92 %, functions 99 %, lines 98 %).
- **Samples** — a `.sh` + `.ps1` pair per command under `samples/`, plus `samples/agent/`
  and `samples/run-all.js`; every sample runs offline.

[Unreleased]: https://github.com/Nizoka/zipnative-cli/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Nizoka/zipnative-cli/releases/tag/v1.0.0
