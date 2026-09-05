# zipnative-cli — Knowledge Base

> This document is structured for AI assistants (GitHub Copilot, Claude, Cursor, Continue, Zed).
> It provides the full context needed to understand, extend, and debug zipnative-cli without reading all source files.

---

## 1. Context

**What is zipnative-cli?**
The official command-line interface for [`zipnative`](https://github.com/Nizoka/zipnative) — a zero-dependency, pure-TypeScript ZIP engine (random access, secure-by-default extraction, streaming, deterministic output, incremental modification) whose 1.0 surface — 77 exports, 39 error codes, `deterministic: true` bytes — is frozen under semver. The CLI exposes 15 commands, grouped by purpose (the global `--help` shows the same grouping):

| Group | Commands |
|-------|----------|
| Create & modify | `create`, `modify` |
| Read & extract | `list`, `inspect`, `cat`, `extract`, `stream` |
| Integrity & codecs | `verify`, `crc32`, `inflate` |
| Automation & meta | `batch`, `doctor`, `schema`, `completion`, `govern` |

`schema` (self-validation + capability manifest) and `doctor` (capability pre-flight) support agent automation.

**Philosophy:**
- Zero extra runtime dependencies — `zipnative` (`^1.0.0`) is the *only* dependency.
- Pure dispatch layer — **no ZIP parsing logic lives in the CLI**. The CLI owns argv, the filesystem, stdout/stderr and the agent contract; every byte of ZIP structure is the engine's.
- The CLI is the **filesystem trust boundary** — the engine never touches disk; `extract` / `stream` are the sinks and re-prove containment themselves (lexically and physically).
- Composable — every command reads from stdin and writes to stdout by default.
- **Offline, always** — no command can open a socket. There is no network opt-in.
- Never loosen a security default — opt-outs skip, they never write anything unsafe.
- Honest envelopes — what the CLI reports (`tier`, `layout`, `verified`, `trust`) is what the engine did.

**Targets:** Node.js ≥ 22. The package is bin-only: one CJS bundle, `dist/cli.cjs` (no ESM build, no type declarations). CI: Ubuntu (Node 22, 24), Windows (Node 22, 24) and macOS (Node 22); the veraZIP conformance gate runs on Linux and Windows.

**Repository:** https://github.com/Nizoka/zipnative-cli
**npm:** https://www.npmjs.com/package/zipnative-cli
**Parent library:** https://github.com/Nizoka/zipnative — docs at https://zipnative.dev

---

## 2. Architecture

```
src/
├── index.ts              # Entry: parse argv (boolean-flag table) → global env flags → config merge → dispatch → exit
├── commands/
│   ├── create.ts         # files/dirs/stdin/manifest → createZip | createParallelZip → toBytes() | stream(); codec-override policy
│   ├── modify.ts         # openZip({ validate: 'eager' }) → createZipModifier → edits → verifyEntry() on every survivor → save() | saveCompact()
│   ├── list.ts           # openZip → entries() → text | json | ndjson (nothing decompressed); commentHex, rawNameHex
│   ├── inspect.ts        # openZip({ validate: 'eager' }) → stats, determinism verdict (reproducible vs canonical layout), --check gates
│   ├── cat.ts            # openZip → readEntryStream | readEntry (sync-only codec fallback) | readEntryRaw → stdout / --output
│   ├── extract.ts        # extractZipStream | extractZip → plan (utils/sink.ts) → write; --skip-unsupported
│   ├── stream.ts         # iterateZipEntries over stdin/pipes → list | extract (utils/sink.ts) | cat (trust: local-headers-only)
│   ├── verify.ts         # verifyZip (whole archive) | eager open + verifyEntry() per --entry → report + verdict
│   ├── crc32.ts          # crc32() over 64 KiB chunks; --seed, --expect
│   ├── inflate.ts        # createInflator(maxOutput) chunk by chunk (bytesConsumed) | codec.decompressSync (--sync / --method)
│   ├── batch.ts          # directory mode (create / verify per item, pool) | --manifest pipeline (captureStdout under --json)
│   ├── doctor.ts         # environment / capability preflight (text | --json, limits check carries data)
│   ├── schema.ts         # 22 JSON Schema subjects (Draft 2020-12) + errors document + capability manifest
│   ├── completion.ts     # COMMANDS table (single source of truth) → bash/zsh/fish/powershell (PATH_FLAGS complete files)
│   └── govern.ts         # AI-governance / HITL: rules | policy | verify-issue
├── utils/
│   ├── args.ts           # Zero-dep argument parser (repeatable flags → string[]; booleans never consume a value)
│   ├── flags.ts          # The boolean-flag table (global + per command) that drives the parser and the completions
│   ├── io.ts             # stdin/stdout/file I/O, --max-input-size bound, exclusive (wx) writes, validatePath (manifest values),
│   │                     #   safeJoin (lexical containment), 50 MB JSON cap, captureStdout, EPIPE guard, streams
│   ├── sink.ts           # THE extraction sink (extract + stream): duplicate policy, realpath containment, exclusive open, cleanup
│   ├── inflight.ts       # In-flight output registry + SIGINT/SIGTERM cleanup (exit 130 / 143)
│   ├── config.ts         # `.zipnativerc.json` discovery + flag-default merge (codec key refused)
│   ├── colors.ts         # NO_COLOR / FORCE_COLOR / TERM=dumb / stderr-TTY-aware ANSI helper
│   ├── sizes.ts          # <size> / <count> parsing (512k, 1m, 8g, 1GiB, none), parsePositiveInt, formatBytes, formatRatio
│   ├── glob.ts           # Minimal glob matcher for entry names (*, **, ?, [abc])
│   ├── walk.ts           # Filesystem walk for create (sorted; preserveInputOrder for --order insertion; symlink policy; name pre-check)
│   ├── limits.ts         # The eight --max-* flags → Partial<ZipLimits> (CWE-tagged), effective limits, --max-input-size
│   ├── engine.ts         # prepareEngine(): --codec modules, node:zlib tier bootstrap (idempotent)
│   ├── codecs.ts         # --codec <module> loader: the CLI's ONLY dynamic import of user code; overridesBuiltin
│   ├── diagnostics.ts    # Diagnostics bridge: core onDiagnostic → stderr text | --json arrays | --strict (dedup by code+entry)
│   ├── entryfmt.ts       # EntryRow (one JSON row shape for list/inspect/stream), flag decoding, rawNameHex/commentHex, text table
│   ├── zipops.ts         # Shared flag → core-option translation (commonOptions, compression, UTC dates, filters, extra fields, comments)
│   ├── manifest.ts       # batch --manifest: parse/validate tasks.json, @id refs, codec-load policy, --json stdout policy
│   ├── projection.ts     # Token economy: --summary / --fields / compact JSON (emitJsonReport)
│   ├── agent.ts          # --json envelopes, emitStatus, progress (quiet-aware), mode flags (ZIPNATIVE_* env)
│   ├── ziperr.ts         # ZIP_TO_CLI (39 codes → E_*/exit), diagnostics list, mapZipError / guard
│   ├── version.ts        # bundle-safe CLI + engine version resolution (name-guarded package.json probe)
│   ├── governance.ts     # AI-governance policy + AGENT_RULES text + pure draft validator (pinned to .github/ by a test)
│   └── error.ts          # CliError { exitCode, code, zipCode?, entryName?, detail? } + 13 E_* codes
└── core-bridge/
    └── index.ts          # The ONLY import point of `zipnative` / `zipnative/worker` (77-export ledger)

scripts/
├── generate-zip-corpus.mjs   # drives the BUILT CLI + a raw builder → test-output/zip/ (37 archives + manifest)
├── validate-zip.mjs          # veraZIP: ISO/IEC 21320-1:2015 validator, vendored from zipnative (independent parser)
└── helpers/interop-tools.mjs # level-1 foreign integrity tools (bsdtar, unzip, 7z, python-zipfile, jar)

tests/                                   # 56 vitest files (in-process; stdout/stderr captured via helpers/capture.ts)
├── commands/, utils/, docs/, scripts/   # per-command suites, util suites, tests/docs/consistency.test.ts, vendored-validator drift
├── integration/                         # round trips, modify incremental, parallel identity, refusal posture, forward read,
│                                        #   one spawn smoke test against dist/cli.cjs (exit codes, EPIPE, signals)
├── helpers/raw-zip-builder.ts           # engine-independent raw ZIP builder (adversarial shapes, never committed)
└── fixtures/interop/                    # two foreign-provenance archives (bsdtar, PowerShell) — see tests/fixtures/README.md
```

### Data Flow

```
process.argv
    │
    ▼
src/index.ts
  parseArgs(argv, { booleans })         ← src/utils/args.ts + src/utils/flags.ts (flags and positionals are order-independent)
  --json/--quiet/--dry-run/--strict/--pure-codecs → ZIPNATIVE_* env (process-wide mode; also honoured when the caller sets them)
  loadConfig(command) + applyConfigDefaults   ← src/utils/config.ts (flags win)
  installEpipeGuard() + installSignalCleanup()
  loadCommand(command)                        (lazy import)
    │
    ├── create   → prepareEngine(args)        ← codecs + node:zlib tier; a method-0/8 override is announced, refused under --parallel
    │               plan: walkPaths({ preserveInputOrder }) | planFromManifest()   (names pre-checked with sanitizeEntryPath)
    │               createZip | createParallelZip → add/addDirectory/addStream (+ setComment(Uint8Array) for binary comments)
    │               toBytes() → writeOutput (exclusive unless --overwrite)  |  stream() → writeStreamingOutput
    │               emitStatus({ … layout, tier, diagnostics })
    │
    ├── modify   → readArchiveBytes (--max-input-size) → openArchive({ validate: 'eager' })
    │               createZipModifier → remove → rename → replace → add / add-dir → comment
    │               verifyEntry() on every entry re-emitted verbatim (lying records refused)
    │               save() | saveCompact() → writeOutput  (--in-place: exclusive temp file + rename)
    │
    ├── extract  → readArchiveBytes(--input)
    │               openArchive() → entries (directory entries, skipped inventory incl. --skip-unsupported)
    │               extractZipStream(bytes, { rejectTraversal, rejectSymlinks, onDuplicate, filter })
    │               PLAN: safeJoin(root, path) per entry, duplicate policy, existing-file check  ← src/utils/sink.ts
    │               WRITE: realpath containment of the parent, exclusive open, backpressure; partial file removed on failure
    │
    ├── verify   → verifyZip(bytes, { limits }) | eager open + verifyEntry(name) per --entry → report on stdout → exit verdict
    │
    └── every core call is wrapped: guard('context', () => core())  ← src/utils/ziperr.ts
                                     → CliError { code: E_*, zipCode: ZIP_*, entryName, detail }
main().catch → emitJsonError (under --json) | message on stderr → process.exit(exitCode)
```

---

## 3. Core Concepts

### Zero-Dep Arg Parser (`src/utils/args.ts`, `src/utils/flags.ts`)

```typescript
type ParsedArgs = {
    readonly flags: Record<string, string | boolean | readonly string[]>;
    readonly positionals: readonly string[];
};

function parseArgs(argv: readonly string[], options?: { booleans?: ReadonlySet<string> }): ParsedArgs
```

Handles `--flag value`, `--flag=value`, `-f value`, bare `--flag` (boolean), `--` pass-through, positionals. `flags.ts` is the **boolean-flag table** (global + per command): a boolean flag never consumes the next token, so `zipnative --json list a.zip` and `list --long a.zip` both work and flags and positionals are order-independent; `--flag=false|0|no|off` is the explicit off form. A token matching `-<digit>` is always a value. Combined short flags (`-lq`) are refused (`E_USAGE`, exit 2). Short aliases that take a value: `-i --input`, `-o --output`, `-d --output-dir`, `-e --entry`, `-f --format`; boolean short: `-q`, `-h`, `-V`. There is **no** `-l` alias for `--long`. A long flag given several times with string values is collected into a `readonly string[]` (`--remove a --remove b`). Helpers: `getStringFlag(flags, ...names)` (first value), `getStringFlagAll` (every value), `hasFlag`, `getBoolFlag`. `tests/docs/consistency.test.ts` pins the table to the USAGE text (a boolean flag appears without a `<value>` placeholder, a value flag with one).

### Core Bridge (`src/core-bridge/index.ts`)

The **only** import point of the engine (`zipnative` and `zipnative/worker`). Grouped exactly like the core's own `src/index.ts` so it doubles as a coverage ledger of the frozen 77-export surface (mapped in §8). Two additions of its own:

- `ensureCodecsReady()` — memoised `initNodeZipCodecs()`: resolves `node:zlib` once so every sync codec path runs on the `node-zlib` tier. Without it a CJS bundle silently runs the pure-TS tier (the core's probe cannot see `require` in CJS scope).
- `loadParallelZip()` — lazy import of `zipnative/worker` (never on the startup path) that also resolves the worker script URL through the package exports map (`zipnative/worker/zip-worker.js`) so a packager that flattens `node_modules` fails loudly instead of silently degrading to main-thread compression.

`zipnative` and `zipnative/worker` stay **external** in the tsup bundle (see `tsup.config.ts`).

### `prepareEngine` (`src/utils/engine.ts`)

Called first by every core-touching command. (1) loads and registers every `--codec <module>` (argv only); (2) unless `--pure-codecs`, calls `ensureCodecsReady()`. Idempotent — `batch` tasks run in-process and call it again as a no-op. `doctor` makes the resulting deflate tier visible (`deflate-tier`, `deflate-pinned`).

**Codecs serve both sides.** The engine resolves methods 0 (store) and 8 (deflate) through the codec registry, so a `--codec` module that registers method 0 or 8 replaces the writer's compressor for `create` / `modify` — even under `--deterministic`, which pins only the engine's own encoder. A module exporting `deflateImpl` replaces the sync deflate tier (`tier: "injected"`) unless `--deterministic` (then `pure-pinned`). `LoadedCodecModule.overridesBuiltin` lists the writer-resolved methods a module registers; the sequential `create` announces an override with a `warning:` line (silent under `--dry-run`), and `create --parallel` refuses (exit 2) a module registering method 0/8 (always) or a `deflateImpl` without `--deterministic`, because the worker pool is a separate bundle that never sees the module. `setInflateImpl` (a module's `inflateImpl`) is honoured by the sync and streaming reader paths (`cat`, `extract`, `verify`, `modify`, `inflate --sync`) but not by `createInflator` (the default `inflate` path) nor by the forward pump of `stream`.

### `CliError` and the error mapper (`src/utils/error.ts`, `src/utils/ziperr.ts`)

```typescript
class CliError extends Error {
    readonly exitCode: number;          // 1 runtime · 2 usage
    readonly code: ErrorCodeValue;      // one of the 13 E_* classes
    readonly zipCode: string | undefined;   // zipnative's frozen ZIP_* code, verbatim
    readonly entryName: string | undefined;
    readonly detail: ErrorDetail | undefined;   // { limit, configured, observed } | { feature } | { expectedCrc, actualCrc }
}
```

`ziperr.ts` is the **only** place that reads `err.code` from the engine. `ZIP_TO_CLI` maps the 39 frozen codes to a class + exit code and is typed `satisfies Record<ZipErrorCode, …>` — a core minor bump that adds a code fails `tsc` here instead of leaking as `E_RUNTIME`. Every core call in a command is wrapped:

```typescript
const reader = guard('Failed to open archive', () => openZip(bytes, options));
// or: try { … } catch (e) { throw mapZipError(e, 'Failed to add entries', entryName); }
```

`mapZipError` returns `CliError`s unchanged, maps `ZipError` subclasses (class → `E_*`, `err.code` → `zipCode`, `entryName` from `ZipSecurityError` / `ZipDataError` or the caller's fallback, `detail` from `ZipLimitError` / `ZipUnsupportedError` / CRC-bearing `ZipDataError`), maps Node `ErrnoException`s (`ENOENT`, `EACCES`, …) to `E_IO`, maps the unwrapped node:zlib errors of the sync tier (`Z_DATA_ERROR` / `Z_NEED_DICT` → `ZIP_DEFLATE_CORRUPT`, `Z_BUF_ERROR` → `ZIP_DEFLATE_TRUNCATED`, both `E_PARSE`, so the class never depends on the codec tier), and everything else to `E_RUNTIME`. Exit code conventions: `0` success, `1` runtime / check failure, `2` usage; `130` / `143` after SIGINT / SIGTERM (§5). Two CLI-side rules keep the classes honest: an unsafe **entry name** that arrives as data (`modify --add/--rename/--add-dir`, `create --stdin-name`, manifest names) is `E_INPUT` (exit 1) with `entryName`, and a malformed **flag** is `E_USAGE` (exit 2). Every CLI-side `E_NOT_FOUND` (`cat`, `inspect --entry`, `stream --cat`, `verify --entry`) carries `zipCode: "ZIP_ENTRY_NOT_FOUND"` and names the remedy.

### Determinism, dates and layout (`src/utils/zipops.ts`, `src/commands/create.ts`)

- **Dates are UTC wall-clock.** `--date <ISO>` (`create`, `modify`) and manifest `date` values are read as UTC: a string without a zone designator gets `Z`, a date-only string gets `T00:00:00Z`, and the stored DOS fields are identical on every host regardless of `TZ`. DOS resolution is 2 seconds (odd seconds are floored, with a warning) and the range is 1980–2107 (a warning outside it). `now` and `--mtime` are local time and not reproducible. `epoch` (the default) is the DOS epoch, 1980-01-01 00:00.
- **Reproducible vs canonical layout.** `create --stream` and any `addStream()` entry (`--stdin-name` is always streamed) use the data-descriptor layout: the same content as the buffered layout, different bytes (an engine contract; Info-ZIP and bsdtar do the same to a pipe). The `create` envelope reports `layout: "buffered" | "data-descriptor"`. `inspect` separates the two questions: `determinism.deterministic = epochTimestamps && canonicalOrder && utf8Flags` (reproducibility) and `determinism.canonicalLayout = noDataDescriptors` (form); `--check deterministic` and `--check canonical-layout` (alias of `no-data-descriptor`) gate them separately. A `create --stream` archive is reproducible run-to-run (`deterministic: true`, `canonicalLayout: false`).
- **Order.** `--order canonical` (default) sorts by raw-name bytes. `--order insertion` keeps the argv order across inputs (each directory still walks in sorted `readdir` order — `walkPaths({ preserveInputOrder })`); a manifest keeps its `entries` order. EPUB `mimetype`-first: `zipnative create book/mimetype book/META-INF book/OEBPS --base book --order insertion -o book.epub` (`--base` rebases the names, inputs are looked up where they are), or a manifest with `order: "insertion"`.
- **Encoder pinning.** `--deterministic` pins the pure-TS encoder (`tier: "pure-pinned"`); without it bytes are stable per Node + zlib build only (`ZIP_NONDETERMINISTIC_CODEC` when a pinned date meets an unpinned codec). `--parallel` is byte-identical to the sequential writer per tier. A `--codec` module registering method 0/8 still governs the bytes under `--deterministic` (see `prepareEngine`). `--stream --deterministic` buffers each streamed entry whole before compressing it (the pinned encoder is whole-buffer).
- `--chunk-size` (with `--stream` or `--stdin-name`) warns outside 1 KiB … 16 MiB (the engine clamps).

### The extraction sink (`src/utils/sink.ts`, `src/commands/extract.ts`, `src/commands/stream.ts`)

The engine never touches the filesystem: `extractZipStream` yields `{ path, entry, stream() }` with `path` already run through `sanitizeEntryPath()`. `utils/sink.ts` is the **one** place that turns a sanitised path into a file on disk, shared by `extract` (plan-then-write) and `stream --output-dir` (write-per-entry, after applying `sanitizeEntryPath()` itself because the forward reader does not sanitise names). Guards, in order:

1. **Lexical containment** — `safeJoin(root, path)` (`utils/io.ts`) proves the resolved target stays under the root before any I/O (`E_SECURITY` otherwise).
2. **Duplicate targets** — a case-folded key on case-insensitive filesystems (win32, darwin) and `--flat` collisions follow the same `--on-duplicate error|first|last` policy as the engine's own sanitised-path duplicates (`ZIP_EXTRACT_DUPLICATE_PATH` under `error`).
3. **Physical containment** — before `mkdir -p`, the nearest *existing* ancestor of the target directory is `realpath`'d and must sit under the root's `realpath`; the created directory is re-checked afterwards. A symlink or junction pre-planted inside the destination that points outside → `E_SECURITY` "Refusing to write through a link that leaves the output directory…", and nothing is created beyond the link.
4. **Exclusive open** — without `--overwrite` the file is created with `wx`, so a file that appears between the plan and the write is refused like any pre-existing one (no check-then-write window). A residual window exists only between the `realpath` check and the open; the documented posture is "use an empty or trusted destination".
5. **No partial output** — a failed write (CRC / size mismatch, I/O error) removes the partial file.

`extract` drains the lazy extraction generator without decompressing anything (PLAN; the `stream()` thunks are deferred; existing files are refused unless `--overwrite`, `E_IO`), then streams each entry with backpressure (WRITE). `--preserve-mode` applies `getUnixMode(entry) & 0o777` to files (POSIX only, never setuid/setgid/sticky; directories keep the umask); `--preserve-mtime` applies the entry timestamp.

Security defaults are the core's (`rejectTraversal`, `rejectSymlinks`, `onDuplicate: 'error'`, the limits). Opt-outs are skip-not-write: `--skip-unsafe` sets `rejectTraversal: false` (the engine silently drops unsafe names; the CLI lists them as `skipped: [{ reason: 'unsafe-path' }]`), `--allow-symlinks` writes the link **target text** as a regular file (a symlink is never materialised), `--skip-symlinks` drops them, `--skip-unsupported` skips encrypted entries and methods with no registered codec (`reason: 'unsupported'`).

### Overwrite policy and in-flight outputs (`src/utils/io.ts`, `src/utils/inflight.ts`)

Every command that writes a **file** refuses an existing one with `E_IO` "Refusing to overwrite existing file <path> (pass --overwrite)." and leaves it intact: `create -o`, `modify -o`, `cat -o`, `inflate -o`, `extract`, `stream --output-dir`, `batch --task create` (directory mode). `--overwrite` replaces it. Writing to stdout (`-` or no `-o`) is unaffected. `modify --in-place` writes an unpredictable, exclusively created temp file `<input>.tmp-<pid>-<12 hex>` next to the target and renames atomically. A file being written is registered in `utils/inflight.ts` (`writeOutput` registers only a file it created; `writeFileStream` registers on open); on SIGINT / SIGTERM the handler removes exactly those in-flight files — never a completed output, never the original of `--in-place` — and exits 130 / 143 (POSIX in practice; Windows has no signals for child processes).

### Diagnostics bridge (`src/utils/diagnostics.ts`)

The CLI owns stderr, so the core never gets to use its deduplicated `console.warn` default. Every core call receives a sink's `onDiagnostic`; the engine's handler contract delivers *every* diagnostic (no dedup), and the CLI sink **deduplicates by `(code, entryName)`** — an entry read twice in one run yields one row — and presents:

- **text mode** — one `warning: [CODE] entry 'x': message` / `info: [CODE] message` line on stderr, suppressed by `--quiet`;
- **`--json`** — nothing per diagnostic; the collected `DiagnosticRow[]` travels in the success envelope (`emitStatus({ …, ...sink.field() })`) or in the stdout report's `diagnostics` field (`list` / `inspect` / `verify` / `stream --format json`); NDJSON outputs print them as text on stderr; `verify` renders the engine report's own list (`diagnosticRows`) unchanged;
- **`--strict`** — handled by the core (`strict: true`): the first diagnostic throws `ZIP_STRICT_DIAGNOSTIC` → `E_CHECK_FAILED` before any output byte. `verify --strict` is the exception: the report is printed, then the verdict is `E_VERIFY_FAILED` when any diagnostic was emitted.

Which command can raise which of the 11 codes is tabulated in §5.

### Limits (`src/utils/limits.ts`)

Eight individual `--max-*` flags (one per `ZipLimits` key, `LIMIT_FLAGS`, CWE-tagged) rather than a JSON blob: they complete in every shell and are flat keys in `.zipnativerc.json`. Values are pre-validated (`E_USAGE` on malformed or zero values), so `ZIP_LIMIT_INVALID` is unreachable from the CLI; `none` disables a bound (`Infinity`) with a one-shot visible warning. `parseLimitFlags` returns `undefined` when none is set so the engine's defaults apply untouched; `effectiveLimits` merges for `doctor` and `inflate`'s default `--max-output`. The bounds also apply on the **write** side (`maxEntries`, `maxNameBytes`, `maxCommentBytes`, `maxExtraFieldBytes` on `create` / `modify`, `maxCentralDirectoryBytes` on `modify`).

`--max-input-size <size>` (global; default 4 GiB; `none` disables with one warning) is CLI-owned, **not** a `ZipLimits` key: it bounds every *buffered* read — stdin (byte-counted, the read aborts) and files (size checked via `stat` before reading) — for `list`, `inspect`, `verify`, `extract`, `cat`, `modify`, `create --stdin-name` (buffered), `inflate --sync` and `govern verify-issue`. Exceeding it is `E_LIMIT` with `detail { limit: "maxInputSize", configured, observed }`. The streaming commands are not bounded by it. `doctor` reports it under `limits` (`data.maxInputSize`) and counts it as an override.

| Memory profile | Commands |
|----------------|----------|
| Whole archive in memory (bounded by `--max-input-size`) | `list`, `inspect`, `cat`, `extract`, `verify`, `modify`; `create --stdin-name` without `--stream`; `inflate --sync` |
| Constant memory | `stream`, `crc32`, `inflate` (default path), `create --stream` (one chunk + the segment being copied) |
| Per-entry buffering | `create --stream --deterministic` (the pinned encoder is whole-buffer); `cat` of an entry whose `--codec` has `decompressSync` but no `decompressStream` |

### I/O Helpers (`src/utils/io.ts`)

```typescript
validatePath(p)                               // E_INPUT on ../ (also ..\) — applied to DATA-supplied paths only (manifest values)
assertStdinNotTty()                           // E_USAGE "No input: …" when stdin is a terminal and no path was given
readStdin(explicit?, maxBytes) / readFileOrStdin(path, maxBytes)   // '-' = stdin; maxBytes = --max-input-size → E_LIMIT
openInputStream(path)                         // Readable for streaming commands (unbounded)
installEpipeGuard()                           // EPIPE on stdout/stderr → exit 0, quietly
assertJsonSizeLimit(buf)                      // 50 MB cap → E_INPUT
readJsonInput(path, what)                     // read + cap + JSON.parse (E_IO / E_PARSE)
overwriteRefused(path, entryName?)            // the uniform E_IO refusal
writeOutput(bytes, path, { exclusive }) / writeStreamingOutput(chunks, path, opts)   // stdout when path is undefined / '-'
writeFileStream(path, chunks, opts)           // backpressure-aware; 'wx' when exclusive; registers in-flight
safeJoin(root, relPath)                       // lexical containment proof → E_SECURITY
pathExists(path) / unlinkQuiet(path)          // existence probe / best-effort partial-file removal
captureStdout(fn, maxBytes)                   // batch --manifest --json: one task's stdout → buffer (64 MiB cap → E_LIMIT captureBytes)
readableToByteSource(stream)                  // Node Readable → engine ByteSource
```

Argv-typed paths (`--input`, `-o`, `--output-dir`, `--base`, `--config`, `--codec`, `--comment-file`, positionals) are the user's own filesystem authority: `../a.zip` or `-o ../out.zip` is ordinary shell usage and is **not** refused. `validatePath()` still applies to values that arrive as **data**: batch-manifest path flags and create/modify-manifest `path` values. Entry **names** are always checked with the engine's `sanitizeEntryPath()`.

### Config file (`src/utils/config.ts`)

`.zipnativerc.json` is discovered cwd-upward (or `--config <file>`; `--no-config` skips). Flag names map to values; a top-level key naming a command is a command-scoped section. Precedence: explicit CLI flag > command section > global section > built-in. The file is capped at 1 MB and the `codec` key is **refused** anywhere in it (it executes user code).

---

## 4. CLI Commands — Full Reference

Every archive-touching command starts with `prepareEngine(args)`, resolves its input with `resolveInputPath` (`--input` / `-i`, else the first positional, else stdin — a terminal with nothing piped is refused with `E_USAGE`), reads it with `readArchiveBytes` (bounded by `--max-input-size`), opens it through `openArchive` (a `guard`ed `openZip`) with `commonOptions(args, sink)` = `{ strict, onDiagnostic, limits }`, and wraps every further core call. `--format, -f` exists on every command that has a format. The tables below quote `zipnative <command> --help`.

### `create`

**Purpose:** Build an archive from files, directories, stdin or a JSON manifest through the engine's deterministic writer.

```bash
zipnative create [<path>...] --output <out.zip> [options]
zipnative create --from-manifest <entries.json> -o <out.zip>
cat file | zipnative create --stdin-name <name> -o <out.zip>
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| positionals / `--input`, `-i` | string[] | — | Files and directories (walked recursively) |
| `--stdin-name` | string | — | Read stdin as one entry (always streamed → data-descriptor layout; buffered read bounded by `--max-input-size` unless `--stream`) |
| `--from-manifest` | path | — | `create-manifest` JSON; paths resolve against the manifest's directory; mutually exclusive with inputs |
| `--output`, `-o` | path | stdout | Output |
| `--overwrite` | boolean | false | Replace an existing output file (default: refuse, `E_IO`) |
| `--base` | dir | each input's parent | Entry names relative to this directory (an input outside it is `E_USAGE`) |
| `--prefix` | `dir/` | — | Prepended to every name |
| `--dir-entries` | boolean | false | Explicit directory entries (empty directories kept) |
| `--include` / `--exclude` | glob[] | — | Name filters (filtered names are reported as `skipped`) |
| `--follow-symlinks` | boolean | false | Dereference symlinks (realpath cycle guard); default: skipped with a warning; symlink entries are never written |
| `--method` | `store`\|`deflate` | `deflate` | Archive-default method |
| `--level` | 0–9 | 6 | Deflate level |
| `--deterministic` | boolean | false | Pin the pure-TS encoder (`tier: "pure-pinned"`): identical SHA-256 on every runtime |
| `--order` | `canonical`\|`insertion` | `canonical` | Central-directory order; `insertion` = argv order, directories walked name-sorted (EPUB `mimetype` first) |
| `--date` | `epoch`\|`now`\|ISO 8601 | `epoch` | Default entry timestamp; ISO dates are UTC wall-clock (1980–2107, 2-second resolution) |
| `--mtime` | boolean | false | Use each file's mtime (local time, non-reproducible) |
| `--comment` | string | — | Archive comment |
| `--comment-file` | path | — | Archive comment as raw bytes (`-` = stdin; exclusive with `--comment`; > 65535 bytes is `E_INPUT`) → `setComment(Uint8Array)` |
| `--entry-comment name=text` | string[] | — | Per-entry comments (an unknown name is `E_USAGE`) |
| `--preserve-mode` | boolean | false | External attributes from POSIX mode bits (masked to 0o777; a warning on Windows) |
| `--store-ext` | csv | — | Extensions stored uncompressed |
| `--stream` | boolean | false | `addStream()` per file + `writer.stream()` — constant memory, data-descriptor layout (same content, different bytes); entries > 4 GiB are refused (`ZIP_UNSUPPORTED_ZIP64_STREAMING`) |
| `--chunk-size` | size | 65536 | Output chunk size of the chunked writer; requires `--stream` or `--stdin-name`; warns outside 1 KiB … 16 MiB |
| `--parallel` | boolean | false | `createParallelZip` from `zipnative/worker`; byte-identical to the sequential writer per tier; refused (exit 2) with a `--codec` module registering method 0/8, or a `deflateImpl` without `--deterministic` |
| `--workers` / `--min-job-size` / `--job-timeout` | int / size / ms | cores−1 (max 8) / 32k / 60000 | Require `--parallel`; `--workers 0` = main thread; the pool is used only when ≥ 2 deflate jobs reach `--min-job-size` |
| `--dry-run` | boolean | false | Walk inputs, validate names, print the plan (`plan  name  size  method` / `skip  name  (reason)` lines on stdout, none under `--json` / `ZIPNATIVE_JSON`) + status envelope; nothing written |

**Manifest (`create-manifest`):** `{ version?: 1, comment? | commentBase64?, order?, date?, compression?: { method, level, deterministic }, entries: [{ name, path | data | dataBase64 | directory: true, method?, level?, deterministic?, date?, comment?, mode?, extraFields?: [{ id, hex | base64 }] }] }` — unknown keys are `E_INPUT`; every name is checked with `sanitizeEntryPath()`; duplicates are `E_INPUT`; `path` values get `validatePath()`; `commentBase64` is exclusive with `comment` (≤ 65535 bytes); `mode` is an octal string (`"0644"`, `"0755"`); `extraFields` are written verbatim (`id` 0–65535 or `"0x5455"`, exactly one of `hex` / `base64`, ≤ 65531 bytes each); `date` values are UTC wall-clock.

**Plan → writer:** each entry is `{ name, isDirectory, source: file | bytes | stdin, options: AddEntryOptions }`. `externalAttributes` are built as `(S_IFREG | perm) << 16` (files) or `((S_IFDIR | perm) << 16) | 0x10` (directories); setuid/setgid/sticky are never propagated; a raw external-attribute word is deliberately not exposed (ROADMAP).

**Status envelope:** `{ ok, command: 'create', dryRun, output, entries, files, directories, bytes, bytesIn, method, level, deterministic, order, stream, layout: 'buffered' | 'data-descriptor', parallel: false | { workers }, skipped: [{ name, path, reason: 'symlink' | 'special' | 'filtered' }], tier, diagnostics }` (`bytes` and `tier` are absent under `--dry-run`; under `--parallel` `tier` is `node-zlib` or `pure-pinned`, never `injected`).

**zipnative API used:** `createZip(options)` → `ZipWriter.add / addDirectory / addStream / setComment(Uint8Array) / toBytes / stream`; `loadParallelZip()` → `createParallelZip(options)` → `ParallelZipWriter`; `walkPaths({ preserveInputOrder })` for `--order insertion`; `sanitizeEntryPath` (name pre-check); `activeDeflateTier(deterministic)` for the `tier` field; `AddEntryOptions.extraFields` from manifests. Types: `CreateZipOptions`, `AddEntryOptions`, `ZipCompressionOptions`, `ZipExtraField`, `ByteSource`, `StreamOptions`, `ParallelZipOptions`.

### `modify`

**Purpose:** Incremental edits through the engine's modifier — untouched entries are never recompressed, and every one of them is verified before it is re-emitted.

```bash
zipnative modify --input <a.zip> --output <b.zip> [edits] [--compact]
zipnative modify --input <a.zip> --in-place [edits]
zipnative modify --input <a.zip> -o <b.zip> --from-manifest <edits.json>
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` | path | — (required; positional accepted) | Source archive (`-` = stdin, incompatible with `--in-place`); opened **eagerly** |
| `--remove` / `--rename from=to` / `--replace name=path` / `--add name=path` / `--add-dir` | string[] | — | Edits; `path` may be `-` (stdin, once); a bare `--add path` uses the basename; new names are checked with `sanitizeEntryPath()` (`E_INPUT` with `entryName`); `--add "dir/=payload"` is `E_INPUT` pointing at `--add-dir` |
| `--comment` | string | — | Archive comment (`""` clears) |
| `--comment-file` | path | — | Archive comment as raw bytes (`-` = stdin; exclusive with `--comment`; ≤ 65535 bytes) → `setComment(Uint8Array)`; shown as `"<N bytes>"` in `edits` |
| `--from-manifest` | path | — | `modify-manifest` JSON (below); mutually exclusive with the edit flags |
| `--method` / `--level` / `--deterministic` | — | engine defaults | Compression for **new** payloads (`ZipModifierOptions.compression`) |
| `--date` | `epoch`\|`now`\|ISO | `epoch` | `defaultDate` for new payloads (ISO = UTC wall-clock) |
| `--compact` | boolean | false | `saveCompact()` instead of `save()`: canonical rewrite, removed data truly gone, still no recompression; drops any SFX / prepended prefix and clears data-descriptor bits on copied entries |
| `--in-place` | boolean | false | Write back to the input path: exclusive temp file `<input>.tmp-<pid>-<12 hex>` + atomic rename; mutually exclusive with `--output` |
| `--output`, `-o` | path | stdout | Output path |
| `--overwrite` | boolean | false | Replace an existing `--output` file (default: refuse, `E_IO`) |
| `--dry-run` | boolean | false | Validate every edit against the archive (payloads loaded, modifier calls made, survivors verified); nothing saved |

**Manifest (`modify-manifest`):** `{ version?, comment? | commentBase64?, edits: [{ op: add | replace | remove | rename | add-dir, name, to?, path | data | dataBase64, method?, level?, deterministic?, date?, comment?, mode?, extraFields?: [{ id, hex | base64 }] }] }` — `mode` and `extraFields` apply to `add` / `replace` / `add-dir`; `path` values get `validatePath()`.

Edits are applied in the fixed order `remove → rename → replace → add / add-dir → comment`. Core refusals surface with their code: `ZIP_ENTRY_NOT_FOUND` (`E_NOT_FOUND`), `ZIP_ENTRY_EXISTS` (`E_INPUT`), `ZIP_DUPLICATE_ENTRY_NAME` (`E_INPUT`, duplicate-name source archives cannot be modified incrementally). When a destructive edit is saved append-only the CLI prints one `info:` line about data remanence and 7-Zip.

**Verification of re-emitted entries.** The archive is opened with `validate: 'eager'` (overlap / CD↔LFH structure checked before any edit) and, before `save()` / `saveCompact()`, `reader.verifyEntry()` runs on every entry that will be re-emitted verbatim (every entry not removed or replaced; renamed entries are verified under their original record). A lying record is refused instead of being laundered into a clean-looking archive: `!localHeaderMatch` → `E_SECURITY` `ZIP_CD_LFH_MISMATCH`; `!crcMatch` → `E_DATA` `ZIP_CRC_MISMATCH`; `!sizeMatch` → `E_DATA` `ZIP_SIZE_MISMATCH`, each with `entryName`. Encrypted entries and entries whose registered codec has no `decompressSync` cannot be verified: they are copied as-is and counted in `verifySkipped`. An entry with an unregistered method is `E_UNSUPPORTED` (load its `--codec`). The cost is one decompress pass over the untouched entries — never a recompress. It runs under `--dry-run` too and has **no opt-out** (an opt-out would write unverified bytes).

**Status envelope:** `{ ok, command: 'modify', dryRun, output, bytes, edits: [{ op, name, to? }], layout: 'append-only' | 'compact', changed, verified, verifySkipped, tier, diagnostics }` (`changed` is false when `save()` returned the same reference; `tier` is the deflate tier new payloads were compressed with).

**zipnative API used:** `openZip(bytes, { validate: 'eager', … })` → `ZipReader.entries / verifyEntry / bytes`; `createZipModifier(reader, options)` → `ZipModifier.addEntry / replaceEntry / removeEntry / renameEntry / setComment(string | Uint8Array) / save / saveCompact`; `getCodec` (verifiability check); `sanitizeEntryPath`; `activeDeflateTier`. Types: `ZipModifierOptions`, `AddEntryOptions` (incl. `extraFields`, `externalAttributes` from `mode`), `EntryVerification`.

### `list`

**Purpose:** Entry listing through the random-access reader; nothing is decompressed.

```bash
zipnative list --input <a.zip> [--format text|json|ndjson] [--long] [--validate eager] [--include g] [--exclude g] [--summary] [--fields a,b]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / positional | path | stdin | Archive |
| `--format`, `-f` | `text`\|`json`\|`ndjson` | `text` (`json` under `--json`) | `unzip -l`-style table, `{ archive, entries, diagnostics }`, or one `EntryRow` per line |
| `--long` | boolean | false | Adds `flags`, `versionMadeBy`, `versionNeeded`, `internalAttributes`, `externalAttributes`, `localHeaderOffset`, `dosDate`, `dosTime`, `extraFields`, `rawNameHex` and (when the entry has a comment) `commentHex` |
| `--validate` | `lazy`\|`eager` | `lazy` | `OpenZipOptions.validate` |
| `--include` / `--exclude` | glob[] | — | Name filters |
| `--summary` / `--fields` | — | — | `listSummary(report)` = `{ entries, files, directories, compressedSize, uncompressedSize, zip64, encrypted }` |

**JSON shape (`schema entries`):** `{ archive: { bytes, entryCount, isZip64, comment, commentBytes, commentHex? }, entries: EntryRow[], diagnostics: DiagnosticRow[] }`. `comment` is the lossy UTF-8 decode; `commentHex` (the raw bytes) is present whenever `commentBytes > 0`. `EntryRow` = `{ name, nameEncoding, isDirectory, isSymlink, method, methodName, compressedSize, uncompressedSize, ratio, crc32, lastModified, isEncrypted, usesZip64, usesDataDescriptor, unixMode, comment? }` (+ the `--long` fields); `unixMode` is four octal digits (`"0000"`, `"0644"`, `"4755"` — setuid digit first) or `null` when the producer recorded no Unix attributes (version-made-by host ≠ Unix, e.g. a Windows `Compress-Archive` archive), whatever the invoking host. NDJSON carries no wrapper: diagnostics go to stderr as text.

**zipnative API used:** `openZip(bytes, { validate, strict, onDiagnostic, limits })` → `ZipReader.entries()`, `entryCount`, `isZip64`, `comment` (raw bytes); per row `ZipEntry.rawName`, `getUnixMode`, `isSymlinkEntry`, `getCodec` (method names), `FLAG_*` masks.

### `inspect`

**Purpose:** Forensic archive report + CI assertions. Opens eagerly (every local header cross-checked, overlap table built).

```bash
zipnative inspect --input <a.zip> [--format json|text] [--entries | --entry <name>...] [--extra] [--check <assert>]...
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / positional | path | stdin | Archive (`validate: 'eager'` always) |
| `--format`, `-f` | `text`\|`json` | `text` (`json` under `--json`) | Output |
| `--entries` / `--entry` | boolean / string[] | — | Long-form rows (incl. `rawNameHex` / `commentHex`) for all / the named entries (`E_NOT_FOUND` + `ZIP_ENTRY_NOT_FOUND` if absent) |
| `--extra` | boolean | false | Extra-field payloads as hex |
| `--check` | string[] (comma-separable) | — | `deterministic`, `epoch-timestamps`, `canonical-order`, `utf8-names`, `canonical-layout` / `no-data-descriptor`, `no-zip64`, `zip64`, `no-encryption`, `no-symlinks`, `no-duplicates`, `no-diagnostics`, `store-only`, `deflate-only`, `max-entries=N`, `min-entries=N`, `max-uncompressed=<size>`, `max-ratio=N`, `has=<name>`, `method=store\|deflate\|<id>`; unknown or malformed → `E_USAGE` |
| `--summary` / `--fields` | — | — | `inspectSummary(report)` = `{ entries, bytes, uncompressedSize, zip64, encrypted, deterministic, canonicalLayout, diagnostics, checksPassed? }` |

**JSON shape (`schema inspect`):** `{ archive: { bytes, entryCount, isZip64, comment, commentBytes, commentHex?, prependedData, multipleEocd }, stats: { files, directories, compressedSize, uncompressedSize, ratio, methods: { [id]: n }, encrypted, symlinks, dataDescriptor, zip64Entries, utf8Names, cp437Names, duplicateNames, earliestDate, latestDate }, determinism: { epochTimestamps, canonicalOrder, utf8Flags, noDataDescriptors, canonicalLayout, deterministic }, entries?, diagnostics, checks?: [{ check, ok, detail }] }`. `deterministic = epochTimestamps && canonicalOrder && utf8Flags` (reproducibility); `canonicalLayout = noDataDescriptors` (form) — a `create --stream` archive is reproducible but not canonical. Text: `Determinism: reproducible, layout canonical` or `… layout data-descriptor (streamed)`. `prependedData` / `multipleEocd` are derived from the `ZIP_PREPENDED_DATA` / `ZIP_MULTIPLE_EOCD` diagnostics. Any failed check exits 1 / `E_CHECK_FAILED` **after** the report is printed.

**zipnative API used:** `openZip(bytes, { validate: 'eager', … })` → `entries()`, `getEntry(name)`, `comment`; `isSymlinkEntry`, `getUnixMode`, `FLAG_UTF8`, `FLAG_DATA_DESCRIPTOR`, `METHOD_STORE`, `METHOD_DEFLATE`, `getCodec`. Types: `ZipEntry`, `ZipExtraField`.

### `cat`

**Purpose:** Stream one or more entries to stdout (or `--output`) by random access.

```bash
zipnative cat --input <a.zip> --entry <name> [--entry <name>]... [-o <file>] [--raw] [--no-verify-crc]
zipnative cat <a.zip> <name> [<name>...]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / positional | path | — (required) | Archive |
| `--entry`, `-e` / positionals | string[] | — (required) | Entries, concatenated in order; directories are `E_INPUT`; an unknown name is `E_NOT_FOUND` + `ZIP_ENTRY_NOT_FOUND`; with duplicate names the last occurrence wins (`ZIP_DUPLICATE_NAME` diagnostic) |
| `--output`, `-o` | path | stdout | Partial file removed on failure |
| `--overwrite` | boolean | false | Replace an existing `--output` file (default: refuse, `E_IO`) |
| `--raw` | boolean | false | `readEntryRaw` — the compressed payload, zero-copy |
| `--no-verify-crc` | boolean | false | `ReadEntryOptions.verifyCrc = false` |
| `--dry-run` | boolean | false | `{ entries: [names], bytes }` (compressed sizes under `--raw`); nothing output |

The CRC is verified at the **end** of the stream (like `unzip -p`), so stdout may already carry bytes when `E_DATA` fires; with `--output` the partial file is removed. A `--codec` method that has `decompressSync` but no `decompressStream` is read through `readEntry()` (one entry buffered) instead of failing with `ZIP_UNSUPPORTED_CODEC_MODE`.

**Status envelope:** `{ ok, command: 'cat', dryRun, output, entries: string[], bytes, raw, verifyCrc, diagnostics }`.

**zipnative API used:** `openZip` → `getEntry(name)`, `readEntryStream(entry, { verifyCrc })`, `readEntry(entry, { verifyCrc })` (sync-only codec fallback), `readEntryRaw(entry)`; `getCodec`. Types: `ZipEntry`, `ReadEntryOptions`, `ZipCodec`.

### `extract`

**Purpose:** Write an archive's entries to disk, secure by default (the sink described in §3).

```bash
zipnative extract --input <a.zip> --output-dir <dir> [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / positional | path | stdin | Archive |
| `--output-dir`, `-d` | dir | — (required) | Root; created if missing; every path re-checked with `sanitizeEntryPath()` and contained under it |
| `--include` / `--exclude` / `--entry` | globs / names | — | Selection (filtered entries are reported as `skipped: filtered`) |
| `--overwrite` | boolean | false | Existing files otherwise `E_IO` |
| `--on-duplicate` | `error`\|`first`\|`last` | `error` | `ExtractOptions.onDuplicate` + the CLI's own check under `--flat` / case-fold collisions |
| `--skip-unsafe` | boolean | false | `rejectTraversal: false` — unsafe names (zip-slip, absolute, drive/UNC, NUL, ADS, device names) are skipped, listed as `unsafe-path`, never written |
| `--skip-unsupported` | boolean | false | Skip encrypted entries and methods with no registered codec (`reason: 'unsupported'`) instead of failing |
| `--allow-symlinks` / `--skip-symlinks` | boolean | false | `rejectSymlinks: false`; mutually exclusive; the target text is written as a regular file / the entry is dropped |
| `--flat` | boolean | false | Basenames only (no directory entries created) |
| `--buffered` | boolean | false | `extractZip` (in memory) instead of `extractZipStream` |
| `--preserve-mode` / `--preserve-mtime` | boolean | false | `chmod(mode & 0o777)` on files (POSIX; directories keep the umask) / `utimes` |
| `--dry-run` | boolean | false | `plan  path  size` / `skip  name  (reason)` lines (none under `--json` / `ZIPNATIVE_JSON`) + envelope; every destination proven safe, existing files already refused; nothing written |

**Status envelope:** `{ ok, command: 'extract', dryRun, outputDir, entries, files, directories, bytes, skipped: [{ name, reason: 'unsafe-path' | 'symlink' | 'filtered' | 'duplicate' | 'unsupported' }], symlinksAsData, diagnostics }`.

**zipnative API used:** `openZip` → `entries()` (directory entries + inventory), `extractZipStream(bytes, options)` / `extractZip(bytes, options)`, `sanitizeEntryPath` (directory entries), `getUnixMode`, `isSymlinkEntry`, `getCodec` (unsupported detection), `METHOD_STORE` / `METHOD_DEFLATE`. Types: `ExtractOptions`, `ExtractedStreamEntry`, `ExtractedEntry`.

### `stream`

**Purpose:** Forward-only reader over unseekable input through `iterateZipEntries`.

```bash
curl ... | zipnative stream [--list] [--format ndjson]
curl ... | zipnative stream --output-dir <dir>
cat a.zip | zipnative stream --cat <name>
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / positional | path | stdin | Read sequentially (not bounded by `--max-input-size`) |
| `--list` / `--output-dir`, `-d` / `--cat` | — | list | Mode (`--output-dir` and `--cat` are mutually exclusive; `--cat` is repeatable) |
| `--format`, `-f` | `text`\|`json`\|`ndjson` | `text` (`ndjson` under `--json`; `json` when `--summary` / `--fields` is given) | Listing format (NDJSON rows are emitted as entries arrive) |
| `--long` | boolean | false | `flags`, `versionNeeded`, `dosDate`, `dosTime`, `extraFields`, `rawNameHex` (no CD-only fields, no comments) |
| `--include` / `--exclude`, `--overwrite`, `--on-duplicate`, `--flat`, `--preserve-mtime` | as `extract` | — | Extraction controls (the sink of §3) |
| `--skip-unsafe` | boolean | false | Skip unsafe names (the forward reader does not sanitise; the CLI applies `sanitizeEntryPath` + `safeJoin`) |
| `--skip-unsupported` | boolean | false | Skip encrypted / unknown-method entries (`E_UNSUPPORTED` → `skipped: unsupported`) |
| `--preserve-mode` / `--allow-symlinks` / `--skip-symlinks` | — | — | **Refused** (`E_USAGE`): attributes live only in the central directory |
| `--summary` / `--fields` | — | — | `streamSummary` = `{ entries, bytes, descriptorEntries, bytesKnown, trust }` |
| `--dry-run` | boolean | false | Iterate and plan; nothing written |

**JSON shape (`schema stream`):** `{ mode: 'list', trust: 'local-headers-only', entries: EntryRow[] (isSymlink: null, usesZip64: null, unixMode: null), diagnostics }`. A `warning:` caveat line is printed at start (suppressed by `--quiet`). **Descriptor rows carry zeros:** an entry written with a data descriptor (flag bit 3 — every `create --stream` entry) has `compressedSize: 0`, `uncompressedSize: 0`, `crc32: "00000000"` in its local header, and the forward reader exposes no measured values; `--list` must still inflate-and-discard each such entry to find the next header. The summary makes this explicit: `bytes` excludes descriptor entries, `descriptorEntries` counts them and `bytesKnown` is `descriptorEntries === 0`. Attribute-only directory entries (no trailing `/`) show as files in forward mode. Use `list` on the complete file for authoritative sizes.

**Status envelope (extract / cat modes, and list under `--dry-run` — `bytes` and `skipped` only in extract / cat modes):** `{ ok, command: 'stream', mode, trust, dryRun, outputDir?, entries, bytes?, skipped?: [{ name, reason: 'unsafe-path' | 'filtered' | 'duplicate' | 'unsupported' }], stoppedAt: 'central-directory' | 'eof', diagnostics }`. A missing `--cat` name is `E_NOT_FOUND` + `ZIP_ENTRY_NOT_FOUND`; a stream that ends without a central directory is `ZIP_STREAM_TRUNCATED` (`E_PARSE`); a failure before the first header carries no `entryName`. `--max-entry-size` on a descriptor entry surfaces as `ZIP_INFLATE_OUTPUT_OVERFLOW` (`E_DATA`) rather than `ZIP_LIMIT_EXCEEDED`, because the size is only known after inflation.

**Custom-method caveat (engine limitation):** the forward reader can only pump store and deflate payloads. An entry using a `--codec` method fails mid-stream with `ZIP_DECOMPRESSION_FAILED` (`E_DATA`) after bytes may already have been emitted, and `--skip-unsupported` does not help because the method *is* registered. Use `list` / `cat` / `extract` on the complete file for such archives.

**zipnative API used:** `iterateZipEntries(source, { strict, onDiagnostic, limits })` → `StreamedZipEntry.header / data() / skip()`; `StreamedZipHeader.rawName` (→ `rawNameHex`); `sanitizeEntryPath`; `FLAG_DATA_DESCRIPTOR`. Types: `ByteSource`, `StreamedZipHeader`, `IterateZipOptions`.

### `verify`

**Purpose:** One-call deep integrity verification; the report is the artefact, the exit code is the verdict.

```bash
zipnative verify --input <a.zip> [--entry <name>]... [--format json|text] [--strict] [--summary] [--fields a,b]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / positional | path | stdin | Archive |
| `--entry`, `-e` | string[] | — | Verify only the named entries: eager structural check first, then `verifyEntry()` per name; an unknown name is `E_NOT_FOUND` + `ZIP_ENTRY_NOT_FOUND` before any output |
| `--format`, `-f` | `text`\|`json` | `text` (`json` under `--json`) | Output |
| `--strict` | boolean | false | Fail when any diagnostic was emitted (report printed first) |
| `--summary` / `--fields` | — | — | `verifySummary` = `{ ok, entries, failed, skipped, diagnostics, selected?, error? }` |

**JSON shape (`schema verify`):** the engine's `ZipVerificationReport` — `{ ok, error: { code, message } | null, entryCount, entries: [{ name, ok, crcMatch, sizeMatch, localHeaderMatch, skipped?: 'encrypted' | 'stream-only-codec' }], diagnostics }` — plus `{ failed, skipped, strict, selected? }`. With `--entry`, `entries` lists only the selected names, `entryCount` stays the archive total and `selected: [names]` is added (the text header reads `(N selected of M)`). `verifyZip` never throws for archive problems; a structural refusal lands in `report.error` and the CLI's `E_VERIFY_FAILED` envelope carries `zipCode = report.error.code` — **without** `detail` (the engine's report error is `{ code, message }` only). Encrypted entries are honestly `skipped`, never faked as verified.

**zipnative API used:** `verifyZip(bytes, { limits })` (whole archive); `openZip(bytes, { validate: 'eager', … })` → `getEntry(name)`, `verifyEntry(entry)` (`--entry`); `getCodec` (stream-only codec detection). Types: `ZipVerificationReport`, `VerifiedEntry`, `VerifyZipOptions`, `EntryVerification`.

### `crc32`

**Purpose:** CRC-32 (IEEE 802.3, the ZIP checksum) of files or stdin, constant memory.

```bash
zipnative crc32 [<file>...] [--seed <hex>] [--expect <hex>] [--format text|json]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| positionals / `--input`, `-i` | path[] | stdin | Inputs, 64 KiB chunks (not bounded by `--max-input-size`) |
| `--seed` | hex | 0 | Continue a running checksum from this value |
| `--expect` | hex | — | Exactly one input; mismatch → `E_CHECK_FAILED` with `detail: { expectedCrc, actualCrc }` (reported once) |
| `--format`, `-f` | `text`\|`json` | `text` (`json` under `--json`) | `<crc>  <bytes>  <file>` lines, or `{ files: [{ file, crc32, value, bytes }], expect? }` on stdout |

**Status envelope:** `{ ok, command: 'crc32', files, bytes, expect?, matched? }` (stderr, in addition to the stdout report).

**zipnative API used:** `crc32(chunk, seed)`.

### `inflate`

**Purpose:** Decompress a raw DEFLATE (RFC 1951) or registered-codec stream with a mandatory output bound.

```bash
zipnative inflate [--input <file>] [--output <file>] [--max-output <size>] [--method deflate|store|<id>] [--sync] [--allow-trailing]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / `--output`, `-o` | path | stdin / stdout | I/O (partial output removed on failure); the default path streams and is not bounded by `--max-input-size` |
| `--overwrite` | boolean | false | Replace an existing `--output` file (default: refuse, `E_IO`) |
| `--max-output` | size | effective `maxEntryUncompressedSize` (1 GiB) | Hard bound (`none` → `Number.MAX_SAFE_INTEGER`, only for trusted input) |
| `--method` | `deflate`\|`store`\|int | `deflate` | `store` is a bounded pass-through; other ids need `--codec` (`ZIP_UNSUPPORTED_METHOD` / `ZIP_UNSUPPORTED_CODEC_MODE` otherwise) |
| `--sync` | boolean | false | Buffer the input (bounded by `--max-input-size`), `codec.decompressSync(input, bound)` |
| `--allow-trailing` | boolean | false | Silence the trailing-bytes warning |
| `--dry-run` | boolean | false | `{ method, methodName, maxOutput, sync, output }`; nothing decompressed |

**Status envelope:** `{ ok, command: 'inflate', dryRun, output, method, methodName, bytesIn, bytesConsumed, bytesOut, leftover, maxOutput, sync, tier }`. `bytesConsumed` is the inflator's exact figure on the streaming path (`bytesIn − leftover`); it equals `bytesIn` on the `--sync` / codec paths (a whole-buffer codec has no notion of a stream end). Errors: `ZIP_DEFLATE_CORRUPT` / `ZIP_DEFLATE_TRUNCATED` → `E_PARSE`, `ZIP_INFLATE_OUTPUT_OVERFLOW` → `E_DATA`.

**zipnative API used:** `createInflator(maxOutput)` → `Inflator.push / finished / leftover / bytesConsumed / end` (default path); `getCodec(method)` → `ZipCodec.decompressSync / decompressStream`; `METHOD_DEFLATE`, `METHOD_STORE`; `activeDeflateTier`.

### `batch`

**Purpose:** Directory-mode orchestration or a declarative manifest pipeline.

```bash
zipnative batch --input-dir <dir> --output-dir <dir> [--task create] [create flags]
zipnative batch --input-dir <dir> --task verify
zipnative batch --manifest <tasks.json> [--continue-on-error] [--allow-codec-load]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input-dir` | dir | — | Directory mode: `--task create` archives each immediate subdirectory; `--task verify` verifies every `*.zip` in it |
| `--output-dir` | dir | — | Destination for `--task create` (`<output-dir>/<name>.zip`) |
| `--task` | `create`\|`verify` | `create` | Directory-mode task |
| `--overwrite` | boolean | false | Replace existing `<name>.zip` files (default: each is refused, `E_IO`) |
| `--concurrency` | int 1–64 | 4 | Pool size (`E_USAGE` outside the range) |
| `--fail-fast` | boolean | false | Stop scheduling after the first failure |
| `--manifest` | path | — | Manifest mode (mutually exclusive with `--input-dir`) |
| `--continue-on-error` | boolean | false | Keep running independent tasks after a failure (dependents of a failed task are skipped) |
| `--allow-codec-load` | boolean | false | Permit a `codec` flag inside tasks (executes user code) |
| `--format`, `-f` | `text`\|`json` | `text` (`json` under `--json`) | Report format |
| `--summary` / `--fields` | — | — | `{ ok, command, mode, task?, dryRun?, total, succeeded, failed, skipped? }` / projection |
| `--method` / `--level` / `--deterministic` / `--order` / `--date` / `--comment` + every other `create` flag | — | — | Forwarded to each directory-mode `create` |
| `--dry-run` | boolean | false | Validate and print the plan; execute nothing |

**Directory mode:** `--task create` runs the full `create` command per immediate subdirectory (`--input <dir> --base <dir> --output <output-dir>/<name>.zip`, every other flag forwarded), `--task verify` runs `verifyZip` per `*.zip`. JSON: `{ ok, command: 'batch', mode: 'directory', task, dryRun?, total, succeeded, failed, results: [{ input, output?, ok, error, code? }] }`.

**Manifest mode** (`--manifest`): [`src/utils/manifest.ts`](../src/utils/manifest.ts) parses `{ version: 1, tasks: [{ id, command, flags }] }` **strictly before anything runs** — structural violations exit 2 / `E_USAGE`, value violations (bad or duplicate id, non-whitelisted command, bad `@ref`) exit 1 / `E_INPUT`, a `codec` flag without `--allow-codec-load` exit 2 / `E_USAGE`. Path flags (`input`, `output`, `output-dir`, `from-manifest`, `base`, and the path half of `add` / `replace`) get `validatePath()` (the `..` refusal that argv paths no longer get) and resolve against the manifest's directory; `"@<id>"` substitutes an earlier task's resolved output (or output-dir). Tasks run sequentially, fail-fast unless `--continue-on-error`. Each task's command function is loaded lazily and called in-process with the resolved flags. The 10 manifest commands are `create`, `list`, `inspect`, `extract`, `cat`, `verify`, `stream`, `modify`, `crc32`, `inflate`; `batch`, `govern`, `schema`, `completion`, `doctor` are explicitly forbidden. Manifests are size-capped (50 MB) and bounded to 1 000 tasks. Exit 1 carries the first failing task's `E_*` code and `zipCode`.

**The `--json` stdout contract.** Under `--json` (or `--format json`) stdout is **one** batch document. Each task runs under `captureStdout()` (64 MiB cap → `E_LIMIT` with `detail { limit: "captureBytes", configured, observed }`); what it wrote lands in `tasks[i].report` (parsed JSON object, or an array for NDJSON), `tasks[i].stdout` (text that was not JSON) and `tasks[i].stdoutBytes`. Tasks that would write their artefact to stdout — `create` / `modify` / `cat` / `inflate` without `output`, and `stream --cat` — are refused at validation (`E_USAGE`, exit 2, also under `--dry-run`). Task status envelopes still go to stderr. Text mode keeps the interleaved contract. JSON: `{ ok, command: 'batch', mode: 'manifest', dryRun?, total, succeeded, failed, skipped, tasks: [{ id, command, ok, output?, skipped?, report?, stdout?, stdoutBytes?, error?: { code, message, zipCode? } }] }`.

**zipnative API used:** `verifyZip` (directory verify); everything else through the command modules.

### `doctor`

**Purpose:** Environment / capability preflight. Fully offline. Exit 0 when every check passes, 1 otherwise.

```bash
zipnative doctor [--format json|text]
```

`{ ok, checks: [{ name, status: 'ok' | 'warn' | 'error', value, detail, data? }] }` with the checks `cli`, `node` (≥ 22 → `error` otherwise), `zipnative` (package version vs the engine's `VERSION` export → `warn` on disagreement, `error` if absent), `deflate-tier` (`activeDeflateTier(false)`: `node-zlib` / `injected` ok, `pure` ok only under `--pure-codecs`), `deflate-pinned` (`activeDeflateTier(true)`), `web-streams` (`CompressionStream` / `DecompressionStream`), `workers` (worker_threads + `zipnative/worker/zip-worker.js` resolvable, default worker count), `codecs` (registered methods incl. `--codec` modules), `limits` (effective `ZipLimits` with `--max-*` overrides; `data` carries the numbers — `{ maxEntries, maxEntryUncompressedSize, maxTotalUncompressedSize, maxCompressionRatio, maxNameBytes, maxExtraFieldBytes, maxCommentBytes, maxCentralDirectoryBytes, maxInputSize }`, `"none"` when disabled), `commands` (`COMMANDS.length`).

**zipnative API used:** `VERSION`, `activeDeflateTier`, `getCodec`, `DEFAULT_ZIP_LIMITS`, `METHOD_STORE`, `METHOD_DEFLATE`.

### `schema`

**Purpose:** Hand-authored, versioned JSON Schemas (Draft 2020-12) for the CLI's shapes; `$id` = `https://zipnative.dev/schema/cli/<version>/<subject>.schema.json`. The subjects are listed in §5.

### `completion`

`bash` | `zsh` | `fish` | `powershell` (alias `pwsh`) scripts generated from the `COMMANDS` table (per-command flags + `GLOBAL_FLAGS`). `PATH_FLAGS` (`--input --output --output-dir --input-dir --base --from-manifest --manifest --config --codec --comment-file`) complete files (bash `_filedir` / `compgen -f`, zsh `_files`, fish `-r -F`); every other value flag is fish `-r`; booleans take nothing.

### `govern`

`rules` prints `AGENT_RULES_TEXT`, `policy` prints `AI_GOVERNANCE_POLICY` (JSON), `verify-issue <draft.md>` (or `--input`, `-` = stdin; 50 MB cap, bounded by `--max-input-size`) runs the pure `validateGovernanceDraft` and exits 1 / `E_POLICY` on a violation. Errors: proposing an external runtime dependency, or no fenced reproduction block. Warnings: missing `minimal_reproduction` / `environment` / `expected_behavior` hints, or an apparent anti-goal proposal (encryption, other formats, multi-disk, repair). `tests/utils/governance-sync.test.ts` pins the policy to `.github/ai-governance.json` and every rule line to `.github/AGENT_RULES.md`. Fully offline.

---

## 5. Agent Automation Contract

The CLI is designed so an autonomous AI agent — or any program — can drive it deterministically. There is **no separate runtime**: agent support is a thin presentation layer over the normal dispatch (the planned `zipnative-mcp` server is a different integration; this is about driving the CLI process directly).

### Channels

| Channel | Carries |
|---------|---------|
| **stdout** | The primary artifact: archive bytes (`create`, `modify`), entry bytes (`cat`, `stream --cat`, `inflate`), a JSON or text report (`list`, `inspect`, `verify`, `crc32`, `batch`, `doctor`, `govern`), a JSON Schema (`schema`), or a completion script. `extract` and `stream --output-dir` write files. |
| **stderr** | All diagnostics: progress, warnings, engine diagnostics as text, and the agent JSON envelopes. Colour is decided on stderr (`NO_COLOR` off, `FORCE_COLOR` on, `TERM=dumb` off, otherwise only when stderr is a TTY; `--no-color` sets `NO_COLOR`). |
| **exit code** | `0` success · `1` runtime / check failure · `2` usage · `130` / `143` after SIGINT / SIGTERM (in-flight outputs removed). Unchanged in every mode. |

### Process contract

- **Flags are order-independent.** `zipnative --json list a.zip` and `zipnative list a.zip --json` are the same invocation; a boolean flag never consumes the next token; `--flag=false` is the explicit off form; combined short flags (`-lq`) are refused (exit 2).
- **Environment.** The global flags set `ZIPNATIVE_JSON`, `ZIPNATIVE_DRY_RUN`, `ZIPNATIVE_QUIET`, `ZIPNATIVE_STRICT`, `ZIPNATIVE_PURE_CODECS` (`=1`) for the process, and the same variables are honoured when the caller sets them (`ZIPNATIVE_JSON=1 zipnative extract …` is agent mode without a flag; `create --dry-run` / `extract --dry-run` print no text plan under it either). `ZIPNATIVE_DEBUG=1` prints stack traces. Colour: `NO_COLOR`, `FORCE_COLOR`, `TERM`. The veraZIP scripts read `VERAZIP_REQUIRED`, `VERAZIP_REPORT_DIR`, `VERAZIP_TOOLS`.
- **No input and a terminal.** When no path is given and stdin is a TTY, the command refuses with `E_USAGE` (exit 2) "No input: pass --input <file> (or a positional path), or pipe data on stdin." instead of hanging; an explicit `-` is never guarded.
- **Closed pipe.** `EPIPE` on stdout or stderr (`| head`) ends the process quietly with exit 0.
- **Unknown command** → `E_USAGE`, exit 2 (also with `--help`); flags but no command (`zipnative --frob`, `zipnative --json`) → exit 2 "No command given"; bare `zipnative` → usage, exit 0.
- **Signals.** SIGINT → 130, SIGTERM → 143 after removing exactly the files being written (never a completed output, never the original of `--in-place`).

### `--json` envelope

Global `--json` sets `ZIPNATIVE_JSON=1` (in `index.ts`). In that mode:

- On **failure**, a single object is written to stderr: `{ "ok": false, "command": <name|null>, "error": { "code": "E_*", "message": "…", "zipCode"?: "ZIP_*", "entryName"?: "…", "detail"?: { … } } }` (`schema error`).
- On **success**, `create`, `modify`, `extract`, `stream` (extract / cat modes, or list under `--dry-run`), `cat`, `inflate` and `crc32` write a status line: `{ "ok": true, "command": "create", "dryRun": false, "output": "out.zip", "bytes": 12345, … }` (`schema status`; command-specific fields are documented per command in §4).
- `list`, `inspect`, `verify`, `stream --list`, `batch`, `doctor`, `crc32`, `govern verify-issue` put their result document on stdout as JSON (`--json` selects the JSON format and compacts it). Under `--json`, `batch --manifest` owns stdout: one document, with each task's stdout captured into `tasks[i].report` / `stdout` / `stdoutBytes` (§4).

The helpers live in [`src/utils/agent.ts`](../src/utils/agent.ts): `isJsonMode()`, `isDryRun()`, `isQuiet()`, `isStrict()`, `buildErrorEnvelope()`, `emitJsonError()`, `emitStatus()` (a no-op outside `--json`), `progress()` (suppressed by `--quiet`).

### Stable error classes

Defined in [`src/utils/error.ts`](../src/utils/error.ts) as `ErrorCode` and carried on every `CliError.code`:

| Code | Meaning | Exit |
|------|---------|------|
| `E_USAGE` | Missing/invalid flag or argument, unknown command, a `batch --json` task that would write its artefact to stdout (also `ZIP_INVALID_OPTION`, `ZIP_LIMIT_INVALID`) | 2 |
| `E_INPUT` | User-supplied payload, entry name or manifest failed validation — incl. an unsafe entry **name** given as data (`entryName` set) and `modify --add "dir/=payload"` — or a conflict (entry exists, duplicate name); a `..` in a manifest path value | 1 |
| `E_PARSE` | The bytes are not a valid ZIP / DEFLATE stream / JSON document (structural) | 1 |
| `E_IO` | Filesystem or stream I/O failure, including "Refusing to overwrite existing file <path> (pass --overwrite)." | 1 |
| `E_SECURITY` | Hostile archive shape (zip-slip, overlap, symlink, duplicate path, CD/LFH mismatch — also on a `modify` survivor — Zip64 spoofing) or the CLI sink guard tripped (lexical or physical containment) | 1 |
| `E_DATA` | Integrity failure: CRC / size / data-descriptor mismatch (also on a `modify` survivor), decompression failure, output overflow | 1 |
| `E_LIMIT` | A named bound was exceeded: a `ZipLimits` key, `maxInputSize` (`--max-input-size`) or `captureBytes` (`batch --json` task output) — `detail: { limit, configured, observed }` | 1 |
| `E_UNSUPPORTED` | Encryption, unknown method (also a `modify` survivor with an unregistered method), multi-disk, zip64 streaming, CD-less descriptor, codec mode (`detail: { feature }`) | 1 |
| `E_NOT_FOUND` | A named entry does not exist in the archive — always with `zipCode: "ZIP_ENTRY_NOT_FOUND"` and `entryName` | 1 |
| `E_VERIFY_FAILED` | `verify` verdict is negative (`zipCode` set for structural refusals, never `detail`) | 1 |
| `E_CHECK_FAILED` | `inspect --check`, `crc32 --expect`, or a `--strict` diagnostic escalation failed | 1 |
| `E_POLICY` | `govern verify-issue` found an AI-governance policy violation | 1 |
| `E_RUNTIME` | Catch-all runtime error (also `ZIP_API_MISUSE`, `ZIP_INTERNAL`) | 1 |

When no code is passed, `CliError` derives one from the exit code (`2 → E_USAGE`, otherwise `E_RUNTIME`).

### The 39 `ZIP_*` causes → `E_*` classes

`error.zipCode` is zipnative's frozen `err.code`, verbatim (registry: [`docs/data/errors.json`](data/errors.json), which also carries `raisedWhen` / `remedy` per code). The mapping below is `ZIP_TO_CLI` in [`src/utils/ziperr.ts`](../src/utils/ziperr.ts):

| `zipCode` | Class | Raised when |
|-----------|-------|-------------|
| `ZIP_INVALID_OPTION` | `E_USAGE` (2) | An option value fails validation inside the engine (compression level, chunk size, argument shape) — the CLI pre-validates, so reaching it is a CLI bug |
| `ZIP_INPUT_TOO_LARGE` | `E_LIMIT` | The pure-TS deflate encoder received more than 2 GiB in one call |
| `ZIP_ENTRY_NOT_FOUND` | `E_NOT_FOUND` | A named entry does not exist where one is required (names are case-sensitive) |
| `ZIP_ENTRY_EXISTS` | `E_INPUT` | A named entry already exists where absence is required (add over existing; rename onto existing) |
| `ZIP_API_MISUSE` | `E_RUNTIME` | A usage contract was violated (CLI bug — report it) |
| `ZIP_STRICT_DIAGNOSTIC` | `E_CHECK_FAILED` | `--strict` escalated the first conformance diagnostic |
| `ZIP_INTERNAL` | `E_RUNTIME` | An internal invariant broke — an engine bug, not an input problem |
| `ZIP_EOCD_NOT_FOUND` | `E_PARSE` | Input < 22 bytes, no end-of-central-directory record, or no self-consistent candidate (not a ZIP, truncated, hostile trailing bytes) |
| `ZIP_EOCD_INCONSISTENT` | `E_PARSE` | The EOCD contradicts the layout (entry counts disagree, CD overlaps the record) |
| `ZIP_ZIP64_LOCATOR_MISSING` | `E_PARSE` | A zip64 sentinel is set but the locator is absent |
| `ZIP_ZIP64_EOCD_MISPLACED` | `E_PARSE` | The zip64 EOCD is not where the locator points |
| `ZIP_CD_INCONSISTENT` | `E_PARSE` | The central-directory walk contradicts the declared counts or size |
| `ZIP_RECORD_TRUNCATED` | `E_PARSE` | A record or an entry's payload overruns the available bytes |
| `ZIP_SIGNATURE_MISMATCH` | `E_PARSE` | An expected PK signature is absent at a declared position |
| `ZIP_STREAM_TRUNCATED` | `E_PARSE` | A forward byte stream (`stream`) ended mid-record or mid-entry |
| `ZIP_VALUE_UNREPRESENTABLE` | `E_PARSE` | A 64-bit field exceeds `Number.MAX_SAFE_INTEGER` |
| `ZIP_INVALID_ENTRY_NAME` | `E_INPUT` | A writer-side entry name violates the rules (empty, NUL, backslash, absolute, `..`) |
| `ZIP_DUPLICATE_ENTRY_NAME` | `E_INPUT` | Duplicate names where uniqueness is required (writer `add()`, modifier source archives) |
| `ZIP_DEFLATE_TRUNCATED` | `E_PARSE` | A deflate stream ends mid-block |
| `ZIP_DEFLATE_CORRUPT` | `E_PARSE` | A deflate stream is structurally invalid (Huffman codes, symbols, back-references, block types) |
| `ZIP_ENTRY_OVERLAP` | `E_SECURITY` | Two entries share bytes (CWE-405) — always rejected, no opt-out |
| `ZIP_CD_LFH_MISMATCH` | `E_SECURITY` | A local header contradicts the central directory on the method (CWE-436); also raised by `modify` for an untouched entry it would otherwise re-emit |
| `ZIP_ZIP64_CONTRADICTION` | `E_SECURITY` | A zip64 value contradicts a non-sentinel classic field (CWE-1288) |
| `ZIP_PATH_TRAVERSAL` | `E_SECURITY` | An entry name escapes the extraction root or is a Windows reserved device name (CWE-22 / CWE-67); `--skip-unsafe` skips instead |
| `ZIP_SYMLINK_REJECTED` | `E_SECURITY` | A symlink entry under the default `rejectSymlinks` (CWE-59); `--allow-symlinks` / `--skip-symlinks` |
| `ZIP_EXTRACT_DUPLICATE_PATH` | `E_SECURITY` | Two entries resolve to the same output path under `--on-duplicate error` (CWE-694) |
| `ZIP_CRC_MISMATCH` | `E_DATA` | Decompressed bytes fail the declared CRC-32 (`detail: { expectedCrc, actualCrc }`); also raised by `modify` for an untouched entry |
| `ZIP_SIZE_MISMATCH` | `E_DATA` | Declared vs measured sizes, or local vs central metadata, contradict; also raised by `modify` for an untouched entry |
| `ZIP_INFLATE_OUTPUT_OVERFLOW` | `E_DATA` | Inflate produced more than the declared or permitted output (`inflate --max-output`; `--max-entry-size` on a `stream` descriptor entry) |
| `ZIP_DESCRIPTOR_MISMATCH` | `E_DATA` | No data-descriptor form matches the measured CRC and sizes of a bit-3 entry |
| `ZIP_DECOMPRESSION_FAILED` | `E_DATA` | The active codec failed mid-decompression on a corrupt payload (also `stream` on a custom-method entry) |
| `ZIP_LIMIT_EXCEEDED` | `E_LIMIT` | A configured `ZipLimits` bound was exceeded, reading or writing (`detail: { limit, configured, observed }`) — raise the matching `--max-*` only for trusted input |
| `ZIP_LIMIT_INVALID` | `E_USAGE` (2) | The limits override itself is invalid — unreachable from the CLI (values are pre-validated) |
| `ZIP_UNSUPPORTED_ENCRYPTION` | `E_UNSUPPORTED` | An entry is encrypted — unsupported in 1.x by policy (`detail.feature`: `zipcrypto` \| `strong-encryption`); `extract` / `stream --skip-unsupported` skip it |
| `ZIP_UNSUPPORTED_METHOD` | `E_UNSUPPORTED` | A compression method has no registered codec (`--codec` one); `extract` / `stream --skip-unsupported` skip it |
| `ZIP_UNSUPPORTED_MULTI_DISK` | `E_UNSUPPORTED` | The archive is multi-disk / spanned |
| `ZIP_UNSUPPORTED_ZIP64_STREAMING` | `E_UNSUPPORTED` | A `create --stream` (or `--stdin-name`) entry exceeds 4 GiB — buffer it (omit `--stream`) or split it |
| `ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR` | `E_UNSUPPORTED` | `stream` met a bit-3 entry it cannot delimit (store / encrypted / custom codec) — use `list` / `extract` on the complete file |
| `ZIP_UNSUPPORTED_CODEC_MODE` | `E_UNSUPPORTED` | A registered codec supports only the other access mode (`cat` falls back to `readEntry()` for sync-only codecs; `extract --buffered` needs `decompressSync`) |

Only two causes exit 2 (`ZIP_INVALID_OPTION`, `ZIP_LIMIT_INVALID`); every other cause exits 1. Three are unreachable from the CLI by design (`ZIP_API_MISUSE`, `ZIP_INTERNAL`, `ZIP_LIMIT_INVALID`) and two need inputs above 2 GiB / 4 GiB (`ZIP_INPUT_TOO_LARGE`, `ZIP_UNSUPPORTED_ZIP64_STREAMING`).

### Diagnostics (11 codes, never thrown unless `--strict`)

Row shape: `{ code, severity, message, entryName? }` (`schema diagnostics`). The sink deduplicates by `(code, entryName)` per run. "Raised by" is derived from the engine's emission sites (`zip-eocd.ts`, `zip-cd.ts`, `zip-reader.ts`, `zip-iterate.ts`, `zip-builder.ts`, `zip-modifier.ts`) and the CLI paths that reach them; `batch` surfaces whatever its tasks raise.

| Code | Severity | Raised by | Meaning |
|------|----------|-----------|---------|
| `ZIP_PREPENDED_DATA` | info | any random-access reader: `list`, `inspect`, `cat`, `extract`, `verify`, `modify` | Bytes precede the archive (SFX stub / concatenation); offsets shifted (`inspect` also reports `archive.prependedData`) |
| `ZIP_MULTIPLE_EOCD` | info | any random-access reader: `list`, `inspect`, `cat`, `extract`, `verify`, `modify` | Several EOCD signatures (an append-only `modify` output, a nested zip); the last self-consistent one was used (`archive.multipleEocd`) |
| `ZIP_NAME_MISMATCH` | warning | read paths only: `cat`, `extract`, `verify`, `modify` (survivor verification, `--compact` copies) — `list` / `inspect` never compare names | Local header name differs from the central directory; the CD wins |
| `ZIP_UNICODE_PATH_CONFLICT` | warning | any random-access reader (central-directory parse) | 0x7075 Unicode Path extra disagrees with the header name; header wins |
| `ZIP_INVALID_UTF8_NAME` | warning | any random-access reader (central-directory parse) and `stream` (local headers) | Bit 11 claims UTF-8 but the bytes are not; decoded as CP437 (`rawNameHex` under `--long` keeps the bytes) |
| `ZIP_DUPLICATE_NAME` | warning | name-keyed lookups: `cat`, `inspect --entry`, `verify --entry` (the reader's name index) — `list` / `inspect` / whole-archive `verify` iterate without it; `inspect` counts `stats.duplicateNames` and `--check no-duplicates` gates them | Duplicate names in the central directory; `getEntry` returns the last |
| `ZIP_EXTRA_FIELD_MALFORMED` | warning | any random-access reader (central-directory parse) | An extra field overruns its length and was skipped |
| `ZIP_ZIP64_EXTRA_IGNORED` | warning | any random-access reader (central-directory parse) | Zip64 extra supplied a value for a non-sentinel field; header wins |
| `ZIP_TIMESTAMP_NOT_PINNED` | info | `create --date now` (also `--parallel`, `batch --task create`), `modify --date now` | The wall clock makes the output non-reproducible |
| `ZIP_NONDETERMINISTIC_CODEC` | info | `create` with a pinned `--date <ISO>` on a non-pure tier without `--deterministic` (also `--parallel`, `batch --task create`) | Timestamps pinned but a platform codec in use — pass `--deterministic` |
| `ZIP_DEAD_BYTES_RATIO` | info | `modify` (append-only `save()`) | > 50 % dead bytes; removed content remains recoverable — pass `--compact` |

### `--dry-run`

`create`, `extract`, `modify`, `stream`, `cat`, `inflate` and `batch` accept `--dry-run` (sets `ZIPNATIVE_DRY_RUN=1`). Inputs are fully validated — inputs walked and names checked, archives opened and every destination proven safe (existing files refused), edits applied to the modifier and survivors verified, manifests parsed and their `@ref` graph resolved (incl. the `--json` stdout policy) — but **no output is produced or written**. Commands read `hasFlag(args.flags, 'dry-run') || isDryRun()` so a direct command call and the global flag both work. Text mode prints `plan …` / `skip …` lines (not under `--json` / `ZIPNATIVE_JSON`); `--json` adds `"dryRun": true` to the status envelope.

### Token economy — output projection

The JSON that `list` / `inspect` / `verify` / `stream` / `batch` write to stdout is the bulk of an agent's token cost. The projection layer in [`src/utils/projection.ts`](../src/utils/projection.ts) (`emitJsonReport`, `selectFields`, `serializeJson`, `parseFieldList` — pure, zero-dep) shrinks it through three composable levers:

| Lever | Flag | Effect |
|-------|------|--------|
| Compact serialization | *(auto under `--json`)* | Minified JSON; `--pretty` opts back into 2-space output. Non-`--json` runs stay pretty for humans. |
| Canonical summary | `--summary` | Collapses the report to a minimal verdict (below). |
| Dot-path projection | `--fields a,b.c` | Keeps only the named paths; an array segment maps over its elements; an unknown top-level path is silently omitted, a missing leaf under an array segment yields `null` for that element. |

Order of application (`emitJsonReport`): `--summary` first (the caller's canonical shape replaces the full report), then `--fields` projects whichever document is being emitted — so `--summary --fields entries,failed` keeps two keys of the summary — then compact-vs-pretty.

| Command | `--summary` shape |
|---------|-------------------|
| `list` | `{ entries, files, directories, compressedSize, uncompressedSize, zip64, encrypted }` |
| `inspect` | `{ entries, bytes, uncompressedSize, zip64, encrypted, deterministic, canonicalLayout, diagnostics, checksPassed? }` |
| `verify` | `{ ok, entries, failed, skipped, diagnostics, selected?, error? }` |
| `stream` | `{ entries, bytes, descriptorEntries, bytesKnown, trust: "local-headers-only" }` |
| `batch` | `{ ok, command, mode, task?, dryRun?, total, succeeded, failed, skipped? }` (drops `results` / `tasks`) |

The summary shapes are schema-pinned: `schema entries-summary`, `inspect-summary`, `verify-summary`, `stream-summary`, `batch-summary`.

### `schema` subjects (22)

- **Inputs:** `create-manifest` (default), `modify-manifest`, `batch-manifest`
- **Outputs:** `entries`, `entries-summary`, `inspect`, `inspect-summary`, `verify`, `verify-summary`, `stream`, `stream-summary`, `batch`, `batch-summary`, `doctor`, `govern-verify`, `crc32`
- **Envelopes:** `status`, `error`
- **Registries:** `errors` (the `E_*` codes, the 39-entry `zipnativeToCli` map, the diagnostic codes — data, generated from the source tables), `limits` (the eight bounds with defaults, CWEs and flags), `diagnostics`
- **Meta:** `manifest` (the capability manifest — commands, flags, global flags incl. `--max-input-size`, dry-run / projected / manifest command lists, codes, limits, schemas — data)

`schema list` enumerates them. Every schema `$id` embeds the CLI version so callers can detect drift.

### `batch --manifest` for agents

The manifest is the recommended way to run a multi-step pipeline (create → verify → extract) in **one process invocation** with a single JSON summary: validate it against `schema batch-manifest`, pre-flight with `--dry-run`, give every `create` / `modify` / `cat` / `inflate` task an `output` (under `--json` batch owns stdout), and remember that a `codec` flag inside a manifest is refused unless `batch` itself carries `--allow-codec-load` — a manifest obtained from elsewhere can never execute user code on its own. A manifest has the filesystem access of the user who invokes `batch` — the same trust level as flags typed on the command line — except that its path values still get the `..` refusal.

See [AGENTS.md](../AGENTS.md) for the agent-facing summary.

---

## 6. Security Model

### The engine's guards (zipnative 1.0.0)

| Threat | Defence | CWE | `zipCode` | CLI switch |
|--------|---------|-----|-----------|------------|
| Zip-slip path traversal (`../`, absolute paths, drive letters, UNC, backslashes, NUL, NTFS ADS, Windows reserved device names) | `rejectTraversal: true` by default; `sanitizeEntryPath()` for external sinks | CWE-22 / CWE-67 | `ZIP_PATH_TRAVERSAL` | `extract --skip-unsafe` (skip, never write) |
| Decompression bombs (high ratio, nesting, entry floods) | per-entry and total output caps, ratio bound, entry-count cap — enforced *during* inflation | CWE-400 / CWE-409 | `ZIP_LIMIT_EXCEEDED` | `--max-entry-size`, `--max-total-size`, `--max-ratio`, `--max-entries` |
| Symlink entries redirecting extraction | `rejectSymlinks: true` by default | CWE-59 | `ZIP_SYMLINK_REJECTED` | `extract --allow-symlinks` (target text as data) / `--skip-symlinks` |
| Overlapping entries | always-on overlap detection over central-directory ranges | CWE-405 | `ZIP_ENTRY_OVERLAP` | none |
| Parser-differential smuggling (CD vs local headers) | the central directory is authoritative; method divergence is fatal, name divergence is diagnosed | CWE-436 | `ZIP_CD_LFH_MISMATCH` / `ZIP_NAME_MISMATCH` (diagnostic) | none (`--strict` escalates the diagnostic) |
| Ambiguous EOCD (trailing garbage, multiple candidates) | only a self-consistent EOCD closest to EOF is accepted | — | `ZIP_EOCD_NOT_FOUND` / `ZIP_MULTIPLE_EOCD` (diagnostic) | none |
| Zip64 field spoofing | cross-checked against every non-sentinel classic field | CWE-1288 | `ZIP_ZIP64_CONTRADICTION` | none |
| Duplicate entry names (shadowing) | `onDuplicate: 'error'` by default | CWE-694 | `ZIP_EXTRACT_DUPLICATE_PATH` | `--on-duplicate first\|last` |
| Integer overflow (> 2^53 sizes/offsets) | 64-bit fields read via BigInt and rejected above `Number.MAX_SAFE_INTEGER` | CWE-190 | `ZIP_VALUE_UNREPRESENTABLE` | none |
| Oversized names / extra fields / comments / central directory | `maxNameBytes`, `maxExtraFieldBytes`, `maxCommentBytes`, `maxCentralDirectoryBytes` (read and write side) | CWE-400 | `ZIP_LIMIT_EXCEEDED` | `--max-name-bytes`, `--max-extra-bytes`, `--max-comment-bytes`, `--max-cd-bytes` |

### The CLI's own rows

| Threat | Mitigation |
|--------|-----------|
| Destination escaping `--output-dir` after sanitisation (lexical) | `safeJoin(root, path)` re-proves containment of every destination (`E_SECURITY`); `stream` additionally applies `sanitizeEntryPath()` because the forward reader does not |
| A link pre-planted inside the destination redirecting `mkdir -p` (physical) | Before creating a directory the nearest existing ancestor is `realpath`'d and must sit under the root's `realpath`; the created directory is re-checked; a link that leaves the root is `E_SECURITY` and nothing is created beyond it. Residual window: between `realpath` and open — use an empty or trusted destination |
| A file appearing between the plan and the write (check-then-write race) | Exclusive open (`wx`) unless `--overwrite`; the late file is refused exactly like a pre-existing one |
| Silent overwrite of any file the CLI writes | Uniform policy: `create -o`, `modify -o`, `cat -o`, `inflate -o`, `extract`, `stream --output-dir`, `batch --task create` refuse an existing file (`E_IO`) unless `--overwrite`; `modify --in-place` uses an unpredictable exclusive temp file + atomic rename; stdout is unaffected |
| Case-fold collision on case-insensitive filesystems | On win32 / darwin case-folded duplicates are refused (`ZIP_EXTRACT_DUPLICATE_PATH`) unless `--on-duplicate first\|last` |
| Partial outputs on failure or interruption | `cat --output`, `extract`, `stream --output-dir`, `inflate --output`, `modify --in-place` remove the partial file / temp file; SIGINT / SIGTERM remove the in-flight outputs and exit 130 / 143 |
| Unbounded buffered input (memory exhaustion via a huge archive or payload) | `--max-input-size` (default 4 GiB, CWE-400) bounds every buffered read — stdin byte-counted, files `stat`-checked — with `E_LIMIT` `{ limit: "maxInputSize" }`; streaming commands stay constant-memory |
| Path traversal via data-supplied paths | `validatePath()` rejects `../` in batch-manifest path flags and create/modify-manifest `path` values before any filesystem access. Argv-typed paths (`--input`, `-o`, `--output-dir`, `--base`, `--config`, `--codec`, `--comment-file`) are the user's own authority and are not second-guessed |
| Lying records laundered by an incremental save | `modify` opens eagerly and verifies every entry it re-emits verbatim (CRC-32, sizes, local header); refusals carry `E_DATA` / `E_SECURITY` + `entryName`; encrypted / stream-only-codec entries are counted in `verifySkipped`; no opt-out |
| Memory exhaustion via large JSON | 50 MB cap before `JSON.parse` (manifests, drafts); 1 MB cap on `.zipnativerc.json`; 1 000-task cap on batch manifests; 64 MiB cap on a captured task stdout (`batch --json`) |
| Unbounded raw DEFLATE (`inflate`) | Mandatory output bound (`--max-output`, default = the effective `--max-entry-size`) |
| Executing user code | `--codec` is the only dynamic import: argv only, refused from config files, refused inside manifests without `--allow-codec-load`. Codecs serve **both** sides: a module registering method 0/8 also drives the writer (`warning:` line, also under `--deterministic`), a `deflateImpl` replaces the deflate tier (`tier: "injected"`) unless `--deterministic`; `create --parallel` refuses either because the worker pool never sees the module |
| Hostile config file planted in a repository | The `codec` key is refused; config only supplies flag defaults and never runs code |
| Data remanence in `modify` | Documented on `--help` and printed as an `info:` line; `--compact` is the deletion path |
| Forward-reader trust (`stream`) | Attribute-dependent flags refused; `trust: "local-headers-only"` in every JSON output; a `warning:` line at start; descriptor rows carry zero sizes (`bytesKnown: false` in the summary) |
| Supply-chain risk | Zero extra runtime dependencies; Trusted Publishing (OIDC) with provenance; CodeQL + Scorecard CI; CycloneDX SBOM per release, attested with `actions/attest-build-provenance` |
| False conformance claims | Blocking veraZIP gate (`verazip.yml` on Linux + Windows on every PR, and pre-publish in `publish.yml`): a 37-archive corpus — 33 conformant (30 CLI-produced or crafted + 3 hostile-but-conformant archives `extract` must refuse) and 4 raw-crafted negative canaries — validated by an engine-independent ISO/IEC 21320-1 parser (`33 PASS, 4 XFAIL, 0 FAIL`) |

**Network:** none. No command opens a socket in any mode.

See [SECURITY.md](../SECURITY.md) for the full policy.

---

## 7. Troubleshooting

### `E_SECURITY` / `ZIP_PATH_TRAVERSAL` on an archive that "works in unzip"

The archive contains a name that cannot be made safe — `../` segments, an absolute path, a drive letter, or a **Windows reserved device name** (`CON`, `NUL`, `aux.h`, `COM1`…) — and the CLI refuses on every platform. Inspect it (`zipnative inspect --input a.zip --entries --format json`), then extract with `--skip-unsafe` to skip those entries (nothing unsafe is ever written).

### `E_SECURITY` "Refusing to write through a link that leaves the output directory"

A symlink or junction inside `--output-dir` points outside it and an entry would be written through it. The sink refuses before creating anything beyond the link. Extract into an empty or trusted directory.

### `E_IO` "Refusing to overwrite existing file … (pass --overwrite)"

Every file the CLI writes is created exclusively: `create -o`, `modify -o`, `cat -o`, `inflate -o`, `extract`, `stream --output-dir` and `batch --task create` refuse an existing target. Pass `--overwrite` to replace it, or write to stdout / a fresh path. Re-run scripts must opt in explicitly.

### `E_LIMIT` / `ZIP_LIMIT_EXCEEDED` with `detail.limit = "maxCompressionRatio"`

An entry inflates more than 1024:1 — the shape of a decompression bomb. If the archive is trusted (sparse files, large zero-filled payloads), raise the named bound explicitly: `--max-ratio 4096`. `none` disables a bound and prints a warning.

### `E_LIMIT` with `detail.limit = "maxInputSize"`

A buffered read (the whole archive for `list` / `inspect` / `cat` / `extract` / `verify` / `modify`, or a payload for `create --stdin-name` / `inflate --sync`) exceeds `--max-input-size` (default 4 GiB). Raise it only for trusted input, or use a streaming command (`stream`, `crc32`, `inflate`, `create --stream`).

### `E_VERIFY_FAILED` with `zipCode`

`verify` found a structural refusal: the envelope's `zipCode` is `report.error.code` (`ZIP_ENTRY_OVERLAP`, `ZIP_EOCD_NOT_FOUND`, …) and there is no `detail` (the engine report carries `{ code, message }` only). Read the report on stdout for the detail; there is no repair mode by design.

### `modify` refuses with `E_DATA` / `E_SECURITY` and an `entryName` I did not touch

`modify` verifies every entry it would re-emit verbatim. The named entry's record lies (CRC, sizes or local header contradict the central directory) and the CLI will not copy it into a clean-looking archive. `verify` the source, then rebuild it from a trusted origin; `--remove` / `--replace` of that entry also clears the refusal. There is no `--skip-verify`.

### `modify` fails with `E_UNSUPPORTED` / `ZIP_UNSUPPORTED_METHOD`

An untouched entry uses a compression method with no registered codec, so it cannot be verified. Load the codec with `--codec <module>` (it is then verified when the codec has `decompressSync`, otherwise copied as-is and counted in `verifySkipped`).

### `doctor` reports `deflate-tier: pure`

`node:zlib` was not resolved (or `--pure-codecs` was passed). Compression still works but through the pure-TS tier. Every archive-touching command calls `prepareEngine()`, so this only happens under `--pure-codecs`; if it happens otherwise, the bundle was altered — `zipnative` must stay external (see [CLAUDE.md](../CLAUDE.md)).

### `create --parallel` fails with `E_USAGE` under `--pure-codecs` or with a `--codec` module

`--parallel` compresses in a separate worker bundle that resolves `node:zlib` itself and never sees a loaded `--codec` module, so neither `--pure-codecs` nor a method-0/8 override nor a `deflateImpl` can govern it — the CLI refuses instead of reporting a tier it did not use. Add `--deterministic` (the pinned encoder in every worker; a `deflateImpl` is then irrelevant, a method-0/8 override still refused) or drop `--parallel`.

### `modify` output looks wrong in 7-Zip

7-Zip's CLI mis-reads the append-only layout (it does not honour the final central directory). Pass `--compact`; every other mainstream reader (unzip, bsdtar, Python, jar, Expand-Archive) and zipnative read the append-only output correctly.

### `stream` fails with `ZIP_STREAM_TRUNCATED` or `ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR`

The producer cut the stream, or the archive uses data descriptors the forward reader cannot delimit (store + bit 3, encrypted + bit 3, custom codec + bit 3). Download the whole file and use `list` / `extract`.

### `stream` shows zero sizes, or fails with `ZIP_DECOMPRESSION_FAILED` on a custom-method entry

Data-descriptor entries (every `create --stream` entry) carry zero sizes and CRC in their local header; the forward reader exposes no measured values, `--list` must inflate each such entry to find the next one, and `--summary` reports `bytesKnown: false`. Entries compressed with a `--codec` method cannot be pumped by the forward reader at all (engine limitation): the failure is `E_DATA`, may follow bytes already written, and `--skip-unsupported` does not apply because the method is registered. Use `list` / `cat` / `extract` on the complete file.

### `Error: Path traversal detected`

A **data-supplied** path — a batch-manifest path flag or a create/modify-manifest `path` value — contains `..`. Argv paths (`--input ../a.zip`, `-o ../out.zip`) are not checked. Rewrite the manifest with paths relative to its directory (or absolute paths).

### Timestamps differ between machines

`--date <ISO>` and manifest dates are UTC wall-clock and identical on every host; `--date now` and `--mtime` are local time and not reproducible; DOS resolution is 2 seconds and the range is 1980–2107 (warnings are printed when a value is floored or clamped). The engine renders `lastModified` from the DOS fields in local time, so the JSON instant of the same archive can differ between hosts with different `TZ` while the stored bytes do not — compare `dosDate` / `dosTime` under `--long`, or the archive hash.

### Piping binary output

`create` and `cat` write bytes to stdout by default. Redirect (`> out.zip`) or pass `--output <file>`; read the `--json` envelope from stderr. A closed downstream pipe (`| head`) ends the process with exit 0.

---

## 8. zipnative API Mapping

Every one of the 77 exports of zipnative 1.0.0 (72 from `zipnative`, 5 from `zipnative/worker` — [`docs/data/core-exports.json`](data/core-exports.json)) mapped to its CLI touchpoint. "Bridge" means the export is re-exported by [`src/core-bridge/index.ts`](../src/core-bridge/index.ts); `tests/docs/consistency.test.ts` checks that every name below stays present. The **Reach** column grades each row honestly (per the 1.0.0 coverage audit): **capability** — the behaviour behind the export is exercisable from a command; **type** — re-exported (or aliased) for typing only, nothing user-visible depends on it beyond `tsc`.

### Reading, random access, streams

| Export | Kind | Reach | CLI touchpoint |
|--------|------|-------|----------------|
| `openZip` | function | capability | `openArchive()` in `utils/zipops.ts` — `list`, `inspect`, `cat`, `extract`, `verify --entry`, `modify` |
| `OpenZipOptions` | interface | capability | `openArchive(bytes, options)`; `list --validate` sets `validate`; `inspect`, `modify` and `verify --entry` force `eager` |
| `ReadEntryOptions` | interface | capability | `cat --no-verify-crc` → `{ verifyCrc: false }` on `readEntryStream` / `readEntry` |
| `ZipReader` | interface | capability | `entries()` (`list`, `inspect`, `extract`, `modify`), `getEntry()` (`cat`, `inspect --entry`, `verify --entry`), `readEntryStream()` / `readEntryRaw()` (`cat`), `readEntry()` (`cat` sync-only codec fallback; `extract --buffered` through `extractZip`), `verifyEntry()` (`modify` survivor verification, `verify --entry`), `entryCount` / `isZip64` / `comment` (raw bytes → `commentHex`) / `bytes` (`modify` `changed`) |
| `iterateZipEntries` | function | capability | `stream` — the forward reader over stdin / pipes |
| `IterateZipOptions` | type | capability | `commonOptions(args, sink)` passed to `iterateZipEntries` (`--strict`, `--max-*`, the diagnostics sink) |
| `StreamedZipEntry` | interface | capability | `stream`: `header` / `data()` / `skip()` per local entry (`pumpEntry`); custom-method entries cannot be pumped (engine limitation, §7) |
| `StreamedZipHeader` | interface | capability | `rowFromHeader()` in `utils/entryfmt.ts` — the forward `EntryRow` (no CD-only fields); `rawName` → `rawNameHex` under `--long`; descriptor headers carry zero sizes (`descriptorEntries` in the summary) |
| `ByteSource` | type | capability | `readableToByteSource()` in `utils/io.ts` — `stream` input, `create --stream` file sources, `create --stdin-name` (the Node `Readable` adapter; a Web `ReadableStream` source is not applicable to a CLI) |

### Extraction

| Export | Kind | Reach | CLI touchpoint |
|--------|------|-------|----------------|
| `extractZip` | function | capability | `extract --buffered` (in-memory extractor; needs `decompressSync` codecs) |
| `extractZipStream` | function | capability | `extract` (default streaming extractor; plan phase defers `stream()`) |
| `sanitizeEntryPath` | function | capability | Name pre-check in `create` (`walk.ts`, manifests, `--stdin-name`), `modify` (`assertSafeName`), directory entries in `extract`, every name in `stream`, and the basis of `safeJoin` |
| `ExtractOptions` | interface | capability | `extract`: `rejectTraversal` (`--skip-unsafe`), `rejectSymlinks` (`--allow-symlinks` / `--skip-symlinks`), `onDuplicate`, `filter` (`--include` / `--exclude` / `--entry` / `--skip-unsupported`), limits |
| `ExtractedEntry` | interface | capability | `extract --buffered` items (`{ path, data, entry }`) |
| `ExtractedStreamEntry` | interface | capability | `extract` items (`{ path, entry, stream() }`) |

### Writing

| Export | Kind | Reach | CLI touchpoint |
|--------|------|-------|----------------|
| `createZip` | function | capability | `create` (buffered and `--stream`), `batch --task create` |
| `ZipWriter` | interface | capability | `add()` / `addDirectory()` / `addStream()` / `toBytes()` / `stream()` in `create`; `setComment(string)` is expressed as `CreateZipOptions.comment`, `setComment(Uint8Array)` by `--comment-file` / manifest `commentBase64` |
| `CreateZipOptions` | interface | capability | `create`: `order` (`insertion` = argv order / manifest order), `defaultDate` (UTC wall-clock), `compression`, `comment` (string), `strict`, `onDiagnostic`, `limits` |
| `AddEntryOptions` | interface | capability | Per-entry `compression`, `date`, `comment`, `externalAttributes` (mode bits from `--preserve-mode` / manifest `mode` on both manifests; a raw u32 word is deliberately not exposed — ROADMAP), `extraFields` (manifest `extraFields: [{ id, hex \| base64 }]` on `create` entries and `modify` add / replace / add-dir edits) |
| `ZipCompressionOptions` | interface | capability | `--method` / `--level` / `--deterministic` (`parseCompression` in `utils/zipops.ts`) and manifest `compression` |
| `StreamOptions` | interface | capability | `--chunk-size` → `writer.stream({ chunkSize })` under `--stream` or `--stdin-name` (warned outside the engine's 1 KiB … 16 MiB clamp) |
| `createParallelZip` (`./worker`) | function | capability | `create --parallel` via `loadParallelZip()` (lazy, with an explicit `workerUrl`) |
| `ParallelZipOptions` (`./worker`) | interface | capability | `create --parallel --workers / --min-job-size / --job-timeout` (+ every `CreateZipOptions` field); `workerUrl` is bridge-owned by decision (an argv flag would point the worker at arbitrary code); a loaded `--codec` module is refused rather than silently ignored |
| `ParallelZipWriter` (`./worker`) | interface | capability | The `create` writer under `--parallel` (`toBytes()` is awaited; `stream()` under `--parallel --stream`) |
| `ByteSource` (`./worker`) | type | type | The worker subpath re-exports the root declaration unchanged (`node_modules/zipnative/dist/worker/index.d.ts`); the bridge imports `ByteSource` from the root entry only and never from `zipnative/worker`, so this row is a re-export alias of the same type, not a second touchpoint |
| `StreamOptions` (`./worker`) | interface | type | Same as the row above — the root `StreamOptions` is the one the CLI uses for `stream({ chunkSize })`, also under `--parallel --stream` |

### Verification and modification

| Export | Kind | Reach | CLI touchpoint |
|--------|------|-------|----------------|
| `verifyZip` | function | capability | `verify` (whole archive), `batch --task verify` |
| `VerifyZipOptions` | interface | capability | `verify` / `batch --task verify` pass `{ limits }` from the `--max-*` flags |
| `ZipVerificationReport` | interface | capability | The `verify` report body (`ok`, `error: { code, message }` — no `detail`, `entryCount`, `entries`, `diagnostics`) |
| `VerifiedEntry` | interface | capability | `verify` rows (`name`, `ok`, `crcMatch`, `sizeMatch`, `localHeaderMatch`, `skipped?: 'encrypted' \| 'stream-only-codec'`) |
| `EntryVerification` | interface | capability | The per-entry `crcMatch` / `sizeMatch` / `localHeaderMatch` triple: base of `VerifiedEntry`, the `verify --entry` rows, and `modify`'s survivor verification (`verified` / `verifySkipped`) |
| `createZipModifier` | function | capability | `modify` — over an eagerly opened reader, every survivor verified before `save()` / `saveCompact()` |
| `ZipModifier` | interface | capability | `addEntry` / `replaceEntry` / `removeEntry` / `renameEntry` / `setComment(string \| Uint8Array)` (`--comment`, `--comment-file`, `commentBase64`) / `save` / `saveCompact` (drops an SFX prefix, clears descriptor bits) in `modify` |
| `ZipModifierOptions` | interface | capability | `modify --method / --level / --deterministic / --date` + common options |

### Entry attributes, entries and shared types

| Export | Kind | Reach | CLI touchpoint |
|--------|------|-------|----------------|
| `getUnixMode` | function | capability | `unixMode` column (`list`, `inspect`; four octal digits), `extract --preserve-mode` (files only) |
| `isSymlinkEntry` | function | capability | `isSymlink` column, `inspect` symlink count and `--check no-symlinks`, `extract --skip-symlinks` / `symlinksAsData` |
| `ZipEntry` | interface | capability | `rowFromEntry()` (incl. `rawName` → `rawNameHex`, raw `comment` → `commentHex`), `inspect` statistics, `cat` / `extract` / `modify` planning |
| `ZipExtraField` | interface | capability | Read: `extraFields` rows under `--long` (ids, names, lengths) and hex under `inspect --extra`; write: manifest `extraFields` (`parseExtraFields` in `utils/zipops.ts`) |
| `ZipCommonOptions` | interface | capability | `commonOptions(args, sink)` = `{ strict, onDiagnostic, limits }` for every core entry point |
| `ZipDiagnostic` | interface | capability | `createDiagnosticSink()` converts each one to a `DiagnosticRow` (deduplicated by code + entry) |
| `ZipDiagnosticCode` | type | capability | The 11-code vocabulary listed in `ZIP_DIAGNOSTIC_CODES` (`utils/ziperr.ts`) and `schema diagnostics`; every code is reachable (§5 "raised by") |
| `ZipDiagnosticHandler` | type | capability | The sink's `onDiagnostic` |
| `ZipLimits` | interface | capability | The eight `--max-*` flags (`LIMIT_FLAGS` in `utils/limits.ts`), `doctor` `limits` check (`data`), `schema limits` |
| `DEFAULT_ZIP_LIMITS` | const | capability | Defaults shown by `--help`, `doctor`, `schema limits` / `manifest`, and `inflate`'s default `--max-output` |

### Errors

| Export | Kind | Reach | CLI touchpoint |
|--------|------|-------|----------------|
| `ZipError` | class | capability | `mapZipError()` — the `instanceof` root; `err.code` → `zipCode` |
| `ZipFormatError` | class | capability | → `E_PARSE` (or `E_INPUT` for the two entry-name codes) |
| `ZipSecurityError` | class | capability | → `E_SECURITY`; supplies `entryName` |
| `ZipDataError` | class | capability | → `E_DATA`; supplies `entryName` and `detail: { expectedCrc, actualCrc }` |
| `ZipLimitError` | class | capability | → `E_LIMIT` (`ZIP_LIMIT_INVALID` → `E_USAGE`); supplies `detail: { limit, configured, observed }` |
| `ZipUnsupportedError` | class | capability | → `E_UNSUPPORTED`; supplies `detail: { feature }` |
| `ZipErrorCode` | type | type | `ZIP_TO_CLI satisfies Record<ZipErrorCode, …>` — a compile-time guard: a new core code fails `tsc` (the codes themselves reach the envelope as `zipCode`) |
| `ZipBaseErrorCode` | type | type | The 7 base-code rows of `ZIP_TO_CLI`; 4 reachable from the CLI (`ZIP_API_MISUSE`, `ZIP_INTERNAL` unreachable by design, `ZIP_INPUT_TOO_LARGE` needs > 2 GiB) |
| `ZipFormatErrorCode` | type | type | The 13 format-code rows of `ZIP_TO_CLI` (all reachable) |
| `ZipSecurityErrorCode` | type | type | The 6 security-code rows of `ZIP_TO_CLI` (all reachable) |
| `ZipDataErrorCode` | type | type | The 5 data-code rows of `ZIP_TO_CLI` (all reachable) |
| `ZipLimitErrorCode` | type | type | The 2 limit-code rows of `ZIP_TO_CLI` (`ZIP_LIMIT_INVALID` pre-empted by the CLI) |
| `ZipUnsupportedErrorCode` | type | type | The 6 unsupported-code rows of `ZIP_TO_CLI` (`ZIP_UNSUPPORTED_ZIP64_STREAMING` needs > 4 GiB) |
| `ZipUnsupportedFeature` | type | capability | `detail.feature` in the `E_UNSUPPORTED` envelope (`zipcrypto`, `strong-encryption`, `multi-disk`, `zip64-streaming`, `cd-less-descriptor`, `method:<n>`) |

### Codecs, checksums, constants, metadata

| Export | Kind | Reach | CLI touchpoint |
|--------|------|-------|----------------|
| `crc32` | function | capability | `crc32` command (chunked, `--seed` chaining, `--expect`) |
| `createInflator` | function | capability | `inflate` (default resumable path; not affected by `setInflateImpl`) |
| `Inflator` | interface | capability | `push()` / `finished` / `leftover` / `bytesConsumed` / `end()` in `inflate`; `bytesConsumed` is reported in the envelope |
| `getCodec` | function | capability | `inflate --method <id>`, `methodName()` in `utils/entryfmt.ts`, `doctor` `codecs`, unsupported / verifiability checks in `extract`, `cat`, `verify`, `modify` |
| `registerCodec` | function | capability | `--codec <module>` (`utils/codecs.ts`) — serves the reader for any method **and** the writer for methods 0/8 (`overridesBuiltin`, announced with a `warning:`, refused by `create --parallel`) |
| `setDeflateImpl` | function | capability | `--codec` module `deflateImpl` export — the sync deflate tier of `create` / `modify` (`tier: "injected"`) unless `--deterministic`; `create --parallel` refuses it without `--deterministic` (the worker bundle never sees it) |
| `setInflateImpl` | function | capability | `--codec` module `inflateImpl` export — honoured by the sync / streaming reader paths (`cat`, `extract`, `verify`, `modify`, `inflate --sync`), not by `createInflator` (`inflate` default) nor the forward pump (`stream`); no `doctor` row until the engine exposes an inflate-tier getter (ROADMAP) |
| `initNodeZipCodecs` | function | capability | `ensureCodecsReady()` in the bridge, called by `prepareEngine()` (skipped under `--pure-codecs`) |
| `activeDeflateTier` | function | capability | `tier` in the `create` / `modify` / `inflate` envelopes; `doctor` `deflate-tier` / `deflate-pinned`; under `create --parallel` the value is `node-zlib` or `pure-pinned`, never `injected` |
| `DeflateTier` | type | capability | The `tier` enum in `schema status` (`pure-pinned` \| `injected` \| `node-zlib` \| `pure`) |
| `ZipCodec` | interface | capability | `--codec` module contract (`isCodec()` validation: `method`, `name`, at least one of `compressSync` / `decompressSync` / `decompressStream`), `inflate --method`, the `cat` / `verify` / `modify` sync-vs-stream decisions |
| `CodecCompressOptions` | interface | capability | The `{ level, deterministic }` the engine hands to `compressSync` of a `--codec` module that registers method 0 or 8 (the writer only emits those two methods; a custom id's `compressSync` is never called) |
| `METHOD_STORE` / `METHOD_DEFLATE` | const | capability | `methodName()`, `inspect --check store-only / deflate-only / method=`, `inflate --method`, `extract --skip-unsupported`, `doctor` |
| `FLAG_DATA_DESCRIPTOR` / `FLAG_ENCRYPTED` / `FLAG_STRONG_ENCRYPTION` / `FLAG_UTF8` | const | capability | `decodeFlags()` (`--long` rows), `inspect` UTF-8 verdict, forward `usesDataDescriptor` / `descriptorEntries` |
| `VERSION` | const | capability | `doctor` `zipnative` check (package version vs the engine's `VERSION` export); `tests/docs/consistency.test.ts` pins `docs/data/*.json` to it (`--version --json` reports the installed package version by design) |

---

## 9. Development Quick Reference

```bash
# Install
npm ci

# Build (outputs dist/cli.cjs — the bin; CJS only, no ESM build, no .d.ts, no source maps)
npm run build

# Test (56 vitest files, in-process; one spawn smoke test against the built binary)
npm test
npm run test:coverage       # thresholds: statements 93 / branches 88 / functions 94 / lines 93
                            # (measured 96.27 / 92.36 / 97.91 / 96.81 on 2026-09-05; never lower them — add tests)

# Conformance (veraZIP — ISO/IEC 21320-1:2015; level 0 needs no external tool)
npm run corpus:zip          # write the 37-archive corpus to test-output/zip/ (needs a prior build)
npm run validate:zip        # build + corpus + validate → 33 PASS, 4 XFAIL, 0 FAIL (exit 0/1/2/3 — see CONTRIBUTING.md)

# Typecheck / lint (eslint covers src/ and tests/)
npm run typecheck:all
npm run lint

# Smoke test the built binary (always, before claiming a change works)
node dist/cli.cjs --help
node dist/cli.cjs --version --json
node dist/cli.cjs doctor                                      # deflate-tier must read node-zlib
node dist/cli.cjs create src/ --deterministic -o /tmp/src.zip && node dist/cli.cjs verify --input /tmp/src.zip
node dist/cli.cjs create src/ --parallel -o /tmp/p.zip        # proves zipnative/worker resolves from the bundle
node dist/cli.cjs schema manifest | head
node samples/run-all.js                                       # 73 jobs, dependency-free
```

The published tarball holds 7 files: `dist/cli.cjs`, `AGENTS.md`, `LICENSE`, `README.md`, `llms.txt`, `docs/data/errors.json`, `package.json`.

---

## 10. Samples

Complete, runnable examples live in [`samples/`](../samples/), one directory per command plus `config` and `agent`; every script ships as a Bash (`.sh`) **and** a PowerShell (`.ps1`) pair — 41 dual-shell demos — and runs offline against the committed input tree in `samples/input/`:

| Directory | Description |
|-----------|-------------|
| [`create/`](../samples/create/) | Directory, store vs deflate, deterministic + SHA-256 twice, manifest, stdin `--stream --chunk-size`, `--parallel`, comments / `--order insertion` / `--date` |
| [`modify/`](../samples/modify/) | Append-only vs `--compact`, rename / `--add-dir` / comment / `--in-place`, edits manifest |
| [`list/`](../samples/list/) | Text table, `--long`, JSON, `--summary` / `--fields`, NDJSON pipelines |
| [`inspect/`](../samples/inspect/) | Forensic report, `--check` gates, `--strict` diagnostics |
| [`cat/`](../samples/cat/) | Single / multiple entries, `--dry-run`, `--raw` → `inflate` round trip |
| [`extract/`](../samples/extract/) | Safe defaults, filters and `--flat`, `--dry-run` plan, refusals and `--overwrite` |
| [`stream/`](../samples/stream/) | Pipe listing, pipe extraction, `--cat`, the trust caveat |
| [`verify/`](../samples/verify/) | Verdicts, `--json --summary`, tamper detection |
| [`crc32/`](../samples/crc32/) | Files, stdin, `--expect`, `--seed` |
| [`inflate/`](../samples/inflate/) | Raw DEFLATE, `--max-output`, from stdin |
| [`batch/`](../samples/batch/) | Directory mode (create / verify), a `--manifest` pipeline, `--dry-run` |
| [`doctor/`](../samples/doctor/), [`schema/`](../samples/schema/), [`completion/`](../samples/completion/) | Preflight, schemas / manifest, shell completion install |
| [`config/`](../samples/config/) | `.zipnativerc.json` discovery, `--config` / `--no-config`, precedence |
| [`govern/`](../samples/govern/) | Rules, policy, `verify-issue` on a passing and a failing draft |
| [`agent/`](../samples/agent/) | `--json` + `--dry-run`, the error envelope catalogue, token economy |

Run every sample at once (73 jobs, no dependencies):

```bash
node samples/run-all.js
```

See [`samples/README.md`](../samples/README.md) for the full descriptions.

---

## 11. Integration Patterns

### Shell pipeline
```bash
# Fetch, list what arrives, then extract safely from the complete file
curl -sL "$URL" -o pkg.zip
zipnative inspect --input pkg.zip --check no-encryption,no-symlinks,max-ratio=100 --json --summary
zipnative extract --input pkg.zip --output-dir out/ --json
```

### GitHub Actions — reproducible build artefact
```yaml
- name: Build a reproducible archive and prove it
  run: |
    npx zipnative-cli create dist/ --deterministic --output release.zip
    npx zipnative-cli inspect --input release.zip --check deterministic,canonical-layout
    npx zipnative-cli verify --input release.zip --strict
    sha256sum release.zip | tee release.zip.sha256
```

Two runs of that step on different runners produce the same SHA-256 — `--deterministic` pins the pure-TS encoder, and the engine's defaults (canonical order, DOS-epoch timestamps, UTF-8 names) remove every other environmental input. A re-run in the same workspace needs `--overwrite`.

### Docker
```dockerfile
FROM node:22-alpine
RUN npm install --global zipnative-cli
COPY upload.zip .
RUN zipnative extract --input upload.zip --output-dir /app --max-total-size 512m --max-ratio 50
```

### TypeScript (spawn)
```typescript
import { spawn } from 'node:child_process';

function createArchive(inputs: string[], outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('zipnative', ['create', ...inputs, '--deterministic', '--output', outputPath], {
            stdio: ['ignore', 'ignore', 'inherit'],
        });
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
    });
}
```

### Autonomous agent (JSON envelope + error codes)
```typescript
import { spawnSync } from 'node:child_process';

const r = spawnSync('zipnative', ['extract', '--input', 'upload.zip', '--output-dir', 'out', '--json'], {
    encoding: 'utf8',
});
if (r.status !== 0) {
    // Diagnostics (including the failure envelope) are on stderr — the envelope is the last line.
    const env = JSON.parse(r.stderr.trim().split('\n').at(-1)!);
    switch (env.error.code) {                       // the CLASS
        case 'E_SECURITY':                          // hostile shape — quarantine
            console.error('refused:', env.error.zipCode, env.error.entryName);   // the CAUSE
            break;
        case 'E_LIMIT':                             // a bound fired — retry only for trusted input
            console.error('limit:', env.error.detail);
            break;
        case 'E_UNSUPPORTED':                       // encryption / method / multi-disk — route around
            break;
        case 'E_IO':                                // an existing file — --overwrite, or a filesystem problem
            break;
        default:
            throw new Error(env.error.message);
    }
} else {
    const status = JSON.parse(r.stderr.trim().split('\n').at(-1)!);   // { ok: true, command: 'extract', … }
}
```

See [AGENTS.md](../AGENTS.md) for the full agent contract.

---

## 12. Frequently Asked Questions

### Why does `extract` refuse an archive that `unzip` opens?

Because the archive has a shape the engine treats as hostile: a name with `..`, an absolute path, a Windows reserved device name (`aux.h` from a POSIX host), a symlink entry, two entries resolving to the same path, or overlapping / contradictory headers. `unzip` and friends forgive most of these; zipnative refuses by default and tells you the exact `ZIP_*` cause. Use `--skip-unsafe` / `--skip-symlinks` / `--skip-unsupported` / `--on-duplicate` to skip deliberately; overlaps and header contradictions have no opt-out.

### How do I get byte-identical archives across machines?

`create --deterministic`. Without it the bytes are stable for a given Node + zlib build only (the `ZIP_NONDETERMINISTIC_CODEC` diagnostic tells you when a pinned date meets an unpinned codec). Keep the DOS-epoch default (`--date epoch`) or an explicit ISO date (UTC wall-clock, host-independent) and avoid `--mtime` / `now`; `--parallel` is byte-identical to the sequential writer per tier. Prove it with `inspect --check deterministic` and `sha256sum`. Do not load a `--codec` module that registers method 0/8 unless you want its bytes.

### Why do `create --stream` bytes differ from `create` of the same files?

`--stream` (and any `--stdin-name` entry) writes the data-descriptor layout: sizes and CRC trail each payload because they are unknown when its local header is written. The content is identical and the archive is still reproducible run-to-run (`inspect` reports `deterministic: true`, `canonicalLayout: false`; the envelope reports `layout: "data-descriptor"`). Compare streamed and buffered outputs with `verify` / `inspect`, not with a hash, and gate the form separately with `--check canonical-layout`.

### Why does `modify` decompress entries I did not touch?

Because an append-only `save()` copies their bytes verbatim, and copying a lying record (CRC, sizes or local header contradicting the central directory) would launder a hostile archive into a clean-looking one. `modify` verifies every survivor (one decompress pass, never a recompress) and refuses with `E_DATA` / `E_SECURITY` + `entryName`; encrypted and stream-only-codec entries are copied unverified and counted in `verifySkipped`. There is no opt-out.

### Why does `create --parallel` refuse my `--codec` module?

The worker pool is a separate engine bundle: `registerCodec` / `setDeflateImpl` calls on the main entry never reach it. Rather than compress with `node:zlib` while reporting `tier: "injected"`, the CLI refuses a module that registers method 0/8 (always) or exports a `deflateImpl` (unless `--deterministic`, whose pinned encoder is the same in every worker). Drop `--parallel` for that module.

### Why is my existing output file refused?

Every file the CLI writes is created exclusively (`create -o`, `modify -o`, `cat -o`, `inflate -o`, `extract`, `stream --output-dir`, `batch --task create`): an existing target is `E_IO` "Refusing to overwrite existing file …" and left intact. Pass `--overwrite` to replace it. Writing to stdout needs nothing.

### Which time zone do timestamps use?

ZIP stores DOS date/time fields with no zone. `--date <ISO>` and manifest dates are read as **UTC wall-clock** (a string without a zone is UTC), so the stored fields — and the archive bytes — are identical on every host. `--date now` and `--mtime` use local time. On the read side the engine turns the DOS fields into a local `Date`, so `lastModified` in JSON is an instant that depends on the host's `TZ` while `dosDate` / `dosTime` (under `--long`) do not.

### Is `--json` output stable?

Yes. Envelope fields, the 13 `E_*` classes, the 39 `ZIP_*` causes and the report shapes are pinned by `schema` (`$id` embeds the CLI version) and by tests. New fields are additive.

### Where do the security limits come from and how do I change them?

They are zipnative's `DEFAULT_ZIP_LIMITS` (100000 entries, 1 GiB per entry, 8 GiB total, 1024:1 ratio, 4096-byte names, 65535-byte extra fields and comments, 256 MiB central directory), plus the CLI's own `--max-input-size` (4 GiB) on buffered reads. Override per run with `--max-*`, or per project in `.zipnativerc.json` (`{ "max-total-size": "32g", "extract": { "max-ratio": 4096 } }`). `none` disables a bound and warns.

### Can I use zipnative-cli with stdin/stdout on Windows PowerShell?

Yes. `Get-Content -AsByteStream a.zip | zipnative stream --list` and `zipnative cat a.zip x | Set-Content -AsByteStream x` work; for archives prefer `--input` / `--output` paths to avoid PowerShell's text-mode pipe conversions. Every sample ships as a `.ps1` next to its `.sh`.

### What is the difference between `list`, `inspect` and `verify`?

| Command | Opens | Decompresses | Purpose |
|---------|-------|--------------|---------|
| `list` | lazily | nothing | Enumerate entries fast |
| `inspect` | eagerly (local headers cross-checked, overlap table) | nothing | Forensic facts, determinism verdict, `--check` gates |
| `verify` | eagerly | every entry (or the `--entry` selection) | CRC / size / local-header agreement per entry — the integrity verdict |

### Why does `modify` say my removed file is "recoverable"?

The default `save()` is append-only: it keeps the original bytes verbatim and writes a new central directory, so untouched entries are never recompressed — and removed / replaced payloads stay inside the file. `--compact` rewrites the archive canonically (still without recompressing) so removed content is truly gone. 7-Zip's CLI also mis-reads the append-only layout.

### Can the CLI open encrypted archives?

No — by engine policy in 1.x (ZipCrypto is cryptographically broken). Encrypted entries are detected (`isEncrypted`), listed, counted by `inspect`, reported as `skipped` by `verify`, copied unverified by `modify` (`verifySkipped`), and refused on read with `ZIP_UNSUPPORTED_ENCRYPTION`. `extract --skip-unsupported` / `stream --skip-unsupported` skip them. Read-only AES decryption is a future consideration blocked on a core crypto-provider seam (see ROADMAP).

### Does anything here touch the network?

No. Not `doctor`, not `govern`, not `schema`, not `--json`. The engine never opens a socket and neither does the CLI.

### Are there security considerations I should know?

Yes — the defaults are the safe path: containment-proved extraction (lexical and physical), refusals for hostile shapes, CWE-tagged bounds always on, a bound on buffered input, no symlink ever materialised, no overwrite without `--overwrite`, exclusive file creation, partial files removed on failure or interruption, survivors verified by `modify`, `--codec` only from argv. When handling untrusted archives, tighten `--max-total-size` / `--max-ratio`, keep `--skip-unsafe` off unless you accept silently skipped entries, extract into an empty directory, and prefer `extract --dry-run --json` first. See [SECURITY.md](../SECURITY.md).

---

*Last updated: 2026-09-05 | zipnative-cli v1.0.0 | zipnative 1.0.0*
