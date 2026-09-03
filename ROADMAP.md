# Roadmap

This document outlines the planned development direction for zipnative-cli. Priorities may shift based on community feedback. The CLI is a thin dispatch layer over [`zipnative`](https://github.com/Nizoka/zipnative): it never re-implements engine logic, so every item below that needs a new primitive is marked with the upstream dependency it waits on.

## Released

### v1.0.0 — zipnative 1.0.0: the agent-grade ZIP CLI _(released 2026-09-03)_

- [x] **`zipnative` pinned** to `^1.0.0` — the engine's frozen 77-export surface, 39-code error
  vocabulary and `deterministic: true` bytes; the sole runtime dependency, imported only
  through `src/core-bridge/index.ts`.
- [x] **`create` command** — files / directories / stdin / `--from-manifest` through
  `createZip` (`add`, `addDirectory`, `addStream`, `toBytes`, `stream`); `--deterministic`,
  `--stream`, `--parallel` via `createParallelZip` (`zipnative/worker`), `--method`, `--level`,
  `--order`, `--date`, globs, `--store-ext`, `--preserve-mode`, `--dry-run`; names pre-checked
  with `sanitizeEntryPath`.
- [x] **`modify` command** — `createZipModifier` (`addEntry`, `replaceEntry`, `removeEntry`,
  `renameEntry`, `setComment`, `save`, `saveCompact`); append-only by default, `--compact`,
  `--in-place`, `--from-manifest`.
- [x] **`list` command** — `openZip` + `entries()`; text / json / ndjson, `--long`,
  `--validate eager`, filters, `--summary` / `--fields`.
- [x] **`inspect` command** — `openZip({ validate: 'eager' })`; stats, determinism verdict,
  diagnostics, `--entries` / `--entry` / `--extra`, 19 `--check` assertions → `E_CHECK_FAILED`.
- [x] **`cat` command** — `readEntryStream` / `readEntryRaw` to stdout or `--output`.
- [x] **`extract` command** — `extractZipStream` / `extractZip` with the engine's guards on by
  default and the CLI as the proven sink (`safeJoin` containment, overwrite refusal,
  case-fold check); skip-not-write opt-outs; `getUnixMode` / `isSymlinkEntry` for
  `--preserve-mode` and symlink policy.
- [x] **`stream` command** — `iterateZipEntries` over stdin / pipes (list, extract, cat) with
  the trust caveat explicit (`trust: "local-headers-only"`).
- [x] **`verify` command** — `verifyZip` report + CLI counters, `--strict`, `E_VERIFY_FAILED`
  with `zipCode`.
- [x] **`crc32` command** — the engine's incremental `crc32()`, `--seed`, `--expect`.
- [x] **`inflate` command** — `createInflator` (resumable, bounded) or `getCodec().decompressSync`
  (`--sync`, `--method <id>`), mandatory `--max-output`.
- [x] **`batch` command** — directory mode (create / verify) and `--manifest` pipelines
  (10 whitelisted manifest commands, `@<id>` references, `--allow-codec-load` policy).
- [x] **`doctor` command** — versions (`VERSION` export cross-check), `activeDeflateTier`
  (default and pinned), web streams, workers, `getCodec` registry, effective
  `DEFAULT_ZIP_LIMITS` + overrides, command count.
- [x] **`schema` command** — 22 subjects incl. `errors`, `limits`, `diagnostics`, `status`,
  `error` and the capability `manifest`; **`completion`** for four shells; **`govern`**
  (rules / policy / verify-issue).
- [x] **Global options** — `--json`, `--pretty`, `--dry-run` (7 commands), `--strict`,
  `--quiet`, `--no-color`, `--config` / `--no-config` (`.zipnativerc.json`), the eight
  `--max-*` bounds over `ZipLimits`, `--pure-codecs`, `--codec` (`registerCodec`,
  `setInflateImpl`, `setDeflateImpl`).
- [x] **Agent contract** — 13 stable `E_*` classes + the 39 `ZIP_*` causes verbatim
  (`ZIP_TO_CLI`, typed against `ZipErrorCode`), `entryName` / `detail`, the diagnostics bridge
  (11 codes), token economy (`--summary`, `--fields`, compact JSON), `llms.txt`,
  `docs/data/core-exports.json`, `docs/data/errors.json`, `AGENTS.md`.
- [x] **Blocking veraZIP gate** — `npm run validate:zip` over a 34-archive corpus written by the
  built CLI (30 conformant incl. 3 hostile-but-conformant that `extract` must refuse, + 4
  raw-crafted negative canaries), validated by the ISO/IEC 21320-1:2015 parser vendored from
  the engine (independent by construction), level 1 foreign integrity tools, blocking in
  `verazip.yml` (Linux + Windows) and pre-publish.
- [x] **Governance & supply chain** — CI (Ubuntu 22 / 24, Windows 22), CodeQL, Scorecard,
  Dependabot, Trusted Publishing with provenance + SBOM, AI-governance / HITL files, `CLAUDE.md`.
- [x] **Samples** — `.sh` + `.ps1` pairs per command, `samples/agent/`, `samples/run-all.js`.

## Future Considerations

Feasibility is called out honestly: some ideas need zipnative to expose a primitive first (the
CLI stays a thin dispatch layer and never re-implements engine logic).

- **`zipnative-mcp`** — a Model Context Protocol server exposing the same capabilities to AI
  clients, in its own repository pinning `zipnative ^1.0.0` (the ecosystem pattern); the CLI's
  `schema manifest` and `docs/data/errors.json` are its contract inputs. Planned upstream.
- **Read-only AES decryption** (`extract --password`, `cat --password`) — **Blocked**: the engine
  ships no encryption in 1.x by policy (ZipCrypto is broken and will never be written; AES
  AE-2 may come in a later major behind an injected crypto provider). The CLI can only surface
  it once a core crypto-provider seam exists; it will never implement decryption itself.
- **Streamed entries > 4 GiB** (`create --stream` / `--stdin-name` beyond 4 GiB) — **Blocked**
  on the core's per-entry `zip64` opt-in for `addStream` (designed in zipnative's 0.9 ADR,
  post-1.0). Today the engine refuses with `ZIP_UNSUPPORTED_ZIP64_STREAMING`; buffered entries
  are fully Zip64.
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
- **Positional arguments in manifest tasks** — `batch --manifest` tasks carry only a flat flag
  map today; every whitelisted command accepts its inputs as flags (`input`, `entry`, …), so no
  command is excluded, but a `positionals` array would make manifests read like the shell.
- **man pages** — generated from the USAGE strings; deferred (ongoing maintenance cost vs
  `--help` / completions already covering usage).
- **`scripts/verify-docs.mjs`** — port the engine's docs-verification rules (API-JSON sync,
  error parity, count consistency) as a script; today `tests/docs/consistency.test.ts` covers
  the counts and mappings inside the test suite.
- **`doctor --json` limits as numbers** — the `limits` check renders the effective bounds as a
  formatted string; a structured `{ key: value }` field would save agents a parse.
- **Global flags before the command name** — `zipnative --json <cmd> …` currently reads the
  flag but `--dry-run` / `--strict` semantics are documented after the sub-command; the parser
  could accept every global flag in front as well (`llms.txt` documents the workaround).
- **veraZIP sync automation** — a check that fails when `zipnative/scripts/validate-zip.ts`
  changes upstream without the vendored copy (and its recorded commit / blob hashes) being
  re-ported.
