# Contributing to zipnative-cli

Thank you for considering contributing to zipnative-cli!

## Development Setup

```bash
git clone https://github.com/Nizoka/zipnative-cli.git
cd zipnative-cli
npm ci
```

### Requirements

- Node.js >= 22
- npm >= 9

## Build

```bash
npm run build          # tsup → dist/ (CJS bin + ESM + .d.ts); zipnative stays external
npm run dev            # tsup --watch
```

## Test

```bash
npm run test           # vitest run (in-process; one spawn smoke test against dist/cli.cjs)
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest with v8 coverage
npm run corpus:zip     # generate the ISO/IEC 21320-1 validation corpus (needs a prior npm run build)
npm run validate:zip   # build + corpus + veraZIP validation (see below)
```

All new code must include tests. Coverage thresholds (enforced by `vitest.config.ts`, the single source of truth): statements 85 %, branches 75 %, functions 85 %, lines 85 %. Never lower them to make a change pass — add tests.

Tests run the command functions **in-process** with `process.stdout` / `process.stderr` captured (`tests/helpers/capture.ts`); adversarial archives (overlaps, zip-slip, CRC lies, descriptor tricks, prepended stubs) are generated in-test by the engine-independent `tests/helpers/raw-zip-builder.ts` and are **never committed** — the only committed archives are the two foreign-provenance interop fixtures listed in `tests/fixtures/README.md` (enforced by `tests/docs/fixture-policy.test.ts`). `tests/docs/consistency.test.ts` pins the documentation to the code (command counts, `E_*` codes, the `ZIP_*` mapping, the 77-export map, the limits table, the schema subjects) — update the docs, not the test.

## Conformance validation (veraZIP)

ZIP has no reference validator the way PDF/A has veraPDF, so the CLI ships its own gate.
`npm run validate:zip` builds `dist/cli.cjs`, drives the **built** CLI (plus an
engine-independent raw builder for the canaries) to write a **34-archive corpus** to
`test-output/zip/` with a `manifest.json` (`scripts/generate-zip-corpus.mjs`), then validates
every archive against **ISO/IEC 21320-1:2015** (Document Container File — the
ISO-standardised ZIP profile) with `scripts/validate-zip.mjs` and compares each verdict with
the manifest's expectation.

**Independence.** `validate-zip.mjs` is **vendored** from the engine
(`zipnative/scripts/validate-zip.ts`, commit `4f1bc36`; the upstream commit and blob hashes
are recorded in its header, and a vendor test pins them). It raw-parses the bytes with its own
EOCD / central-directory / local-header reader and never imports `zipnative`, `src/` or runs
`dist/cli.cjs` for parsing — a validator that shared the engine's parser would attest the
engine with the engine. When upstream's `validate-zip.ts` changes, re-port the parser body 1:1
(types erased) and bump both hashes in the same PR.

**The corpus.** 30 conformant archives cover every writer path (buffered, `--stream`,
`--parallel`, `--deterministic`, store / deflate, comments, directory entries, `modify`
append-only and `--compact`, `--from-manifest`, `batch`). Three of them are
**hostile-but-conformant** (zip-slip, a Windows device name, duplicate paths): the ISO profile
constrains the container's structure, not the meaning of entry names, so they PASS the
validator — and the manifest records that `extract` **must refuse** them (`refusedBy`), which
the gate also checks. Four **raw-crafted negative canaries** (`expectConformant: false`) must
be rejected with their declared check id — `WF/ENTRY-OVERLAP`, `WF/CD-COUNT`,
`WF/LFH-SIZE-MISMATCH`, `WF/LFH-NAME-MISMATCH` (the well-formedness cross-checks lenient
extractors forgive). A coverage canary fails the run if a manifest file is missing, is not a
ZIP, or a required check id has no canary — a corpus generator that silently dropped a canary
would otherwise shrink the gate without anyone noticing.

**Levels.**

- **Level 0** — the ISO/IEC 21320-1 clause checks (no multi-volume, no encryption, no
  digital-signature record, version needed ≤ 45, forbidden general-purpose bits, UTF-8
  discipline, methods 0 / 8 only, no volume labels) plus the APPNOTE well-formedness
  cross-checks (central directory ↔ local header agreement, offsets, counts, overlaps,
  data-descriptor validation). **Needs nothing** — pure byte parsing — and **always runs**.
- **Level 1** — every conformant archive is re-tested with the foreign integrity tools present
  on the machine (`scripts/helpers/interop-tools.mjs`, vendored from the engine's
  `tests/helpers/interop-tools.ts`): `tar -tf` (bsdtar), `unzip -t`, `7z t`,
  `python -m zipfile -t`, `jar tf`. Exit codes are read per each tool's own contract (unzip's
  and 7-Zip's documented exit 1 "warnings" count as a pass). Absent tools are reported as
  `SKIP integrity <tool>` — never simulated; documented per-file exclusions
  (`integrityExclude`) carry known tool limitations instead of loosened exit codes.
- Level 2 (the differential-extraction matrix) stays in zipnative's own interop suite.

**Outcomes** per manifest file: `PASS` (conformant as expected), `FAIL` (non-conformant
although expected conformant, or a negative that failed with the *wrong* check id), `XFAIL`
(negative canary rejected with its declared id), `XPASS` (a negative canary accepted — the
validator is not validating; always fatal), `INFRA` (parser exception / unreadable file — not a
verdict). Per-file JSON reports and a `summary.json` land in `test-output/zip/reports/`.

| Exit | Meaning |
|------|---------|
| 0 | Every expectation met — **or** no level-1 tool is usable and `VERAZIP_REQUIRED` is unset: level 1 is **SKIPPED** (exit 0 is a skip of level 1, not a pass of it; level 0 verdicts still hold) |
| 1 | A conformance expectation was not met (`FAIL` / `XPASS`), a level-1 tool rejected a conformant archive, the coverage canary tripped, the corpus has no negative canary, or a required check id has no canary |
| 2 | Corpus directory / manifest absent — run `npm run corpus:zip` first |
| 3 | `INFRA`: a file produced an INFRA outcome, or (`VERAZIP_REQUIRED=1` only) zero level-1 tools are usable |

Environment: `VERAZIP_REQUIRED=1` fails closed (no usable level-1 tool → exit 3 instead of a
skip; set in CI, unset locally so a bare machine never blocks); `VERAZIP_REPORT_DIR=<dir>`
relocates the reports; `VERAZIP_TOOLS=<ids|none>` restricts level 1 to a subset of
`bsdtar,unzip,7z,python-zipfile,jar` (`none` disables it).

**CI is blocking**: the same scripts run with `VERAZIP_REQUIRED=1` on Linux and Windows on
every push / PR touching `src/`, `scripts/`, `samples/` or the package manifest
(`.github/workflows/verazip.yml`), and again as a pre-publish gate in
`.github/workflows/publish.yml`. No dependency is added — the validator is a script and the
foreign tools are external.

Installing the level-1 tools locally (**level 0 needs nothing**):

```bash
# macOS (bsdtar, python3 and jar ship with the OS / Xcode / a JDK; unzip is built in)
brew install p7zip

# Debian / Ubuntu
sudo apt-get install unzip p7zip-full python3 default-jdk-headless   # bsdtar: libarchive-tools
```

```powershell
# Windows — tar.exe (bsdtar) is built in since Windows 10; Python from python.org or winget
winget install 7zip.7zip
winget install Python.Python.3.12
# jar comes with any JDK (e.g. winget install Microsoft.OpenJDK.21); Info-ZIP unzip is optional
```

**PR checklist**: if you change anything the CLI **writes** (`create`, `modify`, `batch --task
create`, name handling, the corpus generator) or the validator itself, make sure
`npm run validate:zip` passes locally — and remember that exit 0 without any level-1 tool is a
skip of level 1, not a proof of it. A new writer path deserves a new corpus entry; a new
refusal deserves a new canary.

## Lint & Type Check

```bash
npm run lint              # eslint src/
npm run typecheck         # tsc --noEmit (src/)
npm run typecheck:tests   # tsc --project tsconfig.test.json
npm run typecheck:all     # both above
```

All must pass before opening a PR.

## Code Style

- **TypeScript strict mode** — `strict: true`
- **ESM-first** — all internal imports use `.js` extension
- **`const` over `let`** — never use `var`
- **No `any`** — use `unknown` with type narrowing
- **No `console.log`** — use `process.stdout.write(msg + '\n')` / `process.stderr.write(msg + '\n')`
- **`readonly`** on interface props where mutation is unnecessary
- **No ZIP parsing in `src/`** — every byte of ZIP structure belongs to the engine; the CLI never reads a `PK` signature (the vendored validator and the test-only raw builder are the sanctioned exceptions, outside `src/`)

## Agent contract

The CLI is agent-native (see [AGENTS.md](AGENTS.md)). When you add or change a command:

- **Wrap every core call** with `guard('context', () => …)` / `guardAsync` or `mapZipError(e,
  'context', entryName)` from `utils/ziperr.ts` — that module is the only place allowed to read
  the engine's `err.code`. An autonomous caller must always receive the stable class
  (`error.code`), the exact cause (`error.zipCode`), the entry name and the code-specific
  `detail` when the engine knows them.
- Throw `CliError(message, exitCode, ErrorCode.X, { zipCode?, entryName?, detail? })` with a
  stable code from `utils/error.ts`. Numeric exit codes (0/1/2) must not change. A new engine
  code fails `tsc` in `ZIP_TO_CLI` until it is mapped — map it, regenerate
  `docs/data/errors.json`, and update the tables in AGENTS.md and the knowledge base.
- Pass `commonOptions(args, sink)` (`{ strict, onDiagnostic, limits }`) to every engine entry
  point so `--strict`, the diagnostics bridge and the `--max-*` bounds apply uniformly.
- Keep **stdout** for the artifact and **stderr** for diagnostics. For success status on a
  write command, call `emitStatus({ command, …, ...sink.field() })` (no-op outside `--json`).
- Honour `--dry-run` via `hasFlag(args.flags, 'dry-run') || isDryRun()` and add the command
  to `DRY_RUN_COMMANDS` in `commands/completion.ts`.
- Never loosen a security default: opt-outs skip, they never write anything unsafe; a symlink
  is never materialised; every destination goes through `safeJoin`.
- If a command gains a new input/output shape, update the matching schema in
  `commands/schema.ts` (hand-authored Draft 2020-12; the `$id` tracks the package version
  automatically) and add a test assertion; register the command's flags in the `COMMANDS`
  table (completions, `schema manifest` and `doctor` derive from it).

## Project Structure

```
src/
├── index.ts               # CLI entry: parse argv → env flags → config merge → dispatch → exit
├── commands/              # one file per command (15) — create, modify, list, inspect, cat,
│                          #   extract, stream, verify, crc32, inflate, batch, doctor, schema,
│                          #   completion (the COMMANDS table), govern
├── utils/
│   ├── args.ts            # zero-dep arg parser
│   ├── io.ts              # stdin/file I/O, validatePath, safeJoin (sink containment), 50 MB JSON cap
│   ├── ziperr.ts          # ZIP_TO_CLI (39 codes → E_*), mapZipError / guard
│   ├── error.ts           # CliError + the 13 E_* codes
│   ├── limits.ts          # the eight --max-* flags → ZipLimits
│   ├── engine.ts          # prepareEngine (codecs + node:zlib tier)
│   ├── diagnostics.ts     # the diagnostics sink (text | --json | --strict)
│   ├── zipops.ts          # shared flag → core-option translation
│   └── …                  # agent, projection, manifest, codecs, entryfmt, walk, glob, sizes, config, version, governance, colors
└── core-bridge/
    └── index.ts           # the ONLY import point of zipnative / zipnative/worker
scripts/                   # generate-zip-corpus.mjs, validate-zip.mjs (veraZIP), helpers/interop-tools.mjs
tests/                     # vitest suite (mirrors src/) + tests/docs/ + tests/helpers/ + tests/fixtures/
samples/                   # .sh + .ps1 per command, run-all.js
```

## Security

- The CLI is the filesystem trust boundary: every destination goes through `safeJoin`, existing files are never overwritten without `--overwrite`, partial outputs are removed on failure, and no flag may ever materialise a symlink.
- Validate file paths against path traversal before filesystem access; cap JSON input at 50 MB before parsing.
- `--codec` is the only dynamic import of user code — argv only, refused from config files, gated in manifests. Do not add another.
- No command may open a socket. Do not add a network path.
- A CycloneDX **SBOM** is generated in CI and attached to each release; the generator is build-time only — do not add it as a runtime dependency.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance (deps, CI, governance)
- `docs:` documentation only
- `test:` tests only
- `refactor:` no behaviour change
