---
description: "Use when implementing or modifying any command (create, modify, list, inspect, cat, extract, stream, verify, crc32, inflate, batch, doctor, schema, completion, govern). Covers flag conventions, stdin/stdout, the extraction sink, error mapping, projection, governance, and error contracts."
applyTo: "src/commands/**"
---
# Command Implementation

> Shared conventions and security constraints are in `.github/copilot-instructions.md`
> (Command Conventions + Security Constraints). This file only adds per-command deltas.

## Shared

- Signature: `export async function <name>(args: ParsedArgs): Promise<void>`.
- First statement of every core-touching command: `await prepareEngine(args);`.
- `--input` omitted → stdin; `--output` omitted → stdout (binary via `process.stdout.write`).
- Usage error → `CliError(msg, 2)`; runtime error → `CliError(msg, 1)`. Never swallow errors.
- Every core call goes through `mapZipError(e, 'Failed to …')` or `guard(...)` — never read
  `err.code` in a command.
- `validatePath` (the `..` refusal) applies to MANIFEST-supplied values only (`batch` task
  paths, `create` / `modify` manifest `path`); argv paths are the user's own and are never
  second-guessed. Entry names always go through the core's `sanitizeEntryPath()`.
- Single-file writers (`create`, `modify`, `cat`, `inflate` with `--output`) refuse an existing
  file with `E_IO` unless `--overwrite` (exclusive `wx` open through `utils/io.ts`); a file
  being written is registered in `utils/inflight.ts` so a signal removes it, never a finished
  output.
- Every buffered read goes through the `--max-input-size`-bounded helpers in `utils/io.ts`;
  never route a streaming path (`stream`, `crc32`, `inflate`, `create --stream`) through them.
- No ZIP parsing in a command: no magic numbers, no header offsets, no manual CRC. If the
  core lacks the primitive, the feature waits for the core.

## Agent contract (cross-cutting)

- **Error codes:** pass a stable `ErrorCode` as the 3rd `CliError` arg (`E_USAGE`/`E_INPUT`/
  `E_PARSE`/`E_IO`/`E_SECURITY`/`E_DATA`/`E_LIMIT`/`E_UNSUPPORTED`/`E_NOT_FOUND`/
  `E_VERIFY_FAILED`/`E_CHECK_FAILED`/`E_POLICY`/`E_RUNTIME`). Omitting it derives `E_USAGE`
  from exit 2, else `E_RUNTIME`. The 4th arg carries `{ zipCode, entryName, detail }`.
- **`--json`:** never write the envelope yourself in the dispatcher path — `index.ts` emits
  the failure envelope. Use `emitStatus({...})` (from `utils/agent.ts`) for success status on
  `create`/`modify`/`extract`/`stream`/`cat`/`inflate`/`crc32` (the `status` schema's
  `command` enum); it is a no-op outside `--json`. stdout stays artifact-only. Spread
  `...sink.field()` so collected diagnostics ride along. `batch`, `list`, `inspect`, `verify`
  and `doctor` emit NO status envelope — their JSON report on stdout is the artefact.
- **`--dry-run`:** read `hasFlag(args.flags, 'dry-run') || isDryRun()`; validate fully, then
  short-circuit before producing/writing output. Supported by `create`/`extract`/`modify`/
  `stream`/`cat`/`inflate`/`batch` (`DRY_RUN_COMMANDS` in `completion.ts`). Gate any text plan
  on `isJsonMode()`, not on the `--json` flag alone (`ZIPNATIVE_JSON` must behave the same).
- **Error classes:** an unsafe entry NAME that arrives as data (`--add`, `--rename`,
  `--add-dir`, `--stdin-name`, manifest names) is `E_INPUT` (exit 1) with `entryName`; a
  malformed flag is `E_USAGE`. Every CLI-side `E_NOT_FOUND` carries
  `zipCode: 'ZIP_ENTRY_NOT_FOUND'` and names the remedy (`zipnative list`).
- **`--strict`:** pass `strict: isStrict()` into the core open options; the core escalates the
  first diagnostic (`ZIP_STRICT_DIAGNOSTIC` → `E_CHECK_FAILED`) before any output byte.
- In `--json` mode, do NOT pre-print a detail to stderr that the envelope already carries.
- **Output projection (`list`/`inspect`/`verify`/`stream`/`batch`):** route the JSON-on-stdout
  branch through `utils/projection.ts`. Order: `out = --summary ? toSummary(full) : full`, then
  `if (--fields) out = selectFields(out, parseFieldList(raw))`, then
  `serializeJson(out, hasFlag('pretty') || !isJsonMode())`. Compact is the default under
  `--json`; `--pretty` opts back in; non-`--json` stays pretty. Keep `--summary` shapes minimal
  and in lock-step with the `*-summary` `schema` subjects.
- **Limits:** `--max-*` flags are parsed once by `utils/limits.ts` and passed as `limits`;
  never re-parse them in a command.

## `create` / `modify`

- `create`: three writers, one plan — buffered `createZip`, `--stream` (`addStream` +
  `stream()`, data-descriptor layout: same content as the buffered layout, different bytes —
  the envelope reports `layout: 'buffered' | 'data-descriptor'`; > 4 GiB entries refused with
  `ZIP_UNSUPPORTED_ZIP64_STREAMING`), `--parallel` (`createParallelZip`, byte-identical per
  tier). Inputs walk through `utils/walk.ts` (symlinks skipped, every name pre-checked with
  `sanitizeEntryPath`; sorted, or `preserveInputOrder` for `--order insertion` = argv order
  with each directory still name-sorted). Determinism defaults are the core's;
  `--deterministic` pins the pure-TS encoder. ISO `--date` / manifest `date` values are UTC
  wall-clock (`parseIsoDateUtc` in `utils/zipops.ts`) so the DOS fields are TZ-independent.
  `--comment-file` (raw bytes) is exclusive with `--comment`. `--from-manifest` shape =
  `schema create-manifest` (incl. `extraFields`, `commentBase64`). `assertCodecModulesHonest`:
  a `--codec` module that registers method 0/8 or exports `deflateImpl` is announced with a
  `warning:` (sequential) and refused under `--parallel` (unless `deflateImpl` +
  `--deterministic`). `--chunk-size` is accepted with `--stream` or `--stdin-name` only.
- `modify`: open with `validate: 'eager'`. Edits apply in the FIXED order remove → rename →
  replace → add / add-dir → comment regardless of argv order. Before `save()` /
  `saveCompact()`, `verifySurvivors` runs `reader.verifyEntry()` on every entry copied
  verbatim (CD/LFH mismatch → `E_SECURITY`, CRC / size lie → `E_DATA`, with `entryName`;
  encrypted / sync-less-codec entries counted in `verifySkipped`) — also under `--dry-run`, no
  opt-out. Default `save()` is append-only (data remanence — print one `info:` line when a
  remove/replace happens); `--compact` → `saveCompact()`. `--in-place` = exclusively created
  `<input>.tmp-<pid>-<hex>` + rename in the same directory. Untouched entries are never
  recompressed. Envelope: `edits`, `layout`, `changed`, `verified`, `verifySkipped`, `tier`.

## `list` / `inspect` / `cat` / `extract` / `stream`

- `list`: `openZip` lazily — nothing decompressed. `--validate eager` cross-checks every local
  header. Rows come from `utils/entryfmt.ts` (`rowFromEntry`), shared with `inspect`/`stream`:
  `--long` rows carry `rawNameHex` (always) and `commentHex` (when present); `unixMode` is four
  octal digits. The JSON `archive` object carries `commentHex` whenever `commentBytes > 0`.
  There is no `-l` alias.
- `inspect`: open EAGERLY. `--check` allow-list lives in one table (deterministic,
  epoch-timestamps, canonical-order, utf8-names, no-data-descriptor / canonical-layout, no-zip64, zip64,
  no-encryption, no-symlinks, no-duplicates, no-diagnostics, store-only, deflate-only,
  `max-entries=N`, `min-entries=N`, `max-uncompressed=<size>`, `max-ratio=N`, `has=<name>`,
  `method=…`). `determinism.deterministic` = epoch + canonical order + UTF-8 flags
  (reproducibility); `determinism.canonicalLayout` = no data descriptors (form) — keep the two
  separate. Print the report FIRST, then exit 1 / `E_CHECK_FAILED`.
- `cat`: `readEntryStream` chunk by chunk; `--raw` → `readEntryRaw` (compressed bytes,
  zero-copy); a codec with `decompressSync` but no `decompressStream` falls back to
  `readEntry()` (one entry buffered). CRC is verified at the END — with `--output` remove the
  partial file on `E_DATA`.
- `extract`: two phases — PLAN (drain the lazy generator, `safeJoin` containment, overwrite
  refusal, case-fold collision refusal on win32/darwin) then WRITE through `utils/sink.ts`
  (realpath containment of the nearest existing ancestor before `mkdir`, exclusive `wx` open
  unless `--overwrite`, backpressure, partial file removed on CRC/size failure). Symlinks are
  never materialised; `--preserve-mode` masks setuid/setgid/sticky. Opt-outs are
  `--skip-unsafe`, `--skip-unsupported` (encrypted / no registered codec → skipped
  `unsupported`), `--allow-symlinks`, `--skip-symlinks`, `--overwrite`, `--on-duplicate` —
  nothing else loosens a default. Skipped reasons: `unsafe-path | symlink | filtered |
  duplicate | unsupported`.
- `stream`: `iterateZipEntries` — local headers only. Refuse `--preserve-mode`,
  `--allow-symlinks`, `--skip-symlinks` with `E_USAGE`; every name written goes through
  `sanitizeEntryPath()` + the same sink as `extract`; print the trust warning (suppressed by
  `--quiet`) and set `trust: "local-headers-only"` in every JSON output. `--summary` =
  `{ entries, bytes, descriptorEntries, bytesKnown, trust }` (data-descriptor rows carry zero
  sizes). A failure before the first header carries no `entryName`.

## `verify` / `crc32` / `inflate`

- `verify`: the report is always the artefact; `ok === false` → `CliError('', 1,
  ErrorCode.VERIFY_FAILED, { zipCode: report.error?.code })`. `--strict` also fails on any
  diagnostic. Encrypted entries are reported `skipped`, never faked as verified. `--entry`
  (repeatable): eager open, then `verifyEntry()` per name — report gains `selected`, `entries`
  lists only those, `entryCount` stays the total; an unknown name is `E_NOT_FOUND` /
  `ZIP_ENTRY_NOT_FOUND` before any output.
- `crc32`: stream 64 KiB chunks through the core's incremental `crc32()`; `--expect` mismatch
  → `E_CHECK_FAILED` (reported once); `--seed` continues a running checksum. Emits a status
  envelope (`{ files, bytes, expect?, matched? }`) under `--json`; the report stays on stdout.
- `inflate`: `createInflator(maxOutput)` fed chunk by chunk (constant memory, exact
  `bytesConsumed` = `bytesIn` − `leftover`, trailing bytes reported as `leftover`); `--sync`
  buffers (under `--max-input-size`) and calls the registered codec's `decompressSync`. The
  output bound is MANDATORY (`--max-output`, default the effective `--max-entry-size`; `none`
  only for trusted input).

## `batch` / `doctor`

- `batch`: directory mode (`--task create` runs the full `create` command per subdirectory
  with a bounded pool; `--task verify` runs `verifyZip` per `*.zip`) or manifest mode
  (`utils/manifest.ts`: strict pre-validation, whitelisted commands, `@<id>` output refs,
  sequential + fail-fast by default, 1000-task cap, `codec` refused without
  `--allow-codec-load`; `--concurrency` 1–64). Strip `summary`/`fields`/`pretty` from flags
  forwarded to a sub-command. Exit 1 carries the FIRST failing task's `E_*` code. Under
  `--json` / `--format json` stdout is ONE batch document: run each manifest task under
  `captureStdout()` (`utils/io.ts`, 64 MiB cap) into `tasks[i].report` (parsed JSON, or an
  array for NDJSON) / `tasks[i].stdout` / `tasks[i].stdoutBytes`; `utils/manifest.ts` refuses
  at validation (exit 2, also under `--dry-run`) any task that would write its artefact to
  stdout (`create`/`modify`/`cat`/`inflate` without `output`, `stream --cat`). Text mode keeps
  the interleaved contract. `batch` never calls `emitStatus`.
- `doctor`: offline only; report the resolved engine version vs its `VERSION` export, the
  active deflate tier, the pinned deterministic tier, streaming codecs, worker availability,
  registered codecs, effective limits (the `limits` check carries the numbers under `data`,
  `maxInputSize` included, `"none"` when disabled) and the command count (from `COMMANDS`).
  Exit 1 when any check fails.

## `schema` / `completion` / `govern`

- `schema`: hand-authored, versioned JSON Schemas (draft 2020-12; `$id` embeds the CLI
  version) + the `manifest` capability document built from `COMMANDS`, `GLOBAL_FLAGS`,
  `ERROR_CODES`, `ZIP_ERROR_CODES`, `ZIP_DIAGNOSTIC_CODES` and the limit table. Pure data,
  zero deps; the CLI only PRODUCES schemas. Unknown subject → `CliError(..., 2, USAGE)`.
- `completion`: static bash/zsh/fish/powershell scripts generated from `COMMANDS` +
  `GLOBAL_FLAGS` — adding a flag to a command means adding it to that command's `flags` array
  (and to `utils/flags.ts` if it is boolean, to `PATH_FLAGS` if it takes a path — path flags
  complete files: bash `_filedir`, zsh `_files`, fish `-r -F`; other value flags are fish `-r`).
- `govern`: `zipnative govern <rules|policy|verify-issue>`; logic in `utils/governance.ts`
  (`AI_GOVERNANCE_POLICY`, `AGENT_RULES_TEXT`, pure `validateGovernanceDraft`). A violation →
  `CliError('', 1, ErrorCode.POLICY)`. Fully offline — no network, no GitHub.
  `tests/utils/governance-sync.test.ts` enforces the sync: `govern policy` deep-equals
  `.github/ai-governance.json` and every rule line of `govern rules` appears verbatim in
  `.github/AGENT_RULES.md` — edit both sides together.
