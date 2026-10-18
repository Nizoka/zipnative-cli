# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] – 2026-10-18

Built on **zipnative 1.1.0** (`^1.0.0` → `^1.1.0`, still the only runtime dependency). The
engine's 1.1.0 is additive: 77 → 106 exports, the same 39 error codes, a 12th diagnostic
(`ZIP_TIMESTAMP_CLAMPED`) and a new `ZipLimits.maxEntryCompressedSize`. This release brings the
CLI to parity with it — every new export is bridged, and the ones that change what a command can
do are exposed as flags — and to the runtime and supply-chain hardening level of pkinative-cli
and zipnative 1.1.0. Three hardening items narrow what 1.0.0 accepted; they ship as **security
fixes in a minor release** and are listed with their migration under
[Security and behaviour changes](#security-and-behaviour-changes-migration). Every other change is
additive: the `--json` envelopes, the 13 `E_*` codes, the exit codes and the `ZIP_*` mapping are
unchanged, and the 37 archives of the 1.0.0 veraZIP corpus are byte-identical when the 1.1.0 CLI
writes them. Design decisions are recorded as ADRs in [docs/adr/](docs/adr/README.md).

### Security and behaviour changes (migration)

- **The configuration file is presentation only** ([ADR 0001](docs/adr/0001-configuration-is-presentation-only.md)).
  `.zipnativerc.json` may set `format`, `fields`, `json`, `pretty`, `quiet`, `no-color`,
  `progress`, `strict`, `long` and `summary` — nothing else. 1.0.0 refused only `codec`, so a
  file planted in a parent directory could disable the limits or turn on `--overwrite`,
  `--skip-unsafe` or `--allow-symlinks` for every command run below it. Any other key is now
  `E_USAGE` naming the file; `__proto__` / `constructor` / `prototype` are refused; only a
  regular file is read, through one bounded descriptor; a key applies only to a command that
  declares the flag. The file that applied is announced on stderr
  (`info: defaults from <path>: <keys>`) and carried as `config: { path, applied }` in the
  envelopes. **Migration:** move safety and limit settings from the file to argv (or to a
  `batch` manifest task's `flags`).
- **Strict invocation** ([ADR 0003](docs/adr/0003-strict-invocation.md)). A flag the command
  does not declare (`--overwite`), a single-value flag given twice, a repeated switch, a value
  given to a switch (`--json=1`), `-o=x`, and surplus operands are `E_USAGE` (exit 2) before any
  input is read — on argv and for every `batch` task before the first one runs. 1.0.0 ignored a
  misspelt flag, so `--max-entires 10` silently ran with the default bound; `--constructor x`
  crashed with `E_RUNTIME`. The parser is prototype-free and canonicalises the short aliases.
  **Migration:** remove the flags the command never honoured; `--codec`, `--include`,
  `--exclude`, `--entry`, `--check` and the other declared repeatable flags still repeat.
- **Every bound is finite** ([ADR 0002](docs/adr/0002-every-bound-is-finite.md)). `none`, `inf`
  and `infinity` are refused on the eight `--max-*` flags, `--max-input-size` and `inflate
  --max-output`, with a remedy naming an explicit value. **Migration:** pass the size you mean
  (`--max-total-size 64g`).
- **Reads through one descriptor; overwrites by rename** ([ADR 0005](docs/adr/0005-one-descriptor-reads-and-rename-overwrites.md)).
  An input is opened once: a regular file is size-checked against `--max-input-size` on that
  descriptor and read to that size; a pipe, FIFO or device is byte-counted, so `/dev/zero` stops
  with `E_LIMIT` instead of exhausting memory (process substitution still works); a directory
  is `E_IO`. An output is created with an `lstat` refusal (a dangling link counts as existing)
  and an exclusive open; under `--overwrite` it is written to a temporary sibling and renamed
  into place, so a planted symlink is **replaced, never followed**. This covers `create`,
  `modify`, `cat`, `inflate`, `extract` and `stream`.
- **Terminal-safe text** ([ADR 0004](docs/adr/0004-terminal-safe-text.md)). C0 / C1 controls,
  DEL, the Unicode bidi controls and the invisible look-alike characters (zero-width space,
  line separators, BOM, soft hyphen, Hangul fillers, tag characters) in attacker-controlled text (entry names, comments, engine
  messages) are escaped as `\xNN` / `\uXXXX` in every text sink — tables, progress lines,
  diagnostics, errors, remedies; a single field (a name, a message) has its TAB and LF escaped
  too, so it cannot forge a row or a `remedy:` line. JSON output stays exact (`rawNameHex`
  keeps the bytes).
- **Text errors lead with the class and the engine code**: `error E_X (ZIP_Y): message`, then
  the `remedy:` line. Scripts that matched the 1.0.0 `Error: ` prefix should match
  `^error ` or, better, use `--json`.

### Added

- **zipnative 1.1.0 parity.** The core bridge re-exports all **106** exports (101 from
  `zipnative`, 5 from `zipnative/worker`); `docs/data/core-exports.json` gains a third reach
  grade, `bridged`, for the exports no 1.1.0 command reaches yet (the range reader,
  `canonicalizeZip`, raw entry copy — each named in [ROADMAP.md](ROADMAP.md) "1.2 candidates").
- **`create --stream --zip64`** (also with `--stdin-name`): a
  streamed entry is written with a Zip64 local header and the 24-byte data descriptor, so it may
  exceed 4 GiB (`AddEntryOptions.zip64`). Without it, an entry past 4 GiB stays refused with
  `ZIP_UNSUPPORTED_ZIP64_STREAMING`. The status envelope carries `zip64`.
- **`--name-encoding <label>`** on `list`, `inspect`, `cat`, `extract` and `stream`: names
  stored without the UTF-8 flag are decoded with any WHATWG label the runtime knows
  (`shift_jis`, `gbk`, `windows-1252`, …) through the engine's `nameDecoder`, which applies it
  **before** sanitising for extraction. `nameEncoding` becomes `"custom"`; `--long` keeps the
  bytes in `rawNameHex`. `verify` does not take it (`VerifyZipOptions` has no decoder).
- **`--timeout <duration>`** (global: `500`, `500ms`, `30s`, `5m`, `1h`): one `AbortSignal`
  deadline for the run. Past it the run stops at the next chunk or entry boundary with
  **`E_LIMIT`** (`detail.limit: "timeout"`, `configured`, `observed`) and the file being written
  is removed; no new `E_*` code ([ADR 0006](docs/adr/0006-timeout-is-a-limit.md)). An abort
  that reaches a decompressor is reported as the deadline, never as corrupt data. The deadline
  is one per process: a `batch` manifest task cannot carry `timeout` (`E_USAGE`) — pass it to
  `batch` itself.
- **`--progress`** (global, or `ZIPNATIVE_PROGRESS=1`): the engine's `onProgress` snapshots on
  stderr where the engine measures them (`create --stream` / `--stdin-name` / `--parallel`,
  `extract` without `--buffered`, `stream`, `cat`) — one throttled text line, or NDJSON
  `{"type":"progress",…}` under `--json`; off under `--quiet`; stdout is never touched.
- **`inspect`** measures determinism with `analyzeDeterminism()`: `deterministic` keeps its
  1.0.0 meaning, and the block adds `canonicalExtras`, `canonicalVersionMadeBy`,
  `canonicalForm` and `offenders[{ name, concern }]`; **`--check canonical-form`** asserts the
  engine's full verdict. `--summary` carries `canonicalForm`.
- **`--long` rows** add `timestamps { mtime, atime, ctime, source }` (UT `0x5455`, NTFS
  `0x000a` or DOS) and `unixIds { uid, gid }` (`0x7875`), read through
  `getExtendedTimestamps()` / `getUnixIds()`.
- **`stream --codec`**: methods registered by a `--codec` module are decoded through the
  codec's `createDecompressor()`; a codec without one is refused before the first byte
  (`ZIP_UNSUPPORTED_CODEC_MODE`), or skipped with `--skip-unsupported`.
- **`ZIP_TIMESTAMP_CLAMPED`**, the 12th diagnostic: a date outside the DOS range is clamped by
  the engine (before 1980 → 1980-01-01) and reported; `--strict` refuses it. The CLI's own
  range warning is gone (the engine reports it).
- **`maxEntryCompressedSize`** is reported by `doctor` and `schema limits`, deliberately
  without a flag: only `openZipRange()` consults it, and no 1.1.0 command opens a range reader
  ([ADR 0007](docs/adr/0007-no-flag-without-an-effect.md)).
- **Seeded fuzzing of the CLI-owned parsers** (`tests/fuzz/`, ROADMAP A-25,
  [ADR 0010](docs/adr/0010-seeded-fuzzing-of-cli-parsers.md)): argv and the invocation
  contract, sizes / counts / durations, globs, `--fields`, `batch` manifests,
  `.zipnativerc.json`, `--name-encoding` labels and the terminal escaper; invariant: return or
  `CliError`, never `E_RUNTIME`. `FUZZ_SEED` / `FUZZ_RUNS` widen a campaign.
- **Documentation integrity tests**: every relative link and `#anchor` in a tracked Markdown
  file resolves, no tracked text file is stored with CRLF, and the fixture ledger records and
  checks the SHA-256 of each committed archive.
- **`scripts/sync-engine-data.mjs`** (`npm run sync:engine`, `--check` in CI): re-derives the
  engine half of `docs/data/errors.json` and `docs/data/core-exports.json` from a zipnative
  checkout, and the CLI mapping from the built CLI.
- Ten **ADRs** under [docs/adr/](docs/adr/README.md), pinned to the code by a consistency test.

### Changed

- **`batch` directory mode declares every `create` flag it forwards** (`--include`,
  `--exclude`, `--dir-entries`, `--store-ext`, `--mtime`, `--stream`, `--zip64`, `--parallel`,
  …), so strict invocation accepts them and the shells complete them.
- **A manifest `comment-file`** resolves against the manifest directory and is refused on
  `..`, like the other path flags of a manifest task (1.0.0 resolved it against the current
  directory).
- **Engine compensations removed** now that 1.1.0 answers them: the zlib-error translation
  (`ZLIB_TO_ZIP` — every inflate tier raises `ZIP_DEFLATE_CORRUPT` / `ZIP_DEFLATE_TRUNCATED`),
  the hand-rolled skip re-derivation in `verify --entry` and `modify`
  (`EntryVerification.skipped`, the engine's archive rule), and the Unix-mode encoder
  (`externalAttributesFromUnixMode()`, still masked to `0o777`, so setuid / setgid / sticky bits
  are never written).
- **`modify`** cross-checks the local header of an encrypted or stream-only-codec survivor too
  (a mismatch is `E_SECURITY` `ZIP_CD_LFH_MISMATCH`); an unregistered method stays
  `E_UNSUPPORTED` `ZIP_UNSUPPORTED_METHOD`.
- **`verify`**: a skipped entry is never `ok`. An encrypted or stream-only-codec entry whose
  local header matches is counted in `skipped`; an unsupported method fails.
- **DOS dates**: the engine's `dosTimeMode` is deliberately not adopted — the CLI's convention
  is per entry (explicit dates store UTC fields; `--date now` and `--mtime` store local
  wall-clock time), which one archive-wide mode cannot express
  ([ADR 0008](docs/adr/0008-dos-dates-per-entry-convention.md)).
- **Node security floor**: `engines.node` is `^22.17.1 || >=24.4.1` (was `>=22`) — the patch floor of the Windows path-normalisation fixes CVE-2025-23084 and CVE-2025-27210 (device names in `path.join` / `normalize`), which the sink's containment relies on. `doctor`
  reads the range from `package.json` instead of a hard-coded floor and reports `error` below it,
  and the gate's `node-floor` step enforces it. npm `engines` is advisory for installs.
- **Exit after flush**: an exit that follows a stdout or stderr write waits for the stream to
  drain (asynchronous pipes on macOS and Windows could truncate the output).
- **TypeScript and lint**: `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noPropertyAccessFromIndexSignature`, `lib` without `dom`; ESLint adds
  `no-non-null-assertion`, `no-console` and a rule forbidding a `zipnative` import outside the
  core bridge. Coverage thresholds ratcheted to 95 / 91 / 97 / 96 (measured
  96.13 / 92.11 / 98.21 / 96.88).
- **veraZIP** re-ported from zipnative 1.1.0 (`scripts/validate-zip.ts`, commit `1e2ab42`, blob
  `604321f`): the new `WF/DESCRIPTOR-WIDTH` check keys the data-descriptor width on the local
  header's Zip64 extra (APPNOTE 4.3.9.2), a 23-id vocabulary. The corpus gains `create --stream
  --zip64` and a clamped pre-1980 `--date`: **39 archives, 35 PASS, 4 XFAIL**. When an engine
  checkout is present, the vendor test compares the pinned blobs with the upstream files at the
  installed engine's tag.
- `samples/config` demonstrates the presentation-only contract, including a refused planted
  file.

### Fixed

- **A run never ends with exit 0 while an engine call is still pending.** If the event loop
  drains with the command unfinished, the run fails (the deadline's `E_LIMIT` when it fired,
  `E_RUNTIME` otherwise) and the files being written are removed. `stream` does not hand the
  deadline to the engine's forward reader, whose pending entry read did not settle on abort;
  the CLI's own input and write loops enforce it there.
- **`MaxListenersExceededWarning` on large entries** (1.0.0): every backpressure wait of the
  file writer left a `close` listener behind; one listener pair now lives per wait, so
  stderr carries envelopes only.
- **A pipe, FIFO or device read is bounded in memory, not only in bytes**: reads fill 64 KiB
  blocks, so a peer trickling 1-byte reads cannot pin 64 KiB per byte below
  `--max-input-size`.
- **`false` in `.zipnativerc.json` never turns a switch on** (`{"json": false}` printed
  JSON; `{"quiet": false}` silenced the warnings): it only turns off what a broader section
  turned on.
- `--json` after `--` is an operand, not agent mode.
- **Data loss on an early error** (1.0.0): when the engine failed before the deferred exclusive
  open, `cat`, `inflate` and `create` unlinked the output path — which could be a pre-existing
  file the run had refused to overwrite. The write layer now removes only what it created.
- A glob character class with a range out of order (`--include '[h-%]'`) is a usage error
  (exit 2) instead of a RegExp `SyntaxError` surfacing as `E_RUNTIME` (found by the fuzz suite).
- `--constructor x`, `--__proto__ x` and other prototype names no longer crash the parser with
  `E_RUNTIME`; they are `E_USAGE`.
- `--json` is honoured for the refusals raised while argv is parsed (the envelope used to be
  text).
- A literal NUL in `src/utils/diagnostics.ts` made git treat the source as binary;
  `tests/docs/source-hygiene.test.ts` now forbids raw control and bidi characters in every
  tracked text file (Trojan Source, CVE-2021-42574).

### Supply chain

- **Five-job release** ([ADR 0009](docs/adr/0009-release-integrity.md)): `guard` (the tag must
  equal `v<version>`) → `build` (no `id-token`, no cache, the publish gate, pack + SHA-256 /
  SHA-512) → `publish` (behind the `npm-publish` environment, `.nvmrc` only, both digests
  re-checked, an npm client pinned by SHA-512, `npm publish --provenance` through Trusted
  Publishing) → `attest` (the tarball fetched back from the registry and compared, CycloneDX +
  SPDX SBOMs from `npm sbom`, attested and attached to the release; no registry code runs
  next to its signing identity) → `consumer` (read-only: install, `npm audit signatures`, the
  installed bin). `@cyclonedx/cyclonedx-npm` is dropped.
- **One definition of green**: `scripts/gate.mjs` (`--fast`, `--ci`, `--publish`,
  `--require-all`) is what `ci.yml`, `node-current.yml`, `sample-regression.yml` and
  `publish.yml` run, instead of hand-copied steps. It adds a reproducible-build step, a bundle
  probe (engine external, no inlined engine code, no `console.log`, no attribution trailer), a
  frozen tarball file list (`docs/data/package-files.json`, 10 files) and an install smoke test
  of the packed tarball.
- **Every job**: `step-security/harden-runner` first, `npm ci --ignore-scripts`, read-only
  top-level permissions with writes granted per job, `persist-credentials: false`, one SHA per
  action verified against the peeled upstream tag; no path filter on a required check;
  `verazip.yml` no longer interpolates step outputs into `run:` scripts.
- **New workflows**: `audit.yml` (weekly `npm audit` + OSV-Scanner), `dependency-review.yml`
  (high severity, licence allow-list), `node-current.yml` (Node 26, advisory),
  `sample-regression.yml` (`samples/run-all.js` on Linux and Windows) and a `workflow-lint` job
  (zizmor, checksum-verified actionlint, `reuse lint`). CodeQL analyses `actions` and
  `javascript-typescript` with `security-extended`.
- **Repository as code**: `.github/rulesets/{main,tags}.json`, CODEOWNERS widened to the trust
  boundary, `SECURITY-INSIGHTS.yml` (OpenSSF 2.0), `docs/.well-known/security.txt` (RFC 9116),
  `REUSE.toml` + `LICENSES/`, `THIRD-PARTY-NOTICES.md`.
- **Dependabot**: seven-day cooldown, GitHub Actions grouped (the four `codeql-action` steps
  move together), `zipnative` excluded from the dev group, `@types/node` majors ignored (the
  `engines` floor is Node 22).
- **Package**: a tracked `.npmrc` (`ignore-scripts`, `engine-strict`, `audit-level=moderate`),
  `.node-version`, `packageManager`, exact `overrides`, `@eslint/js` declared, no `main`
  entry; the tarball adds `CHANGELOG.md`, `SECURITY.md` and `THIRD-PARTY-NOTICES.md`.
- `npm audit`: the five vulnerable dev-only packages of the 1.0.0 lockfile (`brace-expansion`,
  `source-map-js`, `fast-uri`, `http-cache-semantics`, `ip-address`) are gone; 0
  vulnerabilities.
- CI actions moved to `github/codeql-action` v4.37.9 (all four steps together) and
  `ossf/scorecard-action` v2.4.4; this supersedes Dependabot PRs #1, #3, #4, #5 and #7.
- `typescript-eslint` 8.69.0 → 8.71.1 (the dev half of Dependabot PR #11, whose other half —
  the runtime `zipnative` — is the hand-made bump above).
- AI governance 1.1.0: `ai_attribution_trailers_allowed: false`,
  `configuration_relaxes_checks: false`; opt-in git hooks (`npm run hooks:install`).

### Documentation

- README, AGENTS.md, llms.txt, the knowledge base, SECURITY.md and CONTRIBUTING.md describe the
  1.1.0 surface: the new flags, the presentation-only configuration, strict invocation, the
  `config` envelope field, terminal-safe text, the 12 diagnostics, `offenders`, the release
  integrity chain and how to verify it, and the engine-bump procedure.
- SECURITY.md: 1.1.x supported; 1.0.x receives security fixes until 2027-04-18.
- The `[Unreleased]` entries listed after 1.0.0 shipped in the 1.0.0 tarball; they now sit
  under [1.0.0] ("Release-branch review").

## [1.0.0] – 2026-09-05

Built on **zipnative 1.0.0** — the engine's first stable release, whose 77-export API, 39-code
error vocabulary and `deterministic: true` output bytes are frozen under semver. This is the
first release of the CLI: **15 commands** in four groups over that frozen surface, a thin
dispatch layer with no ZIP parsing of its own, an agent contract that carries the engine's
`ZIP_*` codes verbatim next to 13 stable `E_*` classes, secure-by-default extraction with the
CLI as the proven filesystem trust boundary, and a blocking ISO/IEC 21320-1:2015 conformance
gate (veraZIP) over every archive the CLI writes. Offline in every mode — no command can open a
socket. Zero extra runtime dependencies. Node.js ≥ 22.

The release branch closed with two independent audits (A: CLI/UX/supply chain, B: engine
coverage) arbitrated into 74 accepted findings; the lines tagged `(audit …)` below record what
each one changed. Six findings were deferred to [ROADMAP.md](ROADMAP.md) "Future
Considerations" (A-11, A-25, A-36, B-21, B-39, B-42) and one was rejected (B-44).

### Added

#### Commands

- **`create`** — build a deterministic ZIP from files, directories, stdin (`--stdin-name`) or a
  JSON manifest (`--from-manifest`, schema subject `create-manifest`) through `createZip`:
  canonical entry order, DOS-epoch timestamps and UTF-8 names by default; `--deterministic`
  pins the pure-TS encoder (identical SHA-256 on every runtime, reported as
  `tier: "pure-pinned"`); `--stream` (constant-memory writer: file inputs are streamed
  through `addStream()`, data-descriptor layout, same content as the buffered layout but
  not the same bytes, reported as `layout: "data-descriptor"`; entries > 4 GiB refused with
  `ZIP_UNSUPPORTED_ZIP64_STREAMING`); `--parallel` / `--workers` / `--min-job-size` /
  `--job-timeout` (`createParallelZip` from `zipnative/worker`, loaded lazily with an explicit
  `workerUrl`); `--method`, `--level`, `--order canonical|insertion`, `--date epoch|now|<ISO>`,
  `--mtime`, `--comment` / `--comment-file`, `--entry-comment`, `--preserve-mode`,
  `--store-ext`, `--base`, `--prefix`, `--dir-entries`, `--include` / `--exclude` globs,
  `--follow-symlinks` (symlinks are skipped with a warning by default and never written as
  symlink entries), `--overwrite`, `--dry-run` (the plan). Every entry name is pre-checked with
  the engine's `sanitizeEntryPath()`.
- **`modify`** — incremental edits through `createZipModifier`: `--remove`, `--rename`,
  `--replace`, `--add`, `--add-dir`, `--comment` / `--comment-file`, or `--from-manifest`
  (schema subject `modify-manifest`), applied in a fixed order; untouched entries are never
  recompressed and every re-emitted entry is verified before the save. The default save is
  append-only (original bytes verbatim — removed content remains recoverable, and 7-Zip's CLI
  mis-reads the layout; an `info:` line says so); `--compact` (`saveCompact`) for true
  deletion; `--in-place` (exclusive temp file + rename); `--overwrite`; `--method` / `--level`
  / `--deterministic` / `--date` for new payloads; `--dry-run`.
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
  `--overwrite`, `--dry-run`; the CRC is verified at the end of the stream and a partial
  `--output` file is removed on failure.
- **`extract`** — write entries to `--output-dir` with the engine's guards on by default
  (`extractZipStream`; `--buffered` for `extractZip`): zip-slip / device names, symlinks,
  overlaps, CD/LFH mismatch, duplicate paths and bombs are refused with their `ZIP_*` code.
  Two-phase sink (`src/utils/sink.ts`, shared with `stream`): plan (every destination
  re-proved under the root with `safeJoin`, existing files refused without `--overwrite`,
  case-fold collisions refused on win32 / darwin) then write (realpath containment against
  planted links, exclusive open, backpressure, partial files removed on failure). Opt-outs are
  skip-not-write: `--skip-unsafe`, `--skip-symlinks`, `--allow-symlinks` (target text as a
  regular file — a symlink is never materialised), `--skip-unsupported`, `--on-duplicate
  error|first|last`; `--include` / `--exclude` / `--entry`, `--flat`, `--preserve-mode` (never
  setuid/setgid/sticky), `--preserve-mtime`, `--dry-run`.
- **`stream`** — forward-only reader for unseekable input via `iterateZipEntries`: `--list`
  (default; text | json | ndjson, rows emitted as entries arrive), `--output-dir`
  (`sanitizeEntryPath` + the shared sink on every name), `--cat`; `--long`, `--skip-unsafe`,
  `--skip-unsupported`, `--overwrite`, `--on-duplicate`, `--flat`, `--preserve-mtime`,
  `--dry-run`. The trust caveat is explicit: `--preserve-mode` / `--allow-symlinks` /
  `--skip-symlinks` are refused (attributes live only in the central directory), every JSON
  output carries `trust: "local-headers-only"`, and a `warning:` line is printed at start.
- **`verify`** — one-call deep verification via `verifyZip`: the engine's
  `ZipVerificationReport` plus `failed` / `skipped` / `strict`; `--entry` (repeatable) verifies
  named entries through `verifyEntry`; encrypted entries are honestly `skipped`; exit 1 /
  `E_VERIFY_FAILED` with `zipCode = report.error.code` for structural refusals; `--strict` also
  fails on any diagnostic; `--summary`, `--fields`.
- **`crc32`** — CRC-32 of files or stdin in 64 KiB chunks through the engine's incremental
  `crc32()`; `--seed`, `--expect` (exit 1 / `E_CHECK_FAILED` with
  `detail: { expectedCrc, actualCrc }`), `--format text|json`.
- **`inflate`** — raw DEFLATE (RFC 1951) or registered-codec decoder with a **mandatory**
  output bound (`--max-output`, default = the effective `--max-entry-size`): the resumable
  `createInflator` fed chunk by chunk (constant memory, trailing bytes reported as
  `leftover`, consumed bytes as `bytesConsumed`), `--sync`, `--method deflate|store|<id>`,
  `--allow-trailing`, `--overwrite`, `--dry-run`.
- **`batch`** — directory mode (`--task create`: every subdirectory through the full `create`
  command with a bounded `--concurrency` pool (1–64); `--task verify`: every `*.zip` verified;
  `--fail-fast`, `--overwrite`) and manifest mode (`--manifest tasks.json`, schema subject
  `batch-manifest`): a strictly pre-validated, sequential, fail-fast pipeline of 10
  whitelisted manifest commands with `"@<id>"` output references, `--continue-on-error`, and a
  codec-load policy (`--allow-codec-load` required for any `codec` task flag). Manifests are
  size-capped (50 MB), bounded to 1 000 tasks, and their path values go through the `..`
  check (`validatePath`) that argv paths do not need. Under `--json` stdout is one batch
  document. `--summary`, `--fields`, `--dry-run`.
- **`doctor`** — offline environment / capability preflight: CLI, Node (≥ 22), zipnative
  (package version vs the engine's `VERSION` export), `deflate-tier` (`node-zlib` expected),
  `deflate-pinned` (the `--deterministic` tier), `web-streams`, `workers` (`create
  --parallel`), `codecs`, the effective `limits` (as numbers under `--json`), and the command
  count; text or `--format json`; exit 0/1.
- **`schema`** — 22 versioned JSON Schema subjects (Draft 2020-12, `$id` embeds the CLI
  version): `create-manifest`, `modify-manifest`, `batch-manifest`, `entries`,
  `entries-summary`, `inspect`, `inspect-summary`, `verify`, `verify-summary`, `stream`,
  `stream-summary`, `batch`, `batch-summary`, `doctor`, `govern-verify`, `crc32`, `status`,
  `error`, `errors` (the `E_*` codes, the 39-entry `ZIP_*` → `E_*` map and the diagnostic
  codes), `limits`, `diagnostics`, and the capability `manifest`.
- **`completion`** — `bash`, `zsh`, `fish` and `powershell` scripts generated from the
  `COMMANDS` table (the single source of truth shared with `schema manifest` and `doctor`);
  path flags complete files.
- **`govern`** — the zipnative ecosystem's AI-governance / Human-in-the-Loop contract:
  `govern rules`, `govern policy`, `govern verify-issue <draft.md>` (exit 1 / `E_POLICY` on a
  runtime-dependency proposal or a missing reproduction block; anti-goal proposals and
  missing recommended fields are warnings). Fully offline; pinned to the `.github` files by a
  test.

#### Global options

- **`--json`** (agent mode), **`--pretty`**, **`--dry-run`** (7 commands), **`--strict`** (the
  first engine diagnostic → `ZIP_STRICT_DIAGNOSTIC` → `E_CHECK_FAILED` before any output
  byte), **`--quiet`** / `-q`, **`--no-color`** (+ `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`),
  **`--config <file>`** / **`--no-config`** (`.zipnativerc.json`, discovered cwd-upward,
  global + per-command sections, flags win, 1 MB cap), **`--version --json`**
  (`{ name, version, zipnative }`), **`--format, -f`** on every command that has a format.
  Global flags may be placed before or after the command name.
- **Eight `--max-*` security bounds** mapping one-to-one onto the engine's CWE-tagged
  `ZipLimits` (`--max-entries`, `--max-entry-size`, `--max-total-size`, `--max-ratio`,
  `--max-name-bytes`, `--max-extra-bytes`, `--max-comment-bytes`, `--max-cd-bytes`) with the
  engine's defaults (100000 / 1 GiB / 8 GiB / 1024:1 / 4096 / 65535 / 65535 / 256 MiB), a
  `<size>` grammar (`512k`, `1m`, `8g`, `1GiB`), and `none` to disable a bound with a visible
  warning; values are pre-validated so `ZIP_LIMIT_INVALID` is unreachable from the CLI.
- **`--max-input-size <size>`** — the CLI-owned bound on every buffered read (stdin and
  files; default 4 GiB; `none` disables with a warning); `E_LIMIT` with
  `detail { limit: "maxInputSize", configured, observed }`. Streaming commands are not bounded
  by it (audit A-16).
- **`--pure-codecs`** (skip `node:zlib`, run the pure-TS tier) and **`--codec <module>`** (load
  an ESM module exporting `{ codecs: ZipCodec[] }` and optional `inflateImpl` / `deflateImpl`;
  the CLI's only dynamic import of user code — argv only, refused from config
  files, refused inside manifests without `--allow-codec-load`; a module that registers
  method 0 / 8 or exports `deflateImpl` also shapes the writer and is reported as such).

#### Agent surface

- **`--json` envelopes** — on failure a single stderr line
  `{ ok: false, command, error: { code, message, zipCode?, entryName?, detail? } }`; on
  success a status line for `create` / `modify` / `extract` / `stream` / `cat` / `inflate` /
  `crc32` carrying command-specific facts (`bytes`, `entries`, `skipped`, `tier`, `layout`,
  `trust`, `verified`, …) and the engine's `diagnostics[]`.
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
  the npm package together with `AGENTS.md` and `docs/data/errors.json`.
  [`docs/data/core-exports.json`](docs/data/core-exports.json) lists the
  77 engine exports and [`docs/data/errors.json`](docs/data/errors.json) the 39 + 11 codes
  with `raisedWhen` / `remedy` and the CLI mapping per code; `docs/KNOWLEDGE_BASE.md` §8 maps
  every export to a CLI touchpoint and `tests/docs/consistency.test.ts` pins the docs to the
  code.
- **[AGENTS.md](AGENTS.md)** documents the full contract, the recommended agent loop
  (`doctor` → `inspect --summary` → `extract --dry-run` → `extract` → branch on
  `code` / `zipCode`), and the safety notes for unattended use.

#### Conformance gate (veraZIP)

- **`npm run validate:zip`** — build, `npm run corpus:zip` (`scripts/generate-zip-corpus.mjs`
  drives the **built** CLI plus an engine-independent raw builder to write a 37-archive corpus
  to `test-output/zip/` with a manifest), then `scripts/validate-zip.mjs` — the ISO/IEC
  21320-1:2015 validator **vendored from zipnative** (`scripts/validate-zip.ts`, commit
  `4f1bc36`) — raw-parses every archive with its own EOCD / central-directory / local-header
  reader and never imports the engine. 33 conformant archives cover every writer path
  (buffered, `--stream`, `--parallel`, `--deterministic`, `modify` append-only and
  `--compact`, manifests with `extraFields`, binary comments, `--order insertion`, `batch`),
  including 3 **hostile-but-conformant** archives (zip-slip, a Windows device name, duplicate
  paths) that PASS the ISO profile and that `extract` must **refuse** — both facts are checked;
  4 **raw-crafted negative canaries** (`WF/ENTRY-OVERLAP`, `WF/CD-COUNT`,
  `WF/LFH-SIZE-MISMATCH`, `WF/LFH-NAME-MISMATCH`) must be rejected with their declared check id
  (an unexpected pass, XPASS, is fatal), and a coverage canary fails the run if any required
  check id has no canary or a manifest file is missing. Expected verdict: 33 PASS, 4 XFAIL.
- **Levels and outcomes** — level 0 (ISO clauses + APPNOTE well-formedness cross-checks)
  needs no external tool and always runs; level 1 re-tests every conformant archive with the
  foreign integrity tools present on the machine (`bsdtar`, `unzip`, `7z`, `python -m
  zipfile`, `jar` — `scripts/helpers/interop-tools.mjs`, vendored from the engine's
  `tests/helpers/interop-tools.ts`) and SKIPs absent tools visibly; `VERAZIP_REQUIRED=1`
  fails closed (exit 3 INFRA) when no level-1 tool is usable. Outcomes PASS / FAIL / XFAIL /
  XPASS / INFRA per file; exit 0 ok/skip · 1 conformance · 2 no corpus · 3 infra;
  `VERAZIP_REPORT_DIR`, `VERAZIP_TOOLS` knobs. Per-file JSON reports and a `summary.json`.
- **Blocking in CI** — `.github/workflows/verazip.yml` on Linux and Windows with
  `VERAZIP_REQUIRED=1` on every push and PR (no path filter), and again as a pre-publish gate
  in `publish.yml`. No dependency added — the validator is a script, the foreign tools are
  external.

#### Governance & supply chain

- **Workflows** — `ci.yml` (typecheck, lint, tests with coverage thresholds 93 / 88 / 94 /
  93, build and built-binary smoke on Ubuntu Node 22 + 24, Windows Node 22 + 24 (blocking)
  and macOS Node 22; documentation changes run the suite), `verazip.yml`, `publish.yml` (the
  full gate again, npm Trusted Publishing / OIDC with provenance attestations, a CycloneDX
  SBOM attested with `actions/attest-build-provenance` and attached to the GitHub Release, the
  packed tarball verified before publish), `codeql.yml`, `scorecard.yml`, Dependabot.
- **AI-governance / HITL** — `.github/ai-governance.json`, `.github/AGENT_RULES.md` and
  `.github/drafts/README.md`, mirrored by the `govern` command and pinned by
  `tests/utils/governance-sync.test.ts`; `CLAUDE.md` for Claude Code contributors;
  `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, `CITATION.cff`,
  `.github/ISSUE_TEMPLATE/config.yml` (blank issues disabled, security and engine links).
- **Tests** — in-process vitest suites (stdout / stderr captured) for every command and
  util, an engine-independent raw ZIP builder for adversarial shapes (never committed — see
  `tests/fixtures/README.md`), two foreign-provenance interop fixtures, one spawn smoke test
  against the built binary, and `tests/docs/consistency.test.ts`. 1202 tests across
  61 files (1193 passed + 9 platform-conditional skips; statements 96.32 %, branches 92.52 %,
  functions 97.93 %, lines 96.91 %).
- **Package** — the CJS bin only (`dist/cli.cjs`; no ESM build, no `.d.ts`, no source maps):
  7 files, 120.0 kB packed.
- **Samples** — 41 dual-shell demos (`.sh` + `.ps1`) under `samples/`, plus `samples/agent/`
  and `samples/run-all.js` (73 jobs); every sample runs offline.

#### Added by the audit pass

- `--max-input-size` global bound on buffered reads (audit A-16); the `maxInputSize` key in
  `schema manifest` limits and in `doctor`'s `limits.data`.
- `create --order insertion` writes the argv order (directories still name-sorted; manifests
  keep their entries order), so an EPUB `mimetype` listed first is written first (audit B-04).
- Manifest `extraFields: [{ id, hex | base64 }]` on `create` entries and `modify`
  add / replace / add-dir edits → `AddEntryOptions.extraFields` (audit B-01).
- `--comment-file <path>` on `create` and `modify` and manifest `commentBase64` — raw archive
  comment bytes through `setComment(Uint8Array)` (audit B-05).
- `modify` manifest edits accept `mode` (octal string), like the `create` manifest (audit B-06).
- `commentHex` on `list --format json` / `inspect` `archive` whenever the archive has a
  comment, and per entry under `--long` (audit B-14).
- `verify --entry, -e <name>` (repeatable): per-entry `verifyEntry()`, `selected` in the
  report and the summary, `E_NOT_FOUND` / `ZIP_ENTRY_NOT_FOUND` for an unknown name (audit B-15).
- `extract --skip-unsupported`: encrypted entries and unregistered methods are skipped with
  reason `unsupported` instead of aborting (audit B-16).
- `rawNameHex` on every `--long` row (`list`, `inspect --entries`, `stream --long`) so an
  invalid-UTF-8 name stays recoverable (audit B-18).
- `inflate` envelope `bytesConsumed` (the inflator's exact figure on the streaming path)
  (audit B-43).
- `modify` envelope `tier` (audit B-33), `verified`, `verifySkipped` (audit B-03).
- `doctor` `limits` check carries `data { …ZipLimits, maxInputSize }` as numbers (`"none"`
  when disabled) (audit A-30).
- `stream --summary` reports `descriptorEntries` and `bytesKnown` — data-descriptor local
  headers carry zero sizes and the summary says so instead of pretending (audit B-19, A-46).
- `SIGINT` / `SIGTERM` handling: the in-flight output file is removed (never a completed one,
  never the original of `--in-place`) and the process exits 130 / 143 (audit A-38).
- `create --chunk-size` is accepted with `--stdin-name` (the chunked writer) (audit B-32).
- `create` envelope `layout: "buffered" | "data-descriptor"`; `inspect` `determinism` gains
  `canonicalLayout` and `--check canonical-layout` (alias of `no-data-descriptor`).
- `tests/utils/governance-sync.test.ts` pins `govern policy` / `govern rules` to
  `.github/ai-governance.json` and `.github/AGENT_RULES.md` (audit A-10).
- `tests/docs/consistency.test.ts` gains the relations that would have caught the drift found
  by the audits: CITATION version, `status` command enum vs `emitStatus` callers, USAGE flags
  vs `COMMANDS`, README / KB tables vs `COMMANDS`, environment variables and exit codes in the
  global USAGE, `raisedBy` per diagnostic, tarball paths in `llms.txt` (audit A-28).
- `.github/ISSUE_TEMPLATE/config.yml` — blank issues disabled, links to private vulnerability
  reporting, the ecosystem Discussions and the engine tracker (audit A-45).
- Two human-submittable upstream drafts for the engine (local, under `.github/drafts/`): DOS
  time encoded from local getters (audit A-02) and `stream` custom-method entries pumped
  through the inflater (audit B-20).

### Changed

- `inspect`'s determinism verdict separates **reproducibility** (`deterministic` = epoch
  timestamps + canonical order + UTF-8 flags) from **form** (`canonicalLayout` = no data
  descriptors): a `create --stream` archive is reproducible run-to-run and no longer fails
  `--check deterministic`; the text verdict reads "reproducible, layout canonical" or
  "… layout data-descriptor (streamed)".
- Unknown commands and flags without a command are usage errors: exit 2 / `E_USAGE` (was
  exit 1 / `E_RUNTIME`) (audit A-29).
- `--help` polish: every USAGE line ≤ 80 columns, `--format, -f` documented on every command
  that has a format, combined short flags (`-lq`) refused with a clear `E_USAGE`, a dash-digit
  token (`--level -1`) is always a value; there is no `-l` alias for `--long` (audit A-37).
- ISO dates are **UTC wall-clock**: `--date <ISO>` and manifest `date` values without a zone
  designator are read as UTC and the stored DOS fields are identical on every host; `now` and
  `--mtime` stay local. Years outside 1980–2107, odd seconds and a `--chunk-size` outside
  1 KiB..16 MiB emit a warning instead of being clamped silently (audit B-31).
- **Argv paths are the user's own filesystem authority**: `zipnative list ../a.zip`,
  `-o ../out.zip`, `--output-dir ../x` are no longer refused; `validatePath()` (`E_INPUT`
  "Path traversal detected") applies to path values that arrive as data — `batch` manifest
  path flags and `create` / `modify` manifest `path` values. Entry names always go through
  `sanitizeEntryPath()` (audit A-09).
- **Uniform overwrite policy**: `create -o`, `modify -o`, `cat -o`, `inflate -o` and
  `batch --task create` refuse an existing file with `E_IO` ("Refusing to overwrite existing
  file <path> (pass --overwrite)") and leave it intact, like the extraction sink; `--overwrite`
  replaces it; stdout output is unaffected (audit A-14).
- `extract` and `stream --output-dir` share one sink module (`src/utils/sink.ts`); the
  case-insensitive-filesystem rule lives there only (audit A-22).
- `modify` opens the archive eagerly and verifies every entry it re-emits (see Security);
  the cost is one decompress pass over untouched entries, never a recompress (audit B-03).
- The codec statement is honest everywhere: a `--codec` module that registers method 0 / 8
  replaces the writer's compressor for `create` / `modify` (also under `--deterministic`); a
  `deflateImpl` replaces the sync tier unless `--deterministic`; the former "reader-only"
  claim is gone from every document and `LoadedCodecModule.overridesBuiltin` lists the
  writer-resolved methods (audit B-07, B-41).
- `batch --manifest` under `--json`: stdout is **one** batch document — each task runs under
  a 64 MiB stdout capture and its output lands in `tasks[i].report` (parsed JSON, or an array
  for NDJSON), `tasks[i].stdout` and `tasks[i].stdoutBytes`; a task that would write its
  artefact to stdout (`create` / `modify` / `cat` / `inflate` without `output`, `stream --cat`)
  is refused at validation (`E_USAGE`, also under `--dry-run`). Text mode keeps the
  interleaved contract (audit A-05).
- Unsafe entry **names** are data, not usage: `modify --add` / `--rename` / `--add-dir` and
  `create --stdin-name` refuse them with `E_INPUT` (exit 1) carrying `entryName`, like the
  walker and the manifests (audit A-21); `modify --add "dir/=payload"` is `E_INPUT` pointing at
  `--add-dir` instead of `ZIP_INVALID_OPTION` → `E_USAGE` (audit B-36).
- `unixMode` is always four octal digits (`"0000"`, `"0644"`, `"4755"`) (audit B-37).
- Every refusal names the next action — `--skip-unsafe`, `--add-dir`, `--dry-run`,
  `zipnative list <archive>`, the directory-mode rules, `--on-duplicate first|last` — since
  agents branch on `code`, never on `message` (audit A-23).
- Dead exports removed (`die`, `ensureDir`, `parentDir`, `entryBasename`, `guardAsync`,
  `LIMIT_DEFAULTS`) with their tests; `deprecate` and `getBoolFlag` stay (audit A-31).
- `batch --concurrency` is parsed as a positive integer and capped at 64; the remaining
  dynamic imports in `create` / `modify` / `extract` are static; the tsup banner comment is
  correct (audit A-43).
- `ci.yml` no longer ignores `**.md` / `docs/**` (the docs are pinned by tests); only
  `LICENSE`, `.editorconfig`, `.gitignore`, `.github/FUNDING.yml` and
  `.github/ISSUE_TEMPLATE/**` are ignored; `verazip.yml` has no `paths:` filter so it can be a
  required check (audit A-04).
- CI matrix: a macOS job (Node 22 — the second case-insensitive filesystem the sink handles)
  and Windows on Node 22 **and** 24 (audit A-27).
- Coverage thresholds ratcheted from 85 / 75 / 85 / 85 to 93 / 88 / 94 / 93 (audit A-33).
- `package.json` is bin-only: `module`, `types` and `sideEffects` removed, `files` ships
  `AGENTS.md` and `docs/data/errors.json` (so every relative path in `llms.txt` resolves in the
  tarball — audit A-19) and excludes `*.map`; `tsup` emits `dist/cli.cjs` only (no ESM build,
  no `.d.ts`, no source maps); `repository.url` is `git+https://…` (audit A-42).
- `npm run lint` covers `tests/` (relaxed test-ergonomics override); the `dom` lib entry in
  `tsconfig.json` is annotated (`CompressionStream` / `TextDecoder` types);
  `noUncheckedIndexedAccess` is deferred to the roadmap (audit A-44).

### Fixed

- Boolean flags no longer swallow the next token: `src/utils/flags.ts` is the boolean-flag
  table, so `zipnative --json list a.zip` dispatches and `list --long a.zip` keeps its
  positional; flags and positionals are order-independent; `--flag=false|0|no|off` is the
  explicit off form (audit A-01).
- `EPIPE` on stdout / stderr (a downstream `| head` closing the pipe) ends the run quietly
  with exit 0 instead of an unhandled `'error'` event, a stack trace and exit 1 (audit A-03).
- A read command with no input on an interactive terminal is refused (`E_USAGE`, "No input:
  pass --input <file> (or a positional path), or pipe data on stdin.") instead of blocking
  forever; an explicit `-` still reads stdin (audit A-08).
- `create --deterministic --date <instant>` bytes no longer depend on the host time zone
  (24576 vs 28672 `dosTime` for the same instant under `TZ=UTC` / `Europe/Paris`); every ISO
  date is normalised to its UTC components before the engine encodes it (audit A-02).
- `create --parallel` refuses (exit 2) a `--codec` module registering method 0 / 8, and a
  `deflateImpl` without `--deterministic`: the worker pool never sees the module and the
  envelope previously reported `tier: "injected"` while the workers compressed with
  `node:zlib`; under `--parallel` the tier is `node-zlib` or `pure-pinned`, never `injected`
  (audit B-02).
- `cat` falls back to `readEntry()` (one entry buffered) for a `--codec` method that has
  `decompressSync` but no `decompressStream` (was `ZIP_UNSUPPORTED_CODEC_MODE`, while
  `extract --buffered` could read it) (audit B-17).
- `create --dry-run` / `extract --dry-run` print no text plan when agent mode comes from
  `ZIPNATIVE_JSON` (was: the plan on stdout **and** the envelope on stderr) (audit A-12).
- Colours are decided on **stderr** (the only stream that carries them): `NO_COLOR` off,
  `FORCE_COLOR` on, `TERM=dumb` off, otherwise on only when stderr is a TTY (audit A-13).
- A forward-read failure before the first header no longer carries an empty `entryName`
  (audit B-29).
- Every CLI-side `E_NOT_FOUND` (`cat`, `inspect --entry`, `stream --cat`, `verify --entry`)
  carries `zipCode: "ZIP_ENTRY_NOT_FOUND"` and names the remedy (audit B-40).
- `govern policy` deep-equals `.github/ai-governance.json` (`spec_updated`,
  `compliance_report.description`, `capability_manifest`, `verification.advisory_in_ci`,
  `references` were missing) and every rule line of `govern rules` appears verbatim in
  `.github/AGENT_RULES.md` (audit A-10).
- Completions: path flags (`--input`, `--output`, `--output-dir`, `--input-dir`, `--base`,
  `--from-manifest`, `--manifest`, `--config`, `--codec`, `--comment-file`) complete files in
  bash (`_filedir` / `compgen -f`), zsh (`_files`) and fish (`-r -F`); every other value flag
  is fish `-r`; booleans take nothing (audit A-40).
- `publish.yml` hygiene: the release tag reaches the shell through the environment (never
  interpolated into `run:`), the top-level `id-token: write` is gone (the job requests
  `id-token` / `contents` / `attestations`), and the SBOM is attested with a SHA-pinned
  `actions/attest-build-provenance` (audit A-41).

### Security

- **Physical sink containment** — before `mkdir -p` the nearest existing ancestor of an
  extraction target is `realpath`'d under the root's `realpath`, and the created directory is
  re-checked after: a symlink or junction planted inside `--output-dir` that points outside is
  refused with `E_SECURITY` and nothing is created beyond the link (previously the check was
  lexical only and such a link redirected the write). The residual realpath → open window is
  documented in SECURITY.md ("use an empty or trusted destination") (audit A-06).
- **Exclusive opens** — every file the CLI writes is opened with `wx` unless `--overwrite`, so
  a file that appears between the plan and the write is refused like any pre-existing one (no
  check-then-write window); `modify --in-place` writes to an unpredictable, exclusively
  created temp file `<input>.tmp-<pid>-<12 hex>` instead of `.tmp-<pid>` (audit A-07).
- **`modify` verifies what it re-emits** — eager open (overlap / CD↔LFH structure before any
  edit) and `reader.verifyEntry()` on every entry not removed or replaced before `save()` /
  `saveCompact()`: `!localHeaderMatch` → `E_SECURITY` `ZIP_CD_LFH_MISMATCH`, `!crcMatch` →
  `E_DATA` `ZIP_CRC_MISMATCH`, `!sizeMatch` → `E_DATA` `ZIP_SIZE_MISMATCH`, each with
  `entryName`; encrypted and stream-only-codec entries are copied as-is and counted in
  `verifySkipped`; an unregistered method is `E_UNSUPPORTED`. Runs under `--dry-run` too; no
  opt-out. Previously append-only `save()` re-emitted hostile untouched records verbatim
  (overlap, CD/LFH method mismatch, CRC lie) with exit 0 (audit B-03).
- **Bounded buffering** — `--max-input-size` (4 GiB default) closes the unbounded stdin / file
  buffering of the random-access commands (audit A-16); the threat-model rows for buffering,
  planted links and the check-then-write window are recorded in SECURITY.md and the knowledge
  base §6 (audit A-26).
- **Honest codec posture** — a `--codec` module that shapes the writer is announced
  (`warning:` line, `tier`), and `create --parallel` refuses it instead of reporting a tier the
  workers did not use (audit B-02, B-07).
- **Supply chain** — the SBOM is attested (`actions/attest-build-provenance`) and the packed
  tarball is verified (bin, `AGENTS.md`, `llms.txt`, `docs/data/errors.json`; no maps, no
  tests) before `npm publish --provenance`; every action stays SHA-pinned (audit A-41, A-42).

### Release-branch review

The review pass that closed the release branch. These entries were listed under
[Unreleased] until 1.1.0, but they shipped in the 1.0.0 tarball.

#### Added

- **`error.remedy`** in the `--json` error envelope (and a `remedy:` line in text mode): the
  CLI flag(s) or command that lift a refusal — `--skip-unsafe (extract, stream)`,
  `--on-duplicate first|last`, `--overwrite`, the exact `--max-*` flag of an exceeded bound,
  `--skip-unsupported`, `zipnative list` … — computed from one `ZIP_REMEDY` table and mirrored
  in `schema error`, `schema errors` and `docs/data/errors.json` (`cli.remedy`). The engine
  message stays verbatim (it names library options, not flags). (review Q2-F2)

- **`inspect --check safe-names`** and `stats.unsafeNames`: every entry name must pass the
  engine's `sanitizeEntryPath()` — the pre-extraction gate `verify` cannot give (it proves
  integrity and structure, not path safety; its help and the docs now say so). (review Q2-F3)

#### Changed

- ESLint runs the type-aware `strictTypeChecked` set over `src/` (`no-floating-promises`,
  `no-misused-promises`, `no-unnecessary-condition`, …; three relaxations justified in
  `eslint.config.js`, tests keep the non-type-checked strict set) and `tsconfig.json` enables
  `noUncheckedIndexedAccess`. No behaviour change. (review Q4-P1-3, audit A-44)

#### Supply chain

- The CycloneDX generator is an exact-pinned devDependency (`@cyclonedx/cyclonedx-npm` 6.0.1,
  installed from the lockfile) instead of an unpinned `npx --yes …@^1` fetched inside the
  publish job — the old range also declared `engines.npm: 6 - 9`, incompatible with the npm ≥ 11
  Trusted Publishing requires. (review Q4-P0-2)
- The published tarball is attested with `actions/attest-build-provenance` (next to the SBOM),
  attached to the release with its SHA-256, and `npm publish` ships that packed file. (P1-1)
- CI proves the bundle is byte-reproducible (two builds, one hash), audits at
  `--audit-level=moderate`, checks Conventional Commits on PRs (dependency-free job), and runs
  a start-up guard (the worker bundle is reachable only through the lazy `import()`, the engine
  is the single hoisted external; overhead over bare Node under 250 ms). (P1-2, P1-8, P2-5, P2-6)

#### Documentation

- Two more upstream engine asks drafted for human filing (HITL): the node-zlib inflate tier
  leaking raw `Z_DATA_ERROR` / `Z_BUF_ERROR` instead of `ZIP_DEFLATE_*`, and `verifyEntry()`
  not reporting the `skipped` reason — both pass `govern verify-issue`. (review Q3)
- `.github/drafts/` is now git-ignored except its `README.md` and a `TEMPLATE.md` whose
  sections match what `govern verify-issue` and the compliance report expect — the same rule
  as the engine repository; the four drafts written so far are local files until filed.

- Agent docs (AGENTS.md, llms.txt, README, knowledge base): the two rules an unattended caller
  must encode — hermetic invocation (`--no-config` / `--config`; `.zipnativerc.json` is
  discovered cwd-upward) and line-by-line stderr parsing (the envelope is the last `{` line).
  (review Q2-F4)
- CONTRIBUTING: "Versioning, stability and deprecation" (the public surface, the semver rules,
  the `deprecate()` ladder) with a README summary; the branch-protection paragraph names
  secret scanning / push protection; npm requirements and the deliberate absence of
  `packageManager`. README: the locale stance (English, locale-independent output).

#### Fixed

- `--quiet` now also silences the text diagnostics that `list --format ndjson` and
  `stream --list` print on stderr under `--json` (they went through `process.stderr` directly);
  one `formatDiagnosticLine()` renders every stderr diagnostic. (review Q2-F1)
- The bridge rule is pinned by a test: no `src/` file outside `core-bridge` references the
  `zipnative` package, except the `zipnative/package.json` metadata probe in `version.ts`
  (kept out of the bridge so `--version` never loads the engine). (review Q3)

[Unreleased]: https://github.com/Nizoka/zipnative-cli/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Nizoka/zipnative-cli/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Nizoka/zipnative-cli/releases/tag/v1.0.0
