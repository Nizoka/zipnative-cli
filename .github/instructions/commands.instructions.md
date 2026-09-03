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
- Every core call goes through `mapZipError(e, 'Failed to …')`, `guard(...)` or
  `guardAsync(...)` — never read `err.code` in a command.
- Validate every path arg against `..` traversal (`validatePath`) before read/write.
- No ZIP parsing in a command: no magic numbers, no header offsets, no manual CRC. If the
  core lacks the primitive, the feature waits for the core.

## Agent contract (cross-cutting)

- **Error codes:** pass a stable `ErrorCode` as the 3rd `CliError` arg (`E_USAGE`/`E_INPUT`/
  `E_PARSE`/`E_IO`/`E_SECURITY`/`E_DATA`/`E_LIMIT`/`E_UNSUPPORTED`/`E_NOT_FOUND`/
  `E_VERIFY_FAILED`/`E_CHECK_FAILED`/`E_POLICY`/`E_RUNTIME`). Omitting it derives `E_USAGE`
  from exit 2, else `E_RUNTIME`. The 4th arg carries `{ zipCode, entryName, detail }`.
- **`--json`:** never write the envelope yourself in the dispatcher path — `index.ts` emits
  the failure envelope. Use `emitStatus({...})` (from `utils/agent.ts`) for success status on
  `create`/`modify`/`extract`/`stream`/`cat`/`inflate`/`batch`; it is a no-op outside `--json`.
  stdout stays artifact-only. Spread `...sink.field()` so collected diagnostics ride along.
- **`--dry-run`:** read `hasFlag(args.flags, 'dry-run') || isDryRun()`; validate fully, then
  short-circuit before producing/writing output. Supported by `create`/`extract`/`modify`/
  `stream`/`cat`/`inflate`/`batch` (`DRY_RUN_COMMANDS` in `completion.ts`).
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
  `stream()`, data-descriptor layout, byte-identical for buffered content; > 4 GiB entries
  refused with `ZIP_UNSUPPORTED_ZIP64_STREAMING`), `--parallel` (`createParallelZip`,
  byte-identical per tier). Inputs walk through `utils/walk.ts` (sorted, symlinks skipped,
  every name pre-checked with `sanitizeEntryPath`). Determinism defaults are the core's;
  `--deterministic` pins the pure-TS encoder. `--from-manifest` shape = `schema create-manifest`.
- `modify`: edits apply in the FIXED order remove → rename → replace → add / add-dir →
  comment regardless of argv order. Default `save()` is append-only (data remanence — print
  one `info:` line when a remove/replace happens); `--compact` → `saveCompact()`. `--in-place`
  = tmp file + rename in the same directory. Untouched entries are never recompressed.

## `list` / `inspect` / `cat` / `extract` / `stream`

- `list`: `openZip` lazily — nothing decompressed. `--validate eager` cross-checks every local
  header. Rows come from `utils/entryfmt.ts` (`rowFromEntry`), shared with `inspect`/`stream`.
- `inspect`: open EAGERLY. `--check` allow-list lives in one table (deterministic,
  epoch-timestamps, canonical-order, utf8-names, no-data-descriptor, no-zip64, zip64,
  no-encryption, no-symlinks, no-duplicates, no-diagnostics, store-only, deflate-only,
  `max-entries=N`, `min-entries=N`, `max-uncompressed=<size>`, `max-ratio=N`, `has=<name>`,
  `method=…`). Print the report FIRST, then exit 1 / `E_CHECK_FAILED`.
- `cat`: `readEntryStream` chunk by chunk; `--raw` → `readEntryRaw` (compressed bytes,
  zero-copy). CRC is verified at the END — with `--output` remove the partial file on `E_DATA`.
- `extract`: two phases — PLAN (drain the lazy generator, `safeJoin` containment, overwrite
  refusal, case-fold collision refusal on win32/darwin) then WRITE (backpressure, partial file
  removed on CRC/size failure). Symlinks are never materialised; `--preserve-mode` masks
  setuid/setgid/sticky. Opt-outs are `--skip-unsafe`, `--allow-symlinks`, `--skip-symlinks`,
  `--overwrite`, `--on-duplicate` — nothing else loosens a default.
- `stream`: `iterateZipEntries` — local headers only. Refuse `--preserve-mode`,
  `--allow-symlinks`, `--skip-symlinks` with `E_USAGE`; every name written goes through
  `sanitizeEntryPath()` + `safeJoin`; print the trust warning (suppressed by `--quiet`) and set
  `trust: "local-headers-only"` in every JSON output.

## `verify` / `crc32` / `inflate`

- `verify`: the report is always the artefact; `ok === false` → `CliError('', 1,
  ErrorCode.VERIFY_FAILED, { zipCode: report.error?.code })`. `--strict` also fails on any
  diagnostic. Encrypted entries are reported `skipped`, never faked as verified.
- `crc32`: stream 64 KiB chunks through the core's incremental `crc32()`; `--expect` mismatch
  → `E_CHECK_FAILED`; `--seed` continues a running checksum.
- `inflate`: `createInflator(maxOutput)` fed chunk by chunk (constant memory, exact
  `bytesConsumed`, trailing bytes reported as `leftover`); `--sync` buffers and calls the
  registered codec's `decompressSync`. The output bound is MANDATORY (`--max-output`, default
  the effective `--max-entry-size`; `none` only for trusted input).

## `batch` / `doctor`

- `batch`: directory mode (`--task create` runs the full `create` command per subdirectory
  with a bounded pool; `--task verify` runs `verifyZip` per `*.zip`) or manifest mode
  (`utils/manifest.ts`: strict pre-validation, whitelisted commands, `@<id>` output refs,
  sequential + fail-fast by default, 1000-task cap, `codec` refused without
  `--allow-codec-load`). Strip `summary`/`fields`/`pretty` from flags forwarded to a
  sub-command. Exit 1 carries the FIRST failing task's `E_*` code.
- `doctor`: offline only; report the resolved engine version vs its `VERSION` export, the
  active deflate tier, the pinned deterministic tier, streaming codecs, worker availability,
  registered codecs, effective limits and the command count (from `COMMANDS`). Exit 1 when
  any check fails.

## `schema` / `completion` / `govern`

- `schema`: hand-authored, versioned JSON Schemas (draft 2020-12; `$id` embeds the CLI
  version) + the `manifest` capability document built from `COMMANDS`, `GLOBAL_FLAGS`,
  `ERROR_CODES`, `ZIP_ERROR_CODES`, `ZIP_DIAGNOSTIC_CODES` and the limit table. Pure data,
  zero deps; the CLI only PRODUCES schemas. Unknown subject → `CliError(..., 2, USAGE)`.
- `completion`: static bash/zsh/fish/powershell scripts generated from `COMMANDS` +
  `GLOBAL_FLAGS` — adding a flag to a command means adding it to that command's `flags` array.
- `govern`: `zipnative govern <rules|policy|verify-issue>`; logic in `utils/governance.ts`
  (`AI_GOVERNANCE_POLICY`, `AGENT_RULES_TEXT`, pure `validateGovernanceDraft`). A violation →
  `CliError('', 1, ErrorCode.POLICY)`. Fully offline — no network, no GitHub. Keep
  `AGENT_RULES_TEXT` / `AI_GOVERNANCE_POLICY` in sync with `.github/AGENT_RULES.md` /
  `.github/ai-governance.json`.
