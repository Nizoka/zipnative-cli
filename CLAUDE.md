# CLAUDE.md — working on zipnative-cli with Claude Code

Guidance for Claude Code (and any Claude-family agent) contributing to this
repository. It complements — does not replace — the existing project docs:

- **[.github/copilot-instructions.md](.github/copilot-instructions.md)** — the
  canonical architecture map, entry-point contract, arg-parser contract,
  security constraints, and code style. **Read it first.**
- **[AGENTS.md](AGENTS.md)** — the agent-automation contract (process contract,
  `--json` envelopes with `code` + `zipCode`, token economy, `schema`,
  governance/HITL).
- **[ROADMAP.md](ROADMAP.md)**, **[docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md)**,
  **[CONTRIBUTING.md](CONTRIBUTING.md)**, **[SECURITY.md](SECURITY.md)**.

When those documents and this one disagree, they win on architecture/style and
this file wins on Claude-Code workflow specifics.

## Project philosophy (non-negotiable)

1. **Zero extra runtime dependencies.** `zipnative` is the ONLY runtime
   dependency. Proposing a new npm runtime dep is a hard block (enforced by
   `zipnative govern verify-issue`).
2. **No ZIP parsing logic in `src/`.** Every byte of ZIP structure — EOCD,
   central directory, local headers, Zip64, DEFLATE, CRC — is the engine's.
   The CLI owns argv, the filesystem, stdout/stderr and the agent contract.
   If you find yourself reading a `PK` signature in this repository, stop:
   the only sanctioned raw parsers are the veraZIP validator
   (`scripts/validate-zip.mjs`, vendored, engine-independent by design) and
   the test-only `tests/helpers/raw-zip-builder.ts` (adversarial shapes).
3. **All core imports go through [src/core-bridge/index.ts](src/core-bridge/index.ts).**
   Never import from `zipnative` or `zipnative/worker` directly in a command
   or util — add a selective re-export to the bridge instead. The bridge is
   the 77-export coverage ledger mapped in `docs/KNOWLEDGE_BASE.md` §8.
4. **Agent-first.** stdout = artifact, stderr = diagnostics/envelopes, stable
   exit codes (0/1/2), 13 stable `E_*` classes and the engine's `ZIP_*` code
   carried verbatim as `zipCode`. Every core call is wrapped with
   `guard()` / `mapZipError()` from `src/utils/ziperr.ts` — that module is the
   only place allowed to read `err.code`. Agent mode is a thin presentation
   layer, never a second runtime.
5. **Never loosen a security default.** `rejectTraversal`, `rejectSymlinks`,
   `onDuplicate: 'error'`, every `ZipLimits` bound, `--max-input-size`, the
   sink containment (`safeJoin` + realpath re-check + exclusive open in
   `src/utils/sink.ts`), the uniform overwrite refusal, `modify`'s
   verification of every re-emitted entry (no opt-out), the `--codec`
   argv-only rule and the manifest `--allow-codec-load` gate stay as they are
   unless a human records the decision. Opt-outs skip; they never write
   anything unsafe. A symlink is never materialised.
6. **Offline, always.** No command opens a socket, and no change may add one.
   There is no network opt-in to extend.
7. **ESM-first TypeScript strict.** Relative imports carry the `.js`
   extension. No `console.log` (write to `process.stdout`/`process.stderr`),
   no `any`, prefer `const` and `readonly`. Bytes written under
   `--deterministic` are the engine's frozen contract — never post-process
   archive bytes in the CLI.

## Repository shape

- `src/index.ts` — entry point: USAGE strings (one per command + the global
  block), `loadCommand()` dispatch, global flags → `ZIPNATIVE_*` env, config
  merge, agent error envelope.
- `src/commands/*.ts` — one file per command (15), each exporting a single
  `async function <name>(args: ParsedArgs): Promise<void>`; `completion.ts`
  holds the `COMMANDS` table (the single source of truth for the surface).
- `src/utils/*.ts` — `args` (arg parsing), `flags` (the boolean-flag table:
  which flags take no value, global + per command), `io` (`validatePath` for
  manifest-supplied values only — argv paths are never second-guessed —,
  `safeJoin`, exclusive writes, the `--max-input-size`-bounded reads,
  `captureStdout`), `sink` (the extraction sink shared by `extract` and
  `stream`: lexical + realpath containment, duplicate policy, exclusive open,
  partial-file removal), `inflight` (SIGINT / SIGTERM cleanup of the files
  being written, exit 130 / 143), error codes, `ziperr` (the 39-code
  mapping), `limits` (the eight `--max-*` flags + `--max-input-size`),
  `engine` (`prepareEngine`), `codecs` (`--codec`), `diagnostics` (the
  diagnostic sink), `entryfmt` (the `EntryRow`), `zipops` (shared flag →
  option translation, UTC dates, extra fields), `manifest`, `projection`,
  `agent`, `colors`, `config`, `governance`.
- `src/core-bridge/index.ts` — the single import point of `zipnative` /
  `zipnative/worker` (+ `ensureCodecsReady()`, `loadParallelZip()`).
- `scripts/` — `generate-zip-corpus.mjs` + `validate-zip.mjs` (veraZIP) +
  `helpers/interop-tools.mjs`.
- `tests/**` — vitest, in-process (stdout/stderr captured via
  `tests/helpers/capture.ts`); one spawn smoke test against `dist/cli.cjs`;
  `tests/docs/consistency.test.ts` pins the docs to the code and
  `tests/utils/governance-sync.test.ts` pins `govern policy` / `govern rules`
  to `.github/ai-governance.json` / `.github/AGENT_RULES.md`.
- `samples/**` — dual-shell (`.sh` + `.ps1`) runnable demos per command.

## Adding or changing a command (checklist)

A new command touches **all** of these — miss one and it half-works:

1. `src/commands/<name>.ts` — the implementation. Start with
   `await prepareEngine(args)`, resolve input with `resolveInputPath`, open
   through `openArchive` / wrap every core call with `guard()` or
   `mapZipError()`, pass `commonOptions(args, sink)` to the engine, emit
   `emitStatus({ command, …, ...sink.field() })` for write commands.
2. `src/index.ts` — (a) the top-level `USAGE` command list (keep the group
   headings and the `Commands (N)` count), (b) a `<NAME>_USAGE` constant + an
   entry in `COMMAND_USAGE`, (c) a `case` in `loadCommand()`.
3. `src/commands/completion.ts` — add the command with its `group` and flags
   to the `COMMANDS` table; add it to `DRY_RUN_COMMANDS` if it honours
   `--dry-run`. All four shells, `schema manifest`, `doctor`'s command count
   and the docs test derive from this table. Every **boolean** flag also goes
   into `COMMAND_BOOLEAN_FLAGS` in `src/utils/flags.ts` (otherwise the parser
   makes it consume the next token); a path-valued flag goes into
   `PATH_FLAGS` so the shells complete files. Also `src/utils/config.ts`
   `KNOWN_COMMANDS`, `src/utils/projection.ts` `PROJECTED_COMMANDS` if it
   emits a JSON report, and `src/utils/manifest.ts` `MANIFEST_COMMANDS` +
   `batch.ts` `loadTaskCommand()` if it may run inside a manifest.
4. `src/commands/schema.ts` — add a subject (and its `--summary` twin) if the
   command has a JSON input/output shape agents should validate; extend the
   `status` schema's `command` enum if it emits a status envelope.
5. New stable error code? Add it to `src/utils/error.ts` **and**
   `src/utils/agent.ts` (`DEFAULT_MESSAGE`), and document it in AGENTS.md,
   llms.txt, README and the knowledge base (the docs test checks every code
   appears in AGENTS.md and llms.txt). New engine code? `ZIP_TO_CLI` in
   `src/utils/ziperr.ts` fails `tsc` until you map it — then regenerate
   `docs/data/errors.json` and update the mapping tables.
6. `tests/**` — a command test (in-process) plus an integration round-trip
   where meaningful; **`tests/docs/consistency.test.ts`** must still pass
   (command counts, `E_*` codes, `ZIP_*` mapping, the 77-export map, the
   limits table, the schema subject count).
7. `samples/<name>/` — a `.sh` and a `.ps1` (keep them runnable, offline).
   If the command **writes archives**, add a corpus entry to
   `scripts/generate-zip-corpus.mjs` so the veraZIP gate validates its output
   (and a negative canary if it introduces a new refusal).
8. Docs — README command reference (flag table from the USAGE string),
   `docs/KNOWLEDGE_BASE.md` (§2 tree, §4 reference with the **zipnative API
   used**, §8 mapping if a new export is bridged), `CHANGELOG.md`,
   `ROADMAP.md`, and `AGENTS.md` / `llms.txt` if the agent surface changed.

## Build, test, verify

```bash
npm run typecheck:all   # tsc for src + tests — must be clean
npm run lint            # eslint src/ tests/ — 0 errors (tests use a relaxed override)
npm run test            # vitest run — all pass; keep coverage ≥ thresholds
npm run build           # tsup → dist/cli.cjs (the bin — the only artefact)
npm run validate:zip    # veraZIP gate: build + corpus:zip + scripts/validate-zip.mjs
                        #   level 0 (ISO/IEC 21320-1 clauses, no external tool) ALWAYS runs
                        #   level 1 (unzip/7z/python/bsdtar/jar integrity) SKIPs absent tools
                        #   exit 0 ok/skip · 1 conformance · 2 no corpus · 3 infra
                        #   VERAZIP_REQUIRED=1 (CI) fails closed when no level-1 tool exists
```

Coverage thresholds live in `vitest.config.ts` (statements 93 / branches 88 /
functions 94 / lines 93 — ratcheted after the 1.0.0 audit pass, three points
below the measured actuals). Do not lower them to make a change pass — add
tests.

> **Bundle gotcha:** tsup flattens `src/**` into one `dist/cli.cjs` — the
> package's only artefact (no ESM build, no `.d.ts`, no source maps; it is a
> bin, not a library) — so a path relative to a source file
> (`../../package.json`) resolves differently at runtime. Resolve versions via
> `src/utils/version.ts` (which probes candidates and name-guards), never with
> an ad-hoc `require('../…/package.json')`.
> `zipnative` and `zipnative/worker` **must stay external** in `tsup.config.ts`
> (`noExternal: []`): the worker subpath resolves `./zip-worker.js` next to its
> own bundle, and `loadParallelZip()` resolves the script through the exports
> map so a flattened install fails loudly instead of silently compressing on
> the main thread. Always smoke-test the **built** CLI — including
> `node dist/cli.cjs create <dir> --parallel -o out.zip` and
> `node dist/cli.cjs doctor` (the deflate tier must read `node-zlib`) — not
> just source tests, before claiming a change works.

## Recommended Claude Code workflow

- Use **plan mode** for multi-file changes; confirm the command surface before
  editing eight files.
- Run **`/code-review`** on the branch diff before opening a PR, and drive an
  affected command end-to-end on the built binary (create → new command →
  inspect / verify).
- Prefer the dedicated tools (Read/Edit/Grep/Glob) over shell equivalents.
- Adversarial archives for tests come from `tests/helpers/raw-zip-builder.ts`
  — never commit a CLI- or engine-produced archive (see
  `tests/fixtures/README.md`).

## Governance / HITL (hard rule)

Agents are **draftsmen, never autonomous submitters**. No autonomous GitHub
writes; every bug needs a local reproduction; no anti-goal (encryption, other
formats, multi-disk, repair, I/O in the engine) may be proposed; no security
default weakened; a human review gate always applies.
`zipnative govern verify-issue <draft>` must pass (no runtime deps, a
reproduction block) — necessary but not sufficient. See AGENTS.md and
[.github/AGENT_RULES.md](.github/AGENT_RULES.md).
