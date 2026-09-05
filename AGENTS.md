# AGENTS.md — Driving zipnative-cli from autonomous agents

`zipnative-cli` is built so that an autonomous AI agent — or any program — can
drive it inside a larger automated process **deterministically and safely**.

There is **no separate runtime** for this: agent support is a thin presentation
layer over the normal command dispatch. The planned `zipnative-mcp` server is a
different integration; this document is about driving the **CLI** directly
(spawn a process, pass flags, read stdout/stderr, branch on the exit code).

The CLI is a thin dispatch layer over the [`zipnative`](https://github.com/Nizoka/zipnative)
engine: every ZIP decision is the engine's, and every engine error reaches you
with its frozen `ZIP_*` code intact.

---

## 1. The process contract

**Prerequisite:** Node.js ≥ 22 (check with `zipnative doctor`).

| Channel | Carries |
|---------|---------|
| **stdout** | The primary artifact: archive bytes (`create`, `modify`), entry bytes (`cat`, `stream --cat`, `inflate`), a JSON or text report (`list`, `inspect`, `verify`, `crc32`, `batch`, `doctor`, `govern verify-issue`), a JSON Schema (`schema`), the governance protocol / policy (`govern rules` / `policy`), or a completion script (`completion`). `extract` and `stream --output-dir` write files under `--output-dir`. |
| **stderr** | All diagnostics: progress, warnings, engine diagnostics as text, and the agent JSON envelopes below. Colour lives here too: `NO_COLOR` (any value) off, `FORCE_COLOR` (not `0` / `false`) on, `TERM=dumb` off, otherwise only when stderr is a TTY; `--no-color` sets `NO_COLOR`. |
| **exit code** | `0` success · `1` runtime / check failure · `2` usage error · `130` / `143` after SIGINT / SIGTERM. Unchanged in every mode. |

Keep stdout binary-clean: write archives and entries to `--output <file>` /
`--output-dir <dir>` or redirect stdout, and read the envelope from stderr.
**Nothing here opens a socket** — there is no network opt-in to guard.

**Flags are order-independent.** `zipnative --json list a.zip`,
`zipnative list --json a.zip` and `zipnative list a.zip --json` are the same
invocation: a boolean flag never consumes the token after it, `--flag=false`
(`0`, `no`, `off`) is the explicit off form, and combined short flags (`-lq`)
are refused with exit 2. Short aliases that take a value: `-i --input`,
`-o --output`, `-d --output-dir`, `-e --entry`, `-f --format`; boolean short
aliases: `-q`, `-h`, `-V`. There is no `-l`.

**Environment.** The global flags set process-wide variables that the same
process reads back, and you may set them yourself instead of passing the flag:

| Variable | Equivalent | Notes |
|----------|-----------|-------|
| `ZIPNATIVE_JSON=1` | `--json` | agent mode; `create --dry-run` / `extract --dry-run` print no text plan under it either |
| `ZIPNATIVE_DRY_RUN=1` | `--dry-run` | |
| `ZIPNATIVE_QUIET=1` | `--quiet` | |
| `ZIPNATIVE_STRICT=1` | `--strict` | |
| `ZIPNATIVE_PURE_CODECS=1` | `--pure-codecs` | |
| `ZIPNATIVE_DEBUG=1` | — | stack traces on stderr |
| `NO_COLOR`, `FORCE_COLOR`, `TERM` | `--no-color` | colour decision, see above |

(`VERAZIP_REQUIRED`, `VERAZIP_REPORT_DIR`, `VERAZIP_TOOLS` are read by the
conformance scripts only.)

**Edge cases you can rely on.**

- No input path and stdin is a terminal → `E_USAGE` (exit 2) "No input: pass
  --input <file> (or a positional path), or pipe data on stdin." — the process
  never hangs waiting on a TTY. An explicit `-` is never guarded.
- A closed downstream pipe (`| head`) → `EPIPE` ends the process quietly with
  exit 0, on stdout and on stderr.
- Unknown command → `E_USAGE`, exit 2 (also `zipnative nope --help`). Flags but
  no command (`zipnative --frob`, `zipnative --json`) → exit 2 "No command
  given". Bare `zipnative` prints the usage and exits 0.
- SIGINT → exit 130, SIGTERM → exit 143, after removing exactly the files being
  written at that moment — never a completed output, never the original of
  `modify --in-place` (POSIX in practice; Windows has no signals for child
  processes).
- Every command that writes a **file** refuses an existing one with `E_IO`
  "Refusing to overwrite existing file <path> (pass --overwrite)." and leaves it
  intact: `create -o`, `modify -o`, `cat -o`, `inflate -o`, `extract`,
  `stream --output-dir`, `batch --task create`. Pass `--overwrite` to replace.
  Writing to stdout is unaffected.
- Every buffered read is bounded by `--max-input-size` (default 4 GiB) →
  `E_LIMIT` with `detail.limit = "maxInputSize"`; the streaming commands
  (`stream`, `crc32`, `inflate`, `create --stream`) are not.

---

## 2. Agent mode — `--json`

Pass the global `--json` flag to any command to switch on machine-readable
envelopes (the data on stdout is unchanged; the JSON-on-stdout commands switch
to their JSON format and compact it).

**On failure**, a single JSON object is written to stderr (`zipnative schema error`):

```json
{ "ok": false, "command": "extract", "error": { "code": "E_SECURITY", "message": "Failed to extract: zipnative: entry '../etc/passwd' escapes the extraction root …", "zipCode": "ZIP_PATH_TRAVERSAL", "entryName": "../etc/passwd" } }
```

```json
{ "ok": false, "command": "extract", "error": { "code": "E_LIMIT", "message": "Failed to extract: zipnative: maxCompressionRatio exceeded …", "zipCode": "ZIP_LIMIT_EXCEEDED", "entryName": "bomb.bin", "detail": { "limit": "maxCompressionRatio", "configured": 1024, "observed": 4096 } } }
```

```json
{ "ok": false, "command": "cat", "error": { "code": "E_UNSUPPORTED", "message": "Failed to read entry \"secret.txt\": zipnative: entry is encrypted …", "zipCode": "ZIP_UNSUPPORTED_ENCRYPTION", "entryName": "secret.txt", "detail": { "feature": "zipcrypto" } } }
```

```json
{ "ok": false, "command": "cat", "error": { "code": "E_NOT_FOUND", "message": "Entry not found: nope (run `zipnative list` for the exact names).", "zipCode": "ZIP_ENTRY_NOT_FOUND", "entryName": "nope" } }
```

```json
{ "ok": false, "command": "list", "error": { "code": "E_LIMIT", "message": "\"a.zip\" exceeds --max-input-size (10 bytes; observed 3361). …", "detail": { "limit": "maxInputSize", "configured": 10, "observed": 3361 } } }
```

`error.code` is the **class** (13 values, below), `error.zipCode` is the exact
**cause** — zipnative's frozen `err.code`, verbatim (39 values). `entryName` and
`detail` appear when known: `{ limit, configured, observed }` for `E_LIMIT`
(the engine's `ZipLimits` keys, or the CLI's own `maxInputSize` /
`captureBytes`), `{ feature }` for `E_UNSUPPORTED`, `{ expectedCrc, actualCrc }`
for `E_DATA` / `crc32 --expect`.

**On success**, `create` / `modify` / `extract` / `stream` (extract and cat
modes, or list mode under `--dry-run`) / `cat` / `inflate` / `crc32` write a
status line to stderr (`zipnative schema status`):

```json
{ "ok": true, "command": "create", "output": "out.zip", "entries": 12, "files": 11, "directories": 1, "bytesIn": 131072, "method": "deflate", "level": 6, "deterministic": true, "order": "canonical", "stream": false, "layout": "buffered", "parallel": false, "skipped": [], "dryRun": false, "bytes": 48213, "tier": "pure-pinned", "diagnostics": [] }
```

```json
{ "ok": true, "command": "modify", "dryRun": false, "output": "b.zip", "bytes": 3661, "edits": [{ "op": "add", "name": "extra.txt" }, { "op": "comment", "name": "<5 bytes>" }], "layout": "append-only", "changed": true, "verified": 3, "verifySkipped": 0, "tier": "node-zlib", "diagnostics": [] }
```

```json
{ "ok": true, "command": "extract", "outputDir": "/work/out", "entries": 11, "files": 11, "directories": 1, "bytes": 131072, "skipped": [{ "name": "aux.h", "reason": "unsafe-path" }], "symlinksAsData": 0, "dryRun": false, "diagnostics": [] }
```

Command-specific fields (all confirmed against the built binary):

| Command | Envelope fields beyond `ok`, `command`, `dryRun`, `diagnostics` |
|---------|-------------------------------------------------------------------|
| `create` | `output`, `entries`, `files`, `directories`, `bytesIn`, `method`, `level`, `deterministic`, `order`, `stream`, `layout: "buffered" \| "data-descriptor"` (streamed entries), `parallel: false \| { workers }`, `skipped: [{ name, path, reason: "symlink" \| "special" \| "filtered" }]`, `tier` and `bytes` (both absent under `--dry-run`; under `--parallel` `tier` is `node-zlib` or `pure-pinned`, never `injected`) |
| `modify` | `output`, `bytes`, `edits: [{ op, name, to? }]` (a binary comment shows as `"<N bytes>"`), `layout: "append-only" \| "compact"`, `changed` (false when the save returned the same bytes), `verified` (untouched entries verified before re-emission), `verifySkipped` (encrypted / stream-only-codec entries copied as-is), `tier` (deflate tier of new payloads) |
| `extract` | `outputDir`, `entries`, `files`, `directories`, `bytes`, `skipped: [{ name, reason: "unsafe-path" \| "symlink" \| "filtered" \| "duplicate" \| "unsupported" }]`, `symlinksAsData` |
| `stream` | `mode`, `trust: "local-headers-only"`, `outputDir?`, `entries`, `bytes?` (extract / cat modes), `skipped?: [{ name, reason: "unsafe-path" \| "filtered" \| "duplicate" \| "unsupported" }]`, `stoppedAt: "central-directory" \| "eof"` |
| `cat` | `output` (`"-"` for stdout), `entries: [names]`, `bytes`, `raw`, `verifyCrc` |
| `inflate` | `output`, `method`, `methodName`, `bytesIn`, `bytesConsumed` (exact on the streaming path = `bytesIn − leftover`; equals `bytesIn` on `--sync` / codec paths), `bytesOut`, `leftover`, `maxOutput`, `sync`, `tier` (no `diagnostics`) |
| `crc32` | `files`, `bytes` (no `dryRun`, no `diagnostics`; the report itself is on stdout) |

Every archive envelope carries the engine's `diagnostics: [{ code, severity, message, entryName? }]`.

**The stdout documents.** `list`, `inspect`, `verify`, `stream --list`,
`batch`, `doctor`, `crc32` and `govern verify-issue` put their result document
on **stdout** as JSON; `--json` only adds the failure envelope on stderr and
selects / compacts the JSON format. Shapes worth knowing:

- `list` / `inspect`: `archive.commentHex` (the raw comment bytes) whenever
  `commentBytes > 0` — `comment` is the lossy UTF-8 decode; `--long` rows carry
  `rawNameHex` (always) and `commentHex` (when the entry has a comment);
  `unixMode` is four octal digits (`"0644"`, `"4755"`) or `null`.
- `inspect`: `determinism.deterministic` (reproducible: epoch timestamps +
  canonical order + UTF-8 flags) is separate from `determinism.canonicalLayout`
  (no data descriptors) — a `create --stream` archive is reproducible but not
  canonical.
- `verify --entry <name>` (repeatable): `entries` lists only the selected
  names, `entryCount` stays the archive total, `selected: [names]` is added.
- `stream --list` rows for data-descriptor entries carry zero sizes and CRC
  (local headers hold none) — see `stream --summary` in §3.
- `doctor`: `checks[].data` is the machine-readable payload; the `limits` check
  carries `{ maxEntries, maxEntryUncompressedSize, maxTotalUncompressedSize,
  maxCompressionRatio, maxNameBytes, maxExtraFieldBytes, maxCommentBytes,
  maxCentralDirectoryBytes, maxInputSize }` (numbers; `"none"` when disabled).
- **`batch --manifest` under `--json` owns stdout: one document.** Each task
  runs with its stdout captured (64 MiB cap → `E_LIMIT` `{ limit:
  "captureBytes" }`) into `tasks[i].report` (parsed JSON object, or an array of
  objects for NDJSON), `tasks[i].stdout` (text that was not JSON) and
  `tasks[i].stdoutBytes`. Tasks that would write their **artefact** to stdout —
  `create` / `modify` / `cat` / `inflate` without `"output"`, and
  `stream --cat` — are refused at validation (`E_USAGE`, exit 2, also under
  `--dry-run`): give them an `output` (or `output-dir`). Task status envelopes
  still go to stderr. Text mode keeps the interleaved contract.

### Stable error classes

Branch on `error.code` for the class, on `error.zipCode` for the cause — never
on the human message:

| Code | Meaning | Typical exit |
|------|---------|--------------|
| `E_USAGE` | Missing/invalid flag or argument, unknown command, combined short flags, a `batch --json` task that would write its artefact to stdout (also `ZIP_INVALID_OPTION`, `ZIP_LIMIT_INVALID`) | 2 |
| `E_INPUT` | User-supplied payload, entry name or manifest failed validation, or a conflict (entry exists, duplicate name). An unsafe entry **name** given as data — `modify --add/--rename/--add-dir`, `create --stdin-name`, manifest names — is `E_INPUT` with `entryName` (not usage); so is `modify --add "dir/=payload"` (use `--add-dir`) and a `..` in a manifest path value | 1 |
| `E_PARSE` | The bytes are not a valid ZIP / DEFLATE stream / JSON document (structural) | 1 |
| `E_IO` | Filesystem or stream I/O failure, including "Refusing to overwrite existing file <path> (pass --overwrite)." from every file-writing command | 1 |
| `E_SECURITY` | Hostile archive shape (zip-slip / device name, overlap, symlink, duplicate path, CD/LFH mismatch — also on an untouched `modify` entry — Zip64 spoofing) or the CLI sink guard tripped (lexical containment, or a link inside the destination that leaves it) | 1 |
| `E_DATA` | Integrity failure: CRC / size / data-descriptor mismatch (also on an untouched `modify` entry), decompression failure, output overflow | 1 |
| `E_LIMIT` | A named bound was exceeded — a `ZipLimits` key (reading **or** writing), `maxInputSize` (`--max-input-size`) or `captureBytes` (a `batch --json` task's stdout); `detail: { limit, configured, observed }` | 1 |
| `E_UNSUPPORTED` | Encryption, unknown method (also an untouched `modify` entry whose method has no registered codec — load its `--codec`), multi-disk, zip64 streaming, CD-less descriptor, codec mode | 1 |
| `E_NOT_FOUND` | A named entry does not exist in the archive — always with `zipCode: "ZIP_ENTRY_NOT_FOUND"` and `entryName`; `cat`, `inspect --entry` and `verify --entry` point at `zipnative list`, `stream --cat` at `stream --list`, `modify` relays the engine's message (names are case-sensitive) | 1 |
| `E_VERIFY_FAILED` | `verify` verdict is negative (`zipCode` set for structural refusals; never a `detail` — the engine report carries `{ code, message }` only) | 1 |
| `E_CHECK_FAILED` | `inspect --check`, `crc32 --expect` (reported once, with both CRCs in `detail`), or a `--strict` diagnostic escalation failed | 1 |
| `E_POLICY` | `govern verify-issue` found an AI-governance policy violation | 1 |
| `E_RUNTIME` | Catch-all runtime error (also `ZIP_API_MISUSE`, `ZIP_INTERNAL` — report these) | 1 |

### The 39 causes — `error.zipCode` → `error.code`

The mapping is `ZIP_TO_CLI` in `src/utils/ziperr.ts`, also printed by
`zipnative schema errors`; `raisedWhen` / `remedy` per code live in
[`docs/data/errors.json`](docs/data/errors.json).

| `zipCode` | `code` | What it means for you |
|-----------|--------|-----------------------|
| `ZIP_INVALID_OPTION` | `E_USAGE` | An option value the engine forbids reached it — the CLI pre-validates every option, so this is a CLI bug; report it |
| `ZIP_INPUT_TOO_LARGE` | `E_LIMIT` | > 2 GiB in one pure-TS deflate call — split the input or drop `--deterministic` for that entry |
| `ZIP_ENTRY_NOT_FOUND` | `E_NOT_FOUND` | Names are case-sensitive — `list` first (every CLI-side not-found carries this code too) |
| `ZIP_ENTRY_EXISTS` | `E_INPUT` | `modify --add` over an existing name, or `--rename` onto one — use `--replace` / `--remove` first |
| `ZIP_API_MISUSE` | `E_RUNTIME` | Engine usage contract violated — a CLI bug; report it |
| `ZIP_STRICT_DIAGNOSTIC` | `E_CHECK_FAILED` | `--strict` escalated a diagnostic; the message embeds its code |
| `ZIP_INTERNAL` | `E_RUNTIME` | Engine invariant broke — report it with the archive |
| `ZIP_EOCD_NOT_FOUND` | `E_PARSE` | Not a ZIP, truncated, or hostile trailing bytes |
| `ZIP_EOCD_INCONSISTENT` | `E_PARSE` | Corrupt or hostile — re-obtain the file |
| `ZIP_ZIP64_LOCATOR_MISSING` | `E_PARSE` | Truncated or corrupt zip64 archive |
| `ZIP_ZIP64_EOCD_MISPLACED` | `E_PARSE` | Corrupt, or an unsupported prepended-data layout |
| `ZIP_CD_INCONSISTENT` | `E_PARSE` | Central directory contradicts its declared counts / size |
| `ZIP_RECORD_TRUNCATED` | `E_PARSE` | A record or payload overruns the file — verify the transfer completed |
| `ZIP_SIGNATURE_MISMATCH` | `E_PARSE` | No PK signature where one is declared |
| `ZIP_STREAM_TRUNCATED` | `E_PARSE` | `stream` input ended mid-record / mid-entry (or without a central directory) |
| `ZIP_VALUE_UNREPRESENTABLE` | `E_PARSE` | A 64-bit field exceeds 2^53 — 1 — unsupported by design |
| `ZIP_INVALID_ENTRY_NAME` | `E_INPUT` | A name you asked to write is unsafe (empty, NUL, backslash, absolute, `..`) |
| `ZIP_DUPLICATE_ENTRY_NAME` | `E_INPUT` | Duplicate names at creation, or a duplicate-name archive given to `modify` — extract and rebuild |
| `ZIP_DEFLATE_TRUNCATED` | `E_PARSE` | Deflate stream ends mid-block |
| `ZIP_DEFLATE_CORRUPT` | `E_PARSE` | Deflate stream structurally invalid |
| `ZIP_ENTRY_OVERLAP` | `E_SECURITY` | Entries share bytes — always refused, no opt-out (`modify` refuses it before any edit) |
| `ZIP_CD_LFH_MISMATCH` | `E_SECURITY` | Local header contradicts the central directory (method) — refused; `modify` refuses to re-emit such an untouched entry |
| `ZIP_ZIP64_CONTRADICTION` | `E_SECURITY` | Zip64 value contradicts a classic field — refused |
| `ZIP_PATH_TRAVERSAL` | `E_SECURITY` | Zip-slip or a Windows device name — `extract --skip-unsafe` skips such entries (never writes them) |
| `ZIP_SYMLINK_REJECTED` | `E_SECURITY` | Symlink entry — `--skip-symlinks`, or `--allow-symlinks` to get the target text as a file |
| `ZIP_EXTRACT_DUPLICATE_PATH` | `E_SECURITY` | Two entries → one path (also case-folded on Windows / macOS) — `--on-duplicate first\|last` decides deliberately |
| `ZIP_CRC_MISMATCH` | `E_DATA` | Corrupt payload; `detail` carries both CRCs (`cat` verifies at the end of the stream, so stdout may already hold bytes; a partial `--output` is removed); `modify` refuses to re-emit such an untouched entry |
| `ZIP_SIZE_MISMATCH` | `E_DATA` | Metadata lies about sizes — treat as corrupt or hostile; `modify` refuses to re-emit such an untouched entry |
| `ZIP_INFLATE_OUTPUT_OVERFLOW` | `E_DATA` | More output than declared / permitted (`inflate --max-output`; also how `--max-entry-size` surfaces on a `stream` data-descriptor entry, whose size is only known after inflation) |
| `ZIP_DESCRIPTOR_MISMATCH` | `E_DATA` | Bit-3 entry's descriptor matches nothing — use the complete file |
| `ZIP_DECOMPRESSION_FAILED` | `E_DATA` | Codec failed mid-stream on a corrupt payload — or `stream` met an entry compressed with a `--codec` method, which the forward reader cannot pump (use `list` / `cat` / `extract` on the complete file) |
| `ZIP_LIMIT_EXCEEDED` | `E_LIMIT` | `detail.limit` names the bound — raise the matching `--max-*` only for trusted input; the bounds also apply when writing (`create` / `modify`) |
| `ZIP_LIMIT_INVALID` | `E_USAGE` | Unreachable from the CLI (values are pre-validated) |
| `ZIP_UNSUPPORTED_ENCRYPTION` | `E_UNSUPPORTED` | Encrypted entry — route around it (`list` shows `isEncrypted`; `extract --skip-unsupported` / `stream --skip-unsupported`; `modify` copies it unverified and counts `verifySkipped`) |
| `ZIP_UNSUPPORTED_METHOD` | `E_UNSUPPORTED` | No codec for the method — `--codec <module>`, or `extract` / `stream --skip-unsupported` |
| `ZIP_UNSUPPORTED_MULTI_DISK` | `E_UNSUPPORTED` | Spanned archive — an explicit anti-goal |
| `ZIP_UNSUPPORTED_ZIP64_STREAMING` | `E_UNSUPPORTED` | `create --stream` (or `--stdin-name`) entry > 4 GiB — buffer (omit `--stream`) or split |
| `ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR` | `E_UNSUPPORTED` | `stream` cannot delimit this bit-3 entry — use `list` / `extract` on the whole file |
| `ZIP_UNSUPPORTED_CODEC_MODE` | `E_UNSUPPORTED` | The codec supports only the other access mode (`cat` already falls back to a buffered read for sync-only codecs; `extract --buffered` needs `decompressSync`) |

### Diagnostics (informational, 11 codes)

Non-fatal conformance concerns never throw by default. They reach you as
`warning:` / `info:` lines on stderr (text mode, suppressed by `--quiet`), or as
`diagnostics: [{ code, severity, message, entryName? }]` inside the status
envelope / the stdout report under `--json`. The CLI **deduplicates by
`(code, entryName)` per run** — the engine hands the sink every occurrence, an
entry read twice yields one row. `--strict` escalates the **first** one into
`ZIP_STRICT_DIAGNOSTIC` → `E_CHECK_FAILED` before any output byte
(`verify --strict`: report printed, then `E_VERIFY_FAILED`).

"Raised by" lists the commands whose engine paths can emit the code
(`batch` surfaces whatever its tasks raise; the same lists are `raisedBy` in
[`docs/data/errors.json`](docs/data/errors.json)):

| Code | Severity | Raised by | Meaning |
|------|----------|-----------|---------|
| `ZIP_PREPENDED_DATA` | info | any random-access reader: `list`, `inspect`, `cat`, `extract`, `verify`, `modify` | Bytes precede the archive (SFX stub / concatenation); offsets shifted (`inspect` also reports `archive.prependedData`) |
| `ZIP_MULTIPLE_EOCD` | info | any random-access reader | Several EOCD signatures (an append-only `modify` output, a nested zip); the last self-consistent one was used (`archive.multipleEocd`) |
| `ZIP_NAME_MISMATCH` | warning | read paths only: `cat`, `extract`, `verify`, `modify` — `list` / `inspect` never compare local-header names | Local header name differs from the central directory; the CD wins |
| `ZIP_UNICODE_PATH_CONFLICT` | warning | any random-access reader | 0x7075 Unicode Path extra disagrees with the header name; header wins |
| `ZIP_INVALID_UTF8_NAME` | warning | any random-access reader, and `stream` | Bit 11 claims UTF-8 but the bytes are not; decoded as CP437 (`--long` keeps the bytes in `rawNameHex`) |
| `ZIP_DUPLICATE_NAME` | warning | name-keyed lookups only: `cat`, `inspect --entry`, `verify --entry` — plain `list` / `inspect` / `verify` iterate without the index; `inspect` counts `stats.duplicateNames` and `--check no-duplicates` is the reliable gate | Duplicate names in the central directory; `getEntry` returns the last |
| `ZIP_EXTRA_FIELD_MALFORMED` | warning | any random-access reader | An extra field overruns its length and was skipped |
| `ZIP_ZIP64_EXTRA_IGNORED` | warning | any random-access reader | Zip64 extra supplied a value for a non-sentinel field; header wins |
| `ZIP_TIMESTAMP_NOT_PINNED` | info | `create --date now` (also `--parallel`, `batch --task create`), `modify --date now` | The wall clock makes the output non-reproducible |
| `ZIP_NONDETERMINISTIC_CODEC` | info | `create` with a pinned `--date <ISO>` on the `node-zlib` tier without `--deterministic` (also `--parallel`, `batch --task create`) | Timestamps pinned but a platform codec in use — pass `--deterministic` |
| `ZIP_DEAD_BYTES_RATIO` | info | `modify` (append-only, not `--compact`) | An append-only `modify` left > 50 % dead bytes — pass `--compact` |

---

## 3. Token economy — compact JSON, `--summary`, `--fields`

The JSON that `list` / `inspect` / `verify` / `stream` / `batch` write to
**stdout** is the bulk of what an agent pays for in tokens. Three composable
levers shrink it — typically by ~90 % — without losing the fields you branch on.

**Compact by default under `--json`.** In agent mode the stdout JSON is minified
(no indentation). Pass `--pretty` to force indentation back on. Outside `--json`
the output stays pretty for humans.

**`--summary` — the canonical minimal verdict.**

| Command | `--summary` shape |
|---------|-------------------|
| `list` | `{ "entries": <int>, "files": <int>, "directories": <int>, "compressedSize": <int>, "uncompressedSize": <int>, "zip64": <bool>, "encrypted": <int> }` |
| `inspect` | `{ "entries": <int>, "bytes": <int>, "uncompressedSize": <int>, "zip64": <bool>, "encrypted": <int>, "deterministic": <bool>, "canonicalLayout": <bool>, "diagnostics": <int>, "checksPassed"?: <bool> }` — `deterministic` is reproducibility, `canonicalLayout` is the absence of data descriptors (`create --stream` output is `true` / `false`); `stream --json --summary` selects the json report (an explicit `--format ndjson` never projects) |
| `verify` | `{ "ok": <bool>, "entries": <int>, "failed": <int>, "skipped": <int>, "diagnostics": <int>, "selected"?: <int>, "error"?: "ZIP_*" }` — `entries` is the archive total, `selected` the `--entry` count |
| `stream` | `{ "entries": <int>, "bytes": <int>, "descriptorEntries": <int>, "bytesKnown": <bool>, "trust": "local-headers-only" }` — `bytes` excludes data-descriptor entries (their local headers carry zeros), `descriptorEntries` counts them, `bytesKnown` is `descriptorEntries === 0`; a `create --stream` archive therefore reads `bytes: 0, bytesKnown: false` |
| `batch` | `{ "ok": <bool>, "command": "batch", "mode": "directory" \| "manifest", "task"?: …, "dryRun"?: <bool>, "total": <int>, "succeeded": <int>, "failed": <int>, "skipped"?: <int> }` (drops `results` / `tasks`) |

**`--fields a,b.c` — dot-path projection.** Keep only the paths you name. A
segment landing on an array maps over every element; an unknown top-level path
is silently omitted (so a conditionally-absent field never crashes the run) and a
missing leaf under an array segment yields `null` for that element. `--summary` is
applied first and `--fields` then projects whichever document is being emitted,
so `--summary --fields ok,failed` is a two-key verdict.

```bash
# Smallest possible "is this archive intact?" probe:
zipnative verify --input a.zip --json --summary             # → {"ok":true,"entries":12,"failed":0,"skipped":0,"diagnostics":0}
zipnative inspect --input a.zip --json --fields determinism.deterministic,determinism.canonicalLayout,stats.encrypted
zipnative list --input a.zip --json --fields entries.name,entries.uncompressedSize
zipnative batch --manifest tasks.json --json --summary
```

The compact shapes are schema-pinned — validate them with `schema
entries-summary`, `inspect-summary`, `verify-summary`, `stream-summary`,
`batch-summary`. `list --format ndjson` / `stream --format ndjson` emit one
`EntryRow` per line for streaming consumers.

---

## 4. Validate first — `--dry-run`

`create`, `extract`, `modify`, `stream`, `cat`, `inflate` and `batch` accept
`--dry-run`: inputs are fully validated (inputs walked and names checked,
archives opened and every destination proven safe — existing files are already
refused — edits applied to the modifier and every untouched entry verified,
manifests parsed and their `@ref` graph and `--json` stdout policy resolved) but
**no output is produced or written**. Text mode prints `plan …` / `skip …` lines
(not under `--json` / `ZIPNATIVE_JSON`); combine with `--json` for a
`{ "ok": true, "dryRun": true, … }` envelope that already carries `entries`,
`skipped` and `diagnostics` (`bytes` / `tier` are absent from a `create` dry run).

```bash
zipnative extract --input upload.zip --output-dir out/ --dry-run --json
```

---

## 5. Discover shapes — `schema`

Fetch a versioned JSON Schema (Draft 2020-12) and validate input with your own
tooling before invoking a command. Each schema carries a `$id` embedding the CLI
version so you can detect drift.

```bash
zipnative schema list              # → { "subjects": [ …22 subjects… ] }
zipnative schema create-manifest   # input accepted by `create --from-manifest` (extraFields, mode, commentBase64, UTC dates)
zipnative schema modify-manifest   # input accepted by `modify --from-manifest` (mode + extraFields on add/replace/add-dir)
zipnative schema batch-manifest    # pipeline file accepted by `batch --manifest`
zipnative schema entries           # output of `list --format json` (rows of ndjson): commentHex, rawNameHex, unixMode
zipnative schema inspect           # output of `inspect --format json` (determinism.canonicalLayout)
zipnative schema verify            # output of `verify --format json` (selected)
zipnative schema stream            # output of `stream --format json`
zipnative schema batch             # output of `batch --format json` (tasks[].report / stdout / stdoutBytes)
zipnative schema doctor            # output of `doctor --format json` (checks[].data)
zipnative schema govern-verify     # output of `govern verify-issue --json`
zipnative schema crc32             # output of `crc32 --format json`
zipnative schema entries-summary | inspect-summary | verify-summary | stream-summary | batch-summary
zipnative schema status            # the --json success envelope (layout, verified, verifySkipped, bytesConsumed, tier …)
zipnative schema error             # the --json error envelope (code, zipCode, entryName, detail)
zipnative schema errors            # E_* codes + the 39 ZIP_* → E_* mapping + diagnostics (DATA, not a schema)
zipnative schema limits            # ZipLimits: eight bounds, defaults, CWEs, flags
zipnative schema diagnostics       # the diagnostic row shape (11 codes)
zipnative schema manifest          # capability manifest: commands, flags, codes, schemas (DATA, not a schema)
```

**Tool discovery.** `zipnative schema manifest` emits a single JSON document
listing every command (group, summary, flags), the global flags (incl.
`--max-input-size`), the dry-run / projected / manifest command lists, the
`E_*` and `ZIP_*` codes, the diagnostic codes and the limits — enough to
register the CLI as a tool set at runtime. A prose/LLM-facing version lives in
`llms.txt` at the repo root (shipped in the npm package, together with this
file and `docs/data/errors.json`).

**Listing for RAG.** `list --format ndjson` emits one JSON object per entry
(`{ name, method, compressedSize, uncompressedSize, crc32, lastModified,
isEncrypted, … }`) which streams cleanly into a retrieval pipeline; add `--long`
for flags, offsets, extra fields and the raw name bytes (`rawNameHex`).

---

## 6. Governance & Human-in-the-Loop — `govern`

The zipnative ecosystem's governance model treats AI agents as **draftsmen**,
never autonomous submitters. The `govern` command makes that contract actionable
from any agent pipeline — entirely offline:

```bash
zipnative govern rules                  # the human/agent protocol on stdout
zipnative govern policy --json          # machine-readable policy JSON on stdout
zipnative govern verify-issue draft.md  # gate a draft: exit 1 / E_POLICY on a violation
```

Rules an agent MUST honour:

- **No autonomous GitHub writes.** Never open, edit, label, close, comment on, or submit
  issues / PRs / releases. Produce a **local draft** plus a compliance report and hand it
  to the human.
- **Zero runtime dependencies.** Never propose adding an npm runtime package — this is a
  hard block that `verify-issue` enforces.
- **No anti-goals.** Do not propose encryption, other archive formats, multi-disk
  archives, archive repair, or filesystem / network I/O inside the engine
  (`verify-issue` warns).
- **Never weaken a security default.** `rejectTraversal`, `rejectSymlinks`,
  `onDuplicate`, every `ZipLimits` bound, `--max-input-size`, the extraction-sink
  containment (lexical and physical), the exclusive-open overwrite policy, the
  `modify` survivor verification and the `--codec` argv-only rule stay as they are unless
  a human records the decision. Bytes under `--deterministic` are a frozen contract (a
  byte change is semver-major).
- **Local reproduction required.** A bug draft must include a minimal, executed repro
  inside a fenced code block; `verify-issue` fails the draft otherwise.
- **Identity integrity.** Anything submitted is published under the **human's** GitHub
  identity; remind them of their shared responsibility.

`govern verify-issue` returns `{ ok, errors, warnings }` under `--json`. A passing check is
**necessary but not sufficient** — the human review gate always applies. Recommended flow:
draft locally → `govern verify-issue` → present to the human → the **human** submits.
The printed rules and the policy JSON are pinned to `.github/AGENT_RULES.md` and
`.github/ai-governance.json` by a test, so what `govern` prints is what the repository
enforces.

---

## 7. Recommended agent loop

1. `zipnative doctor --format json` → confirm the CLI, Node ≥ 22 and the engine are
   present, the deflate tier is `node-zlib`, workers are available if you plan
   `create --parallel`, and read the **effective limits** as numbers from the
   `limits` check's `data` (incl. `maxInputSize`).
2. `zipnative inspect --input a.zip --json --summary` → cheap facts (entries, bytes,
   encrypted count, reproducibility and layout verdicts, diagnostics count) before
   touching anything. Add `--check no-encryption,no-symlinks,max-ratio=100` to turn
   policy into an exit code.
3. `zipnative extract --input a.zip --output-dir out/ --dry-run --json` → the plan:
   every destination proven safe, existing files refused, `skipped` inventory,
   nothing written. Extract into an empty directory.
4. `zipnative extract --input a.zip --output-dir out/ --json` → do it; read the status
   envelope from stderr.
5. On any non-zero exit, parse the last stderr line and branch on `error.code`
   (class) then `error.zipCode` (cause): `E_SECURITY` → quarantine the archive;
   `E_LIMIT` → only for trusted input, retry with the named `--max-*` (or
   `--max-input-size`) raised; `E_UNSUPPORTED` → route around the feature
   (`detail.feature`, `--skip-unsupported`); `E_PARSE` / `E_DATA` → the bytes are
   corrupt or hostile, re-obtain them; `E_IO` → an existing file (`--overwrite`) or a
   filesystem problem; `E_NOT_FOUND` → `list` for the exact names.

For `verify` / `inspect`, read the JSON result on stdout and use `--strict` /
`--check` to turn findings into exit codes for unattended gating; `verify --entry
<name>` verifies a selection without paying for the whole archive. Add
`--summary` (or `--fields`) to keep that stdout JSON token-cheap — see §3.

**Conformance changes → veraZIP gate.** An agent working **on this repository** must
run `npm run validate:zip` for any change touching what the CLI writes (`create`,
`modify`, `batch --task create`, the corpus generator, name handling): it builds the
CLI, drives the built binary to write the 37-archive corpus (33 conformant archives —
30 CLI-produced or crafted, plus 3 hostile-but-conformant ones `extract` must refuse —
and 4 raw-crafted negative canaries; expected `33 PASS, 4 XFAIL, 0 FAIL`) and
validates every file against ISO/IEC 21320-1:2015 with an engine-independent parser.
Level 0 needs no external tool and always runs; level 1 (foreign integrity tools)
skips visibly when a tool is absent — set `VERAZIP_REQUIRED=1` to fail closed as CI
does. Exit 0/1/2/3 semantics are in
[CONTRIBUTING.md](CONTRIBUTING.md#conformance-validation-verazip).

**Orchestrate with `batch --manifest`.** Instead of shelling out N times, declare
the whole pipeline once and run it fail-fast in a single process. Under `--json`
every task that produces an artefact must name an `output`, and report-producing
tasks should ask for `"format": "json"` so their result lands in `tasks[i].report`
as an object rather than in `tasks[i].stdout` as text:

```json
{ "version": 1, "tasks": [
  { "id": "build",   "command": "create",  "flags": { "input": "dist", "output": "release.zip", "deterministic": true, "overwrite": true } },
  { "id": "check",   "command": "inspect", "flags": { "input": "@build", "check": ["deterministic", "no-symlinks"], "format": "json", "summary": true } },
  { "id": "verify",  "command": "verify",  "flags": { "input": "@build", "strict": true, "format": "json", "summary": true } },
  { "id": "unpack",  "command": "extract", "flags": { "input": "@build", "output-dir": "staging" } }
] }
```

`zipnative batch --manifest tasks.json --json` then prints one document on stdout:
`{ ok, command: "batch", mode: "manifest", total, succeeded, failed, skipped, tasks: [{ id, command, ok, output?, report?, stdout?, stdoutBytes?, skipped?, error?: { code, message, zipCode? } }] }`
(the `build` and `unpack` tasks have `stdoutBytes: 0`; their status envelopes went to stderr).

`"@<id>"` references the resolved output (or output-dir) of an **earlier** task;
relative paths resolve against the manifest's directory and manifest path values get
the `..` refusal that argv paths do not (`E_INPUT` "Path traversal detected"); 10
manifest commands are whitelisted — `create`, `list`, `inspect`, `extract`, `cat`,
`verify`, `stream`, `modify`, `crc32`, `inflate` (never `batch`, `govern`, `schema`,
`completion`, `doctor`). Validate the file with `schema batch-manifest`, pre-flight
with `--dry-run` (it also enforces the `--json` stdout policy), and remember: a
`codec` flag inside a manifest additionally requires `--allow-codec-load` on the
command line — a manifest obtained from elsewhere can never execute user code on its
own. A manifest has the filesystem access of the user who invokes `batch` — the same
trust level as flags typed on the command line. Manifests are size-capped (50 MB) and
bounded to 1 000 tasks; directory mode's `--concurrency` accepts 1–64. Exit 1 carries
the first failing task's `E_*` code and `zipCode`.

---

## 8. Safety notes for unattended use

- **Offline, always.** No command opens a socket — not `doctor`, not `govern`, not
  `schema`, not `--json`. The engine never touches the network either. There is nothing
  to allow-list.
- **The sink is guarded three times.** The engine sanitises every path
  (`sanitizeEntryPath`) and refuses hostile shapes; the CLI re-proves lexically that each
  destination stays under `--output-dir` (`safeJoin`); then, before creating a directory,
  it `realpath`s the nearest existing ancestor and requires it to sit under the root's
  `realpath` (a symlink or junction pre-planted inside the destination cannot redirect
  `mkdir -p`; the created directory is re-checked). Files are created exclusively (`wx`)
  unless `--overwrite`, so a file appearing between the plan and the write is refused
  like any other; case-fold collisions are refused on case-insensitive filesystems; a
  symlink is never materialised. Opt-outs skip; they never write anything unsafe. A
  residual window exists between the `realpath` check and the open — extract into an
  empty or trusted directory.
- **Overwrite is opt-in everywhere.** `create -o`, `modify -o`, `cat -o`,
  `inflate -o`, `extract`, `stream --output-dir` and `batch --task create` refuse an
  existing file (`E_IO`) unless `--overwrite`; `modify --in-place` writes an
  unpredictable exclusive temp file and renames atomically. Interrupting (SIGINT /
  SIGTERM) removes the in-flight files and exits 130 / 143.
- **Bounded input.** The engine's eight CWE-tagged limits are always on (100000 entries,
  1 GiB per entry, 8 GiB total, 1024:1 ratio, 4096-byte names, 65535-byte extra fields and
  comments, 256 MiB central directory) — when reading **and** when writing; tighten them
  for untrusted uploads (`--max-total-size 512m --max-ratio 50`). `--max-input-size`
  (default 4 GiB) bounds every buffered read of an archive or payload, so a huge upload
  cannot exhaust memory before the engine sees it; the streaming commands stay
  constant-memory. `none` disables a bound and warns — never do that on untrusted input.
  JSON inputs are capped at 50 MB; a captured `batch --json` task stdout at 64 MiB.
  `inflate` always has an output bound.
- **Argv paths are yours; data paths are checked.** `--input ../a.zip` or
  `-o ../out.zip` is ordinary shell usage and is not second-guessed. Paths that arrive as
  *data* — batch-manifest path flags, create/modify-manifest `path` values — are refused
  when they contain `..`. Entry **names** are always checked with the engine's
  `sanitizeEntryPath()`.
- **`modify` never launders a lying record.** The archive is opened eagerly (overlap /
  CD↔LFH structure checked before any edit) and every untouched entry is verified
  (CRC-32, sizes, local header — one decompress pass, never a recompress) before it is
  re-emitted verbatim; a failure is `E_DATA` / `E_SECURITY` with `entryName`.
  Encrypted and stream-only-codec entries are copied as-is and counted in
  `verifySkipped`; an unregistered method is `E_UNSUPPORTED`. There is no opt-out.
- **Data remanence.** `modify` without `--compact` keeps removed / replaced bytes
  recoverable in the output. When deletion matters, pass `--compact`. The CLI prints an
  `info:` line and the engine emits `ZIP_DEAD_BYTES_RATIO` when it is significant.
- **Forward reading is unverified metadata.** `stream` trusts local headers alone — no
  central directory to cross-check names, sizes or methods — so mode / symlink policy is
  unavailable, data-descriptor entries show zero sizes (`bytesKnown: false`), custom-method
  entries cannot be decoded, and every JSON output says `trust: "local-headers-only"`.
  Use it only for streams you cannot seek; prefer `list` / `extract` on a complete file.
- **`--codec` runs user code and shapes what you write.** It is the CLI's only dynamic
  import (same trust as `node -r`): argv only, refused from `.zipnativerc.json`, refused
  inside a `batch --manifest` without `--allow-codec-load`. Codecs are not read-side
  only: a module registering method 0/8 replaces the compressor of `create` / `modify`
  (announced by a `warning:`, also under `--deterministic`), a `deflateImpl` replaces the
  deflate tier (`tier: "injected"`) unless `--deterministic`, and `create --parallel`
  refuses either because its worker pool never sees the module. Never pass a module you
  did not author or vet.
- **Timestamps are host-independent only when you pin them.** `--date <ISO>` and
  manifest dates are UTC wall-clock (identical DOS fields on every host); `--date now`
  and `--mtime` are local time and not reproducible; `--stream` output is reproducible
  but not canonical (`layout: "data-descriptor"`).
- **No encryption.** Encrypted entries are detected, listed and reported as `skipped`
  by `verify`; reads fail with `ZIP_UNSUPPORTED_ENCRYPTION`; `extract` / `stream`
  `--skip-unsupported` skip them. Do not expect a password flag.
- **Human-in-the-loop for governance.** `govern` never submits anything; it only drafts
  and verifies. A human must review and submit under their own identity (see §6).
- **One process per task.** The CLI is stateless; run it per unit of work and let the
  exit code drive your orchestration (or a `batch --manifest` for a fixed pipeline).

See [SECURITY.md](SECURITY.md) for the full security model and
[docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) for the deep reference.
