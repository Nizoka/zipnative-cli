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
- The CLI is the **filesystem trust boundary** — the engine never touches disk; `extract` / `stream` are the sinks and re-prove containment themselves.
- Composable — every command reads from stdin and writes to stdout by default.
- **Offline, always** — no command can open a socket. There is no network opt-in.
- Never loosen a security default — opt-outs skip, they never write anything unsafe.

**Targets:** Node.js ≥ 22, Bun, Deno (via `node dist/cli.cjs`). CI: Ubuntu (Node 22, 24) and Windows (Node 22).

**Repository:** https://github.com/Nizoka/zipnative-cli
**npm:** https://www.npmjs.com/package/zipnative-cli
**Parent library:** https://github.com/Nizoka/zipnative — docs at https://zipnative.dev

---

## 2. Architecture

```
src/
├── index.ts              # Entry: parse argv → global env flags → config merge → dispatch → exit
├── commands/
│   ├── create.ts         # files/dirs/stdin/manifest → createZip | createParallelZip → toBytes() | stream()
│   ├── modify.ts         # createZipModifier → remove/rename/replace/add/add-dir/comment → save() | saveCompact()
│   ├── list.ts           # openZip → entries() → text | json | ndjson (nothing decompressed)
│   ├── inspect.ts        # openZip({ validate: 'eager' }) → stats, determinism verdict, diagnostics, --check gates
│   ├── cat.ts            # openZip → readEntryStream | readEntryRaw → stdout / --output
│   ├── extract.ts        # extractZipStream | extractZip → plan (safeJoin containment) → write; THE filesystem sink
│   ├── stream.ts         # iterateZipEntries over stdin/pipes → list | extract | cat (trust: local-headers-only)
│   ├── verify.ts         # verifyZip → ZipVerificationReport + { failed, skipped, strict } → exit verdict
│   ├── crc32.ts          # crc32() over 64 KiB chunks; --seed, --expect
│   ├── inflate.ts        # createInflator(maxOutput) chunk by chunk | codec.decompressSync (--sync / --method)
│   ├── batch.ts          # directory mode (create / verify per item, pool) | --manifest pipeline
│   ├── doctor.ts         # environment / capability preflight (text | --json)
│   ├── schema.ts         # 22 JSON Schema subjects (Draft 2020-12) + errors document + capability manifest
│   ├── completion.ts     # COMMANDS table (single source of truth) → bash/zsh/fish/powershell
│   └── govern.ts         # AI-governance / HITL: rules | policy | verify-issue
├── utils/
│   ├── args.ts           # Zero-dep argument parser (repeatable flags → string[])
│   ├── io.ts             # stdin/stdout/file I/O, validatePath, safeJoin (containment), 50 MB JSON cap, streams
│   ├── config.ts         # `.zipnativerc.json` discovery + flag-default merge (codec key refused)
│   ├── colors.ts         # NO_COLOR/TTY-aware ANSI helper
│   ├── sizes.ts          # <size> / <count> parsing (512k, 1m, 8g, 1GiB, none), formatBytes, formatRatio
│   ├── glob.ts           # Minimal glob matcher for entry names (*, **, ?, [abc])
│   ├── walk.ts           # Deterministic filesystem walk for create (sorted, symlink policy, name pre-check)
│   ├── limits.ts         # The eight --max-* flags → Partial<ZipLimits> (CWE-tagged), effective limits
│   ├── engine.ts         # prepareEngine(): --codec modules, node:zlib tier bootstrap (idempotent)
│   ├── codecs.ts         # --codec <module> loader: the CLI's ONLY dynamic import of user code
│   ├── diagnostics.ts    # Diagnostics bridge: core onDiagnostic → stderr text | --json arrays | --strict
│   ├── entryfmt.ts       # EntryRow (one JSON row shape for list/inspect/stream), flag decoding, text table
│   ├── zipops.ts         # Shared flag → core-option translation (commonOptions, compression, date, filters…)
│   ├── manifest.ts       # batch --manifest: parse/validate tasks.json, @id refs, codec-load policy
│   ├── projection.ts     # Token economy: --summary / --fields / compact JSON (emitJsonReport)
│   ├── agent.ts          # --json envelopes, emitStatus, progress (quiet-aware), mode flags
│   ├── ziperr.ts         # ZIP_TO_CLI (39 codes → E_*/exit), diagnostics list, mapZipError / guard
│   ├── version.ts        # bundle-safe CLI + engine version resolution (name-guarded package.json probe)
│   ├── governance.ts     # AI-governance policy + AGENT_RULES text + pure draft validator
│   └── error.ts          # CliError { exitCode, code, zipCode?, entryName?, detail? } + 13 E_* codes
└── core-bridge/
    └── index.ts          # The ONLY import point of `zipnative` / `zipnative/worker` (77-export ledger)

scripts/
├── generate-zip-corpus.mjs   # drives the BUILT CLI + a raw builder → test-output/zip/ (34 archives + manifest)
├── validate-zip.mjs          # veraZIP: ISO/IEC 21320-1:2015 validator, vendored from zipnative (independent parser)
└── helpers/interop-tools.mjs # level-1 foreign integrity tools (bsdtar, unzip, 7z, python-zipfile, jar)

tests/
├── commands/, utils/, docs/, helpers/   # in-process vitest (stdout/stderr captured); tests/docs/consistency.test.ts
├── helpers/raw-zip-builder.ts           # engine-independent raw ZIP builder (adversarial shapes, never committed)
└── fixtures/interop/                    # two foreign-provenance archives (bsdtar, PowerShell) — see tests/fixtures/README.md
```

### Data Flow

```
process.argv
    │
    ▼
src/index.ts
  parseArgs(argv)                       ← src/utils/args.ts
  --json/--quiet/--dry-run/--strict/--pure-codecs → ZIPNATIVE_* env (process-wide mode)
  loadConfig(command) + applyConfigDefaults   ← src/utils/config.ts (flags win)
  loadCommand(command)                        (lazy import)
    │
    ├── create   → prepareEngine(args)        ← codecs + node:zlib tier
    │               plan: walkPaths() | planFromManifest()   (names pre-checked with sanitizeEntryPath)
    │               createZip | createParallelZip → add/addDirectory/addStream
    │               toBytes() → writeOutput  |  stream() → writeStreamingOutput
    │               emitStatus({ … tier, diagnostics })
    │
    ├── extract  → readArchiveBytes(--input)
    │               openArchive() → entries (directory entries, skipped inventory)
    │               extractZipStream(bytes, { rejectTraversal, rejectSymlinks, onDuplicate, filter })
    │               PLAN: safeJoin(root, path) per entry, existing-file check, case-fold check
    │               WRITE: writeFileStream with backpressure; partial file removed on E_DATA
    │
    ├── verify   → verifyZip(bytes, { limits }) → report on stdout → exit verdict (E_VERIFY_FAILED)
    │
    └── every core call is wrapped: guard('context', () => core())  ← src/utils/ziperr.ts
                                     → CliError { code: E_*, zipCode: ZIP_*, entryName, detail }
main().catch → emitJsonError (under --json) | message on stderr → process.exit(exitCode)
```

---

## 3. Core Concepts

### Zero-Dep Arg Parser (`src/utils/args.ts`)

```typescript
type ParsedArgs = {
    readonly flags: Record<string, string | boolean | readonly string[]>;
    readonly positionals: readonly string[];
};

function parseArgs(argv: readonly string[]): ParsedArgs
```

Handles `--flag value`, `--flag=value`, `-f value`, bare `--flag` (boolean), `--` pass-through, positionals. A long flag given several times with string values is collected into a `readonly string[]` (`--remove a --remove b`). Helpers: `getStringFlag(flags, ...names)` (first value), `getStringFlagAll` (every value), `hasFlag`, `getBoolFlag`, `omitFlags`.

### Core Bridge (`src/core-bridge/index.ts`)

The **only** import point of the engine (`zipnative` and `zipnative/worker`). Grouped exactly like the core's own `src/index.ts` so it doubles as a coverage ledger of the frozen 77-export surface (mapped in §8). Two additions of its own:

- `ensureCodecsReady()` — memoised `initNodeZipCodecs()`: resolves `node:zlib` once so every sync codec path runs on the `node-zlib` tier. Without it a CJS bundle silently runs the pure-TS tier (the core's probe cannot see `require` in CJS scope).
- `loadParallelZip()` — lazy import of `zipnative/worker` (never on the startup path) that also resolves the worker script URL through the package exports map (`zipnative/worker/zip-worker.js`) so a packager that flattens `node_modules` fails loudly instead of silently degrading to main-thread compression.

`zipnative` and `zipnative/worker` stay **external** in the tsup bundle (see `tsup.config.ts`).

### `prepareEngine` (`src/utils/engine.ts`)

Called first by every core-touching command. (1) loads and registers every `--codec <module>` (argv only); (2) unless `--pure-codecs`, calls `ensureCodecsReady()`. Idempotent — `batch` tasks run in-process and call it again as a no-op. `doctor` makes the resulting deflate tier visible (`deflate-tier`, `deflate-pinned`).

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

`mapZipError` returns `CliError`s unchanged, maps `ZipError` subclasses (class → `E_*`, `err.code` → `zipCode`, `entryName` from `ZipSecurityError` / `ZipDataError` or the caller's fallback, `detail` from `ZipLimitError` / `ZipUnsupportedError` / CRC-bearing `ZipDataError`), maps Node `ErrnoException`s (`ENOENT`, `EACCES`, …) to `E_IO`, and everything else to `E_RUNTIME`. Exit code conventions: `0` success, `1` runtime / check failure, `2` usage.

### The extraction sink (`src/commands/extract.ts`, `src/utils/io.ts`)

The engine never touches the filesystem: `extractZipStream` yields `{ path, entry, stream() }` with `path` already run through `sanitizeEntryPath()`. `extract` is the sink and therefore the CLI's own trust boundary, hardened in two phases:

1. **PLAN** — drain the lazy extraction generator without decompressing anything (the `stream()` thunks are deferred). Every path is re-checked with `safeJoin(root, path)`, which resolves the destination and proves it stays inside `root` (`E_SECURITY` otherwise). Existing files are refused unless `--overwrite` (`E_IO`); on case-insensitive filesystems (win32 / darwin) case-folded collisions are refused (`ZIP_EXTRACT_DUPLICATE_PATH`) unless `--on-duplicate first|last`.
2. **WRITE** — each entry streams into its file with backpressure; a CRC / size failure removes the partial file. `--preserve-mode` applies `getUnixMode(entry) & 0o777` (POSIX only, never setuid/setgid/sticky); `--preserve-mtime` applies the entry timestamp.

Security defaults are the core's (`rejectTraversal`, `rejectSymlinks`, `onDuplicate: 'error'`, the limits). Opt-outs are skip-not-write: `--skip-unsafe` sets `rejectTraversal: false` (the engine silently drops unsafe names; the CLI lists them as `skipped: [{ reason: 'unsafe-path' }]`), `--allow-symlinks` writes the link **target text** as a regular file (a symlink is never materialised), `--skip-symlinks` drops them. `stream --output-dir` applies `sanitizeEntryPath()` + `safeJoin` itself because the forward reader does not sanitise names.

### Diagnostics bridge (`src/utils/diagnostics.ts`)

The CLI owns stderr, so the core never gets to use its deduplicated `console.warn` default. Every core call receives a sink's `onDiagnostic`; the sink deduplicates by `(code, entryName)` and presents:

- **text mode** — one `warning: [CODE] entry 'x': message` / `info: [CODE] message` line on stderr, suppressed by `--quiet`;
- **`--json`** — nothing per diagnostic; the collected `DiagnosticRow[]` travels in the success envelope (`emitStatus({ …, ...sink.field() })`) or in the stdout report's `diagnostics` field (`list` / `inspect` / `verify` / `stream --format json`); NDJSON outputs print them as text on stderr;
- **`--strict`** — handled by the core (`strict: true`): the first diagnostic throws `ZIP_STRICT_DIAGNOSTIC` → `E_CHECK_FAILED` before any output byte. `verify --strict` is the exception: the report is printed, then the verdict is `E_VERIFY_FAILED` when any diagnostic was emitted.

### Limits (`src/utils/limits.ts`)

Eight individual `--max-*` flags (one per `ZipLimits` key, `LIMIT_FLAGS`, CWE-tagged) rather than a JSON blob: they complete in every shell and are flat keys in `.zipnativerc.json`. Values are pre-validated (`E_USAGE` on malformed or zero values), so `ZIP_LIMIT_INVALID` is unreachable from the CLI; `none` disables a bound (`Infinity`) with a one-shot visible warning. `parseLimitFlags` returns `undefined` when none is set so the engine's defaults apply untouched; `effectiveLimits` merges for `doctor` and `inflate`'s default `--max-output`.

### I/O Helpers (`src/utils/io.ts`)

```typescript
validatePath(p)                               // throws E_INPUT on ../ (also ..\)
readStdin() / readFileOrStdin(path)           // '-' = stdin
openInputStream(path)                         // Readable for streaming commands
assertJsonSizeLimit(buf)                      // 50 MB cap → E_INPUT
readJsonInput(path, what)                     // read + cap + JSON.parse (E_IO / E_PARSE)
writeOutput(bytes, path) / writeStreamingOutput(chunks, path)   // stdout when path is undefined / '-'
writeFileStream(path, chunks, onChunk)        // backpressure-aware
safeJoin(root, relPath)                       // containment proof → E_SECURITY
unlinkQuiet(path)                             // best-effort partial-file removal
readableToByteSource(stream)                  // Node Readable → engine ByteSource
```

### Config file (`src/utils/config.ts`)

`.zipnativerc.json` is discovered cwd-upward (or `--config <file>`; `--no-config` skips). Flag names map to values; a top-level key naming a command is a command-scoped section. Precedence: explicit CLI flag > command section > global section > built-in. The file is capped at 1 MB and the `codec` key is **refused** anywhere in it (it executes user code).

---

## 4. CLI Commands — Full Reference

Every archive-touching command starts with `prepareEngine(args)`, resolves its input with `resolveInputPath` (`--input` / `-i`, else the first positional, else stdin), reads it with `readArchiveBytes`, opens it through `openArchive` (a `guard`ed `openZip`) with `commonOptions(args, sink)` = `{ strict, onDiagnostic, limits }`, and wraps every further core call.

### `create`

**Purpose:** Build an archive from files, directories, stdin or a JSON manifest through the engine's deterministic writer.

```bash
zipnative create [<path>...] --output <out.zip> [options]
zipnative create --from-manifest <entries.json> -o <out.zip>
cat file | zipnative create --stdin-name <name> -o <out.zip>
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| positionals / `--input`, `-i` | string[] | — | Files and directories (walked recursively, sorted) |
| `--stdin-name` | string | — | Read stdin as one entry (buffered unless `--stream`) |
| `--from-manifest` | path | — | `create-manifest` JSON; paths resolve against the manifest's directory; mutually exclusive with inputs |
| `--output`, `-o` | path | stdout | Output |
| `--base` | dir | each input's parent | Entry names relative to this directory (an input outside it is `E_USAGE`) |
| `--prefix` | `dir/` | — | Prepended to every name |
| `--dir-entries` | boolean | false | Explicit directory entries (empty directories kept) |
| `--include` / `--exclude` | glob[] | — | Name filters (filtered names are reported as `skipped`) |
| `--follow-symlinks` | boolean | false | Dereference symlinks (realpath cycle guard); default: skipped with a warning |
| `--method` | `store`\|`deflate` | `deflate` | Archive-default method |
| `--level` | 0–9 | 6 | Deflate level |
| `--deterministic` | boolean | false | Pin the pure-TS encoder (`tier: "pure-pinned"`) |
| `--order` | `canonical`\|`insertion` | `canonical` | Central-directory order |
| `--date` | `epoch`\|`now`\|ISO 8601 | `epoch` | Default entry timestamp |
| `--mtime` | boolean | false | Use each file's mtime |
| `--comment` / `--entry-comment name=text` | string | — | Archive / per-entry comments (an unknown name is `E_USAGE`) |
| `--preserve-mode` | boolean | false | External attributes from POSIX mode bits (masked to 0o777) |
| `--store-ext` | csv | — | Extensions stored uncompressed |
| `--stream` | boolean | false | `addStream()` per file + `writer.stream()` — constant memory, data-descriptor layout (same content as the buffered layout, different bytes); stdin entries always stream |
| `--chunk-size` | size | 65536 | Requires `--stream` |
| `--parallel` | boolean | false | `createParallelZip` from `zipnative/worker` |
| `--workers` / `--min-job-size` / `--job-timeout` | int / size / ms | cores−1 (max 8) / 32k / 60000 | Require `--parallel` |
| `--dry-run` | boolean | false | Plan (`plan  name  size  method` / `skip  name  (reason)` lines on stdout) + status envelope; nothing written |

**Manifest (`create-manifest`):** `{ version?: 1, comment?, order?, date?, compression?: { method, level, deterministic }, entries: [{ name, path | data | dataBase64 | directory: true, method?, level?, deterministic?, date?, comment?, mode? }] }` — unknown keys are `E_INPUT`; every name is checked with `sanitizeEntryPath()`; duplicates are `E_INPUT`.

**Plan → writer:** each entry is `{ name, isDirectory, source: file | bytes | stdin, options: AddEntryOptions }`. `externalAttributes` are built as `(S_IFREG | perm) << 16` (files) or `((S_IFDIR | perm) << 16) | 0x10` (directories); setuid/setgid/sticky are never propagated.

**Status envelope:** `{ ok, command: 'create', dryRun, output, entries, files, directories, bytes, bytesIn, method, level, deterministic, order, stream, parallel: false | { workers }, skipped: [{ name, path, reason: 'symlink' | 'special' | 'filtered' }], tier, diagnostics }`.

**zipnative API used:** `createZip(options)` → `ZipWriter.add / addDirectory / addStream / toBytes / stream`; `loadParallelZip()` → `createParallelZip(options)` → `ParallelZipWriter`; `sanitizeEntryPath` (name pre-check); `activeDeflateTier(deterministic)` for the `tier` field. Types: `CreateZipOptions`, `AddEntryOptions`, `ZipCompressionOptions`, `ByteSource`, `ParallelZipOptions`.

### `modify`

**Purpose:** Incremental edits through the engine's modifier — untouched entries are never recompressed.

```bash
zipnative modify --input <a.zip> --output <b.zip> [edits] [--compact]
zipnative modify --input <a.zip> --in-place [edits]
zipnative modify --input <a.zip> -o <b.zip> --from-manifest <edits.json>
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` | path | — (required; positional accepted) | Source archive (`-` = stdin, incompatible with `--in-place`) |
| `--output`, `-o` / `--in-place` | path / boolean | stdout / false | Mutually exclusive; `--in-place` writes `<input>.tmp-<pid>` then renames |
| `--remove` / `--rename from=to` / `--replace name=path` / `--add name=path` / `--add-dir` | string[] | — | Edits; `path` may be `-` (stdin, once); a bare `--add path` uses the basename; new names are checked with `sanitizeEntryPath()` |
| `--comment` | string | — | Archive comment (`""` clears) |
| `--from-manifest` | path | — | `modify-manifest` JSON `{ version?, comment?, edits: [{ op, name, to?, path | data | dataBase64, method?, level?, deterministic?, date?, comment? }] }`; mutually exclusive with the edit flags |
| `--method` / `--level` / `--deterministic` | — | engine defaults | Compression for **new** payloads (`ZipModifierOptions.compression`) |
| `--date` | `epoch`\|`now`\|ISO | `epoch` | `defaultDate` for new payloads |
| `--compact` | boolean | false | `saveCompact()` instead of `save()` |
| `--dry-run` | boolean | false | Validate every edit against the archive (payloads loaded, modifier calls made); nothing saved |

Edits are applied in the fixed order `remove → rename → replace → add / add-dir → comment`. Core refusals surface with their code: `ZIP_ENTRY_NOT_FOUND` (`E_NOT_FOUND`), `ZIP_ENTRY_EXISTS` (`E_INPUT`), `ZIP_DUPLICATE_ENTRY_NAME` (`E_INPUT`, duplicate-name source archives cannot be modified incrementally). When a destructive edit is saved append-only the CLI prints one `info:` line about data remanence and 7-Zip.

**Status envelope:** `{ ok, command: 'modify', dryRun, output, bytes, edits: [{ op, name, to? }], layout: 'append-only' | 'compact', changed, diagnostics }` (`changed` is false when `save()` returned the same reference).

**zipnative API used:** `openZip` → `createZipModifier(reader, options)` → `ZipModifier.addEntry / replaceEntry / removeEntry / renameEntry / setComment / save / saveCompact`; `sanitizeEntryPath`. Types: `ZipModifierOptions`, `AddEntryOptions`.

### `list`

**Purpose:** Entry listing through the random-access reader; nothing is decompressed.

```bash
zipnative list --input <a.zip> [--format text|json|ndjson] [--long] [--validate eager] [--include g] [--exclude g] [--summary] [--fields a,b]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / positional | path | stdin | Archive |
| `--format` | `text`\|`json`\|`ndjson` | `text` (`json` under `--json`) | `unzip -l`-style table, `{ archive, entries, diagnostics }`, or one `EntryRow` per line |
| `--long`, `-l` | boolean | false | Adds `flags`, `versionMadeBy`, `versionNeeded`, `internalAttributes`, `externalAttributes`, `localHeaderOffset`, `dosDate`, `dosTime`, `extraFields` |
| `--validate` | `lazy`\|`eager` | `lazy` | `OpenZipOptions.validate` |
| `--include` / `--exclude` | glob[] | — | Name filters |
| `--summary` / `--fields` | — | — | `listSummary(report)` = `{ entries, files, directories, compressedSize, uncompressedSize, zip64, encrypted }` |

**JSON shape (`schema entries`):** `{ archive: { bytes, entryCount, isZip64, comment, commentBytes }, entries: EntryRow[], diagnostics: DiagnosticRow[] }`. `EntryRow` = `{ name, nameEncoding, isDirectory, isSymlink, method, methodName, compressedSize, uncompressedSize, ratio, crc32, lastModified, isEncrypted, usesZip64, usesDataDescriptor, unixMode, comment? }` (+ the `--long` fields). NDJSON carries no wrapper: diagnostics go to stderr as text.

**zipnative API used:** `openZip(bytes, { validate, strict, onDiagnostic, limits })` → `ZipReader.entries()`, `entryCount`, `isZip64`, `comment`; per row `getUnixMode`, `isSymlinkEntry`, `getCodec` (method names), `FLAG_*` masks.

### `inspect`

**Purpose:** Forensic archive report + CI assertions. Opens eagerly (every local header cross-checked, overlap table built).

```bash
zipnative inspect --input <a.zip> [--format json|text] [--entries | --entry <name>...] [--extra] [--check <assert>]...
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` | path | stdin | Archive (`validate: 'eager'` always) |
| `--format` | `text`\|`json` | `text` (`json` under `--json`) | Output |
| `--entries` / `--entry` | boolean / string[] | — | Long-form rows for all / the named entries (`E_NOT_FOUND` if absent) |
| `--extra` | boolean | false | Extra-field payloads as hex |
| `--check` | string[] (comma-separable) | — | Assertions; unknown or malformed → `E_USAGE` |
| `--summary` / `--fields` | — | — | `inspectSummary(report)` = `{ entries, bytes, uncompressedSize, zip64, encrypted, deterministic, diagnostics, checksPassed? }` |

**JSON shape (`schema inspect`):** `{ archive: { bytes, entryCount, isZip64, comment, commentBytes, prependedData, multipleEocd }, stats: { files, directories, compressedSize, uncompressedSize, ratio, methods: { [id]: n }, encrypted, symlinks, dataDescriptor, zip64Entries, utf8Names, cp437Names, duplicateNames, earliestDate, latestDate }, determinism: { epochTimestamps, canonicalOrder, utf8Flags, noDataDescriptors, deterministic }, entries?, diagnostics, checks?: [{ check, ok, detail }] }`. `prependedData` / `multipleEocd` are derived from the `ZIP_PREPENDED_DATA` / `ZIP_MULTIPLE_EOCD` diagnostics. Any failed check exits 1 / `E_CHECK_FAILED` **after** the report is printed.

**zipnative API used:** `openZip(bytes, { validate: 'eager', … })` → `entries()`, `getEntry(name)`; `isSymlinkEntry`, `getUnixMode`, `FLAG_UTF8`, `METHOD_STORE`, `METHOD_DEFLATE`, `getCodec`. Types: `ZipEntry`.

### `cat`

**Purpose:** Stream one or more entries to stdout (or `--output`) by random access.

```bash
zipnative cat --input <a.zip> --entry <name> [--entry <name>]... [-o <file>] [--raw] [--no-verify-crc]
zipnative cat <a.zip> <name> [<name>...]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / positional | path | — (required) | Archive |
| `--entry`, `-e` / positionals | string[] | — (required) | Entries, concatenated in order; directories are `E_INPUT` |
| `--output`, `-o` | path | stdout | Partial file removed on failure |
| `--raw` | boolean | false | `readEntryRaw` — the compressed payload, zero-copy |
| `--no-verify-crc` | boolean | false | `ReadEntryOptions.verifyCrc = false` |
| `--dry-run` | boolean | false | `{ entries: [names], bytes }` (compressed sizes under `--raw`); nothing output |

**Status envelope:** `{ ok, command: 'cat', dryRun, output, entries: string[], bytes, raw, verifyCrc, diagnostics }`.

**zipnative API used:** `openZip` → `getEntry(name)`, `readEntryStream(entry, { verifyCrc })`, `readEntryRaw(entry)`. Types: `ZipEntry`, `ReadEntryOptions`.

### `extract`

**Purpose:** Write an archive's entries to disk, secure by default (the sink described in §3).

```bash
zipnative extract --input <a.zip> --output-dir <dir> [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` | path | stdin | Archive |
| `--output-dir`, `-d` | dir | — (required) | Root; created if missing |
| `--include` / `--exclude` / `--entry` | globs / names | — | Selection (filtered entries are reported as `skipped: filtered`) |
| `--overwrite` | boolean | false | Existing files otherwise `E_IO` |
| `--on-duplicate` | `error`\|`first`\|`last` | `error` | `ExtractOptions.onDuplicate` + the CLI's own check under `--flat` / case-fold collisions |
| `--skip-unsafe` | boolean | false | `rejectTraversal: false` — unsafe names are skipped, listed as `unsafe-path`, never written |
| `--allow-symlinks` / `--skip-symlinks` | boolean | false | `rejectSymlinks: false`; mutually exclusive; the target text is written as a regular file / the entry is dropped |
| `--flat` | boolean | false | Basenames only (no directory entries created) |
| `--buffered` | boolean | false | `extractZip` (in memory) instead of `extractZipStream` |
| `--preserve-mode` / `--preserve-mtime` | boolean | false | `chmod(mode & 0o777)` (POSIX) / `utimes` |
| `--dry-run` | boolean | false | `plan  path  size` / `skip  name  (reason)` lines + envelope; nothing written |

**Status envelope:** `{ ok, command: 'extract', dryRun, outputDir, entries, files, directories, bytes, skipped: [{ name, reason: 'unsafe-path' | 'symlink' | 'filtered' | 'duplicate' }], symlinksAsData, diagnostics }`.

**zipnative API used:** `openZip` → `entries()` (directory entries + inventory), `extractZipStream(bytes, options)` / `extractZip(bytes, options)`, `sanitizeEntryPath` (directory entries), `getUnixMode`, `isSymlinkEntry`. Types: `ExtractOptions`, `ExtractedStreamEntry`, `ExtractedEntry`.

### `stream`

**Purpose:** Forward-only reader over unseekable input through `iterateZipEntries`.

```bash
curl ... | zipnative stream [--list] [--format ndjson]
curl ... | zipnative stream --output-dir <dir>
cat a.zip | zipnative stream --cat <name>
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / positional | path | stdin | Read sequentially |
| `--list` / `--output-dir`, `-d` / `--cat` | — | list | Mode (`--output-dir` and `--cat` are mutually exclusive) |
| `--format` | `text`\|`json`\|`ndjson` | `text` (`ndjson` under `--json`) | Listing format (NDJSON rows are emitted as entries arrive) |
| `--long`, `-l` | boolean | false | `flags`, `versionNeeded`, `dosDate`, `dosTime`, `extraFields` (no CD-only fields) |
| `--include` / `--exclude`, `--overwrite`, `--on-duplicate`, `--flat`, `--preserve-mtime` | as `extract` | — | Extraction controls |
| `--skip-unsafe` | boolean | false | Skip unsafe names (the forward reader does not sanitise; the CLI applies `sanitizeEntryPath` + `safeJoin`) |
| `--skip-unsupported` | boolean | false | Skip encrypted / unknown-method entries (`E_UNSUPPORTED` → `skipped: unsupported`) |
| `--preserve-mode` / `--allow-symlinks` / `--skip-symlinks` | — | — | **Refused** (`E_USAGE`): attributes live only in the central directory |
| `--summary` / `--fields` | — | — | `streamSummary` = `{ entries, bytes, trust }` |
| `--dry-run` | boolean | false | Iterate and plan; nothing written |

**JSON shape (`schema stream`):** `{ mode: 'list', trust: 'local-headers-only', entries: EntryRow[] (isSymlink: null, usesZip64: null, unixMode: null), diagnostics }`. A `warning:` caveat line is printed at start (suppressed by `--quiet`).

**Status envelope (extract / cat modes, and list under `--dry-run`):** `{ ok, command: 'stream', mode, trust, dryRun, outputDir?, entries, bytes, skipped, stoppedAt: 'central-directory' | 'eof', diagnostics }`. A missing `--cat` name is `E_NOT_FOUND`; a stream that ends without a central directory is `ZIP_STREAM_TRUNCATED` (`E_PARSE`).

**zipnative API used:** `iterateZipEntries(source, { strict, onDiagnostic, limits })` → `StreamedZipEntry.header / data() / skip()`; `sanitizeEntryPath`; `FLAG_DATA_DESCRIPTOR`. Types: `ByteSource`, `StreamedZipHeader`, `IterateZipOptions`.

### `verify`

**Purpose:** One-call deep integrity verification; the report is the artefact, the exit code is the verdict.

```bash
zipnative verify --input <a.zip> [--format json|text] [--strict] [--summary] [--fields a,b]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` | path | stdin | Archive |
| `--format` | `text`\|`json` | `text` (`json` under `--json`) | Output |
| `--strict` | boolean | false | Fail when any diagnostic was emitted |
| `--summary` / `--fields` | — | — | `verifySummary` = `{ ok, entries, failed, skipped, diagnostics, error? }` |

**JSON shape (`schema verify`):** the engine's `ZipVerificationReport` — `{ ok, error: { code, message } | null, entryCount, entries: [{ name, ok, crcMatch, sizeMatch, localHeaderMatch, skipped?: 'encrypted' | 'stream-only-codec' }], diagnostics }` — plus `{ failed, skipped, strict }`. `verifyZip` never throws for archive problems; a structural refusal lands in `report.error` and the CLI's `E_VERIFY_FAILED` envelope carries `zipCode = report.error.code`.

**zipnative API used:** `verifyZip(bytes, { limits })`. Types: `ZipVerificationReport`, `VerifiedEntry`, `VerifyZipOptions`, `EntryVerification`.

### `crc32`

**Purpose:** CRC-32 (IEEE 802.3, the ZIP checksum) of files or stdin, constant memory.

```bash
zipnative crc32 [<file>...] [--seed <hex>] [--expect <hex>] [--format text|json]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| positionals / `--input`, `-i` | path[] | stdin | Inputs, 64 KiB chunks |
| `--seed` | hex | 0 | Initial value |
| `--expect` | hex | — | Exactly one input; mismatch → `E_CHECK_FAILED` with `detail: { expectedCrc, actualCrc }` |
| `--format` | `text`\|`json` | `text` (`json` under `--json`) | `{ files: [{ file, crc32, value, bytes }], expect? }` |

**Status envelope:** `{ ok, command: 'crc32', files, bytes }`.

**zipnative API used:** `crc32(chunk, seed)`.

### `inflate`

**Purpose:** Decompress a raw DEFLATE (RFC 1951) or registered-codec stream with a mandatory output bound.

```bash
zipnative inflate [--input <file>] [--output <file>] [--max-output <size>] [--method deflate|store|<id>] [--sync] [--allow-trailing]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--input`, `-i` / `--output`, `-o` | path | stdin / stdout | I/O (partial output removed on failure) |
| `--max-output` | size | effective `maxEntryUncompressedSize` (1 GiB) | Hard bound (`none` → `Number.MAX_SAFE_INTEGER`) |
| `--method` | `deflate`\|`store`\|int | `deflate` | `store` is a bounded pass-through; other ids need `--codec` (`ZIP_UNSUPPORTED_METHOD` / `ZIP_UNSUPPORTED_CODEC_MODE` otherwise) |
| `--sync` | boolean | false | Buffer input, `codec.decompressSync(input, bound)` |
| `--allow-trailing` | boolean | false | Silence the trailing-bytes warning |
| `--dry-run` | boolean | false | `{ method, methodName, maxOutput, sync, output }`; nothing decompressed |

**Status envelope:** `{ ok, command: 'inflate', dryRun, output, method, methodName, bytesIn, bytesOut, leftover, maxOutput, sync, tier }`.

**zipnative API used:** `createInflator(maxOutput)` → `Inflator.push / finished / leftover / end` (default path); `getCodec(method)` → `ZipCodec.decompressSync / decompressStream`; `METHOD_DEFLATE`, `METHOD_STORE`; `activeDeflateTier`.

### `batch`

**Purpose:** Directory-mode orchestration or a declarative manifest pipeline.

```bash
zipnative batch --input-dir <dir> --output-dir <dir> [--task create] [create flags]
zipnative batch --input-dir <dir> --task verify
zipnative batch --manifest <tasks.json> [--continue-on-error] [--allow-codec-load]
```

**Directory mode:** `--task create` runs the full `create` command per immediate subdirectory (`--input <dir> --base <dir> --output <output-dir>/<name>.zip`, every other flag forwarded), `--task verify` runs `verifyZip` per `*.zip`; `--concurrency` (default 4) bounds the pool; `--fail-fast` stops scheduling after the first failure. JSON: `{ ok, command: 'batch', mode: 'directory', task, dryRun?, total, succeeded, failed, results: [{ input, output?, ok, error, code? }] }`.

**Manifest mode** (`--manifest`, mutually exclusive with `--input-dir`): [`src/utils/manifest.ts`](../src/utils/manifest.ts) parses `{ version: 1, tasks: [{ id, command, flags }] }` **strictly before anything runs** — structural violations exit 2 / `E_USAGE`, value violations (bad or duplicate id, non-whitelisted command, bad `@ref`) exit 1 / `E_INPUT`, a `codec` flag without `--allow-codec-load` exit 2 / `E_USAGE`. Path flags (`input`, `output`, `output-dir`, `from-manifest`, `base`, and the path half of `add` / `replace`) get the same traversal check as direct flags and resolve against the manifest's directory; `"@<id>"` substitutes an earlier task's resolved output (or output-dir). Tasks run sequentially, fail-fast unless `--continue-on-error` (dependents of a failed task are skipped). Each task's command function is loaded lazily and called in-process with the resolved flags. JSON: `{ ok, command: 'batch', mode: 'manifest', dryRun?, total, succeeded, failed, skipped, tasks: [{ id, command, ok, output?, skipped?, error?: { code, message, zipCode? } }] }`. The 10 manifest commands are `create`, `list`, `inspect`, `extract`, `cat`, `verify`, `stream`, `modify`, `crc32`, `inflate`; `batch`, `govern`, `schema`, `completion`, `doctor` are explicitly forbidden. Manifests are size-capped (50 MB) and bounded to 1 000 tasks. Exit 1 carries the first failing task's `E_*` code and `zipCode`.

`--summary` / `--fields` / `--pretty` apply to both modes; `--dry-run` prints the plan.

**zipnative API used:** `verifyZip` (directory verify); everything else through the command modules.

### `doctor`

**Purpose:** Environment / capability preflight. Fully offline. Exit 0 when every check passes, 1 otherwise.

```bash
zipnative doctor [--format json|text]
```

`{ ok, checks: [{ name, status: 'ok' | 'warn' | 'error', value, detail }] }` with the checks `cli`, `node` (≥ 22 → `error` otherwise), `zipnative` (package version vs the engine's `VERSION` export → `warn` on disagreement, `error` if absent), `deflate-tier` (`activeDeflateTier(false)`: `node-zlib` / `injected` ok, `pure` ok only under `--pure-codecs`), `deflate-pinned` (`activeDeflateTier(true)`), `web-streams` (`CompressionStream` / `DecompressionStream`), `workers` (worker_threads + `zipnative/worker/zip-worker.js` resolvable, default worker count), `codecs` (registered methods incl. `--codec` modules), `limits` (effective `ZipLimits` with `--max-*` overrides), `commands` (`COMMANDS.length`).

**zipnative API used:** `VERSION`, `activeDeflateTier`, `getCodec`, `DEFAULT_ZIP_LIMITS`, `METHOD_STORE`, `METHOD_DEFLATE`.

### `schema`

**Purpose:** Hand-authored, versioned JSON Schemas (Draft 2020-12) for the CLI's shapes; `$id` = `https://zipnative.dev/schema/cli/<version>/<subject>.schema.json`. The subjects are listed in §5.

### `completion`

`bash` | `zsh` | `fish` | `powershell` (alias `pwsh`) scripts generated from the `COMMANDS` table (per-command flags + `GLOBAL_FLAGS`).

### `govern`

`rules` prints `AGENT_RULES_TEXT`, `policy` prints `AI_GOVERNANCE_POLICY` (JSON), `verify-issue <draft.md>` (or `--input`, `-` = stdin; 50 MB cap) runs the pure `validateGovernanceDraft` and exits 1 / `E_POLICY` on a violation. Errors: proposing an external runtime dependency, or no fenced reproduction block. Warnings: missing `minimal_reproduction` / `environment` / `expected_behavior` hints, or an apparent anti-goal proposal (encryption, other formats, multi-disk, repair). Fully offline.

---

## 5. Agent Automation Contract

The CLI is designed so an autonomous AI agent — or any program — can drive it deterministically. There is **no separate runtime**: agent support is a thin presentation layer over the normal dispatch (the planned `zipnative-mcp` server is a different integration; this is about driving the CLI process directly).

### Channels

| Channel | Carries |
|---------|---------|
| **stdout** | The primary artifact: archive bytes (`create`, `modify`), entry bytes (`cat`, `stream --cat`, `inflate`), a JSON or text report (`list`, `inspect`, `verify`, `crc32`, `batch`, `doctor`, `govern`), a JSON Schema (`schema`), or a completion script. `extract` and `stream --output-dir` write files. |
| **stderr** | All diagnostics: progress, warnings, engine diagnostics as text, and the agent JSON envelopes. |
| **exit code** | `0` success · `1` runtime / check failure · `2` usage. Unchanged in every mode. |

### `--json` envelope

Global `--json` sets `ZIPNATIVE_JSON=1` (in `index.ts`). In that mode:

- On **failure**, a single object is written to stderr: `{ "ok": false, "command": <name|null>, "error": { "code": "E_*", "message": "…", "zipCode"?: "ZIP_*", "entryName"?: "…", "detail"?: { … } } }` (`schema error`).
- On **success**, `create`, `modify`, `extract`, `stream` (extract / cat modes, or list under `--dry-run`), `cat`, `inflate` and `crc32` write a status line: `{ "ok": true, "command": "create", "dryRun": false, "output": "out.zip", "bytes": 12345, … }` (`schema status`; command-specific fields are documented per command in §4).
- `list`, `inspect`, `verify`, `stream --list`, `batch`, `doctor`, `crc32`, `govern verify-issue` put their result document on stdout as JSON (`--json` selects the JSON format and compacts it).

The helpers live in [`src/utils/agent.ts`](../src/utils/agent.ts): `isJsonMode()`, `isDryRun()`, `isQuiet()`, `isStrict()`, `buildErrorEnvelope()`, `emitJsonError()`, `emitStatus()` (a no-op outside `--json`), `progress()` (suppressed by `--quiet`).

### Stable error classes

Defined in [`src/utils/error.ts`](../src/utils/error.ts) as `ErrorCode` and carried on every `CliError.code`:

| Code | Meaning | Exit |
|------|---------|------|
| `E_USAGE` | Missing/invalid flag or argument (also `ZIP_INVALID_OPTION`, `ZIP_LIMIT_INVALID`) | 2 |
| `E_INPUT` | User-supplied payload, entry name or manifest failed validation, or a conflict (entry exists, duplicate name) | 1 |
| `E_PARSE` | The bytes are not a valid ZIP / DEFLATE stream / JSON document (structural) | 1 |
| `E_IO` | Filesystem or stream I/O failure, including refusing to overwrite | 1 |
| `E_SECURITY` | Hostile archive shape (zip-slip, overlap, symlink, duplicate path, CD/LFH mismatch, Zip64 spoofing) or the CLI sink guard tripped | 1 |
| `E_DATA` | Integrity failure: CRC / size / data-descriptor mismatch, decompression failure, output overflow | 1 |
| `E_LIMIT` | A named security bound (`ZipLimits`) was exceeded (`detail: { limit, configured, observed }`) | 1 |
| `E_UNSUPPORTED` | Encryption, unknown method, multi-disk, zip64 streaming, CD-less descriptor, codec mode (`detail: { feature }`) | 1 |
| `E_NOT_FOUND` | A named entry does not exist in the archive | 1 |
| `E_VERIFY_FAILED` | `verify` verdict is negative (`zipCode` set for structural refusals) | 1 |
| `E_CHECK_FAILED` | `inspect --check`, `crc32 --expect`, or a `--strict` diagnostic escalation failed | 1 |
| `E_POLICY` | `govern verify-issue` found an AI-governance policy violation | 1 |
| `E_RUNTIME` | Catch-all runtime error (also `ZIP_API_MISUSE`, `ZIP_INTERNAL`) | 1 |

When no code is passed, `CliError` derives one from the exit code (`2 → E_USAGE`, otherwise `E_RUNTIME`).

### The 39 `ZIP_*` causes → `E_*` classes

`error.zipCode` is zipnative's frozen `err.code`, verbatim (registry: [`docs/data/errors.json`](data/errors.json), which also carries `raisedWhen` / `remedy` per code). The mapping below is `ZIP_TO_CLI` in [`src/utils/ziperr.ts`](../src/utils/ziperr.ts):

| `zipCode` | Class | Raised when |
|-----------|-------|-------------|
| `ZIP_INVALID_OPTION` | `E_USAGE` (2) | An option value fails validation (compression level, chunk size, argument shape) |
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
| `ZIP_CD_LFH_MISMATCH` | `E_SECURITY` | A local header contradicts the central directory on the method (CWE-436) |
| `ZIP_ZIP64_CONTRADICTION` | `E_SECURITY` | A zip64 value contradicts a non-sentinel classic field (CWE-1288) |
| `ZIP_PATH_TRAVERSAL` | `E_SECURITY` | An entry name escapes the extraction root or is a Windows reserved device name (CWE-22 / CWE-67); `--skip-unsafe` skips instead |
| `ZIP_SYMLINK_REJECTED` | `E_SECURITY` | A symlink entry under the default `rejectSymlinks` (CWE-59); `--allow-symlinks` / `--skip-symlinks` |
| `ZIP_EXTRACT_DUPLICATE_PATH` | `E_SECURITY` | Two entries resolve to the same output path under `--on-duplicate error` (CWE-694) |
| `ZIP_CRC_MISMATCH` | `E_DATA` | Decompressed bytes fail the declared CRC-32 (`detail: { expectedCrc, actualCrc }`) |
| `ZIP_SIZE_MISMATCH` | `E_DATA` | Declared vs measured sizes, or local vs central metadata, contradict |
| `ZIP_INFLATE_OUTPUT_OVERFLOW` | `E_DATA` | Inflate produced more than the declared or permitted output (`inflate --max-output`) |
| `ZIP_DESCRIPTOR_MISMATCH` | `E_DATA` | No data-descriptor form matches the measured CRC and sizes of a bit-3 entry |
| `ZIP_DECOMPRESSION_FAILED` | `E_DATA` | The active codec failed mid-decompression on a corrupt payload |
| `ZIP_LIMIT_EXCEEDED` | `E_LIMIT` | A configured `ZipLimits` bound was exceeded (`detail: { limit, configured, observed }`) — raise the matching `--max-*` only for trusted input |
| `ZIP_LIMIT_INVALID` | `E_USAGE` (2) | The limits override itself is invalid — unreachable from the CLI (values are pre-validated) |
| `ZIP_UNSUPPORTED_ENCRYPTION` | `E_UNSUPPORTED` | An entry is encrypted — unsupported in 1.x by policy (`detail.feature`: `zipcrypto` \| `strong-encryption`) |
| `ZIP_UNSUPPORTED_METHOD` | `E_UNSUPPORTED` | A compression method has no registered codec (`--codec` one) |
| `ZIP_UNSUPPORTED_MULTI_DISK` | `E_UNSUPPORTED` | The archive is multi-disk / spanned |
| `ZIP_UNSUPPORTED_ZIP64_STREAMING` | `E_UNSUPPORTED` | A `create --stream` entry exceeds 4 GiB — buffer it (omit `--stream`) or split it |
| `ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR` | `E_UNSUPPORTED` | `stream` met a bit-3 entry it cannot delimit (store / encrypted / custom codec) — use `list` / `extract` on the complete file |
| `ZIP_UNSUPPORTED_CODEC_MODE` | `E_UNSUPPORTED` | A registered codec supports only the other access mode |

Only two causes exit 2 (`ZIP_INVALID_OPTION`, `ZIP_LIMIT_INVALID`); every other cause exits 1.

### Diagnostics (11 codes, never thrown unless `--strict`)

`ZIP_PREPENDED_DATA` (info), `ZIP_MULTIPLE_EOCD` (info), `ZIP_NAME_MISMATCH` (warning), `ZIP_UNICODE_PATH_CONFLICT` (warning), `ZIP_INVALID_UTF8_NAME` (warning), `ZIP_DUPLICATE_NAME` (warning), `ZIP_EXTRA_FIELD_MALFORMED` (warning), `ZIP_ZIP64_EXTRA_IGNORED` (warning), `ZIP_TIMESTAMP_NOT_PINNED` (info), `ZIP_NONDETERMINISTIC_CODEC` (info), `ZIP_DEAD_BYTES_RATIO` (info). Row shape: `{ code, severity, message, entryName? }` (`schema diagnostics`).

### `--dry-run`

`create`, `extract`, `modify`, `stream`, `cat`, `inflate` and `batch` accept `--dry-run` (sets `ZIPNATIVE_DRY_RUN=1`). Inputs are fully validated — inputs walked and names checked, archives opened and every destination proven safe, edits applied to the modifier, manifests parsed and their `@ref` graph resolved — but **no output is produced or written**. Commands read `hasFlag(args.flags, 'dry-run') || isDryRun()` so a direct command call and the global flag both work. Text mode prints `plan …` / `skip …` lines; `--json` adds `"dryRun": true` to the status envelope.

### Token economy — output projection

The JSON that `list` / `inspect` / `verify` / `stream` / `batch` write to stdout is the bulk of an agent's token cost. The projection layer in [`src/utils/projection.ts`](../src/utils/projection.ts) (`emitJsonReport`, `selectFields`, `serializeJson`, `parseFieldList` — pure, zero-dep) shrinks it through three composable levers:

| Lever | Flag | Effect |
|-------|------|--------|
| Compact serialization | *(auto under `--json`)* | Minified JSON; `--pretty` opts back into 2-space output. Non-`--json` runs stay pretty for humans. |
| Canonical summary | `--summary` | Collapses the report to a minimal verdict (below). |
| Dot-path projection | `--fields a,b.c` | Keeps only the named paths; an array segment maps over its elements; unknown paths are silently omitted. |

Precedence: `--summary` wins over `--fields` (the summary is emitted as-is); otherwise `--fields` projects the full report.

| Command | `--summary` shape |
|---------|-------------------|
| `list` | `{ entries, files, directories, compressedSize, uncompressedSize, zip64, encrypted }` |
| `inspect` | `{ entries, bytes, uncompressedSize, zip64, encrypted, deterministic, diagnostics, checksPassed? }` |
| `verify` | `{ ok, entries, failed, skipped, diagnostics, error? }` |
| `stream` | `{ entries, bytes, trust: "local-headers-only" }` |
| `batch` | `{ ok, command, mode, task?, dryRun?, total, succeeded, failed, skipped? }` (drops `results` / `tasks`) |

The summary shapes are schema-pinned: `schema entries-summary`, `inspect-summary`, `verify-summary`, `stream-summary`, `batch-summary`.

### `schema` subjects (22)

- **Inputs:** `create-manifest` (default), `modify-manifest`, `batch-manifest`
- **Outputs:** `entries`, `entries-summary`, `inspect`, `inspect-summary`, `verify`, `verify-summary`, `stream`, `stream-summary`, `batch`, `batch-summary`, `doctor`, `govern-verify`, `crc32`
- **Envelopes:** `status`, `error`
- **Registries:** `errors` (the `E_*` codes, the 39-entry `zipnativeToCli` map, the diagnostic codes — data), `limits` (the eight bounds with defaults, CWEs and flags), `diagnostics`
- **Meta:** `manifest` (the capability manifest — data)

`schema list` enumerates them. Every schema `$id` embeds the CLI version so callers can detect drift.

### `batch --manifest` for agents

The manifest is the recommended way to run a multi-step pipeline (create → verify → extract) in **one process invocation** with a single JSON summary: validate it against `schema batch-manifest`, pre-flight with `--dry-run`, and remember that a `codec` flag inside a manifest is refused unless `batch` itself carries `--allow-codec-load` — a manifest obtained from elsewhere can never execute user code on its own. A manifest has the filesystem access of the user who invokes `batch` — the same trust level as flags typed on the command line.

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
| Oversized names / extra fields / comments / central directory | `maxNameBytes`, `maxExtraFieldBytes`, `maxCommentBytes`, `maxCentralDirectoryBytes` | CWE-400 | `ZIP_LIMIT_EXCEEDED` | `--max-name-bytes`, `--max-extra-bytes`, `--max-comment-bytes`, `--max-cd-bytes` |

### The CLI's own rows

| Threat | Mitigation |
|--------|-----------|
| Destination escaping `--output-dir` after sanitisation | `safeJoin(root, path)` re-proves containment of every destination (`E_SECURITY`); `stream` additionally applies `sanitizeEntryPath()` because the forward reader does not |
| Silent overwrite / case-fold collision | Existing files refused without `--overwrite` (`E_IO`); on win32 / darwin case-folded duplicates are refused (`ZIP_EXTRACT_DUPLICATE_PATH`) |
| Partial outputs on failure | `cat --output`, `extract`, `stream --output-dir`, `inflate --output`, `modify --in-place` remove the partial file / temp file |
| Path traversal via `--input`, `--output`, `--output-dir`, `--from-manifest`, `--manifest`, `--base`, `--codec`, `--config`, manifest values | `validatePath()` rejects `../` before any filesystem access |
| Memory exhaustion via large JSON | 50 MB cap before `JSON.parse` (manifests, drafts); 1 MB cap on `.zipnativerc.json`; 1 000-task cap on batch manifests |
| Unbounded raw DEFLATE (`inflate`) | Mandatory output bound (`--max-output`, default = the effective `--max-entry-size`) |
| Executing user code | `--codec` is the only dynamic import: argv only, refused from config files, refused inside manifests without `--allow-codec-load`, read-side only |
| Hostile config file planted in a repository | The `codec` key is refused; config only supplies flag defaults and never runs code |
| Data remanence in `modify` | Documented on `--help` and printed as an `info:` line; `--compact` is the deletion path |
| Forward-reader trust (`stream`) | Attribute-dependent flags refused; `trust: "local-headers-only"` in every JSON output; a `warning:` line at start |
| Supply-chain risk | Zero extra runtime dependencies; Trusted Publishing (OIDC) with provenance; CodeQL + Scorecard CI; CycloneDX SBOM per release |
| False conformance claims | Blocking veraZIP gate (`verazip.yml` on Linux + Windows, and pre-publish in `publish.yml`): a CLI-generated 34-archive corpus validated by an engine-independent ISO/IEC 21320-1 parser with 4 negative canaries and 3 hostile-but-conformant archives `extract` must refuse |

**Network:** none. No command opens a socket in any mode.

See [SECURITY.md](../SECURITY.md) for the full policy.

---

## 7. Troubleshooting

### `E_SECURITY` / `ZIP_PATH_TRAVERSAL` on an archive that "works in unzip"

The archive contains a name that cannot be made safe — `../` segments, an absolute path, a drive letter, or a **Windows reserved device name** (`CON`, `NUL`, `aux.h`, `COM1`…) — and the CLI refuses on every platform. Inspect it (`zipnative inspect --input a.zip --entries --format json`), then extract with `--skip-unsafe` to skip those entries (nothing unsafe is ever written).

### `E_LIMIT` / `ZIP_LIMIT_EXCEEDED` with `detail.limit = "maxCompressionRatio"`

An entry inflates more than 1024:1 — the shape of a decompression bomb. If the archive is trusted (sparse files, large zero-filled payloads), raise the named bound explicitly: `--max-ratio 4096`. `none` disables a bound and prints a warning.

### `E_VERIFY_FAILED` with `zipCode`

`verify` found a structural refusal: the envelope's `zipCode` is `report.error.code` (`ZIP_ENTRY_OVERLAP`, `ZIP_EOCD_NOT_FOUND`, …). Read the report on stdout for the detail; there is no repair mode by design.

### `doctor` reports `deflate-tier: pure`

`node:zlib` was not resolved (or `--pure-codecs` was passed). Compression still works but through the pure-TS tier. Every archive-touching command calls `prepareEngine()`, so this only happens under `--pure-codecs`; if it happens otherwise, the bundle was altered — `zipnative` must stay external (see [CLAUDE.md](../CLAUDE.md)).

### `create --parallel` fails with `E_USAGE` under `--pure-codecs`

`--parallel` resolves `node:zlib` inside its worker bundle, so `--pure-codecs` cannot govern it. Add `--deterministic` for unconditional byte identity, or drop `--pure-codecs`.

### `modify` output looks wrong in 7-Zip

7-Zip's CLI mis-reads the append-only layout (it does not honour the final central directory). Pass `--compact`; every other mainstream reader (unzip, bsdtar, Python, jar, Expand-Archive) and zipnative read the append-only output correctly.

### `stream` fails with `ZIP_STREAM_TRUNCATED` or `ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR`

The producer cut the stream, or the archive uses data descriptors the forward reader cannot delimit (store + bit 3, encrypted + bit 3, custom codec + bit 3). Download the whole file and use `list` / `extract`.

### `Error: Path traversal detected`

All file-path flags (and manifest values) are validated. Make sure paths do not contain `../` sequences; use absolute paths if needed.

### Piping binary output

`create` and `cat` write bytes to stdout by default. Redirect (`> out.zip`) or pass `--output <file>`; read the `--json` envelope from stderr.

---

## 8. zipnative API Mapping

Every one of the 77 exports of zipnative 1.0.0 (72 from `zipnative`, 5 from `zipnative/worker` — [`docs/data/core-exports.json`](data/core-exports.json)) mapped to its CLI touchpoint. "Bridge" means the export is re-exported by [`src/core-bridge/index.ts`](../src/core-bridge/index.ts); `tests/docs/consistency.test.ts` checks that every name below stays present.

### Reading, random access, streams

| Export | Kind | CLI touchpoint |
|--------|------|----------------|
| `openZip` | function | `openArchive()` in `utils/zipops.ts` — every archive command (`list`, `inspect`, `cat`, `extract`, `modify`) |
| `OpenZipOptions` | interface | `openArchive(bytes, options)`; `list --validate` sets `validate`, `inspect` forces `eager` |
| `ReadEntryOptions` | interface | `cat --no-verify-crc` → `{ verifyCrc: false }` on `readEntryStream` |
| `ZipReader` | interface | `entries()` (`list`, `inspect`, `extract`), `getEntry()` (`cat`, `inspect --entry`), `readEntryStream()` / `readEntryRaw()` (`cat`), `entryCount` / `isZip64` / `comment` / `bytes` (`list`, `inspect`, `modify`); `verifyEntry()` is covered by `verify` (through `verifyZip`) |
| `iterateZipEntries` | function | `stream` — the forward reader over stdin / pipes |
| `IterateZipOptions` | type | `commonOptions(args, sink)` passed to `iterateZipEntries` |
| `StreamedZipEntry` | interface | `stream`: `header` / `data()` / `skip()` per local entry (`pumpEntry`) |
| `StreamedZipHeader` | interface | `rowFromHeader()` in `utils/entryfmt.ts` — the forward `EntryRow` (no CD-only fields) |
| `ByteSource` | type | `readableToByteSource()` in `utils/io.ts` — `stream` input, `create --stream` file sources, `create --stdin-name` |

### Extraction

| Export | Kind | CLI touchpoint |
|--------|------|----------------|
| `extractZip` | function | `extract --buffered` (in-memory extractor) |
| `extractZipStream` | function | `extract` (default streaming extractor; plan phase defers `stream()`) |
| `sanitizeEntryPath` | function | Name pre-check in `create` (`walk.ts`, manifests, `--stdin-name`), `modify` (`assertSafeName`), directory entries in `extract`, every name in `stream`, and the basis of `safeJoin` |
| `ExtractOptions` | interface | `extract`: `rejectTraversal`, `rejectSymlinks`, `onDuplicate`, `filter`, limits |
| `ExtractedEntry` | interface | `extract --buffered` items (`{ path, data, entry }`) |
| `ExtractedStreamEntry` | interface | `extract` items (`{ path, entry, stream() }`) |

### Writing

| Export | Kind | CLI touchpoint |
|--------|------|----------------|
| `createZip` | function | `create` (buffered and `--stream`), `batch --task create` |
| `ZipWriter` | interface | `add()` / `addDirectory()` / `addStream()` / `toBytes()` / `stream()` in `create`; `setComment` is expressed as `CreateZipOptions.comment` |
| `CreateZipOptions` | interface | `create`: `order`, `defaultDate`, `compression`, `comment`, `strict`, `onDiagnostic`, `limits` |
| `AddEntryOptions` | interface | Per-entry `compression`, `date`, `comment`, `externalAttributes` (`--preserve-mode`, manifest `mode`) in `create` and `modify` |
| `ZipCompressionOptions` | interface | `--method` / `--level` / `--deterministic` (`parseCompression` in `utils/zipops.ts`) and manifest `compression` |
| `StreamOptions` | interface | `create --stream --chunk-size` → `writer.stream({ chunkSize })` |
| `createParallelZip` (`./worker`) | function | `create --parallel` via `loadParallelZip()` (lazy, with an explicit `workerUrl`) |
| `ParallelZipOptions` (`./worker`) | interface | `create --parallel --workers / --min-job-size / --job-timeout` (+ every `CreateZipOptions` field) |
| `ParallelZipWriter` (`./worker`) | interface | The `create` writer under `--parallel` (`toBytes()` is awaited) |
| `ByteSource` (`./worker`) | type | Same type as the root export — `addStream()` sources under `--parallel` |
| `StreamOptions` (`./worker`) | interface | Same type as the root export — `stream({ chunkSize })` under `--parallel --stream` |

### Verification and modification

| Export | Kind | CLI touchpoint |
|--------|------|----------------|
| `verifyZip` | function | `verify`, `batch --task verify` |
| `VerifyZipOptions` | interface | `verify` / `batch --task verify` pass `{ limits }` from the `--max-*` flags |
| `ZipVerificationReport` | interface | The `verify` report body (`ok`, `error`, `entryCount`, `entries`, `diagnostics`) |
| `VerifiedEntry` | interface | `verify` rows (`name`, `ok`, `crcMatch`, `sizeMatch`, `localHeaderMatch`, `skipped?`) |
| `EntryVerification` | interface | Base of `VerifiedEntry` — the per-entry `crcMatch` / `sizeMatch` / `localHeaderMatch` triple `verify` renders |
| `createZipModifier` | function | `modify` |
| `ZipModifier` | interface | `addEntry` / `replaceEntry` / `removeEntry` / `renameEntry` / `setComment` / `save` / `saveCompact` in `modify` |
| `ZipModifierOptions` | interface | `modify --method / --level / --deterministic / --date` + common options |

### Entry attributes, entries and shared types

| Export | Kind | CLI touchpoint |
|--------|------|----------------|
| `getUnixMode` | function | `unixMode` column (`list`, `inspect`), `extract --preserve-mode` |
| `isSymlinkEntry` | function | `isSymlink` column, `inspect` symlink count and `--check no-symlinks`, `extract --skip-symlinks` / `symlinksAsData` |
| `ZipEntry` | interface | `rowFromEntry()`, `inspect` statistics, `cat` / `extract` planning |
| `ZipExtraField` | interface | `extraFields` rows under `--long` / `--extra` (`utils/entryfmt.ts`) |
| `ZipCommonOptions` | interface | `commonOptions(args, sink)` = `{ strict, onDiagnostic, limits }` for every core entry point |
| `ZipDiagnostic` | interface | `createDiagnosticSink()` converts each one to a `DiagnosticRow` |
| `ZipDiagnosticCode` | type | The 11-code vocabulary listed in `ZIP_DIAGNOSTIC_CODES` (`utils/ziperr.ts`) and `schema diagnostics` |
| `ZipDiagnosticHandler` | type | The sink's `onDiagnostic` |
| `ZipLimits` | interface | The eight `--max-*` flags (`LIMIT_FLAGS` in `utils/limits.ts`), `doctor` `limits` check, `schema limits` |
| `DEFAULT_ZIP_LIMITS` | const | Defaults shown by `--help`, `doctor`, `schema limits` / `manifest`, and `inflate`'s default `--max-output` |

### Errors

| Export | Kind | CLI touchpoint |
|--------|------|----------------|
| `ZipError` | class | `mapZipError()` — the `instanceof` root; `err.code` → `zipCode` |
| `ZipFormatError` | class | → `E_PARSE` (or `E_INPUT` for the two entry-name codes) |
| `ZipSecurityError` | class | → `E_SECURITY`; supplies `entryName` |
| `ZipDataError` | class | → `E_DATA`; supplies `entryName` and `detail: { expectedCrc, actualCrc }` |
| `ZipLimitError` | class | → `E_LIMIT` (`ZIP_LIMIT_INVALID` → `E_USAGE`); supplies `detail: { limit, configured, observed }` |
| `ZipUnsupportedError` | class | → `E_UNSUPPORTED`; supplies `detail: { feature }` |
| `ZipErrorCode` | type | `ZIP_TO_CLI satisfies Record<ZipErrorCode, …>` — a new core code fails `tsc` |
| `ZipBaseErrorCode` | type | The 7 base codes (`ZIP_INVALID_OPTION` … `ZIP_INTERNAL`) rows of `ZIP_TO_CLI` |
| `ZipFormatErrorCode` | type | The 13 format-code rows of `ZIP_TO_CLI` |
| `ZipSecurityErrorCode` | type | The 6 security-code rows of `ZIP_TO_CLI` |
| `ZipDataErrorCode` | type | The 5 data-code rows of `ZIP_TO_CLI` |
| `ZipLimitErrorCode` | type | The 2 limit-code rows of `ZIP_TO_CLI` |
| `ZipUnsupportedErrorCode` | type | The 6 unsupported-code rows of `ZIP_TO_CLI` |
| `ZipUnsupportedFeature` | type | `detail.feature` in the `E_UNSUPPORTED` envelope (`zipcrypto`, `strong-encryption`, `multi-disk`, `zip64-streaming`, `cd-less-descriptor`, `method:<n>`) |

### Codecs, checksums, constants, metadata

| Export | Kind | CLI touchpoint |
|--------|------|----------------|
| `crc32` | function | `crc32` command (chunked, `--seed`) |
| `createInflator` | function | `inflate` (default resumable path) |
| `Inflator` | interface | `push()` / `finished` / `leftover` / `end()` in `inflate`; `bytesConsumed` backs the `leftover` accounting |
| `getCodec` | function | `inflate --method <id>`, `methodName()` in `utils/entryfmt.ts`, `doctor` `codecs` |
| `registerCodec` | function | `--codec <module>` (`utils/codecs.ts`) |
| `setDeflateImpl` | function | `--codec` module `deflateImpl` export |
| `setInflateImpl` | function | `--codec` module `inflateImpl` export |
| `initNodeZipCodecs` | function | `ensureCodecsReady()` in the bridge, called by `prepareEngine()` |
| `activeDeflateTier` | function | `tier` in the `create` / `inflate` envelopes; `doctor` `deflate-tier` / `deflate-pinned` |
| `DeflateTier` | type | The `tier` enum in `schema status` (`pure-pinned` \| `injected` \| `node-zlib` \| `pure`) |
| `ZipCodec` | interface | `--codec` module contract (`isCodec()` validation), `inflate --method` |
| `CodecCompressOptions` | interface | The `compressSync` option shape a `--codec` module may implement (validated as a function, forwarded by the engine) |
| `METHOD_STORE` / `METHOD_DEFLATE` | const | `methodName()`, `inspect --check store-only / deflate-only / method=`, `inflate --method`, `doctor` |
| `FLAG_DATA_DESCRIPTOR` / `FLAG_ENCRYPTED` / `FLAG_STRONG_ENCRYPTION` / `FLAG_UTF8` | const | `decodeFlags()` (`--long` rows), `inspect` UTF-8 verdict, forward `usesDataDescriptor` |
| `VERSION` | const | `doctor` `zipnative` check (package version vs the engine's `VERSION` export); `tests/docs/consistency.test.ts` pins `docs/data/*.json` to it |

---

## 9. Development Quick Reference

```bash
# Install
npm ci

# Build (outputs dist/cli.cjs — the bin — plus dist/cli.js and .d.ts)
npm run build

# Test (in-process vitest; one spawn smoke test against the built binary)
npm test
npm run test:coverage       # thresholds: statements 85 / branches 75 / functions 85 / lines 85

# Conformance (veraZIP — ISO/IEC 21320-1:2015; level 0 needs no external tool)
npm run corpus:zip          # write the 34-archive corpus to test-output/zip/ (needs a prior build)
npm run validate:zip        # build + corpus + validate (exit 0/1/2/3 — see CONTRIBUTING.md)

# Typecheck / lint
npm run typecheck:all
npm run lint

# Smoke test the built binary (always, before claiming a change works)
node dist/cli.cjs --help
node dist/cli.cjs --version --json
node dist/cli.cjs doctor
node dist/cli.cjs create src/ --deterministic -o /tmp/src.zip && node dist/cli.cjs verify --input /tmp/src.zip
node dist/cli.cjs create src/ --parallel -o /tmp/p.zip        # proves zipnative/worker resolves from the bundle
node dist/cli.cjs schema manifest | head
```

---

## 10. Samples

Complete, runnable examples live in [`samples/`](../samples/), one directory per command; every script ships as a Bash (`.sh`) **and** a PowerShell (`.ps1`) pair and runs offline:

| Directory | Description |
|-----------|-------------|
| [`create/`](../samples/create/) | Directory, stdin, manifest, deterministic + SHA-256 twice, `--stream`, `--parallel`, globs |
| [`modify/`](../samples/modify/) | Replace / add / remove / rename, append-only vs `--compact`, `--in-place`, edits manifest |
| [`list/`](../samples/list/) | Text, `--long`, JSON, NDJSON, `--summary` / `--fields` |
| [`inspect/`](../samples/inspect/) | Forensic report, `--entries --extra`, `--check` gates |
| [`cat/`](../samples/cat/) | Single / multiple entries, `--raw`, `--output` |
| [`extract/`](../samples/extract/) | Safe defaults, `--dry-run`, globs, `--skip-unsafe`, tightened `--max-*` bounds |
| [`stream/`](../samples/stream/) | Pipe listing, pipe extraction, `--cat`, the trust caveat |
| [`verify/`](../samples/verify/) | Verdicts, `--strict`, `--json --summary` |
| [`crc32/`](../samples/crc32/) | Files, stdin, `--expect`, `--seed` |
| [`inflate/`](../samples/inflate/) | Raw DEFLATE from `cat --raw`, `--max-output`, `--sync` |
| [`batch/`](../samples/batch/) | Directory mode (create / verify) and a `--manifest` pipeline |
| [`doctor/`](../samples/doctor/), [`schema/`](../samples/schema/), [`completion/`](../samples/completion/) | Preflight, schemas / manifest, shell completion install |
| [`govern/`](../samples/govern/) | Rules, policy, `verify-issue` on a passing and a failing draft |
| [`agent/`](../samples/agent/) | The recommended agent loop end to end |

Run every sample at once:

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
    npx zipnative-cli inspect --input release.zip --check deterministic,no-data-descriptor
    npx zipnative-cli verify --input release.zip --strict
    sha256sum release.zip | tee release.zip.sha256
```

Two runs of that step on different runners produce the same SHA-256 — `--deterministic` pins the pure-TS encoder, and the engine's defaults (canonical order, DOS-epoch timestamps, UTF-8 names) remove every other environmental input.

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

Because the archive has a shape the engine treats as hostile: a name with `..`, an absolute path, a Windows reserved device name (`aux.h` from a POSIX host), a symlink entry, two entries resolving to the same path, or overlapping / contradictory headers. `unzip` and friends forgive most of these; zipnative refuses by default and tells you the exact `ZIP_*` cause. Use `--skip-unsafe` / `--skip-symlinks` / `--on-duplicate` to skip deliberately; overlaps and header contradictions have no opt-out.

### How do I get byte-identical archives across machines?

`create --deterministic`. Without it the bytes are stable for a given Node + zlib build only (the `ZIP_NONDETERMINISTIC_CODEC` diagnostic tells you when a pinned date meets an unpinned codec). Keep the DOS-epoch default (`--date epoch`) and avoid `--mtime`; `--parallel` is byte-identical to the sequential writer, while `--stream` produces the same content in the data-descriptor layout (compare with `verify` / `inspect`, not with a hash). Prove it with `inspect --check deterministic` and `sha256sum`.

### Is `--json` output stable?

Yes. Envelope fields, the 13 `E_*` classes, the 39 `ZIP_*` causes and the report shapes are pinned by `schema` (`$id` embeds the CLI version) and by tests. New fields are additive.

### Where do the security limits come from and how do I change them?

They are zipnative's `DEFAULT_ZIP_LIMITS` (100000 entries, 1 GiB per entry, 8 GiB total, 1024:1 ratio, 4096-byte names, 65535-byte extra fields and comments, 256 MiB central directory). Override per run with `--max-*`, or per project in `.zipnativerc.json` (`{ "max-total-size": "32g", "extract": { "max-ratio": 4096 } }`). `none` disables a bound and warns.

### Can I use zipnative-cli with stdin/stdout on Windows PowerShell?

Yes. `Get-Content -AsByteStream a.zip | zipnative stream --list` and `zipnative cat a.zip x | Set-Content -AsByteStream x` work; for archives prefer `--input` / `--output` paths to avoid PowerShell's text-mode pipe conversions. Every sample ships as a `.ps1` next to its `.sh`.

### What is the difference between `list`, `inspect` and `verify`?

| Command | Opens | Decompresses | Purpose |
|---------|-------|--------------|---------|
| `list` | lazily | nothing | Enumerate entries fast |
| `inspect` | eagerly (local headers cross-checked, overlap table) | nothing | Forensic facts, determinism verdict, `--check` gates |
| `verify` | eagerly | every entry | CRC / size / local-header agreement per entry — the integrity verdict |

### Why does `modify` say my removed file is "recoverable"?

The default `save()` is append-only: it keeps the original bytes verbatim and writes a new central directory, so untouched entries are never recompressed — and removed / replaced payloads stay inside the file. `--compact` rewrites the archive canonically (still without recompressing) so removed content is truly gone. 7-Zip's CLI also mis-reads the append-only layout.

### Can the CLI open encrypted archives?

No — by engine policy in 1.x (ZipCrypto is cryptographically broken). Encrypted entries are detected (`isEncrypted`), listed, counted by `inspect`, reported as `skipped` by `verify`, and refused on read with `ZIP_UNSUPPORTED_ENCRYPTION`. `stream --skip-unsupported` skips them. Read-only AES decryption is a future consideration blocked on a core crypto-provider seam (see ROADMAP).

### Does anything here touch the network?

No. Not `doctor`, not `govern`, not `schema`, not `--json`. The engine never opens a socket and neither does the CLI.

### Are there security considerations I should know?

Yes — the defaults are the safe path: containment-proved extraction, refusals for hostile shapes, CWE-tagged bounds always on, no symlink ever materialised, no overwrite without `--overwrite`, partial files removed on failure, `--codec` only from argv. When handling untrusted archives, tighten `--max-total-size` / `--max-ratio`, keep `--skip-unsafe` off unless you accept silently skipped entries, and prefer `extract --dry-run --json` first. See [SECURITY.md](../SECURITY.md).

---

*Last updated: 2026-09-03 | zipnative-cli v1.0.0 | zipnative 1.0.0*
