# Roadmap

This document outlines the planned development direction for zipnative-cli. Priorities may shift based on community feedback. The CLI is a thin dispatch layer over [`zipnative`](https://github.com/Nizoka/zipnative): it never re-implements engine logic, so every item below that needs a new primitive is marked with the upstream dependency it waits on.

## Released

### v1.0.0 — zipnative 1.0.0: the agent-grade ZIP CLI _(released 2026-09-05)_

- [x] **`zipnative` pinned** to `^1.0.0` — the engine's frozen 77-export surface, 39-code error
  vocabulary and `deterministic: true` bytes; the sole runtime dependency, imported only
  through `src/core-bridge/index.ts`.
- [x] **`create` command** — files / directories / stdin / `--from-manifest` through
  `createZip` (`add`, `addDirectory`, `addStream`, `toBytes`, `stream`); `--deterministic`,
  `--stream` (data-descriptor layout, reported as `layout` in the envelope), `--parallel` via
  `createParallelZip` (`zipnative/worker`), `--method`, `--level`, `--order canonical|insertion`
  (insertion = the argv order, so an EPUB `mimetype` listed first is written first), `--date`
  (UTC wall-clock, time-zone independent), `--comment` / `--comment-file` (binary comments),
  globs, `--store-ext`, `--preserve-mode`, `--overwrite`, `--dry-run`; manifest `extraFields`
  and `commentBase64`; names pre-checked with `sanitizeEntryPath`.
- [x] **`modify` command** — `createZipModifier` (`addEntry`, `replaceEntry`, `removeEntry`,
  `renameEntry`, `setComment`, `save`, `saveCompact`); eager open and `verifyEntry()` on every
  entry it re-emits (CRC / sizes / local header, no opt-out); append-only by default,
  `--compact`, `--in-place` (unpredictable exclusive temp file + rename), `--overwrite`,
  `--comment-file`, `--from-manifest` (`mode`, `extraFields`, `commentBase64`); envelope
  `verified` / `verifySkipped` / `tier` / `layout`.
- [x] **`list` command** — `openZip` + `entries()`; text / json / ndjson, `--long` (with
  `rawNameHex` / `commentHex`), `--validate eager`, filters, `--summary` / `--fields`.
- [x] **`inspect` command** — `openZip({ validate: 'eager' })`; stats, a determinism verdict that
  separates reproducibility (`deterministic`) from form (`canonicalLayout`), diagnostics,
  `--entries` / `--entry` / `--extra`, 19 `--check` assertions → `E_CHECK_FAILED`.
- [x] **`cat` command** — `readEntryStream` / `readEntryRaw` to stdout or `--output`
  (`--overwrite`); falls back to `readEntry` for a sync-only `--codec` method.
- [x] **`extract` command** — `extractZipStream` / `extractZip` with the engine's guards on by
  default and the CLI as the proven sink (`src/utils/sink.ts`: `safeJoin` containment, realpath
  re-check against planted links, exclusive open unless `--overwrite`, case-fold check);
  skip-not-write opt-outs incl. `--skip-unsupported`; `getUnixMode` / `isSymlinkEntry` for
  `--preserve-mode` and symlink policy.
- [x] **`stream` command** — `iterateZipEntries` over stdin / pipes (list, extract, cat) through
  the same sink, with the trust caveat explicit (`trust: "local-headers-only"`,
  `descriptorEntries` / `bytesKnown` in `--summary`).
- [x] **`verify` command** — `verifyZip` report + CLI counters, `--entry` (per-entry
  `verifyEntry`), `--strict`, `E_VERIFY_FAILED` with `zipCode`.
- [x] **`crc32` command** — the engine's incremental `crc32()`, `--seed`, `--expect`.
- [x] **`inflate` command** — `createInflator` (resumable, bounded) or `getCodec().decompressSync`
  (`--sync`, `--method <id>`), mandatory `--max-output`, `bytesConsumed` in the envelope,
  `--overwrite`.
- [x] **`batch` command** — directory mode (create / verify, `--concurrency` 1–64, `--overwrite`)
  and `--manifest` pipelines (10 whitelisted manifest commands, `@<id>` references,
  `--allow-codec-load` policy); under `--json` stdout is one batch document with every task's
  report captured.
- [x] **`doctor` command** — versions (`VERSION` export cross-check), `activeDeflateTier`
  (default and pinned), web streams, workers, `getCodec` registry, effective
  `DEFAULT_ZIP_LIMITS` + overrides as numbers (`limits.data`, incl. `maxInputSize`), command count.
- [x] **`schema` command** — 22 subjects incl. `errors`, `limits`, `diagnostics`, `status`,
  `error` and the capability `manifest`; **`completion`** for four shells (path flags complete
  files); **`govern`** (rules / policy / verify-issue, pinned to the `.github` files by a test).
- [x] **Global options** — `--json`, `--pretty`, `--dry-run` (7 commands), `--strict`,
  `--quiet`, `--no-color`, `--config` / `--no-config` (`.zipnativerc.json`), the eight
  `--max-*` bounds over `ZipLimits` plus the CLI-owned `--max-input-size` (4 GiB default),
  `--pure-codecs`, `--codec` (`registerCodec`, `setInflateImpl`, `setDeflateImpl`, reported
  truthfully when it shapes the writer), `--format, -f` on every command that has a format.
- [x] **Global flags before the command name** — `zipnative --json list a.zip` and
  `list --long a.zip` both work: `src/utils/flags.ts` is the boolean-flag table, so a boolean
  never consumes the next token and flags and positionals are order-independent (audit A-01).
- [x] **Relative parent paths on argv** — `zipnative list ../a.zip`, `-o ../out.zip` and
  `--output-dir ../x` are ordinary shell usage and are accepted: argv paths are the user's own
  filesystem authority; the `..` refusal (`validatePath`, `E_INPUT`) now applies only to path
  values that arrive as data (manifests), and entry names always go through
  `sanitizeEntryPath()` (audit A-09, recorded as a posture change in SECURITY.md → Input
  Validation).
- [x] **`--overwrite` for single-file writers** — `create` / `modify` / `cat` / `inflate --output`
  and `batch --task create` refuse an existing file unless `--overwrite`, exactly like the
  extraction sink; `modify --in-place` writes an exclusive temp file and renames (audit A-14).
- [x] **Process contract** — exit 2 / `E_USAGE` for unknown commands and flags without a command;
  a terminal with nothing piped is refused instead of blocking; a closed downstream pipe
  (`EPIPE`) ends the run quietly with exit 0; `SIGINT` / `SIGTERM` remove only the in-flight
  output and exit 130 / 143; `ZIPNATIVE_*`, `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb` honoured
  from the environment.
- [x] **Agent contract** — 13 stable `E_*` classes + the 39 `ZIP_*` causes verbatim
  (`ZIP_TO_CLI`, typed against `ZipErrorCode`), `entryName` / `detail`, the diagnostics bridge
  (11 codes), token economy (`--summary`, `--fields`, compact JSON), `llms.txt`,
  `docs/data/core-exports.json`, `docs/data/errors.json`, `AGENTS.md` — `AGENTS.md`, `llms.txt`
  and `docs/data/errors.json` ship in the npm tarball.
- [x] **Blocking veraZIP gate** — `npm run validate:zip` over a 37-archive corpus written by the
  built CLI (33 conformant incl. 3 hostile-but-conformant that `extract` must refuse, + 4
  raw-crafted negative canaries → 33 PASS, 4 XFAIL), validated by the ISO/IEC 21320-1:2015
  parser vendored from the engine (independent by construction), level 1 foreign integrity
  tools, blocking in `verazip.yml` (Linux + Windows, on every push and PR) and pre-publish.
- [x] **Governance & supply chain** — CI on Ubuntu 22 / 24, Windows 22 / 24 (blocking) and
  macOS 22, veraZIP on Linux + Windows on every PR, documentation changes run the suite
  (the docs are pinned by tests), CodeQL, Scorecard, Dependabot, Trusted Publishing with
  provenance, an attested CycloneDX SBOM and a verified bin-only tarball (7 files), coverage
  thresholds 93 / 88 / 94 / 93, AI-governance / HITL files mirrored by `govern`, `CLAUDE.md`.
- [x] **Samples** — 41 dual-shell demos (`.sh` + `.ps1`) across the commands, `samples/agent/`,
  `samples/run-all.js` (73 jobs, offline).

## Future Considerations

Feasibility is called out honestly: some ideas need zipnative to expose a primitive first (the
CLI stays a thin dispatch layer and never re-implements engine logic).

- **`zipnative-mcp`** — a Model Context Protocol server exposing the same capabilities to AI
  clients, in its own repository pinning `zipnative ^1.0.0` (the ecosystem pattern); the CLI's
  `schema manifest` and `docs/data/errors.json` are its contract inputs. Planned upstream.
- **Read-only AES decryption** (`extract --password`, `cat --password`) — **Blocked**: the engine
  ships no encryption in 1.x by policy — see the engine's
  [What zipnative will NOT do](https://github.com/Nizoka/zipnative#what-zipnative-will-not-do)
  (ZipCrypto is broken and will never be written; AES AE-2 may come in a later major behind an
  injected crypto provider). The CLI can only surface it once a core crypto-provider seam
  exists; it will never implement decryption itself.
- **Streamed entries > 4 GiB** (`create --stream` / `--stdin-name` beyond 4 GiB) — **Blocked**
  on the core's per-entry `zip64` opt-in for `addStream` (designed in zipnative's 0.9 ADR,
  post-1.0). Today the engine refuses with `ZIP_UNSUPPORTED_ZIP64_STREAMING`; buffered entries
  are fully Zip64.
- **Custom-method entries in `stream`** — the engine's forward pump decodes store and deflate
  only, so `stream --cat` / `--output-dir` on a `--codec` method fails with `E_DATA` after the
  header (listing and skipping work). Waits on the engine using `codec.decompressStream` or
  refusing before the first byte (upstream draft in `.github/drafts/`); until then use `cat` /
  `extract --codec` on the complete file.
- **`--explain <ZIP_CODE>`** — print `raisedWhen` / `remedy` / class / CLI mapping for one
  error or diagnostic code from `docs/data/errors.json`, so an agent can resolve a `zipCode`
  without leaving the terminal. Feasible now (pure data).
- **`deflate` command** — the twin of `inflate`: raw DEFLATE of a file or stdin through the
  engine's deflate facade with the same tier / determinism vocabulary (`--level`,
  `--deterministic`). Feasible now.
- **`inspect --diff <b.zip>`** — compare two archives by entry inventory, CRCs, sizes and
  determinism facts with CI-friendly exit codes (no content diff). Feasible now, read-only.
- **`create --from-list <file>`** — one path per line (or NUL-separated) as an input list for
  very large trees, complementing `--from-manifest`. Feasible now.
- **`--store-symlinks`** on `create` — write symlink entries (Unix mode `S_IFLNK`, target text
  as payload) for callers that need them; kept out of 1.0 deliberately because extraction
  refuses symlink entries by default and the CLI never materialises one — needs a documented
  posture on both sides first.
- **Manifest `externalAttributes` (raw u32)** — folded into the `--store-symlinks` decision above: a raw external-attribute word would let a manifest write `S_IFLNK` entries and bypass the deliberate symlink deferral, so it waits for the same documented posture; `mode` (0o7777 permission bits) remains the supported field on both manifests. (audit B-21)
- **`list --extra` / `stream --extra`** — extra-field hex under `--long` for parity with `inspect --extra` (today ids, names and lengths only). (audit B-39)
- **Inflate-tier visibility in `doctor`** — needs an engine getter (the 1.0 surface exposes `setInflateImpl` but no `activeInflateTier`); until then `doctor` can only say whether a `--codec` module injected `inflateImpl`, and the paths that bypass it (`createInflator`, the forward pump) stay documented in KB §8. (audit B-42)
- **User-level config** — `$XDG_CONFIG_HOME/zipnative/config.json` (or `~/.zipnativerc.json`) as the last fallback after the upward `.zipnativerc.json` discovery; today only the nearest project file is consulted. (audit A-39)
- **Positional arguments in manifest tasks** — `batch --manifest` tasks carry only a flat flag
  map today; every whitelisted command accepts its inputs as flags (`input`, `entry`, …), so no
  command is excluded, but a `positionals` array would make manifests read like the shell.
- **Lazy engine require** — `dist/cli.cjs` requires `zipnative` at bundle top level (≈10 ms of the ≈40 ms `--version` start-up over bare Node); moving the require into the first core call (tsup `splitting` or a lazy getter in the bridge) would make `--help` / `--version` / `schema` engine-free. Measured, not yet worth the bundling risk. (audit A-11)
- **Fuzz / property tests for the CLI-owned parsers** — a seeded generator (or `fast-check` as a devDependency) over `parseArgs`, `compileGlob`, `parseByteSize` / `parseCount`, `parseManifest` and `selectFields`, run in CI; today the suites are example-based only. (audit A-25)
- **`noUncheckedIndexedAccess`** — enable the stricter indexing check in `tsconfig.json` once the resulting `undefined` narrowings across `src/` are reviewed (the code already writes `argv[i] as string` as if it were on). (audit A-44)
- **One ecosystem governance schema** — the engine's `.github/ai-governance.json` (`version: 1`, `issue_drafting`, `compliance_report_fields`) and the CLI's (`1.0.0`, `policy`, `compliance_report`) differ in shape; agreeing one schema upstream and generating the CLI constant from it is an ecosystem decision, not a CLI change. (audit A-36)
- **man pages** — generated from the USAGE strings; deferred (ongoing maintenance cost vs
  `--help` / completions already covering usage).
- **`scripts/verify-docs.mjs`** — port the engine's docs-verification rules (API-JSON sync,
  error parity, count consistency) as a script; today `tests/docs/consistency.test.ts` covers
  the counts, mappings and flag tables inside the test suite.
- **veraZIP sync automation** — a check that fails when `zipnative/scripts/validate-zip.ts`
  changes upstream without the vendored copy (and its recorded commit / blob hashes) being
  re-ported.
