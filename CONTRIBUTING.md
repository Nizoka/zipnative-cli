# Contributing to zipnative-cli

Thank you for considering contributing to zipnative-cli!

## Development Setup

```bash
git clone https://github.com/Nizoka/zipnative-cli.git
cd zipnative-cli
npm ci
```

### Requirements

- Node.js `^22.17.1 || >=24.4.1`, a security patch floor that `node scripts/gate.mjs` enforces (`node-floor`) (`.nvmrc` / `.node-version`: 22 — the line CI, the release and contributors
  share)
- npm >= 10 for development (`npm ci`; `packageManager` names npm 10.9.2, as across the
  ecosystem). Publishing needs npm >= 11.5.1 (Trusted Publishing) and happens only in
  `publish.yml`, which fetches a client pinned by its SHA-512 for that one step.
- The tracked `.npmrc` sets `ignore-scripts=true` (no dependency lifecycle script runs on
  your machine either), `engine-strict=true`, `audit-level=moderate` and `fund=false`.

## Build

```bash
npm run build          # tsup → dist/cli.cjs — the CJS bin only (no ESM build, no .d.ts, no
                       #   source maps); zipnative and zipnative/worker stay external
npm run dev            # tsup --watch
```

The package is bin-only: `package.json` has no `main` / `module` / `types` entry point (a
`require('zipnative-cli')` is not an API) and `files` ships exactly `dist/cli.cjs`,
`AGENTS.md`, `llms.txt`, `docs/data/errors.json`, `README.md`, `CHANGELOG.md`,
`SECURITY.md`, `THIRD-PARTY-NOTICES.md`, `LICENSE` and `package.json` — 10 files, pinned in
`docs/data/package-files.json` (`npm run check:package`; `node scripts/package-files.mjs
--update` after a deliberate change, the legal texts pinned by SHA-256).

## The quality gate

`scripts/gate.mjs` is the single definition of "green". CI, the release, the sample workflow,
this file and the agent instructions point at it instead of repeating a list of commands:

```bash
npm run gate:fast                               # typecheck:all, lint, test — the inner loop
npm run gate                                    # --ci: + build, reproducible build, bundle check,
                                                #   smoke, coverage, engine data, the tarball list
node scripts/gate.mjs --publish --require-all   # what publish.yml runs: + samples, veraZIP
                                                #   (fail-closed), the install smoke test
node scripts/gate.mjs --only smoke | --from build | --json
```

Each step logs to `test-output/.gate/<step>.log`; the first failure prints the tail and stops.
`--require-all` turns a SKIP into a FAIL (the engine-data step needs a zipnative checkout next to
this repository, or `ZIPNATIVE_ENGINE_CHECKOUT`; CI clones the pinned tag).

## Test

```bash
npm run test           # vitest run (in-process; one spawn smoke test against dist/cli.cjs)
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest with v8 coverage
npm run corpus:zip     # generate the ISO/IEC 21320-1 validation corpus (needs a prior npm run build)
npm run validate:zip   # build + corpus + veraZIP validation (see below)
```

All new code must include tests. Coverage thresholds (enforced by `vitest.config.ts`, the single
source of truth): **statements 95 %, branches 91 %, functions 97 %, lines 96 %** — ratcheted for
1.1.0 from the measured 95.91 / 91.48 / 97.81 / 96.77 (2026-10-20), within one point of the actuals
(1.0.0 kept three). Never lower them to make a
change pass — add tests. The suite is 76 files / 1396 tests (9 are platform- or checkout-conditional
and skip with a stated reason).

Tests run the command functions **in-process** with `process.stdout` / `process.stderr` captured
(`tests/helpers/capture.ts`); adversarial archives (overlaps, zip-slip, CRC lies, descriptor
tricks, prepended stubs, encrypted survivors, custom methods) are generated in-test by the
engine-independent `tests/helpers/raw-zip-builder.ts` and are **never committed** — the only
committed archives are the two foreign-provenance interop fixtures listed in
`tests/fixtures/README.md` (enforced by `tests/docs/fixture-policy.test.ts`).

### Pinned docs

The documentation is part of the test surface — update the docs, not the tests:

- **`tests/docs/consistency.test.ts`** pins README, `llms.txt`, AGENTS.md, the knowledge base,
  SECURITY.md, CITATION.cff and the USAGE strings to the code: the 17-command count in every
  document; the 13 `E_*` codes (every token in the docs is real, every code is documented in
  AGENTS.md and `llms.txt`); the 106-export map (`docs/data/core-exports.json` ↔ KB §8 ↔ the
  bridge); the 39 `ZIP_*` codes and 12 diagnostics (`docs/data/errors.json` ↔ `ZIP_TO_CLI` ↔
  AGENTS.md, plus a `raisedBy` list per diagnostic); the README global-options table (every
  `--max-*` flag with its engine default, the `--max-input-size` row with default and CWE, the
  `--dry-run` command list); the README schema section (exactly the 22 subjects); the manifest /
  projected command lists in AGENTS.md and `llms.txt`; every `--flag` of every command in its
  USAGE block, its README section and the knowledge base (booleans never shown with a
  `<value>`, no USAGE line over 80 columns, `PATH_FLAGS` ⊆ the value flags); the global USAGE
  naming every bound, the exit codes and every `ZIPNATIVE_*` variable read in `src/`; the
  `status` schema's `command` enum = the set of `emitStatus()` callers; CITATION.cff `version` =
  `package.json`; the retracted "reader-only" codec claim (audit B-07) absent from every
  document; every relative path in the `llms.txt` Docs section shipped in the tarball.
- **`tests/utils/governance-sync.test.ts`** pins `govern`: `AI_GOVERNANCE_POLICY` deep-equals
  `.github/ai-governance.json`, every numbered rule and every "must NOT" bullet of
  `AGENT_RULES_TEXT` appears verbatim in `.github/AGENT_RULES.md`, and every file named in the
  capability manifest exists.
- **`tests/docs/fixture-policy.test.ts`** pins `tests/fixtures/README.md` (the provenance
  ledger, the 20 KB budget, the generated-only rule).
- **`tests/scripts/verazip-vendor.test.ts`** pins the vendored validator to its upstream commit
  and blob hashes, its 23-id check vocabulary and its anti-circularity (never imports
  `zipnative`, `src/` or `dist/cli.cjs`).

Because of these relations, **CI runs on documentation changes too** (see below).

## Conformance validation (veraZIP)

ZIP has no reference validator the way PDF/A has veraPDF, so the CLI ships its own gate.
`npm run validate:zip` builds `dist/cli.cjs`, drives the **built** CLI (plus an
engine-independent raw builder for the canaries) to write a **41-archive corpus** to
`test-output/zip/` with a `manifest.json` (`scripts/generate-zip-corpus.mjs`), then validates
every archive against **ISO/IEC 21320-1:2015** (Document Container File — the
ISO-standardised ZIP profile) with `scripts/validate-zip.mjs` and compares each verdict with
the manifest's expectation. The expected verdict is **37 PASS, 4 XFAIL, 0 FAIL**.

**Independence.** `validate-zip.mjs` is **vendored** from the engine
(`zipnative/scripts/validate-zip.ts`, commit `1e2ab42`, zipnative 1.1.0; the upstream commit and blob hashes
are recorded in its header, and a vendor test pins them). It raw-parses the bytes with its own
EOCD / central-directory / local-header reader and never imports `zipnative`, `src/` or runs
`dist/cli.cjs` for parsing — a validator that shared the engine's parser would attest the
engine with the engine. When upstream's `validate-zip.ts` changes, re-port the parser body 1:1
(types erased) and bump both hashes in the same PR. When an engine checkout is present
(`../zipnative` or `$ZIPNATIVE_ENGINE_CHECKOUT`), the vendor test also compares the pinned blobs
with the upstream files at the tag of the installed engine and fails on divergence.

**The corpus.** 37 conformant archives (41 = 37 + 4) cover every writer path (buffered,
`--stream` (and `--stream --zip64`, whose 8-byte data descriptor the `WF/DESCRIPTOR-WIDTH`
check pairs with the local header's Zip64 extra), `--parallel`, `--deterministic`, a
pre-1980 `--date` clamped to the DOS epoch, `canonicalize` (checked against `--check canonical-form`), `merge` (checked entry for entry), store / deflate, string and binary comments
(`--comment-file`), `--order insertion` (an EPUB-style `mimetype`-first layout), manifest
`extraFields`, directory entries, `modify` append-only and `--compact`, `--from-manifest`,
`batch`). Three of them are **hostile-but-conformant** (zip-slip, a Windows device name,
duplicate paths): the ISO profile constrains the container's structure, not the meaning of entry
names, so they PASS the validator — and the manifest records that `extract` **must refuse** them
(`refusedBy`), which the gate also checks. Four **raw-crafted negative canaries**
(`expectConformant: false`) must be rejected with their declared check id —
`WF/ENTRY-OVERLAP`, `WF/CD-COUNT`, `WF/LFH-SIZE-MISMATCH`, `WF/LFH-NAME-MISMATCH` (the
well-formedness cross-checks lenient extractors forgive). A coverage canary fails the run if a
manifest file is missing, is not a ZIP, or a required check id has no canary — a corpus
generator that silently dropped a canary would otherwise shrink the gate without anyone
noticing. The generator removes each target before regenerating it (the CLI refuses to overwrite
an existing output otherwise).

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
**every push and pull request** — `.github/workflows/verazip.yml` carries no `paths:` filter, so
it can be a required check without the "Expected — Waiting for status" trap — and again as a
pre-publish gate in `.github/workflows/publish.yml`. No dependency is added — the validator is
a script and the foreign tools are external.

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
npm run lint              # eslint src/ tests/ — strictTypeChecked (type-aware) on src/; tests keep the
                          # non-type-checked strict set plus a test-ergonomics override
npm run typecheck         # tsc --noEmit (src/)
npm run typecheck:tests   # tsc --project tsconfig.test.json
npm run typecheck:all     # both above
```

All must pass before opening a PR.

## Continuous integration and branch protection

Every push to `main` and every pull request runs the whole gate — **every change included**,
because the pinned-docs tests above read README, AGENTS.md, `llms.txt`, the knowledge base,
SECURITY.md and CITATION.cff, and because a path-filtered required check stays pending forever.
No workflow carries a `paths` filter (`tests/tools/workflows.test.ts` holds it). Every job
starts with `step-security/harden-runner`, installs with `npm ci --ignore-scripts`, keeps no
checkout credentials, and every action is pinned to one SHA across the tree.

| Workflow | Job (check name) | Runner | What it runs |
|---|---|---|---|
| `ci.yml` | `ci (22)`, `ci (24)` | ubuntu-latest, Node 22 / 24 | `node scripts/gate.mjs --ci --require-all`; `ci (22)` also runs `npm audit --audit-level=moderate` and clones the pinned zipnative tag for the engine-data step |
| `ci.yml` | `windows (22)`, `windows (24)`, `macos (22)` | windows-latest / macos-latest | the same gate — **blocking**: `\` separators, reserved device names, the case-insensitive filesystems the sink handles (win32 and darwin), Windows symlink semantics for the exclusive writes, CRLF checkouts, the npm.cmd shim |
| `ci.yml` | `workflow lint` | ubuntu-latest | zizmor (workflow security), actionlint by the SHA-256 of its release archive (syntax, expressions, shellcheck), `reuse lint` (REUSE.toml) |
| `ci.yml` | `commitlint` | ubuntu-latest, PRs only | every commit subject and the PR title match the Conventional Commits pattern below (advisory) |
| `verazip.yml` | `verazip-linux`, `verazip-windows` | ubuntu-latest / windows-latest, Node 22 | build → `corpus:zip` → `validate-zip.mjs` with `VERAZIP_REQUIRED=1`; tool versions in the job summary; reports uploaded as artifacts |
| `sample-regression.yml` | `sample-regression (ubuntu-latest)`, `sample-regression (windows-latest)` | Node 22 | every `samples/run-all.js` job against the built binary (byte identities, expected refusals) |
| `dependency-review.yml` | `dependency-review` | ubuntu-latest, PRs | a new dependency with a high advisory or a licence outside the allow-list fails (the MPL-2.0 lightningcss exception named package by package) |
| `codeql.yml` | `Analyze (actions)`, `Analyze (javascript-typescript)` | ubuntu-latest | CodeQL `security-extended` over the TypeScript AND the workflows, no build; results required by the ruleset (`code_scanning`) |
| `node-current.yml` | `node 26 (current, advisory)` | ubuntu-latest | the CI gate on Node 26 — information, not a required check |
| `audit.yml` | `npm audit`, `OSV-Scanner` | ubuntu-latest, weekly | the lockfile against npm's and OSV's advisory databases |
| `scorecard.yml` | `Scorecard analysis` | ubuntu-latest | OpenSSF Scorecard on push to `main` and weekly (not a PR check) |
| `publish.yml` | `guard` → `build and pack` → `publish to npm` → `attest and attach` | ubuntu-latest, `.nvmrc` | on a published GitHub Release — see [Release](#release) and docs/adr/0009 |

**Branch protection is code**: `.github/rulesets/main.json` (required checks `ci (22)`,
`ci (24)`, `windows (22)`, `windows (24)`, `macos (22)`, `workflow lint`, `verazip-linux`,
`verazip-windows`, both `sample-regression` legs and `dependency-review`, strict; CodeQL results
required at high-or-higher; squash merges only; resolved review threads; no deletion, no
force-push) and `.github/rulesets/tags.json` (`v*` tags can be neither deleted, moved nor
updated). The maintainer imports both (repository → Settings → Rules → Rulesets → Import);
`tests/tools/workflows.test.ts` holds every required context to a job that reports it.
Dependabot keeps the pins current after a seven-day cooldown, with the actions grouped (so the
four codeql-action steps move together) and the engine excluded from the dev group (it bumps
alone — see [Bumping the engine](#bumping-the-engine)). Alongside the ruleset the maintainers enable **secret scanning with push
protection** and Dependabot alerts (repository → Security → Code security); no npm token exists
anywhere — publishing is OIDC-only.

## Release

The maintainer releases; an agent prepares (see AGENT_RULES.md). One-time setup on GitHub and
npm, before the first publish of a line:

1. **Environment** — repository → Settings → Environments → `npm-publish` with a required
   reviewer (the maintainer). The `publish to npm` job cannot mint a token before that approval.
2. **Trusted Publishing** — npmjs.com → `zipnative-cli` → Settings → Trusted Publishing:
   repository `Nizoka/zipnative-cli`, workflow `publish.yml`, environment `npm-publish`.
   No `NPM_TOKEN` exists anywhere.
3. **Rulesets** — import `.github/rulesets/main.json` and `tags.json`.

Every release:

1. On a release branch: bump `package.json` (and `CITATION.cff`), move `[Unreleased]` in
   `CHANGELOG.md` under the version and date, write `release-notes/vX.Y.Z.md`.
2. Run the pre-release audit in Claude Code: `/release-audit release-notes/vX.Y.Z.md` — two
   auditors in parallel (claims against the code and the non-negotiables; help text, the
   surface tables and the release surfaces), an adversarial verifier, an agent-autonomy pass and
   a GO/NO-GO ledger under `.audit/<version>/` (git-ignored). Fix what it confirms, one
   regression test per finding; the ledger records the fix commits.
3. Run `node scripts/gate.mjs --publish --require-all` locally, fill
   `release-notes/draft/PR-vX.Y.Z.md` (every figure from a command that ran; the *Independent
   audit* section from `verdict.md`), open the PR, merge it once every required check is green.
4. Publish the GitHub Release `vX.Y.Z` (which creates the tag) from `main`. `publish.yml`
   runs `guard` (the tag must equal `v<package.json version>`), `build and pack` (the whole
   publish gate, one tarball, its SHA-256 / SHA-512), waits for the `npm-publish` approval,
   publishes exactly that tarball with provenance, then `attest and attach` fetches it back
   from the registry, checks both digests and attaches the tarball, the CycloneDX / SPDX /
   toolchain SBOMs and the Sigstore bundle to the release; `verify as a consumer` (read-only)
   installs the published version and runs `npm audit signatures`.
5. Verify like a consumer: `npm install zipnative-cli@X.Y.Z && npm audit signatures`, and
   `gh attestation verify zipnative-cli-X.Y.Z.tgz -R Nizoka/zipnative-cli`.

## Bumping the engine

`zipnative` is the only runtime dependency; Dependabot never bumps it inside the dev group.
A bump is a reviewed change of its own:

1. `npx npm@11 install zipnative@^X.Y.Z --ignore-scripts`, then check out the matching tag of
   zipnative next to this repository (`../zipnative`, or set `ZIPNATIVE_ENGINE_CHECKOUT`).
2. `npm run typecheck:all` — `ZIP_TO_CLI` and the diagnostic table are typed against the
   engine's unions, so a new error or diagnostic code fails `tsc` until the CLI maps it.
3. Re-export every new name in `src/core-bridge/index.ts` (the docs test requires it).
4. `npm run build && node scripts/sync-engine-data.mjs` — re-derives the engine half of
   `docs/data/errors.json` and `docs/data/core-exports.json` and names every row a human must
   complete (`raisedBy` for a new diagnostic; `reach` / `via` for a new export — `bridged`
   with a ROADMAP reason when no command reaches it yet). `--check` is the CI form.
5. Map each export in `docs/KNOWLEDGE_BASE.md` §8, read the engine's CHANGELOG for behaviour
   changes (a reclassified error, a widened union, a new default), regenerate the veraZIP corpus
   and compare its SHA-256 with the previous build — a byte change under `--deterministic` is a
   semver-major event.

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

- **Wrap every core call** with `guard('context', () => …)` or `mapZipError(e, 'context',
  entryName)` from `utils/ziperr.ts` — that module is the only place allowed to read the
  engine's `err.code`. An autonomous caller must always receive the stable class
  (`error.code`), the exact cause (`error.zipCode`), the entry name and the code-specific
  `detail` when the engine knows them.
- Throw `CliError(message, exitCode, ErrorCode.X, { zipCode?, entryName?, detail? })` with a
  stable code from `utils/error.ts`. Numeric exit codes (0/1/2) must not change: usage and
  malformed flags are `E_USAGE` / exit 2, unsafe or malformed **data** (an entry name, a manifest
  value) is `E_INPUT` / exit 1. A new engine code fails `tsc` in `ZIP_TO_CLI` until it is
  mapped — map it, regenerate `docs/data/errors.json`, and update the tables in AGENTS.md and
  the knowledge base. Every refusal names the next action (a flag or a command to run).
- Pass `commonOptions(args, sink)` (`{ strict, onDiagnostic, limits }`) to every engine entry
  point so `--strict`, the diagnostics bridge and the `--max-*` bounds apply uniformly; every
  buffered read goes through `readFileOrStdin` / `readArchiveBytes` so `--max-input-size`
  applies.
- Keep **stdout** for the artifact and **stderr** for diagnostics. For success status on a
  write command, call `emitStatus({ command, …, ...sink.field() })` (no-op outside `--json`);
  the `status` schema's `command` enum is tested against the callers.
- Honour `--dry-run` via `hasFlag(args.flags, 'dry-run') || isDryRun()` (agent mode may come
  from the environment, so branch on `isJsonMode()`, never on `hasFlag('json')`) and add the
  command to `DRY_RUN_COMMANDS` in `commands/completion.ts`.
- Write files through `writeOutput` / `writeFileStream` / the sink (`utils/sink.ts`) so the
  uniform overwrite policy (exclusive open unless `--overwrite`), partial-file removal and the
  `SIGINT` / `SIGTERM` cleanup (`utils/inflight.ts`) apply.
- Never loosen a security default: opt-outs skip, they never write anything unsafe; a symlink
  is never materialised; every destination goes through `safeJoin` and the sink's realpath check.
- **Register every flag** in the `COMMANDS` table (completions, `schema manifest`, `doctor` and
  the docs test derive from it). A **boolean** flag must also be listed in `utils/flags.ts` —
  the boolean-flag table is what stops the parser from consuming the next token — and a flag
  that takes a **path** must be added to `PATH_FLAGS` in `commands/completion.ts` so the shells
  complete files after it. Add it to the command's USAGE string (≤ 80 columns, no `<value>` on
  a boolean), its README section and the knowledge base table — the docs test checks all three.
- If a command gains a new input/output shape, update the matching schema in
  `commands/schema.ts` (hand-authored Draft 2020-12; the `$id` tracks the package version
  automatically) and add a test assertion.

## Project Structure

```
src/
├── index.ts               # CLI entry: parse argv → env flags → config merge → dispatch → exit;
│                          #   EPIPE guard, SIGINT/SIGTERM cleanup, the agent error envelope
├── commands/              # one file per command (17) — create, modify, canonicalize, merge,
│                          #   list, inspect, cat, extract, stream, verify, crc32, inflate, batch, doctor, schema,
│                          #   completion (the COMMANDS table + PATH_FLAGS), govern
├── utils/
│   ├── args.ts            # zero-dep arg parser (boolean table aware, order-independent)
│   ├── flags.ts           # the boolean-flag table (global + per command)
│   ├── io.ts              # stdin/file I/O with --max-input-size, validatePath (manifest values),
│   │                      #   safeJoin (lexical containment), exclusive writes, 50 MB JSON cap
│   ├── sink.ts            # the one extraction sink: duplicate policy, realpath containment,
│   │                      #   exclusive open, partial-file removal
│   ├── inflight.ts        # files being written, removed on SIGINT / SIGTERM
│   ├── ziperr.ts          # ZIP_TO_CLI (39 codes → E_*), mapZipError / guard
│   ├── error.ts           # CliError + the 13 E_* codes
│   ├── limits.ts          # the nine --max-* flags → ZipLimits, plus --max-input-size
│   ├── engine.ts          # prepareEngine (codecs + node:zlib tier)
│   ├── diagnostics.ts     # the diagnostics sink (text | --json | --strict)
│   ├── zipops.ts          # shared flag → core-option translation (dates, modes, extra fields)
│   └── …                  # agent, projection, manifest, codecs, entryfmt, walk, glob, sizes, config, version, governance, colors
└── core-bridge/
    └── index.ts           # the ONLY import point of zipnative / zipnative/worker
scripts/                   # generate-zip-corpus.mjs, validate-zip.mjs (veraZIP), helpers/interop-tools.mjs
tests/                     # vitest suite (mirrors src/) + tests/docs/ + tests/scripts/ + tests/helpers/ + tests/fixtures/
samples/                   # .sh + .ps1 per command (48 demos), run-all.js (96 jobs)
.claude/                   # settings.json (attribution off, HITL deny list) + skills/release-audit/
.audit/                    # release-audit ledgers, one directory per version — git-ignored
```

## Security

- The CLI is the filesystem trust boundary: every destination goes through `safeJoin` and the sink's realpath check, existing files are never overwritten without `--overwrite` (every writer, not only the sink), files are opened exclusively, partial outputs are removed on failure or interrupt, and no flag may ever materialise a symlink.
- Argv paths are the user's own authority; path values that arrive as **data** (manifests) go through `validatePath`, and every entry name the CLI writes goes through `sanitizeEntryPath()`. Cap JSON input at 50 MB before parsing; every buffered read honours `--max-input-size`.
- `modify` verifies every entry it re-emits (`verifyEntry()`), with no opt-out. Do not add one.
- `--codec` is the only dynamic import of user code — argv only, refused from config files, gated in manifests, reported truthfully when it shapes the writer. Do not add another.
- No command may open a socket. Do not add a network path.
- The configuration file is presentation only (docs/adr/0001): never add an operational key to `CONFIG_KEYS`. Every bound is finite (0002), every invocation is checked (0003), text output is terminal-safe (0004), writes are exclusive or temp + rename (0005). Do not loosen any of them.
- Never write a raw control or bidi character in a source file (`tests/docs/source-hygiene.test.ts`); use escapes.
- The release pipeline (docs/adr/0009) keeps dev-dependency code away from the publishing token: do not add a step that installs or runs repository code to the `publish` job, and do not give `build` an `id-token`. SBOMs are written by `npm sbom` from the lockfile (CycloneDX and SPDX) in the `attest` job. `npm audit` runs at `--audit-level=moderate`.

## Versioning, stability and deprecation

The package follows [Semantic Versioning](https://semver.org/). The **public surface** guarded
by it:

- the 15 command names and their flags and positional forms (the `COMMANDS` table in
  `src/commands/completion.ts`);
- exit codes `0` / `1` / `2` and the signal exits `130` / `143`;
- the 13 `E_*` class names and the `ZIP_*` → `E_*` mapping (`src/utils/ziperr.ts`);
- the envelope keys (`ok`, `command`, `error.{code, message, zipCode, entryName, detail,
  remedy}`, the status-envelope fields listed in AGENTS.md §2), the JSON report shapes and
  their schema `$id`s, the `schema manifest` shape and `docs/data/errors.json`;
- the `.zipnativerc.json` keys (presentation only since 1.1.0 — `CONFIG_KEYS`) and the
  `ZIPNATIVE_*` environment variables;
- the bytes written under `--deterministic` — the engine's frozen contract; a byte change is
  semver-**major** (`ai-governance.json` → `deterministic_bytes_are_semver_major`).

**Not a contract:** message wording (including the engine's), text-mode layout, progress and
warning lines, `--help` prose, JSON key order.

**Rules:** a new field, flag, schema subject or `E_*` class is a **minor**; a rename, removal,
exit-code change or byte change is a **major**; an engine major bumps the CLI major.

**Deprecation ladder:** (1) a minor release keeps the old flag working and calls
`deprecate(name, replacement)` (`src/utils/error.ts`: one `warning:` line per process, never
suppressed) and lists it under `### Deprecated` in the changelog with a strike-through in the
README table; (2) at least one further minor of overlap; (3) removal in the next major, after
which the flag is an ordinary `E_USAGE`.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/). The `commitlint` job checks every
commit subject of a PR (base to PR head, merges excluded) and the PR title against
`^(feat|fix|docs|chore|test|refactor|ci|build|perf|style|revert)(\([a-z0-9,./ -]+\))?!?: .+`. The PR
title is checked because a squash merge turns it into the commit subject. A subject longer than
100 characters (commitlint's default) only draws a warning — Conventional Commits itself sets no
limit, and GitHub truncates the display at 72. Types:
- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance (deps, CI, governance)
- `docs:` documentation only
- `test:` tests only
- `refactor:` no behaviour change

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
No contributor licence agreement and no `Signed-off-by` (DCO) line is required: that
inbound = outbound rule is the whole agreement.
