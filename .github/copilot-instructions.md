# zipnative-cli — Project Guidelines

## Overview

Official CLI companion to the `zipnative` library. Exposes fifteen commands in
four groups: **Create & modify** — `create` (files/dirs/stdin/manifest → deterministic
ZIP; buffered, `--stream`, `--parallel`), `modify` (append-only or `--compact` edits, no
recompression); **Read & extract** — `list`, `inspect` (forensic report + `--check`
assertions), `cat`, `extract` (secure-by-default sink), `stream` (forward-only reader over
unseekable input); **Integrity & codecs** — `verify`, `crc32`, `inflate`; **Automation &
meta** — `batch` (directory mode or manifest pipeline), `doctor` (capability preflight),
`schema` (versioned JSON Schemas + capability manifest for agents), `completion`
(bash/zsh/fish/powershell), `govern` (AI-governance / HITL contract).

**Philosophy:** Zero extra runtime dependencies. `zipnative` is the only dependency — all
ZIP logic lives there. The CLI is a thin, composable dispatch layer over it: **no ZIP
parsing logic in `src/`** — every byte-level operation (EOCD, central directory, local
headers, CRC, DEFLATE, path sanitisation) is a core call through `src/core-bridge/`. Raw
ZIP bytes are hand-written only in `scripts/` (corpus canaries, vendored validator) and
`tests/helpers/raw-zip-builder.ts` (hostile fixtures), and both are engine-independent by
construction. The CLI is offline, always: no command can open a socket.

**Targets:** Node.js ≥ 22. The package is a CommonJS bin (`dist/cli.cjs`, the only build
artefact — no ESM build, no `.d.ts`, no programmatic entry point). Ubuntu 22/24 and Windows 22/24
are blocking in CI (path separators, reserved device names, case-insensitive filesystems, CRLF);
macOS 22 runs too.

## Working Modes & Token Economy

Default to the cheapest mode that fits the request. Do not over-explore.

- **Plan mode** — for vague, multi-file, or risky requests. Produce a short numbered plan
  (files to touch + approach), then stop for confirmation. No edits yet. Keep it to a handful
  of bullets; do not dump file contents.
- **Implement mode** — for clear, scoped requests. Edit directly, then validate. Skip the plan.

Token discipline (this file loads on every request — keep edits to it minimal):

- Read in **wide ranges**, not many small reads. Batch independent searches/reads in parallel.
- Stop searching once you can act. Don't re-search for facts already in context or in
  `/memories/repo/`.
- Don't restate file contents back to the user; summarize in 1–3 sentences.
- Reuse the per-area instruction files (`.github/instructions/*`) instead of re-deriving
  conventions; they hold the deltas, this file holds the globals.
- After code changes, run the smallest sufficient check (targeted test) before the full suite.

## Architecture

```
src/
├── index.ts           # CLI entry: parse argv → global env flags → config merge → lazy dispatch → exit
├── commands/
│   ├── create.ts      # Files/dirs/stdin/manifest → createZip | addStream+stream() | createParallelZip → output
│   ├── modify.ts      # Archive + edits (remove→rename→replace→add→comment) → save() | saveCompact() | --in-place
│   ├── list.ts        # openZip (nothing decompressed) → text table | json | ndjson rows
│   ├── inspect.ts     # Eager open → forensic report + determinism verdict + --check gate (E_CHECK_FAILED)
│   ├── cat.ts         # readEntryStream / readEntryRaw → stdout or --output; CRC verified at stream end
│   ├── extract.ts     # extractZipStream → PLAN (safeJoin containment, overwrite refusal) → WRITE with backpressure
│   ├── stream.ts      # iterateZipEntries over stdin/pipes (local headers only, trust: "local-headers-only")
│   ├── verify.ts      # verifyZip → report is the artefact, exit code is the verdict (E_VERIFY_FAILED)
│   ├── crc32.ts       # Incremental crc32() over files/stdin in 64 KiB chunks; --expect turns it into a check
│   ├── inflate.ts     # createInflator(maxOutput) chunk by chunk, or --sync decompressSync; mandatory bound
│   ├── batch.ts       # Directory mode (--task create|verify, bounded pool) or manifest pipeline (@id refs)
│   ├── doctor.ts      # Offline preflight: versions, deflate tier, codecs, workers, effective limits, command count
│   ├── schema.ts      # Hand-authored JSON Schemas (draft 2020-12, $id embeds version) + capability manifest
│   ├── completion.ts  # COMMANDS metadata (single source of truth) → bash/zsh/fish/powershell scripts
│   └── govern.ts      # AI-governance / HITL: rules | policy | verify-issue (E_POLICY gate)
├── utils/
│   ├── args.ts        # Zero-dep argument parser (flags, positionals, = notation, repeatable flags, boolean table)
│   ├── flags.ts       # The boolean-flag table (global + per command): a listed flag never consumes the next token
│   ├── error.ts       # CliError (exitCode, E_* code, zipCode, entryName, detail), deprecate()
│   ├── ziperr.ts      # ZIP_* → E_* table (39 codes, `satisfies Record<ZipErrorCode>`), mapZipError / guard
│   ├── agent.ts       # --json / --dry-run / --quiet / --strict env flags, error + status envelopes, progress()
│   ├── io.ts          # stdin/stdout/file I/O, validatePath (MANIFEST values only), safeJoin (lexical containment),
│   │                  #   exclusive writes (wx) unless --overwrite, --max-input-size-bounded reads, EPIPE → exit 0,
│   │                  #   captureStdout (batch --json), 50 MB JSON cap
│   ├── sink.ts        # The extraction sink (extract + stream): safeJoin → duplicate policy → realpath containment
│   │                  #   of the nearest existing ancestor before mkdir (+ re-check) → exclusive open → unlink on failure
│   ├── inflight.ts    # In-flight output registry; SIGINT/SIGTERM remove exactly those files, exit 130/143
│   ├── projection.ts  # Agent output projection (compact JSON, --summary, --fields dot-paths)
│   ├── config.ts      # `.zipnativerc.json` discovery + flag-default merge; refuses the `codec` key
│   ├── version.ts     # CLI + engine version resolution (source layout and bundled dist/)
│   ├── colors.ts      # ANSI helper decided on stderr: NO_COLOR off, FORCE_COLOR on, TERM=dumb off, else TTY
│   ├── sizes.ts       # `<size>` (512k, 1GiB, none) and count parsing
│   ├── limits.ts      # Eight --max-* flags → Partial<ZipLimits> (ZIP_LIMIT_INVALID unreachable) + --max-input-size
│   ├── diagnostics.ts # Core diagnostic sink: text warning lines | collected into the --json envelope
│   ├── engine.ts      # prepareEngine(): --codec modules (argv only) + node:zlib tier unless --pure-codecs
│   ├── codecs.ts      # `--codec <module>` loader — the ONLY dynamic import of user code
│   ├── zipops.ts      # Shared flag → core-option translation (open, compression, common options, UTC dates,
│   │                  #   extra fields, mode, --comment-file)
│   ├── glob.ts        # Dependency-free `/`-separated glob matcher for --include / --exclude
│   ├── walk.ts        # Deterministic filesystem walk for `create` (sorted, symlinks skipped, sanitizeEntryPath)
│   ├── entryfmt.ts    # EntryRow shape + text table shared by list / inspect / stream
│   ├── manifest.ts    # `batch --manifest` parsing: strict validation, @id refs, 1000-task cap, codec policy
│   └── governance.ts  # AI-governance policy + AGENT_RULES text + pure draft validator
└── core-bridge/
    └── index.ts       # Selective re-exports from zipnative — the ONLY import point of the engine (77 exports)
```

## Entry Point Contract (`src/index.ts`)

- First positional arg is the command name; `zipnative <command> --help` prints that
  command's `*_USAGE` block.
- `--help` / `-h` with no command prints usage and exits 0.
- `--version` / `-V` prints the version from `package.json` (with `--json`:
  `{ name, version, zipnative }`) and exits 0.
- Unknown command → `E_USAGE`, exit 2 (also with `--help`). Flags but no command
  (`zipnative --json`) → exit 2 "No command given". Bare `zipnative` → usage, exit 0.
- Global flags are turned into env vars before dispatch: `--json` → `ZIPNATIVE_JSON=1`,
  `--dry-run` → `ZIPNATIVE_DRY_RUN=1`, `--quiet` → `ZIPNATIVE_QUIET=1`, `--strict` →
  `ZIPNATIVE_STRICT=1`, `--pure-codecs` → `ZIPNATIVE_PURE_CODECS=1`, `--no-color` → `NO_COLOR=1`.
  The variables are also honoured when the caller sets them (an env-driven `--dry-run` prints
  no text plan under `ZIPNATIVE_JSON`).
- `.zipnativerc.json` defaults are merged unless `--no-config`; explicit flags always win.
- Commands are lazy-imported so `--help` / `--version` stay fast.
- `main()` installs the process handlers once: `EPIPE` on stdout/stderr → exit 0 quietly;
  `SIGINT` / `SIGTERM` → remove the in-flight output files (`utils/inflight.ts`), exit 130 / 143.
- No input path and stdin is a TTY → `E_USAGE` (exit 2) instead of blocking; an explicit `-`
  is never guarded (`assertStdinNotTty` in `utils/io.ts`).
- `CliError` is caught in `main()` — prints `.message` to stderr (or the `--json` envelope),
  exits `.exitCode`. All other unhandled errors exit 1. `ZIPNATIVE_DEBUG=1` adds the stack.
- **Never uses `console.log`** — only `process.stdout.write` and `process.stderr.write`.

## Zero-Dep Arg Parser Contract (`src/utils/args.ts`)

- `parseArgs(argv: string[], { booleans }): ParsedArgs` — `booleans` is the flag table from
  `utils/flags.ts` (`BOOLEAN_FLAGS`, re-exported by `completion.ts`).
- `ParsedArgs = { flags: Record<string, string | boolean | readonly string[]>; positionals: string[] }`
- Supports: `--flag value`, `--flag=value`, `-f value`, `--flag` (boolean true); a flag
  given twice becomes an array (`getStringFlagAll`).
- A boolean flag NEVER consumes the next token, so flags and positionals are order-independent
  (`--json list a.zip`, `list --long a.zip`); `--flag=false|0|no|off` is the explicit off form.
  A token matching `-<digit>` is always a value. Combined short flags (`-lq`) are refused
  with exit 2. Value short aliases: `-i -o -d -e -f`; boolean: `-q -h -V` (no `-l`).
- `--` terminates flag parsing; all following tokens go into `positionals`.
- Never throws on unknown flags — they are collected as-is.

## Command Conventions (`src/commands/`)

- Each command exports a single async function: `export async function create(args: ParsedArgs): Promise<void>`
- Every core-touching command calls `await prepareEngine(args)` **first** (`--codec` load +
  node:zlib tier); it is idempotent, so `batch` tasks may call it again.
- Every core call is wrapped by `mapZipError` / `guard` (`utils/ziperr.ts`) so the envelope
  always carries a stable `E_*` class and the verbatim `ZIP_*` `zipCode`. `ziperr.ts` is the
  ONLY place that reads `err.code`.
- `--input` for input file path; omit → read from stdin (a TTY with nothing piped is refused).
- `--output` for output file path; omit → write to stdout (binary via `process.stdout.write`).
  An existing output file is refused with `E_IO` unless `--overwrite` — uniformly on `create`,
  `modify`, `cat`, `inflate`, `extract`, `stream --output-dir` and `batch --task create`.
- Usage errors (missing required flag) throw `CliError` with exit code 2; runtime errors exit 1.
  An unsafe entry NAME that arrives as data (`--add`, `--stdin-name`, manifests) is `E_INPUT`
  (exit 1) with `entryName`, not a usage error.
- `create`, `modify`, `extract`, `stream`, `cat`, `inflate` and `crc32` call `emitStatus({...})`
  on success — a no-op outside `--json`; stdout stays artifact-only. `batch` does NOT emit a
  status envelope: its JSON report is the stdout document (under `--json` one document with
  every task's captured stdout in `tasks[i].report` / `.stdout`). `list`, `inspect`, `verify`
  and `doctor` likewise put their JSON report on stdout.
- Core diagnostics go through `createDiagnosticSink()` (`utils/diagnostics.ts`): text
  `warning:` lines on stderr, or collected into the envelope / report under `--json`.

## Security Constraints

- **Extraction sink** (`utils/sink.ts`, shared by `extract` and `stream --output-dir`) is the
  CLI's own trust boundary: every path is re-checked with the core's `sanitizeEntryPath()`,
  contained lexically with `safeJoin(root, path)`, then physically — the nearest EXISTING
  ancestor of the target directory is `realpath`'d under the root's `realpath` BEFORE
  `mkdir -p` and the created directory is re-checked after (a planted symlink / junction is
  `E_SECURITY`, nothing is created beyond the link); files are opened exclusively (`wx`)
  unless `--overwrite`, so a file appearing between plan and write is refused like any other;
  partial files are removed on failure; case-folded collisions are refused on
  case-insensitive filesystems; symlink entries are **never materialised** as links
  (`--allow-symlinks` writes the target TEXT as a regular file); `--preserve-mode` never
  applies setuid/setgid/sticky bits. The residual window between `realpath` and `open` is
  documented posture ("use an empty or trusted destination"), not something to paper over.
- **`modify` verifies every entry it re-emits** (`verifyEntry` on each untouched entry before
  `save()` / `saveCompact()`; encrypted / sync-less-codec entries are copied and counted in
  `verifySkipped`). No opt-out — an opt-out would write unverified bytes.
- **Never loosen a core default silently.** `rejectTraversal`, `rejectSymlinks`,
  `onDuplicate`, every `ZipLimits` bound and the sink containment stay on. Opt-outs are
  named `--skip-*` / `--allow-*`, are argv-explicit, and are documented in SECURITY.md.
- `--codec <module>` executes user code: honoured from **argv only** — `.zipnativerc.json`
  refuses the key, and a `batch` manifest task carrying `codec` is refused unless the
  invocation passes `--allow-codec-load`. A loaded codec is not confined to reading: the engine
  resolves methods 0/8 through the registry, so a module registering them (or exporting a
  `deflateImpl`) also drives what `create` / `modify` write — even under `--deterministic`
  for method 0/8. Reported via `tier` / a `warning:` line (`assertCodecModulesHonest` in
  `create.ts`), and refused by `create --parallel` (its workers cannot see the module).
- Paths typed on the command line (`--input`, `--output`, `--output-dir`, positionals) are the
  user's own filesystem authority and are NOT validated against `..`. `validatePath` applies
  only to values that arrive as DATA: `batch` manifest path flags and `create` / `modify`
  manifest `path` values. Entry NAMES always go through the core's `sanitizeEntryPath()`.
- Every BUFFERED read (stdin or file into memory) is bounded by `--max-input-size` (4 GiB,
  `E_LIMIT` `{ limit: 'maxInputSize' }`); streaming paths (`stream`, `crc32`, `inflate`,
  `create --stream`) must never be routed through it.
- Input JSON (manifests, drafts) is capped at 50 MB before `JSON.parse`; a `batch` manifest
  is capped at 1000 tasks; a captured task stdout (`batch --json`) at 64 MiB.
- `--max-*` values are pre-validated so `ZIP_LIMIT_INVALID` is unreachable; `none` disables a
  bound with a visible warning.
- `stream` parses local headers only: mode / symlink policy flags are refused with `E_USAGE`,
  and every JSON output carries `trust: "local-headers-only"`.
- `inflate` always runs under a mandatory output bound (`--max-output`, default the
  effective `--max-entry-size`).
- **No ZIP byte parsing in `src/`** — a new format need is a core feature request, never a
  local parser.
- `govern verify-issue` is a pure, fully offline validator; `E_POLICY` gates a bad draft.
  `tests/utils/governance-sync.test.ts` keeps `govern policy` / `govern rules` identical to
  `.github/ai-governance.json` / `.github/AGENT_RULES.md`.
- No network capability anywhere: no command can open a socket.

## Code Style

- **TypeScript strict mode** — `strict: true`.
- **ESM-first source** — all internal imports use `.js` extension; tsup bundles it into the
  single CommonJS bin `dist/cli.cjs` (`zipnative` / `zipnative/worker` stay external).
- **Lint covers `src/` AND `tests/`** (`npm run lint`, tests under a relaxed override);
  coverage thresholds are 93 / 88 / 94 / 93 (`vitest.config.ts`).
- **`const` over `let`** — never use `var`.
- **No `any`** — use `unknown` with type narrowing.
- **No `console.log`** — use `process.stdout.write(msg + '\n')` / `process.stderr.write(msg + '\n')`.
- **`readonly`** on interface props where mutation is not needed.
