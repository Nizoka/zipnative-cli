# Roadmap

This document outlines the planned development direction for zipnative-cli. Priorities may shift based on community feedback. The CLI is a thin dispatch layer over [`zipnative`](https://github.com/Nizoka/zipnative): it never re-implements engine logic, so every item below that needs a new primitive is marked with the upstream dependency it waits on.

## Released

### v1.1.0 — zipnative 1.1.0 parity and hardening _(2026-10-18)_

- [x] **`zipnative` pinned** to `^1.1.0` — all 106 exports bridged (101 + 5 worker), the 12th
  diagnostic `ZIP_TIMESTAMP_CLAMPED`, `maxEntryCompressedSize` reported by `doctor` /
  `schema limits` without a flag (ADR 0007); `docs/data/core-exports.json` grades the exports
  no command reaches yet as `bridged` (see "1.2 candidates" below).
- [x] **Streamed Zip64** — `create --stream|--stdin-name --zip64` (`AddEntryOptions.zip64`):
  streamed entries past 4 GiB.
- [x] **Legacy name encodings** — `--name-encoding <label>` on `list`, `inspect`, `cat`,
  `extract`, `stream` (the engine's `nameDecoder`, applied before sanitising).
- [x] **Deadline and progress** — global `--timeout <duration>` (`AbortSignal`, `E_LIMIT`
  `detail.limit: "timeout"`, ADR 0006) and `--progress` (`onProgress`, stderr text or NDJSON).
- [x] **Determinism from the engine** — `inspect` reports `analyzeDeterminism()`
  (`canonicalForm`, `offenders`) and `--check canonical-form`.
- [x] **Richer entry rows** — `--long` adds `timestamps` (UT / NTFS / DOS) and `unixIds`.
- [x] **`stream` with custom codecs** — `--codec` methods decode through
  `createDecompressor()`; codecs without one are refused before the first byte.
- [x] **Engine asks closed** — every compensation for an engine gap is removed: zlib error
  translation, the skip re-derivation in `verify` / `modify`, the Unix-mode encoder.
  `dosTimeMode` is deliberately not adopted (ADR 0008).
- [x] **Runtime hardening** (pkinative-cli parity, ADRs 0001–0005) — presentation-only
  configuration, strict invocation (undeclared / repeated / surplus input is `E_USAGE`), finite
  bounds only, one-descriptor bounded reads, `lstat` + exclusive creates and temp + rename
  overwrites, terminal-safe text output.
- [x] **Release integrity** (ADR 0009) — five-job publish (guard → build → publish → attest → consumer),
  one gate script (`scripts/gate.mjs`), reproducible build, bundle probe, frozen tarball list,
  install smoke test, harden-runner and `--ignore-scripts` on every job, zizmor / actionlint /
  reuse, OSV-Scanner, dependency review, rulesets as code, SECURITY-INSIGHTS, security.txt.
- [x] **Fuzzing of the CLI-owned parsers** (audit A-25, ADR 0010) — seeded campaigns over argv,
  sizes, durations, globs, projections, manifests, the config file, name encodings and the
  terminal escaper; one real bug found and fixed (an out-of-order glob range).
- [x] **Documentation verified by tests** — relative links and anchors resolve, LF line
  endings, fixture SHA-256s, the ADR index; veraZIP re-ported from zipnative 1.1.0
  (`WF/DESCRIPTOR-WIDTH`) with a divergence test against the engine checkout; corpus of 39
  archives (35 PASS, 4 XFAIL).

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
  never consumes the next token and flags and positionals are order-independent (audit A-01)
- [x] **Type-aware lint and `noUncheckedIndexedAccess`** — ESLint runs `strictTypeChecked` over `src/` (three relaxations, each justified in `eslint.config.js`; tests keep the non-type-checked strict set) and `tsconfig.json` enables `noUncheckedIndexedAccess`. (audit A-44, phase 3).
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

### 1.2 candidates — engine 1.1 capabilities bridged but not yet exposed

zipnative 1.1 added 29 exports; 1.1.0 of the CLI surfaces the ones that complete existing
commands (see the v1.1.0 section) and bridges the rest so the ledger
(`docs/data/core-exports.json`, `reach: "bridged"`) stays complete. Each is a command-surface
decision, not an engine wait:

- **Range reading of large local archives** — `openZipRange` / `ZipRangeReader` over a
  `ByteRangeSource` built from a local file handle (`rangeSourceFromBytes` is the in-memory
  form) would let `list` / `inspect` / `cat` / `verify` read an archive larger than
  `--max-input-size` without loading it, bounded by the engine's `maxEntryCompressedSize`
  (which then gets its `--max-*` flag). A network source (`--url`) is **not** a candidate:
  offline, always.
- **`canonicalize` command / `modify --compact --canonical`** — `canonicalizeZip` /
  `saveCompact({ canonical })` with `CanonicalizeOptions` / `CanonicalOptions` /
  `CompactOptions`: the "fix" half of `inspect`'s `canonicalForm` verdict (rewrite an archive
  from any producer into zipnative's canonical deterministic form, no recompression).
- **Verbatim entry copy between archives** (a `merge` / `split` command) — `addFromReader` with
  `AddFromReaderOptions` / `RawEntryReader`, and `addRaw` with `RawEntryMeta` for
  pre-compressed payloads (`verify: true` by default, so a lying source is refused).

### 1.2 targets from the second 1.1.0 review (verified, deferred)

Legitimate findings that the verifier deferred because they cost more churn than a minor release
should carry (`release-notes/draft/review-v1.1.0.md`):

- **Token budget for the AI-facing text** — AGENTS.md (49 KB), llms.txt (15 KB), CLAUDE.md and
  copilot-instructions total about 94 KB (≈ 23k tokens). Targets: `llms.txt` as an
  [llmstxt.org](https://llmstxt.org) index of 4 KB or less; AGENTS.md at 30 KB or less by pointing
  to `schema errors` / `docs/data/errors.json` instead of repeating the tables; CLAUDE.md at 5 KB
  or less, deferring to copilot-instructions.
- **Contract and contributor guide split** (family parity) — move the consumer contract to
  `docs/AGENT_CONTRACT.md` (shipped) and make AGENTS.md the coding-agent contributor guide, as in
  pkinative-cli and pdfnative-cli, with a pointer stub so no link breaks. Tracking a shared
  `.claude/` guard hook and rules is the maintainer's call.
- **Family hygiene** — a `docs.yml` workflow (docs verification + npm drift), a Deno / Bun
  runtime smoke job, `release-notes/PR_TEMPLATE.md`, a standalone `docs/THREAT_MODEL.md` with the
  trust boundaries (argv vs data paths vs archive bytes vs codec modules), an ADR "one runtime
  dependency, one bridge", and `.github/instructions/security.instructions.md`.
- **`modify --name-encoding`** — after checking that the editor re-emits the raw name bytes
  unchanged when a decoder is set (today the CP437 name addresses the entry).
- **A `remedy` on diagnostic rows** — `ZIP_NONDETERMINISTIC_CODEC` → `--deterministic`,
  `ZIP_DEAD_BYTES_RATIO` → `--compact`, from the `ZIP_REMEDY` table. The engine-side message
  vocabulary is drafted for zipnative (`.github/drafts/upstream-message-vocabulary.md`).

### Ideas feasible now (deferred from 1.1.0, which is scoped to engine parity)

- **`--explain <ZIP_CODE>`** — print `raisedWhen` / `remedy` / class / CLI mapping for one
  error or diagnostic code from `docs/data/errors.json`, so an agent can resolve a `zipCode`
  without leaving the terminal — fed by the same `ZIP_REMEDY` table that already emits
  `error.remedy` in the envelope (pure data).
- **`deflate` command** — the twin of `inflate`: raw DEFLATE of a file or stdin through the
  engine's deflate facade with the same tier / determinism vocabulary (`--level`,
  `--deterministic`).
- **`inspect --diff <b.zip>`** — compare two archives by entry inventory, CRCs, sizes and
  determinism facts (`analyzeDeterminism` on both sides) with CI-friendly exit codes (no
  content diff), read-only.
- **`create --from-list <file>`** — one path per line (or NUL-separated) as an input list for
  very large trees, complementing `--from-manifest`.
- **`list --extra` / `stream --extra`** — extra-field hex under `--long` for parity with
  `inspect --extra` (today ids, names and lengths only). (audit B-39)
- **Positional arguments in manifest tasks** — `batch --manifest` tasks carry only a flat flag
  map today; every whitelisted command accepts its inputs as flags (`input`, `entry`, …), so no
  command is excluded, but a `positionals` array would make manifests read like the shell.
- **man pages** — generated from the USAGE strings; deferred (ongoing maintenance cost vs
  `--help` / completions already covering usage).
- **Lazy engine require** — `dist/cli.cjs` requires `zipnative` at bundle top level (≈10 ms of
  the ≈40 ms `--version` start-up over bare Node); moving the require into the first core call
  (tsup `splitting` or a lazy getter in the bridge) would make `--help` / `--version` / `schema`
  engine-free. Measured, not yet worth the bundling risk. (audit A-11)

### Needs a documented posture first

- **`--store-symlinks`** on `create` — write symlink entries (Unix mode `S_IFLNK`, target text
  as payload) for callers that need them; kept out deliberately because extraction refuses
  symlink entries by default and the CLI never materialises one — needs a documented posture on
  both sides first.
- **Manifest `externalAttributes` (raw u32)** — folded into the `--store-symlinks` decision
  above: a raw external-attribute word would let a manifest write `S_IFLNK` entries and bypass
  the deliberate symlink deferral; `mode` (0o7777 permission bits) remains the supported field
  on both manifests. (audit B-21)
- **User-level config** — `$XDG_CONFIG_HOME/zipnative/config.json` (or `~/.zipnativerc.json`) as
  the last fallback after the upward `.zipnativerc.json` discovery; today only the nearest
  project file is consulted. (audit A-39)

### Blocked on the engine or the ecosystem

- **Read-only AES decryption** (`extract --password`, `cat --password`) — **Blocked**: the engine
  ships no encryption in 1.x by policy — see the engine's
  [What zipnative will NOT do](https://github.com/Nizoka/zipnative#what-zipnative-will-not-do)
  (ZipCrypto is broken and will never be written; AES AE-2 is a zipnative 2.0 candidate behind
  an injected crypto provider). Since zipnative 1.1 an AES entry is at least *named*
  (`detail.feature: "aes"`). The CLI can only surface decryption once a core crypto-provider
  seam exists; it will never implement it itself.
- **Inflate-tier visibility in `doctor`** — needs an engine getter (zipnative 1.1 still exposes
  `setInflateImpl` but no `activeInflateTier`); until then `doctor` can only say whether a
  `--codec` module injected `inflateImpl`, and the paths that bypass it (`createInflator`, the
  forward pump) stay documented in KB §8. (audit B-42)
- **One ecosystem governance schema** — the engine moved its `.github/ai-governance.json` to the
  pdfnative schema in 1.1; agreeing one schema across the family and generating the CLI
  constant from it is an ecosystem decision, not a CLI change. (audit A-36)
- **`zipnative-mcp`** — shipped upstream as its own package (zipnative-mcp 1.0.0, 2026-09-07)
  pinning the engine; the CLI's `schema manifest` and `docs/data/errors.json` remain its
  contract inputs, kept in step by the engine's `cli-surface` documentation rules.
