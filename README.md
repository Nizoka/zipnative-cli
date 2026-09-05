# zipnative-cli

[![CI](https://github.com/Nizoka/zipnative-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Nizoka/zipnative-cli/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Nizoka/zipnative-cli/actions/workflows/codeql.yml/badge.svg)](https://github.com/Nizoka/zipnative-cli/actions/workflows/codeql.yml)
[![ISO/IEC 21320-1 (veraZIP)](https://github.com/Nizoka/zipnative-cli/actions/workflows/verazip.yml/badge.svg)](https://github.com/Nizoka/zipnative-cli/actions/workflows/verazip.yml)
[![npm version](https://img.shields.io/npm/v/zipnative-cli)](https://www.npmjs.com/package/zipnative-cli)
[![npm downloads](https://img.shields.io/npm/dm/zipnative-cli)](https://www.npmjs.com/package/zipnative-cli)
[![zero extra runtime dependencies](https://img.shields.io/badge/extra%20runtime%20deps-0-brightgreen)](https://www.npmjs.com/package/zipnative-cli)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm provenance](https://img.shields.io/badge/provenance-signed-blueviolet)](https://docs.npmjs.com/generating-provenance-statements)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Nizoka/zipnative-cli/badge)](https://securityscorecards.dev/viewer/?uri=github.com/Nizoka/zipnative-cli)
<!-- After registering the project at https://www.bestpractices.dev, add the badge:
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/<ID>/badge)](https://www.bestpractices.dev/projects/<ID>) -->
[![zipnative](https://img.shields.io/npm/v/zipnative?label=zipnative&color=2563EB)](https://www.npmjs.com/package/zipnative)
[![website](https://img.shields.io/badge/zipnative.dev-2563EB)](https://zipnative.dev)

Official CLI for the [`zipnative`](https://github.com/Nizoka/zipnative) engine — create deterministic ZIP archives, list and inspect without extracting, extract with secure-by-default guards, verify integrity in one call, read unseekable streams, and modify archives without recompression, directly from the terminal. Zero extra runtime dependencies. Offline, always.

> **What's new in v1.0.0** — first release, built on **zipnative 1.0.0**. **15 commands** in four
> groups: `create` / `modify` (deterministic writer, worker-parallel deflate, append-only or
> `--compact` edits), `list` / `inspect` / `cat` / `extract` / `stream` (random access, forensic
> report with `--check` assertions, zip-slip / bomb / symlink / duplicate guards on by default,
> forward-only reader for pipes), `verify` / `crc32` / `inflate` (one-call deep verification, the
> ZIP checksum, a bounded raw-DEFLATE decoder), and `batch` / `doctor` / `schema` / `completion` /
> `govern` (manifest pipelines, environment preflight, JSON Schemas and a capability manifest,
> four shells, the AI-governance contract). A global **`--json`** envelope carries a stable
> **`E_*`** class **and** zipnative's frozen **`ZIP_*`** code verbatim; **`--dry-run`**,
> **`--summary`** / **`--fields`**, **`--strict`**, eight **`--max-*`** security bounds and
> **`--max-input-size`** complete the agent contract. Every archive the CLI writes is validated against
> **ISO/IEC 21320-1:2015** in CI (the veraZIP gate). **Node ≥ 22**.
> See [release notes](release-notes/v1.0.0.md) and [AGENTS.md](AGENTS.md).
>
> ⭐ Star [`zipnative`](https://github.com/Nizoka/zipnative) — the zero-dependency ZIP engine that powers this CLI.

## Highlights

- **`create`** — build an archive from files, directories, stdin or a JSON manifest through
  zipnative's deterministic writer: canonical entry order, DOS-epoch timestamps and UTF-8 names
  by default, **`--deterministic`** to pin the pure-TS encoder (identical SHA-256 on every
  runtime), **`--stream`** for a constant-memory writer (streamed inputs, data-descriptor layout),
  **`--parallel`** to fan deflate out across a worker pool (`zipnative/worker`), `--include` /
  `--exclude` globs, `--order insertion` (argv order — an EPUB `mimetype` first), `--store-ext`,
  `--preserve-mode`, archive and per-entry comments (`--comment-file` for raw bytes), and a
  `--dry-run` plan. An existing output file is refused without `--overwrite`.
- **`list` / `inspect`** — list entries without decompressing anything (`text` | `json` |
  `ndjson`, `--long` for flags, offsets and extra fields), or open the archive **eagerly** for a
  forensic report — per-method statistics, a determinism verdict, every engine diagnostic — and
  turn it into a CI gate with repeatable **`--check`** assertions (`deterministic`,
  `no-encryption`, `no-symlinks`, `max-ratio=N`, `has=<name>`, …; exit 1 / `E_CHECK_FAILED`).
- **`extract`** — secure by default. The engine sanitises every path; the CLI is the filesystem
  sink and re-proves containment under `--output-dir` — lexically and physically (`realpath`)
  — before writing a byte, and opens every file exclusively. Zip-slip, Windows device names,
  symlink entries, overlapping entries, central-directory / local-header disagreement,
  duplicate output paths and decompression bombs are **refused**, each with its `ZIP_*` code.
  Opt-outs are skip-not-write (`--skip-unsafe`, `--skip-symlinks`, `--skip-unsupported`;
  `--allow-symlinks` writes the link *target text* as a plain file — a symlink is never
  materialised). Existing files are never overwritten without `--overwrite`.
- **`cat`** — stream one or more entries to stdout (or `--output`) by random access: a single
  file from a multi-gigabyte archive never materialises the rest. `--raw` emits the compressed
  payload zero-copy.
- **`stream`** — a forward-only reader for **unseekable** input (stdin, a pipe, an upload body):
  list, extract or `--cat` entries as they arrive, with the engine's trust caveat made explicit
  (`trust: "local-headers-only"` in every JSON output — there is no central directory to
  cross-check).
- **`verify`** — one-call deep integrity verification via zipnative's `verifyZip`: eager
  structural validation, per-entry CRC-32 / size / local-header agreement, diagnostics collected.
  The report is always the artefact; the exit code is the verdict (`E_VERIFY_FAILED`, with
  `zipCode` set for structural refusals). Encrypted entries are honestly reported as *skipped*,
  never faked as verified. `--strict` also fails on any diagnostic.
- **`modify`** — add, replace, remove, rename entries or set the comment **without
  recompressing untouched entries**. Every untouched entry is **verified** (CRC-32, sizes,
  local header) before it is re-emitted verbatim — a lying record is refused, never laundered.
  The default save is append-only (original bytes verbatim); **`--compact`** rewrites
  canonically so removed content is truly gone. `--in-place` writes back through an
  exclusively created temp file + atomic rename.
- **`crc32` / `inflate`** — the ZIP checksum of files or stdin in constant memory (`--expect`
  turns it into a check, `--seed` continues a running value), and a raw-DEFLATE decoder with a
  **mandatory output bound** driven by zipnative's resumable inflater (`--method <id>` for
  codecs loaded with `--codec`).
- **`batch`** — archive every subdirectory of a folder (the full `create` command per
  directory, bounded concurrency), verify every `*.zip` in a folder, or run a declarative
  **`--manifest`** pipeline (`create` → `verify` → `extract` → …) with `@<id>` output references
  and a codec-load policy (`--allow-codec-load`). Under `--json` stdout is **one** batch
  document with every task's captured report inside.
- **`doctor`** — an offline capability preflight: CLI / Node / zipnative versions (package vs
  the engine's `VERSION` export), the active deflate tier (`node-zlib` expected, `pure` under
  `--pure-codecs`), the pinned tier used by `--deterministic`, platform streaming codecs,
  worker-thread availability for `create --parallel`, registered codecs, the **effective
  security limits** (as numbers under `data`, `--max-input-size` included), and the command
  count. Text or `--format json`; exit 0/1.
- **`schema`** — 22 versioned subjects: JSON Schemas (Draft 2020-12) for every input and output shape, the `errors` registry
  plus the machine-readable **capability manifest** (`schema manifest`) and
  [`llms.txt`](llms.txt), so agents can self-validate and discover the tool at runtime.
- **`completion`** — `bash`, `zsh`, `fish` or `powershell` completion scripts, generated from the
  same command table that feeds the manifest.
- **`govern`** — zipnative's AI-governance / Human-in-the-Loop contract: `govern rules`,
  `govern policy`, and `govern verify-issue <draft.md>` to gate an issue/PR draft (exit 1 /
  `E_POLICY`) before a **human** reviews and submits it.
- **Agent-native** — a global `--json` status/error envelope, 13 stable `E_*` classes, the exact
  `ZIP_*` cause carried verbatim as `error.zipCode` (39 frozen codes, plus 11 diagnostic codes),
  `--dry-run` on seven commands, `--strict`, and token-economy levers (**`--summary`**,
  **`--fields a,b.c`**, compact JSON under `--json`). See [AGENTS.md](AGENTS.md).
- **Bounded by default** — the engine's eight CWE-tagged `ZipLimits` are exposed as
  `--max-entries`, `--max-entry-size`, `--max-total-size`, `--max-ratio`, `--max-name-bytes`,
  `--max-extra-bytes`, `--max-comment-bytes` and `--max-cd-bytes`; the CLI adds
  `--max-input-size` (4 GiB) on every buffered read (`none` disables a bound, with a visible
  warning).
- **`.zipnativerc.json`** — optional config file for default flags (global + per-command);
  precedence is CLI flags > config > built-in. `codec` is refused from config files.
- **Zero extra dependencies** — `zipnative` is the sole runtime dependency; all ZIP logic lives
  there. No ZIP parsing in the CLI.
- **Offline, always** — no command can open a socket. There is no network opt-in to forget.
- **Stdin / stdout by default** — every command is shell-pipeline friendly.
- **TypeScript strict, ESM source** — bundled by tsup into one CommonJS bin (`dist/cli.cjs`).
  The package is a command-line tool only: no programmatic entry point, no type declarations.
- **npm provenance** — Trusted Publishing (OIDC) with provenance attestations and a CycloneDX
  SBOM per release.

## Supported Features

| Feature | Status | Notes |
|---------|--------|-------|
| **Commands** | | |
| `create` deterministic archives | ✅ | Files, directories, stdin, `--from-manifest`; `--method`, `--level`, `--deterministic`, `--order canonical\|insertion`, `--date` (UTC), `--stream`, `--parallel`, `--include`/`--exclude`, `--store-ext`, `--preserve-mode`, `--dir-entries`, `--comment` / `--comment-file`, `--overwrite` |
| `modify` incremental edits | ✅ | `--add`, `--add-dir`, `--replace`, `--remove`, `--rename`, `--comment` / `--comment-file`, `--from-manifest`; every untouched entry verified before re-emission; append-only `save()` or `--compact`; `--in-place`, `--overwrite` |
| `list` entries | ✅ | `text` \| `json` \| `ndjson`, `--long` (with `rawNameHex` / `commentHex`), `--validate eager`, globs, `--summary` / `--fields` |
| `inspect` forensic report | ✅ | Eager open, stats, determinism verdict (`deterministic` = reproducibility, `canonicalLayout` = form), diagnostics, `--entries` / `--entry` / `--extra`, 20 `--check` assertions |
| `cat` entries to stdout | ✅ | Random access, `--raw` (compressed payload), `--no-verify-crc`, `--output` (+ `--overwrite`) |
| `extract` to a directory | ✅ | Guards on by default; `--skip-unsafe`, `--skip-unsupported`, `--allow-symlinks`, `--skip-symlinks`, `--on-duplicate`, `--overwrite`, `--flat`, `--buffered`, `--preserve-mode`, `--preserve-mtime` |
| `stream` forward-only reader | ✅ | stdin/pipes; `--list` (default), `--output-dir`, `--cat`; `trust: "local-headers-only"`; `--skip-unsafe`, `--skip-unsupported` |
| `verify` deep integrity | ✅ | `verifyZip` report + `failed` / `skipped` / `strict`; `--entry` verifies selected entries; exit 1 / `E_VERIFY_FAILED` |
| `crc32` checksum | ✅ | Files or stdin, 64 KiB chunks; `--seed`, `--expect` (exit 1 / `E_CHECK_FAILED`) |
| `inflate` raw DEFLATE | ✅ | Resumable inflater, mandatory `--max-output`, `--sync`, `--method <id>` for registered codecs; envelope reports `bytesConsumed` / `leftover`; `--overwrite` |
| `batch` orchestration | ✅ | Directory mode (`--task create` \| `verify`, `--concurrency` 1–64, `--fail-fast`, `--overwrite`) or `--manifest` pipelines (10 whitelisted manifest commands); one JSON document on stdout under `--json` |
| `doctor` preflight | ✅ | Versions, deflate tiers, web streams, workers, codecs, effective limits (numbers under `data`), command count; text or `--json` |
| `schema` JSON Schema export | ✅ | 22 subjects incl. `errors`, `limits`, `diagnostics`, `status`, `error` and the capability `manifest` |
| `completion` shell scripts | ✅ | `bash` / `zsh` / `fish` / `powershell` |
| `govern` AI-governance / HITL | ✅ | `rules` / `policy` / `verify-issue`; gates drafts with `E_POLICY` |
| `.zipnativerc.json` config file | ✅ | Global + per-command defaults; flags > config; `codec` refused from config |
| **Agent & automation** | | |
| Global `--json` envelope | ✅ | Status on success, `{ ok: false, command, error: { code, message, zipCode?, entryName?, detail?, remedy? } }` on failure — `remedy` names the flag that lifts the refusal |
| Stable error classes | ✅ | 13 `E_*` codes — `E_USAGE`, `E_INPUT`, `E_PARSE`, `E_IO`, `E_SECURITY`, `E_DATA`, `E_LIMIT`, `E_UNSUPPORTED`, `E_NOT_FOUND`, `E_VERIFY_FAILED`, `E_CHECK_FAILED`, `E_POLICY`, `E_RUNTIME` |
| Exact cause | ✅ | `error.zipCode` = zipnative's frozen `ZIP_*` code, verbatim (39 codes; `schema errors` prints the mapping) |
| Diagnostics channel | ✅ | 11 `ZIP_*` diagnostic codes: text on stderr, arrays under `--json`, `--strict` escalates the first into `E_CHECK_FAILED` |
| Capability manifest | ✅ | `schema manifest` (JSON) + `llms.txt` — for agent tool discovery |
| `--dry-run` validation | ✅ | `create` / `extract` / `modify` / `stream` / `cat` / `inflate` / `batch` |
| Token economy | ✅ | `--summary`, `--fields a,b.c`, compact JSON under `--json` (`--pretty` opts out) on `list` / `inspect` / `verify` / `stream` / `batch` |
| **Security defaults** (engine guards, CLI switch) | | |
| Zip-slip traversal, absolute paths, drive/UNC, NUL, NTFS ADS, Windows device names | ✅ | CWE-22 / CWE-67 — `ZIP_PATH_TRAVERSAL`; refused by default, `extract --skip-unsafe` skips (nothing unsafe is ever written) |
| Decompression bombs (per-entry, total, ratio, entry flood) | ✅ | CWE-400 / CWE-409 — `ZIP_LIMIT_EXCEEDED`; `--max-entry-size`, `--max-total-size`, `--max-ratio`, `--max-entries` |
| Symlink entries | ✅ | CWE-59 — `ZIP_SYMLINK_REJECTED`; `extract --allow-symlinks` (target text as a regular file) or `--skip-symlinks` |
| Overlapping entries | ✅ | CWE-405 — `ZIP_ENTRY_OVERLAP`; no opt-out |
| Central-directory / local-header disagreement | ✅ | CWE-436 — `ZIP_CD_LFH_MISMATCH`; no opt-out (name divergence is the `ZIP_NAME_MISMATCH` diagnostic) |
| Zip64 sentinel spoofing | ✅ | CWE-1288 — `ZIP_ZIP64_CONTRADICTION`; no opt-out |
| Duplicate output paths | ✅ | CWE-694 — `ZIP_EXTRACT_DUPLICATE_PATH`; `--on-duplicate error\|first\|last` |
| Ambiguous EOCD / trailing garbage | ✅ | `ZIP_EOCD_NOT_FOUND` — refused, never guessed |
| Integer overflow (> 2^53) | ✅ | CWE-190 — `ZIP_VALUE_UNREPRESENTABLE` |
| Sink containment (CLI) | ✅ | `safeJoin(root, path)` re-proves every destination stays under `--output-dir` lexically, then the nearest existing ancestor is `realpath`-checked under the root's `realpath` before any `mkdir` (a planted symlink / junction is `E_SECURITY`); files are opened exclusively (`wx`); case-fold collisions refused on win32/darwin |
| Existing files | ✅ | Never overwritten without `--overwrite` (`E_IO`) — uniform on `create` / `modify` / `cat` / `inflate --output`, `extract`, `stream --output-dir` and `batch` |
| Buffered input bound (CLI) | ✅ | CWE-400 — `--max-input-size` (4 GiB) caps every archive or payload read into memory; `E_LIMIT` with `detail.limit = "maxInputSize"` |
| **Determinism** | | |
| Canonical entry order, DOS-epoch timestamps, UTF-8 names | ✅ | The engine's defaults — structurally reproducible everywhere |
| Cross-runtime byte identity | ✅ | `--deterministic` pins the pure-TS encoder (`tier: "pure-pinned"`); default tier is byte-stable per environment |
| Parallel identity | ✅ | `create --parallel` is byte-identical to the sequential writer (per tier; unconditional with `--deterministic`); `create --stream` yields the same content in the data-descriptor layout (not the same bytes) |
| Determinism verdict | ✅ | `inspect` reports `determinism.{epochTimestamps, canonicalOrder, utf8Flags, noDataDescriptors, canonicalLayout, deterministic}` — `deterministic` is reproducibility (epoch + canonical order + UTF-8 flags), `canonicalLayout` is the buffered layout (a `--stream` archive is reproducible but not canonical); `--check deterministic` / `--check canonical-layout` gate them |
| **Not supported** | | |
| Encryption (read or write) | ❌ | Policy of the engine in 1.x (ZipCrypto is broken); encrypted entries are detected, listed and refused with `ZIP_UNSUPPORTED_ENCRYPTION` |
| Other archive formats / exotic codecs | ❌ | No 7z, RAR, tar, gzip; the codec registry (`--codec`) is the extension point — a registered method is readable everywhere and, for methods 0/8, also drives the writer |
| Multi-disk / spanned archives | ❌ | Detected and refused (`ZIP_UNSUPPORTED_MULTI_DISK`) |
| Archive repair / salvage | ❌ | Structural problems are reported (`verify`), never guessed at |
| Streamed entries > 4 GiB | ❌ | `create --stream` refuses them (`ZIP_UNSUPPORTED_ZIP64_STREAMING`); buffered entries are fully Zip64 |
| Network access | ❌ | None, in any mode |

**Note:** everything listed works today. Planned work is tracked in [ROADMAP.md](ROADMAP.md).

### Conformance status (v1.0.0)

ZIP has no veraPDF, so the CLI ships its own gate — **veraZIP**: an ISO/IEC 21320-1:2015
(Document Container File) validator vendored from the engine
(`zipnative/scripts/validate-zip.ts`, commit `4f1bc36`) that **raw-parses the bytes with its own
EOCD / central-directory / local-header reader and never imports `zipnative`** — a validator that
shared the engine's parser would attest the engine with the engine. `npm run validate:zip` builds
the CLI, drives the **built binary** to write a **37-archive corpus** (33 conformant archives —
30 across every writer path: buffered, `--stream`, `--parallel`, `--deterministic`, `--order
insertion`, manifest extra fields, binary comments, `modify` append-only and `--compact` — plus
**4 raw-crafted negative canaries** the validator must reject with a declared clause id), then
validates every file clause by clause. Three of the conformant archives are
**hostile-but-conformant** (zip-slip, a Windows device name, duplicate paths): the ISO profile
constrains the container, not the meaning of names, so they PASS the validator and `extract`
**must refuse** them — the gate checks both (`33 PASS, 4 XFAIL, 0 FAIL`). Level 0 (the ISO clauses)
needs no external tool and always runs; level 1 re-tests every conformant archive with the
foreign integrity tools present on the machine (`unzip -t`, `7z t`, `python -m zipfile -t`,
`tar -tf`, `jar tf`) and **skips** the absent ones visibly; `VERAZIP_REQUIRED=1` (set in CI)
fails closed. Blocking in [`verazip.yml`](.github/workflows/verazip.yml) on Linux and Windows on
every pull request (no path filter) and again before every publish. See [CONTRIBUTING.md](CONTRIBUTING.md#conformance-validation-verazip).
Not a certification — validation evidence against a specific validator revision, and
**conformant does not mean safe**.

## Installation

```bash
npm install --global zipnative-cli
```

Or run without installing:

```bash
npx zipnative-cli create src/ --output src.zip
```

**Requirements:** Node.js ≥ 22 (CI runs 22 and 24 on Ubuntu and Windows, 22 on macOS). The
package ships one CommonJS bin (`dist/cli.cjs`) plus `README.md`, `AGENTS.md`, `llms.txt` and
`docs/data/errors.json` — it is a command-line tool, not a library.

## Documentation

- 📘 **[Quick Start](#quick-start)** (below) — Create, inspect and extract in 5 minutes
- 🏛️ **[KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md)** — Full CLI reference, architecture, the 77-export API mapping, integration patterns
- 🤖 **[AGENTS.md](AGENTS.md)** — The agent contract: envelopes, codes, token economy, the recommended loop
- 📚 **[samples/README.md](samples/README.md)** — runnable `.sh` + `.ps1` samples per command
- 🔧 **[zipnative engine](https://github.com/Nizoka/zipnative)** — the underlying ZIP engine docs
- ❓ **[FAQ](docs/KNOWLEDGE_BASE.md#12-frequently-asked-questions)** — Common questions & troubleshooting

## Quick Start

### Create an archive

```bash
# A directory (entry names relative to its parent: src/a.ts, src/b/c.ts)
zipnative create src/ --output src.zip

# Several inputs, a prefix, globs, explicit directory entries
zipnative create src/ docs/ --prefix release/ --exclude '*.map' --dir-entries -o release.zip

# From stdin, as one named entry
tar -cf - build/ | zipnative create --stdin-name build.tar -o build.zip

# From a JSON manifest (schema: `zipnative schema create-manifest`)
zipnative create --from-manifest entries.json -o out.zip

# Constant memory (streamed inputs, data-descriptor layout) / worker-parallel deflate
zipnative create data/ --stream -o data.zip
zipnative create data/ --parallel --workers 4 -o data.zip

# Plan only: walk inputs, validate names, write nothing
zipnative create src/ -o src.zip --dry-run
```

### Reproducible builds

```bash
# Pin the pure-TS encoder: identical SHA-256 on every runtime, every day
zipnative create dist/ --deterministic -o a.zip
zipnative create dist/ --deterministic -o b.zip
sha256sum a.zip b.zip          # identical

# Prove it from the archive itself (exit 1 / E_CHECK_FAILED otherwise)
zipnative inspect --input a.zip --check deterministic,canonical-layout
```

Without `--deterministic` the bytes are stable per environment (same Node + zlib build) but may
differ across zlib builds; timestamps default to the DOS epoch and entries are sorted by raw name
bytes either way.

**Dates.** `--date <ISO 8601>` (and a manifest `date`) is **UTC wall-clock**: a string without a
zone designator is read as UTC, a date-only string gets `T00:00:00Z`, and the stored DOS fields
are identical on every host whatever its `TZ`. DOS time has a 2-second resolution (odd seconds
are floored, with a warning) and a 1980–2107 range (a warning outside it). `--date now` and
`--mtime` use local time and are **not** reproducible. `inspect` separates the two verdicts:
`determinism.deterministic` (epoch timestamps + canonical order + UTF-8 flags — run-to-run
reproducibility) and `determinism.canonicalLayout` (no data descriptors — the buffered layout).
A `create --stream` archive is reproducible but not canonical.

### List and inspect

```bash
# unzip -l style table
zipnative list a.zip
zipnative list a.zip --long             # mode, flags, offsets, extra fields

# JSON / NDJSON for pipelines and agents
zipnative list --input a.zip --format json --summary
zipnative list --input a.zip --format ndjson | jq -r 'select(.isEncrypted) | .name'

# Forensic report (eager open: every local header cross-checked) + CI assertions
zipnative inspect --input a.zip
zipnative inspect --input a.zip --entries --extra --format json
zipnative inspect --input a.zip --check no-encryption,no-symlinks,max-ratio=100,has=manifest.json
```

Example `inspect --format json --summary` output:

```json
{ "entries": 12, "bytes": 48213, "uncompressedSize": 131072, "zip64": false, "encrypted": 0, "deterministic": true, "canonicalLayout": true, "diagnostics": 0, "checksPassed": true }
```

### Extract safely

```bash
# Guards on by default: zip-slip, device names, symlinks, duplicates, bombs, overlaps are refused
zipnative extract --input a.zip --output-dir out/

# Plan first (nothing written), then extract only what you need
zipnative extract --input a.zip -d out/ --dry-run
zipnative extract --input a.zip -d out/ --include 'docs/**' --exclude '*.png'

# Hostile archive: skip the unsafe names instead of failing (nothing unsafe is ever written);
# --skip-unsupported also skips encrypted / unknown-method entries
zipnative extract --input untrusted.zip -d out/ --skip-unsafe --skip-symlinks --skip-unsupported

# Tighter bounds for untrusted input
zipnative extract --input upload.zip -d out/ --max-total-size 512m --max-ratio 50 --max-entries 5000
```

### Read entries and stream from a pipe

```bash
# One entry to stdout, CRC verified at the end of the stream (like `unzip -p`)
zipnative cat a.zip README.md
zipnative cat --input a.zip --entry docs/a.md --entry docs/b.md --output merged.md

# Unseekable input: list as entries arrive, or extract / cat from the pipe
curl -sL https://example.com/pkg.zip | zipnative stream --list
curl -sL https://example.com/pkg.zip | zipnative stream --output-dir out/ --skip-unsafe
cat a.zip | zipnative stream --cat manifest.json
```

`stream` parses local headers alone — every JSON output carries `trust: "local-headers-only"`.
Prefer `list` / `extract` whenever the whole file is available.

### Verify integrity

```bash
zipnative verify --input a.zip                  # text verdict, exit 0/1
zipnative verify --input a.zip --strict          # also fail on any diagnostic
zipnative verify --input a.zip --json --summary  # {"ok":true,"entries":12,"failed":0,"skipped":0,"diagnostics":0}
zipnative verify --input a.zip -e docs/a.md      # only the named entries (after the structural check)
```

### Modify without recompressing

```bash
# Append-only save: untouched entries are verified (CRC, sizes, local header) and copied
# verbatim — never recompressed
zipnative modify --input a.zip --output b.zip --replace docs/index.md=new.md --add CHANGELOG.md

# Removed / replaced content stays recoverable after an append-only save (and 7-Zip's CLI
# mis-reads that layout) — pass --compact for a canonical rewrite, still no recompression
zipnative modify --input a.zip -o b.zip --remove secrets.txt --compact

# In place (temp file + rename), from a JSON edit list
zipnative modify --input a.zip --in-place --from-manifest edits.json
```

### Checksums and raw DEFLATE

```bash
zipnative crc32 file.bin                         # "<crc>  <bytes>  <file>"
zipnative crc32 file.bin --expect 1a2b3c4d        # exit 1 / E_CHECK_FAILED on mismatch
zipnative cat a.zip big.bin | zipnative crc32     # cross-check an entry against `list`

zipnative inflate --input payload.deflate --output payload.bin --max-output 64m
zipnative cat a.zip big.bin --raw | zipnative inflate > big.bin   # deflate entry only: a stored entry's --raw payload is already the plain bytes
```

### Batch and pipelines

```bash
# Every subdirectory of projects/ → archives/<name>.zip (all create flags honoured)
zipnative batch --input-dir projects/ --output-dir archives/ --deterministic --concurrency 8

# Verify every *.zip in a folder
zipnative batch --input-dir archives/ --task verify --json --summary

# Declarative pipeline with @id references (schema: `zipnative schema batch-manifest`)
zipnative batch --manifest tasks.json --dry-run
zipnative batch --manifest tasks.json --json     # ONE JSON document on stdout, task reports inside
```

### AI-governance / Human-in-the-Loop

Agents act as **draftsmen**: they may draft an issue/PR locally, but a **human** must review and
submit it. Nothing here touches the network.

```bash
zipnative govern rules
zipnative govern policy --pretty
zipnative govern verify-issue ./draft.md        # exit 1 / E_POLICY on a violation
```

## Examples

Ready-to-run examples are in [`samples/`](samples/), one directory per command — 41 demos,
each shipped as a Bash (`.sh`) **and** a PowerShell (`.ps1`) pair, plus a dependency-free runner
that replays them as 73 jobs:

| Category | Description |
|----------|-------------|
| [`create/`](samples/create/) | Directory, store vs deflate, deterministic + SHA-256 twice, manifest, stdin `--stream`, `--parallel`, comments + `--order insertion` + `--date` |
| [`modify/`](samples/modify/) | Replace / add / remove / rename, append-only vs `--compact`, `--in-place`, edits manifest |
| [`list/`](samples/list/) | Text, `--long`, JSON, NDJSON, `--summary` / `--fields` |
| [`inspect/`](samples/inspect/) | Forensic report, `--entries --extra`, `--check` gates |
| [`cat/`](samples/cat/) | Single / multiple entries, `--raw`, `--output` |
| [`extract/`](samples/extract/) | Safe defaults, `--dry-run`, globs, `--skip-unsafe`, tightened `--max-*` bounds |
| [`stream/`](samples/stream/) | Pipe listing, pipe extraction, `--cat`, the trust caveat |
| [`verify/`](samples/verify/) | Verdicts, `--strict`, `--json --summary` |
| [`crc32/`](samples/crc32/) | Files, stdin, `--expect`, `--seed` |
| [`inflate/`](samples/inflate/) | Raw DEFLATE from `cat --raw`, `--max-output`, `--sync` |
| [`batch/`](samples/batch/) | Directory mode (create / verify) and a `--manifest` pipeline |
| [`doctor/`](samples/doctor/) | Environment preflight, text and JSON |
| [`schema/`](samples/schema/) | Subjects, the capability manifest |
| [`completion/`](samples/completion/) | Install scripts for the four shells |
| [`config/`](samples/config/) | `.zipnativerc.json` defaults, `--config`, `--no-config`, flag precedence |
| [`govern/`](samples/govern/) | Rules, policy, `verify-issue` on a passing and a failing draft |
| [`agent/`](samples/agent/) | `--json` envelopes, `--dry-run`, deterministic error codes, token economy (`--summary` / `--fields`) |

**Run all samples at once:**

```bash
node samples/run-all.js
```

See [`samples/README.md`](samples/README.md) for descriptions and integration patterns (GitHub Actions, Docker, TypeScript).

---

## Command Reference

The 15 commands are grouped by purpose (the global `zipnative --help` shows the same grouping):

| Group | Commands |
|-------|----------|
| **Create & modify** | [`create`](#zipnative-create), [`modify`](#zipnative-modify) |
| **Read & extract** | [`list`](#zipnative-list), [`inspect`](#zipnative-inspect), [`cat`](#zipnative-cat), [`extract`](#zipnative-extract), [`stream`](#zipnative-stream) |
| **Integrity & codecs** | [`verify`](#zipnative-verify), [`crc32`](#zipnative-crc32), [`inflate`](#zipnative-inflate) |
| **Automation & meta** | [`batch`](#zipnative-batch), [`doctor`](#zipnative-doctor), [`schema`](#zipnative-schema), [`completion`](#zipnative-completion), [`govern`](#zipnative-govern) |

### `zipnative create`

```bash
zipnative create [<path>...] --output <out.zip> [options]
zipnative create --from-manifest <entries.json> -o <out.zip>
cat file | zipnative create --stdin-name <name> -o <out.zip>
```

| Flag | Default | Description |
|------|---------|-------------|
| `<path>...` | — | Files and directories (directories are walked recursively, sorted by name) |
| `--input <path>`, `-i` _(repeatable)_ | — | Same as a positional (useful in manifests) |
| `--stdin-name <name>` | — | Read stdin as one entry named `<name>` |
| `--from-manifest <file>` | — | JSON manifest `{ comment\|commentBase64, order, date, compression, entries: [{ name, path\|data\|dataBase64\|directory, method, level, date, comment, mode, extraFields: [{ id, hex\|base64 }] }] }` — see `zipnative schema create-manifest`; entries are emitted in array order under `order: "insertion"`; mutually exclusive with paths / `--stdin-name` |
| `--output <file>`, `-o` | stdout | Output path |
| `--overwrite` | false | Replace an existing output file (default: refuse, `E_IO`, the file is left intact) |
| `--base <dir>` | each input's parent directory | Entry names are relative to `<dir>` |
| `--prefix <dir/>` | — | Prepend `<dir/>` to every entry name |
| `--dir-entries` | false | Emit explicit directory entries (keeps empty directories) |
| `--include <glob>` _(repeatable)_ | — | Keep only matching names (`*`, `**`, `?`, `[abc]`; a pattern without `/` matches at any depth) |
| `--exclude <glob>` _(repeatable)_ | — | Drop matching names |
| `--follow-symlinks` | false | Dereference symlinks (default: skipped with a warning; symlink entries are never written) |
| `--method store\|deflate` | `deflate` | Compression method |
| `--level 0-9` | `6` | Deflate level |
| `--deterministic` | false | Pin the pure-TS encoder: identical SHA-256 on every runtime |
| `--order canonical\|insertion` | `canonical` | Entry order: `canonical` sorts by raw-name bytes; `insertion` keeps the **argv order** (each directory still walks name-sorted; a manifest keeps its `entries` order) — e.g. `zipnative create book/mimetype book/META-INF book/OEBPS --base book --order insertion -o book.epub` puts an EPUB `mimetype` first (`--base` rebases the names; inputs are still looked up where they are) |
| `--date epoch\|now\|<ISO 8601>` | `epoch` | Timestamp for entries. `epoch` = DOS epoch 1980-01-01 (reproducible); an ISO date is **UTC wall-clock** (no zone designator → UTC; 2-second resolution, 1980–2107); `now` is local time and non-reproducible (`ZIP_TIMESTAMP_NOT_PINNED`) |
| `--mtime` | false | Use each file's modification time (local, non-reproducible) |
| `--comment <text>` | — | Archive comment |
| `--comment-file <path>` | — | Archive comment from a file, raw bytes (`-` = stdin; exclusive with `--comment`; at most 65535 bytes, `E_INPUT` beyond) |
| `--entry-comment <name>=<text>` _(repeatable)_ | — | Per-entry comment |
| `--preserve-mode` | false | Store POSIX mode bits (never setuid/setgid/sticky; no effect on Windows) |
| `--store-ext png,jpg,zip` | — | Store (no deflate) entries with these extensions |
| `--stream` | false | Constant-memory writer: file inputs are streamed (data-descriptor layout — same content as the buffered layout, not the same bytes); entries > 4 GiB are refused (`ZIP_UNSUPPORTED_ZIP64_STREAMING`) |
| `--chunk-size <size>` | `65536` | Output chunk size for the chunked writer (`--stream` or `--stdin-name`; refused otherwise; a warning outside 1 KiB–16 MiB) |
| `--parallel` | false | Deflate across a worker pool (`zipnative/worker`); byte-identical to the sequential writer per tier. Refused (exit 2) with a `--codec` module that registers method 0/8, or a `deflateImpl` without `--deterministic` — the workers never see the module |
| `--workers <n>` | cores − 1, max 8 | Worker count (`0` = main thread); requires `--parallel` |
| `--min-job-size <size>` | `32k` | Minimum entry size dispatched to a worker; requires `--parallel` |
| `--job-timeout <ms>` | `60000` | Per-job cap before inline fallback; requires `--parallel` |
| `--dry-run` | false | Walk inputs, validate names, print the plan; write nothing |

`--parallel` resolves `node:zlib` inside its worker bundle, so `--pure-codecs` cannot govern it —
combining the two requires `--deterministic` (exit 2 otherwise). Every entry name is pre-checked
with the engine's `sanitizeEntryPath()`: a name that could not be extracted safely (reserved
device name, traversal, empty segment) is refused at creation time (`E_INPUT`, with
`entryName`). Any streamed input (`--stream`, `--stdin-name`) uses the data-descriptor layout:
same content as the buffered writer, different bytes; `--stream --deterministic` buffers one
entry at a time (the pinned encoder is whole-buffer). Argv paths (`../src`, `-o ../out.zip`)
are ordinary shell paths; only `path` values inside a manifest are refused on `..`.

Status envelope (`--json`): `{ ok, command, output, entries, files, directories, bytes, bytesIn,
method, level, deterministic, tier, order, stream, layout: "buffered" | "data-descriptor",
parallel, skipped, diagnostics }`.

### `zipnative modify`

```bash
zipnative modify --input <a.zip> --output <b.zip> [edits] [--compact]
zipnative modify --input <a.zip> --in-place [edits]
zipnative modify --input <a.zip> -o <b.zip> --from-manifest <edits.json>
```

Edits are applied in a **fixed order** regardless of argv order: `remove` → `rename` → `replace`
→ `add` / `add-dir` → `comment`.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | — **(required)** | Source archive (a positional path also works). Opened **eagerly**: overlap and CD ↔ local-header structure are checked before any edit |
| `--output <file>`, `-o` | stdout | Output path |
| `--overwrite` | false | Replace an existing `--output` file (default: refuse, `E_IO`) |
| `--in-place` | false | Write back to the input path through an exclusively created temp file (`<input>.tmp-<pid>-<12 hex>`) + atomic rename; mutually exclusive with `--output`, requires a file input |
| `--remove <name>` _(repeatable)_ | — | Remove an entry |
| `--rename <from>=<to>` _(repeatable)_ | — | Rename an entry (never overwrites implicitly) |
| `--replace <name>=<path>` _(repeatable)_ | — | Replace an entry's content (path `-` = stdin) |
| `--add <name>=<path>` _(repeatable)_ | — | Add a new entry (a bare `<path>` uses its basename). A name ending in `/` with a payload is `E_INPUT` — use `--add-dir` |
| `--add-dir <name>` _(repeatable)_ | — | Add an explicit directory entry |
| `--comment <text>` | — | Set the archive comment (`""` clears it) |
| `--comment-file <path>` | — | Set the archive comment from a file, raw bytes (`-` = stdin; exclusive with `--comment`; at most 65535 bytes) |
| `--from-manifest <file>` | — | JSON edits `{ comment\|commentBase64, edits: [{ op, name, to, path\|data\|dataBase64, method, level, date, comment, mode, extraFields }] }` — see `zipnative schema modify-manifest`; mutually exclusive with the edit flags |
| `--method` / `--level` / `--deterministic` | engine defaults | Compression for **new** payloads |
| `--date epoch\|now\|<ISO>` | `epoch` | Timestamp for new payloads (an ISO date is UTC wall-clock, as in `create`) |
| `--compact` | false | Canonical rewrite (`saveCompact`): removed data is truly gone, still no recompression |
| `--dry-run` | false | Validate edits against the archive (including the verification pass below); write nothing |

The default save is **append-only**: original bytes verbatim + appended entries + a new central
directory. Removed / replaced content **remains recoverable** (data remanence), and 7-Zip's CLI is
known to mis-read this layout — pass `--compact` when either matters (the CLI prints one `info:`
line whenever a destructive edit is saved append-only). Archives with duplicate entry names cannot
be modified incrementally (`ZIP_DUPLICATE_ENTRY_NAME`).

**Every re-emitted entry is verified.** Before `save()` / `saveCompact()`, each entry that is
copied verbatim (not removed or replaced; renamed entries are checked under their original
record) goes through `verifyEntry()`: CRC-32, sizes and local header vs central directory — one
decompress pass over the untouched entries, never a recompress. A lying record is refused
instead of laundered: local-header disagreement → `E_SECURITY` / `ZIP_CD_LFH_MISMATCH`, a CRC
lie → `E_DATA` / `ZIP_CRC_MISMATCH`, a size lie → `E_DATA` / `ZIP_SIZE_MISMATCH`, each with
`entryName`. Encrypted entries and entries whose registered codec has no `decompressSync` cannot
be verified: they are copied as-is and counted in `verifySkipped`. An entry with no registered
codec is `E_UNSUPPORTED` (load `--codec`). There is no opt-out.

Status envelope: `{ ok, command, output, bytes, edits: [{ op, name, to? }], layout:
"append-only" | "compact", changed, verified, verifySkipped, tier, diagnostics }` (a binary
comment shows as `"<N bytes>"` in `edits`).

### `zipnative list`

```bash
zipnative list --input <a.zip> [options]
zipnative list <a.zip> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | Archive path |
| `--format text\|json\|ndjson`, `-f` | `text` (`json` under `--json`) | Output format; `ndjson` is one `EntryRow` per line |
| `--long` | false | Add mode, flags, versions, offsets and extra fields (no `-l` short form) |
| `--validate lazy\|eager` | `lazy` | Cross-check every local header up front (`eager`) |
| `--include <glob>` / `--exclude <glob>` _(repeatable)_ | — | Name filters |
| `--summary` | — | `{ entries, files, directories, compressedSize, uncompressedSize, zip64, encrypted }` |
| `--fields a,b.c` | — | Dot-path projection of the JSON report |

Nothing is decompressed. JSON shape: `zipnative schema entries`. `--long` rows carry
`rawNameHex` (the name bytes, always) and `commentHex` (when the entry has a comment);
`unixMode` is four octal digits (`"0644"`, `"4755"`). The `--format json` `archive` object
carries `commentHex` whenever `commentBytes > 0` (`comment` stays the lossy UTF-8 decode).

### `zipnative inspect`

```bash
zipnative inspect --input <a.zip> [--format json|text] [--check <assert>]...
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | Archive path. Opened **eagerly**: every local header cross-checked, overlap table built up front |
| `--format text\|json`, `-f` | `text` (`json` under `--json`) | Output format |
| `--entries` | false | Include every entry (long form, with `rawNameHex` / `commentHex`) in the report |
| `--entry <name>` _(repeatable)_ | — | Include only the named entries (`E_NOT_FOUND` / `ZIP_ENTRY_NOT_FOUND` if absent) |
| `--extra` | false | Include extra-field payloads as hex |
| `--check <assert>` _(repeatable, comma-separable)_ | — | Assertion; any failure prints the report then exits 1 with `E_CHECK_FAILED` |
| `--summary` | — | `{ entries, bytes, uncompressedSize, zip64, encrypted, deterministic, canonicalLayout, diagnostics, checksPassed? }` |
| `--fields a,b.c` | — | Dot-path projection |

Assertions: `deterministic`, `epoch-timestamps`, `canonical-order`, `utf8-names`,
`no-data-descriptor` / `canonical-layout`, `no-zip64`, `zip64`, `no-encryption`, `no-symlinks`, `safe-names`
(every name passes the engine's `sanitizeEntryPath()` — the pre-extraction gate `verify` does not give), `no-duplicates`,
`no-diagnostics`, `store-only`, `deflate-only`, `max-entries=N`, `min-entries=N`,
`max-uncompressed=<size>`, `max-ratio=N`, `has=<name>`, `method=store|deflate|<id>`.
The `determinism` verdict is `{ epochTimestamps, canonicalOrder, utf8Flags, noDataDescriptors,
canonicalLayout, deterministic }` — `deterministic` (reproducibility) = epoch timestamps +
canonical order + UTF-8 flags; `canonicalLayout` (form) = no data descriptors. The text report
prints `Determinism: reproducible, layout canonical` or `… layout data-descriptor (streamed)`. JSON shape:
`zipnative schema inspect`.

### `zipnative cat`

```bash
zipnative cat --input <a.zip> --entry <name> [--entry <name>]... [-o <file>]
zipnative cat <a.zip> <name> [<name>...]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | — **(required)** | Archive path |
| `--entry <name>`, `-e` _(repeatable)_ | — **(required)** | Entry name; entries are concatenated in order |
| `--output <file>`, `-o` | stdout | Write to a file instead of stdout |
| `--overwrite` | false | Replace an existing `--output` file (default: refuse, `E_IO`) |
| `--raw` | false | Output the **compressed** payload (zero-copy), no decoding |
| `--no-verify-crc` | false | Skip the CRC-32 check at the end of the stream |
| `--dry-run` | false | Resolve the entries and report their sizes; output nothing |

The CRC is verified at the **end** of the stream (like `unzip -p`), so stdout may already carry
bytes when `E_DATA` fires; with `--output` the partial file is removed. Directory entries are
refused (`E_INPUT`); an unknown name is `E_NOT_FOUND` with `zipCode: "ZIP_ENTRY_NOT_FOUND"`. A
`--codec` method that offers `decompressSync` but no `decompressStream` is read through
`readEntry()` (that one entry is buffered).

### `zipnative extract`

```bash
zipnative extract --input <a.zip> --output-dir <dir> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | Archive path |
| `--output-dir <dir>`, `-d` | — **(required)** | Destination directory (created if missing). Every path is re-checked with `sanitizeEntryPath()` and contained under this root |
| `--include <glob>` / `--exclude <glob>` _(repeatable)_ | — | Name filters |
| `--entry <name>` _(repeatable)_ | — | Extract only the named entries |
| `--overwrite` | false | Replace existing files (default: refuse, `E_IO`) |
| `--on-duplicate error\|first\|last` | `error` | Same sanitised path twice |
| `--skip-unsafe` | false | **Skip** entries whose names cannot be made safe instead of failing (zip-slip, absolute, drive/UNC, NUL, ADS, device names). Nothing unsafe is ever written |
| `--skip-unsupported` | false | **Skip** encrypted entries and methods with no registered codec (reason `unsupported`) instead of failing |
| `--allow-symlinks` | false | Write a symlink entry's **target text** as a regular file (a symlink is never materialised). Default: refuse |
| `--skip-symlinks` | false | Drop symlink entries silently |
| `--flat` | false | Drop directories, write basenames only |
| `--buffered` | false | Use the in-memory extractor (many tiny entries) |
| `--preserve-mode` | false | Apply POSIX mode bits (never setuid/setgid/sticky; no effect on Windows) |
| `--preserve-mtime` | false | Apply the entry timestamp to each file |
| `--dry-run` | false | Plan and validate; write nothing |

Refusals (`E_SECURITY` + `zipCode`): `ZIP_PATH_TRAVERSAL`, `ZIP_SYMLINK_REJECTED`,
`ZIP_EXTRACT_DUPLICATE_PATH`, `ZIP_ENTRY_OVERLAP`, `ZIP_CD_LFH_MISMATCH`. Bounds (`E_LIMIT`):
`--max-entry-size`, `--max-total-size`, `--max-ratio`, `--max-entries`, … Extraction is
two-phase: the plan is drained without decompressing anything and every destination is proven
to stay under the root **lexically** (`safeJoin`); then, per file, the nearest existing ancestor
of the target directory is `realpath`-checked under the root's `realpath` **before** `mkdir -p`
and re-checked after (a symlink or junction planted inside the destination that points outside
is `E_SECURITY`, and nothing is created beyond the link), the file is opened **exclusively**
(`wx`, unless `--overwrite` — a file that appears between the plan and the write is refused like
any pre-existing one), and the entry is streamed in with backpressure (a CRC / size failure
removes the partial file). The only residual window is between `realpath` and `open`: use an
empty or trusted destination. Skipped reasons: `unsafe-path | symlink | filtered | duplicate |
unsupported`.

Status envelope: `{ ok, command, outputDir, entries, files, directories, bytes, skipped:
[{ name, reason }], symlinksAsData, diagnostics }`.

### `zipnative stream`

```bash
curl ... | zipnative stream [--list] [--format ndjson]
curl ... | zipnative stream --output-dir <dir>
cat a.zip | zipnative stream --cat <name>
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | File to read sequentially |
| `--list` | default mode | List entries as they arrive |
| `--output-dir <dir>`, `-d` | — | Extract under `<dir>` (`sanitizeEntryPath` + containment) |
| `--cat <name>` _(repeatable)_ | — | Write the named entry's data to stdout; mutually exclusive with `--output-dir` |
| `--format text\|json\|ndjson`, `-f` | `text` (`ndjson` under `--json`; `json` when `--summary` / `--fields` is given) | Listing format |
| `--long` | false | Add flags, versions and extra fields to the rows (`rawNameHex` included; entry comments live only in the central directory, so there is no `commentHex` here; no `-l` short form) |
| `--include` / `--exclude`, `--overwrite`, `--on-duplicate`, `--flat`, `--preserve-mtime` | as in `extract` | Extraction controls (the same sink: realpath containment, exclusive open) |
| `--skip-unsafe` | false | Skip unsafe names instead of failing |
| `--skip-unsupported` | false | Skip encrypted / unknown-method entries instead of failing |
| `--summary` / `--fields` | — | Projection of the `--format json` report; `--summary` = `{ entries, bytes, descriptorEntries, bytesKnown, trust }` |
| `--dry-run` | false | Iterate and plan; write nothing |

**Trust caveat:** the forward reader parses local headers **alone**. There is no central directory
to cross-check names, sizes, methods or attributes, so `--preserve-mode` / `--allow-symlinks` /
`--skip-symlinks` are unavailable here (`E_USAGE`) and every JSON output carries
`trust: "local-headers-only"`. A `warning:` line says so at start (suppressed by `--quiet`). Prefer
`list` / `extract` whenever the whole file is available. Data-descriptor entries carry zero
sizes in their local header (a `create --stream` archive, for one): the rows show them as such,
`--summary` counts them in `descriptorEntries` and sets `bytesKnown: false` (`bytes` excludes
them), and `--list` has to inflate each such entry to find its end. Data-descriptor entries the
engine cannot delimit without the central directory (store, encrypted or custom-codec + bit 3)
are refused with `ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR`. A `--cat` name that never arrives is
`E_NOT_FOUND` / `ZIP_ENTRY_NOT_FOUND`.

### `zipnative verify`

```bash
zipnative verify --input <a.zip> [--format json|text] [--strict]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | Archive path |
| `--entry <name>`, `-e` _(repeatable)_ | — | Verify only the named entries (CRC-32, sizes, local header of each) after the eager structural check; the report lists them under `selected`, `entries` holds only those, `entryCount` stays the archive total. An unknown name is `E_NOT_FOUND` / `ZIP_ENTRY_NOT_FOUND` before any output |
| `--format text\|json`, `-f` | `text` (`json` under `--json`) | Output format |
| `--strict` | false | Also fail when any diagnostic was emitted |
| `--summary` | — | `{ ok, entries, failed, skipped, diagnostics, selected?, error? }` |
| `--fields a,b.c` | — | Dot-path projection |

The report is zipnative's `ZipVerificationReport` (`{ ok, error, entryCount, entries: [{ name,
ok, crcMatch, sizeMatch, localHeaderMatch, skipped? }], diagnostics }`) plus `{ failed, skipped,
strict, selected? }`. Encrypted entries are honestly `skipped: "encrypted"` (a stream-only codec:
`"stream-only-codec"`), never faked as verified. Exit 1 / `E_VERIFY_FAILED` when `ok` is false;
the error envelope carries `zipCode = report.error.code` for structural refusals. The `--max-*`
bounds apply.

### `zipnative crc32`

```bash
zipnative crc32 [<file>...] [--seed <hex>] [--expect <hex>] [--format text|json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `<file>...` / `--input <file>`, `-i` _(repeatable)_ | stdin | Inputs |
| `--seed <hex>` | `0` | Continue a running checksum from this value |
| `--expect <hex>` | — | Single input: exit 1 / `E_CHECK_FAILED` on mismatch (`detail: { expectedCrc, actualCrc }`) |
| `--format text\|json`, `-f` | `text` (`json` under `--json`) | `text` is `"<crc>  <bytes>  <file>"`; JSON shape: `zipnative schema crc32` |

Streams input in 64 KiB chunks through zipnative's incremental `crc32()` — constant memory for
any size (not bounded by `--max-input-size`). Under `--json` the report stays on stdout and a
`{ ok, command: "crc32", files, bytes, expect?, matched? }` status envelope goes to stderr.

### `zipnative inflate`

```bash
zipnative inflate [--input <file>] [--output <file>] [--max-output <size>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | Compressed input |
| `--output <file>`, `-o` | stdout | Decompressed output |
| `--overwrite` | false | Replace an existing `--output` file (default: refuse, `E_IO`) |
| `--max-output <size>` | the effective `--max-entry-size` (1 GiB) | Hard output bound; `none` only for trusted input |
| `--method deflate\|store\|<id>` | `deflate` | Codec (ids via `--codec`); `store` is a bounded pass-through |
| `--sync` | false | Buffer the input (bounded by `--max-input-size`) and use the codec's `decompressSync` |
| `--allow-trailing` | false | Silence the warning about bytes after the stream end |
| `--dry-run` | false | Report the plan; decompress nothing |

Default path: zipnative's resumable inflater fed chunk by chunk — constant memory, exact
`bytesConsumed` (= `bytesIn` − `leftover`; equals `bytesIn` on the `--sync` / codec paths),
trailing bytes reported as `leftover`. Errors: `ZIP_DEFLATE_CORRUPT` / `ZIP_DEFLATE_TRUNCATED` →
`E_PARSE`, `ZIP_INFLATE_OUTPUT_OVERFLOW` → `E_DATA`. Status envelope: `{ ok, command, output,
method, methodName, bytesIn, bytesConsumed, bytesOut, leftover, maxOutput, sync, tier }`.

### `zipnative batch`

Two mutually exclusive modes: **directory mode** and **manifest mode**.

```bash
zipnative batch --input-dir <dir> --output-dir <dir> [--task create] [create flags]
zipnative batch --input-dir <dir> --task verify
zipnative batch --manifest <tasks.json> [--continue-on-error] [--allow-codec-load]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input-dir <dir>` | — **(required in directory mode)** | `--task create`: each immediate subdirectory becomes `<output-dir>/<name>.zip` through the full `create` command (every create flag is honoured); `--task verify`: every `*.zip` in the directory is verified |
| `--output-dir <dir>` | — **(required for `--task create`)** | Destination directory (created if absent) |
| `--task create\|verify` | `create` | Directory-mode task |
| `--overwrite` | false | Replace existing `<name>.zip` files (default: each is refused, `E_IO`) |
| `--concurrency <n>` | `4` | Parallel workers, 1–64 (exit 2 outside) |
| `--fail-fast` | false | Stop scheduling after the first failure |
| `--method` / `--level` / `--deterministic`, `--order`, `--date`, `--comment` | `create` defaults | Directory mode forwards every `create` flag to each archive |
| `--manifest <file>` | — | Ordered pipeline of whitelisted commands with `"@<id>"` output references; tasks run sequentially, fail-fast by default — see `zipnative schema batch-manifest` |
| `--continue-on-error` | false | Keep running independent tasks after a failure (tasks depending on a failed task are skipped) |
| `--allow-codec-load` | false | Permit a `codec` flag inside tasks (executes user code) |
| `--format text\|json`, `-f` | `text` (`json` under `--json`) | Report format |
| `--summary` | — | `{ ok, command, mode, task?, dryRun?, total, succeeded, failed, skipped? }` |
| `--fields a,b.c` | — | Dot-path projection |
| `--dry-run` | false | Validate and print the plan; execute nothing |

The manifest whitelist holds 10 manifest commands: `create`, `list`, `inspect`, `extract`,
`cat`, `verify`, `stream`, `modify`, `crc32`, `inflate` — never `batch`, `govern`, `schema`,
`completion` or `doctor`. A flag value `"@<id>"` references the resolved `output` (or
`output-dir`) of an **earlier** task; relative paths resolve against the manifest's directory and
are refused on `..` (`validatePath` — a manifest is data, not the invoking user). Manifests are
JSON-size-capped (50 MB) and bounded to 1 000 tasks. Exit 1 carries the **first failing task's**
`E_*` code (and `zipCode`).

**`--json` / `--format json`: stdout is ONE batch document.** Each manifest task runs under
stdout capture (64 MiB cap → `E_LIMIT` `{ limit: "captureBytes" }`); its output lands in
`tasks[i].report` (the parsed JSON object, or an array of rows for NDJSON), `tasks[i].stdout`
(text) and `tasks[i].stdoutBytes`. Tasks that would write their **artefact** to stdout —
`create` / `modify` / `cat` / `inflate` without `output`, `stream --cat` — are refused at
validation (`E_USAGE`, exit 2, also under `--dry-run`). Text mode keeps the interleaved
per-task output. `batch` emits no status envelope: the batch document *is* the report
(shape: `zipnative schema batch`).

### `zipnative doctor`

```bash
zipnative doctor [--format json|text]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--format text\|json`, `-f` | `text` (`json` under `--json`) | Output format |

Checks: `cli`, `node` (≥ 22), `zipnative` (package vs `VERSION` export), `deflate-tier`
(`node-zlib` expected; `pure` under `--pure-codecs`), `deflate-pinned` (the tier used by
`--deterministic`), `web-streams` (`CompressionStream` / `DecompressionStream`), `workers`
(`create --parallel`), `codecs` (registered methods), `limits` (the effective bounds, with
`--max-*` / `--max-input-size` overrides; under `--format json` the check carries `data { maxEntries,
maxEntryUncompressedSize, maxTotalUncompressedSize, maxCompressionRatio, maxNameBytes,
maxExtraFieldBytes, maxCommentBytes, maxCentralDirectoryBytes, maxInputSize }` as numbers, or
`"none"` when disabled), `commands`. Exit 0 when every check passes, 1 otherwise. Always
offline.

### `zipnative schema`

Print a versioned JSON Schema (Draft 2020-12) for a CLI input/output shape, so an agent can
self-validate before invoking a command.

```bash
zipnative schema                    # create-manifest (default)
zipnative schema create-manifest    # create --from-manifest input
zipnative schema modify-manifest    # modify --from-manifest input
zipnative schema batch-manifest     # batch --manifest input
zipnative schema entries            # list --format json output (one EntryRow per line for ndjson)
zipnative schema entries-summary    # list --summary output
zipnative schema inspect            # inspect --format json output
zipnative schema inspect-summary    # inspect --summary output
zipnative schema verify             # verify --format json output
zipnative schema verify-summary     # verify --summary output
zipnative schema stream             # stream --format json output
zipnative schema stream-summary     # stream --summary output
zipnative schema batch              # batch --format json output
zipnative schema batch-summary      # batch --summary output
zipnative schema doctor             # doctor --format json output
zipnative schema govern-verify      # govern verify-issue --json output
zipnative schema crc32              # crc32 --format json output
zipnative schema status             # the --json success envelope
zipnative schema error              # the --json error envelope
zipnative schema errors             # E_* codes + the 39 ZIP_* → E_* mapping + diagnostics (DATA)
zipnative schema limits             # ZipLimits: the eight bounds, defaults, CWEs, flags
zipnative schema diagnostics        # the diagnostic shape (11 codes)
zipnative schema manifest           # capability manifest: commands, flags, codes, schemas (DATA)
zipnative schema list               # list the 22 subjects
```

The **manifest** (`schema manifest`) is a machine-readable capability document — every command
with its group, summary and flags, the global flags, the dry-run / projected / manifest command
lists, the `E_*` and `ZIP_*` codes, the diagnostic codes, the limits — for AI-agent tool
discovery. A prose/LLM-facing version ships as [`llms.txt`](llms.txt) at the package root.

### `zipnative completion`

```bash
zipnative completion bash > /etc/bash_completion.d/zipnative
zipnative completion zsh  > "${fpath[1]}/_zipnative"
zipnative completion fish > ~/.config/fish/completions/zipnative.fish
zipnative completion powershell >> $PROFILE   # Register-ArgumentCompleter
```

The scripts are generated from the same command table as `schema manifest`. Path flags
(`--input`, `--output`, `--output-dir`, `--input-dir`, `--base`, `--from-manifest`, `--manifest`,
`--config`, `--codec`, `--comment-file`) complete files; other value flags require an argument;
boolean flags take none.

### `zipnative govern`

```bash
zipnative govern rules                    # the human/agent protocol on stdout
zipnative govern policy [--pretty]        # the machine-readable policy (JSON)
zipnative govern verify-issue <draft.md>  # validate a draft; exit 1 / E_POLICY on violation
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | positional | Draft path (`-` = stdin), for `verify-issue` |
| `--format json\|text`, `-f` | `text` (`json` under `--json`) | Report format for `verify-issue` |

`verify-issue` fails a draft that proposes an external runtime dependency or omits a
reproduction code block; missing recommended fields (environment, expected behaviour) and
apparent anti-goal proposals (encryption, other formats, multi-disk, repair) are warnings. A
passing check is **necessary but not sufficient** — the human review gate always applies.

### Global options

| Flag | Default | Description |
|------|---------|-------------|
| `--config <file>` | nearest `.zipnativerc.json` upward from cwd | Use a specific config file |
| `--no-config` | — | Ignore any `.zipnativerc.json` |
| `--quiet`, `-q` | — | Suppress progress output and text diagnostics on stderr (never envelopes or errors) |
| `--no-color` | — | Disable ANSI colour on the stderr progress lines (sets `NO_COLOR`). Colour is decided on **stderr**: `NO_COLOR` (any value) off, `FORCE_COLOR` (not `0`/`false`) on, `TERM=dumb` off, otherwise on only when stderr is a TTY |
| `--json` | — | Agent mode: emit a JSON status/error envelope on stderr (data stays on stdout). Errors carry a stable `E_*` code and zipnative's `ZIP_*` code verbatim. `batch` is the exception: its JSON report is the stdout document |
| `--pretty` | — | Indent JSON output under `--json` |
| `--dry-run` | — | Validate inputs and plan without writing output (`create`, `extract`, `modify`, `stream`, `cat`, `inflate`, `batch`) |
| `--strict` | — | Escalate the first engine diagnostic into `E_CHECK_FAILED` before any output byte (`verify`: fail on any diagnostic, `E_VERIFY_FAILED`) |
| `--max-entries <n>` | `100000` | Maximum central-directory entry count (CWE-400) |
| `--max-entry-size <size>` | `1073741824` (1 GiB) | Maximum decompressed size of a single entry (CWE-400) |
| `--max-total-size <size>` | `8589934592` (8 GiB) | Maximum total decompressed size across an extraction (CWE-400) |
| `--max-ratio <n>` | `1024` | Maximum uncompressed/compressed ratio, entries ≥ 1 KiB compressed (CWE-409) |
| `--max-name-bytes <size>` | `4096` | Maximum entry-name length in bytes (CWE-400) |
| `--max-extra-bytes <size>` | `65535` | Maximum extra-field block length in bytes (CWE-400) |
| `--max-comment-bytes <size>` | `65535` | Maximum comment length in bytes (CWE-400) |
| `--max-cd-bytes <size>` | `268435456` (256 MiB) | Maximum central-directory size in bytes (CWE-400) |
| `--max-input-size <size>` | `4294967296` (4 GiB) | CLI-owned bound on every **buffered** read (CWE-400): an archive or payload read from stdin (byte-counted, aborted) or a file (`stat` before reading) into memory — `list`, `inspect`, `verify`, `extract`, `cat`, `modify`, `create --stdin-name`, `inflate --sync`, `govern verify-issue`. Exceeding it is `E_LIMIT` with `detail { limit: "maxInputSize", configured, observed }`; `none` disables it with one warning. Not a `ZipLimits` key (`doctor` reports it under `limits`). The streaming commands (`stream`, `crc32`, `inflate`, `create --stream`) are not bounded by it |
| `--pure-codecs` | — | Skip `node:zlib` and run the pure-TS codec tier |
| `--codec <module>` | — | Load an ESM module exporting `{ codecs: ZipCodec[] }` (and optional `inflateImpl` / `deflateImpl`) and register it. A registered codec serves the reader for its method **and the writer** when it registers store (0) or deflate (8) — such a module replaces the built-in compressor for `create`/`modify` even under `--deterministic`; `deflateImpl` replaces the sync deflate tier (`tier: "injected"`) unless `--deterministic` pins the engine's encoder; `create --parallel` refuses either (workers cannot see the module). Executes user code: only accepted on the command line, never from a config file |
| `--version --json` | — | `{ name, version, zipnative }` — machine-readable version output |
| `--help`, `-h` | — | Global or per-command usage |

`<size>` accepts `65536`, `512k`, `1m`, `8g`, `1GiB`; `none` disables a bound (a visible warning
is printed — not recommended for untrusted input). Limits are also flat keys in
`.zipnativerc.json` (global or command-scoped).

#### Process contract

- **Config discovery is upward.** `.zipnativerc.json` is looked up from the working directory
  to the filesystem root; an unattended run should pass `--no-config` (or `--config <file>`).
  Explicit flags win over the file; the `codec` key is refused from any config file.
- **stderr is line-oriented.** Under `--json` the envelope is the last line that starts with
  `{`; the other lines are text (progress, NDJSON diagnostics) that `--quiet` removes.
- **Flags and positionals are order-independent.** A boolean flag never consumes the next
  token, so `zipnative --json list a.zip` and `zipnative list --long a.zip` both work;
  `--flag=false|0|no|off` is the explicit off form. Combined short flags (`-lq`) are refused
  (exit 2). Short aliases that take a value: `-i`, `-o`, `-d`, `-e`, `-f`; boolean: `-q`, `-h`,
  `-V`. There is no `-l`.
- **Argv paths are ordinary shell paths.** `zipnative list ../a.zip`, `-o ../out.zip` and
  `--output-dir ../x` are the invoking user's own filesystem authority and are not second-guessed.
  Only values that arrive as *data* — path flags inside a `batch` manifest, `path` values inside a
  `create` / `modify` manifest — are refused on `..` (`E_INPUT`). Entry **names** are always
  checked with the engine's `sanitizeEntryPath()`.
- **No input and stdin is a terminal** → `E_USAGE` (exit 2): `No input: pass --input <file> (or
  a positional path), or pipe data on stdin.` An explicit `-` is never guarded.
- **Overwrite policy** is uniform: `create -o`, `modify -o`, `cat -o`, `inflate -o`, `extract`,
  `stream --output-dir` and `batch --task create` refuse an existing file with `E_IO`
  (`Refusing to overwrite existing file <path> (pass --overwrite)`) and leave it intact;
  `--overwrite` replaces it. Writing to stdout is unaffected.
- **Closed pipe.** `EPIPE` on stdout or stderr (`| head`) ends the process quietly with exit 0.
- **Interrupts.** On `SIGINT` / `SIGTERM` the CLI removes exactly the files it is writing at
  that moment (never a completed output, never the original of `modify --in-place`) and exits
  130 / 143. POSIX only in practice (Windows sends no signals to child processes; Ctrl+C in a
  console still triggers Node's `SIGINT` emulation).
- **Unknown command** → exit 2 / `E_USAGE` (also with `--help`); flags without a command
  (`zipnative --json`) → exit 2 `No command given`; bare `zipnative` prints the usage, exit 0.

#### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success (also a closed pipe, `EPIPE`) |
| `1` | Failure — every `E_*` class except `E_USAGE` (`E_INPUT`, `E_IO`, `E_SECURITY`, `E_DATA`, `E_LIMIT`, `E_VERIFY_FAILED`, `E_CHECK_FAILED`, `E_POLICY`, …) |
| `2` | Usage error (`E_USAGE`): bad flags, missing required argument, unknown command, a refused combination |
| `130` / `143` | Interrupted by `SIGINT` / `SIGTERM` (in-flight files removed) |

#### Environment

| Variable | Effect |
|----------|--------|
| `ZIPNATIVE_JSON` | Agent mode (set by `--json`; honoured when set by the caller — `create` / `extract --dry-run` then print no text plan) |
| `ZIPNATIVE_DRY_RUN` | `--dry-run` |
| `ZIPNATIVE_QUIET` | `--quiet` |
| `ZIPNATIVE_STRICT` | `--strict` |
| `ZIPNATIVE_PURE_CODECS` | `--pure-codecs` |
| `NO_COLOR` | Any value disables colour on stderr (`--no-color` sets it) |
| `FORCE_COLOR` | Any value but `0` / `false` forces colour on stderr |
| `TERM` | `dumb` disables colour |
| `ZIPNATIVE_DEBUG` | `1` adds the stack trace to an error |

`VERAZIP_REQUIRED`, `VERAZIP_REPORT_DIR` and `VERAZIP_TOOLS` are read by the veraZIP scripts
only, never by the CLI.

#### Locale

Output is English and locale-independent by design: no environment locale is read, no
`Intl` / `toLocale*` formatting is used, numbers are ASCII digits, dates are ISO-8601 UTC
(`--date` is UTC wall-clock), sizes use binary units. Messages are not translated and are
not part of the contract — branch on `error.code` / `error.zipCode` / `error.remedy`. Entry
names are emitted as UTF-8 bytes (on PowerShell set `[Console]::OutputEncoding` to UTF-8).

#### Memory

| Commands | Memory profile |
|----------|----------------|
| `list`, `inspect`, `cat`, `extract`, `verify`, `modify` | Random access: the whole archive is held in memory, bounded by `--max-input-size` (4 GiB) |
| `stream`, `crc32`, `inflate` (default path), `create --stream` | Constant memory — chunked, not bounded by `--max-input-size` |
| `create` (buffered), `create --stdin-name`, `inflate --sync` | Buffers the inputs / the payload (`--stdin-name` and `--sync` under `--max-input-size`) |
| `create --stream --deterministic` | Constant memory per **entry**: the pinned encoder is whole-buffer, so each entry is buffered in turn |

## Driving from AI agents

`zipnative-cli` is designed so an autonomous agent (or any program) can drive it
deterministically — no MCP server, no daemon, just the process contract:

- **stdout = the artifact** (archive bytes, entry bytes, JSON report, text, schema, script);
  **stderr = diagnostics.**
- Pass **`--json`** (anywhere on the command line) to get a single machine-readable envelope on
  stderr. On failure:
  `{ "ok": false, "command": "...", "error": { "code": "E_*", "message": "...", "zipCode"?: "ZIP_*", "entryName"?: "...", "detail"?: { ... }, "remedy"?: "--skip-unsafe (extract, stream)" } }`.
  `remedy` is the machine-actionable counterpart of `message`: the CLI flag(s) or command that
  lift the refusal (the engine message names library options, not flags); absent when nothing
  does; apply it only for trusted input. Text mode prints the same as a `remedy:` line.
  On success for `create` / `modify` / `extract` / `stream` / `cat` / `inflate` / `crc32`: a
  `{ "ok": true, "command": "...", ... }` status line. `list` / `inspect` / `verify` / `doctor` /
  `batch` put their JSON report on stdout instead (`batch --json` = one document with every
  task's captured report inside).
- Branch on **`error.code`** for the *class* (`E_USAGE`, `E_INPUT`, `E_PARSE`, `E_IO`,
  `E_SECURITY`, `E_DATA`, `E_LIMIT`, `E_UNSUPPORTED`, `E_NOT_FOUND`, `E_VERIFY_FAILED`,
  `E_CHECK_FAILED`, `E_POLICY`, `E_RUNTIME`) and on **`error.zipCode`** for the exact *cause*
  (zipnative's frozen `ZIP_*` code, e.g. `ZIP_PATH_TRAVERSAL`, `ZIP_LIMIT_EXCEEDED`) — never on
  the message text. Every CLI-side `E_NOT_FOUND` (`cat`, `inspect --entry`, `stream --cat`,
  `verify --entry`) carries `ZIP_ENTRY_NOT_FOUND`; an unsafe entry **name** given as data
  (`modify --add`, `create --stdin-name`, manifests) is `E_INPUT` with `entryName`, while a
  malformed **flag** stays `E_USAGE`. Numeric **exit codes** stay `0` (success), `1` (runtime /
  check failure), `2` (usage).
- Use **`--dry-run`** to validate input and print the plan without producing output.
- Fetch a **`schema`** (or **`schema manifest`** / **`llms.txt`**) to discover and validate
  before calling, and run **`doctor --format json`** as a capability pre-flight.

See [AGENTS.md](AGENTS.md) and the [`samples/agent/`](samples/agent) scripts.

## Security

- **Offline, always** — no command can open a socket; there is no network opt-in to forget.
  `--dry-run`, `--json`, `govern`, `doctor` are all local.
- **The CLI is the filesystem trust boundary.** The engine never touches the filesystem: it
  returns sanitised paths and data. One extraction sink serves `extract` and `stream`: lexical
  containment of every destination under `--output-dir` (`safeJoin`), **physical** containment
  (the nearest existing ancestor is `realpath`-checked under the root's `realpath` before any
  `mkdir`, and re-checked after — a planted symlink or junction is `E_SECURITY`), an
  **exclusive** open (`wx`) unless `--overwrite`, removal of partial files on failure, and
  case-fold collision refusal on case-insensitive filesystems. The only residual window is
  between `realpath` and `open` — use an empty or trusted destination. A symlink is never
  materialised, whatever the flags.
- **Overwrite refusal is uniform.** `create` / `modify` / `cat` / `inflate --output`, `extract`,
  `stream --output-dir` and `batch` refuse an existing file (`E_IO`) unless `--overwrite`;
  `modify --in-place` goes through an exclusively created, unpredictable temp file and an
  atomic rename. An interrupted run (`SIGINT` / `SIGTERM`) removes only the files being written
  at that moment and exits 130 / 143.
- **Refusals, not guesses** — zip-slip and device names, symlink entries, overlapping entries,
  central/local header disagreement, Zip64 spoofing, duplicate output paths, ambiguous EOCDs and
  > 2^53 sizes are refused by default with their `ZIP_*` code. Opt-outs skip; they never write
  anything unsafe.
- **Bounded by default** — the engine's eight CWE-tagged limits are always on (`--max-*` to
  tune; `none` warns), and the CLI bounds every buffered read with `--max-input-size` (4 GiB;
  `E_LIMIT`). `inflate` has a mandatory output bound.
- **Data remanence** — `modify` without `--compact` keeps removed / replaced bytes recoverable
  in the output. Use `--compact` when deletion matters. Either way `modify` verifies every entry
  it re-emits (CRC-32, sizes, local header) and refuses a lying record — an append-only save
  never launders a hostile archive into a clean-looking one.
- **No encryption** — read or write, by engine policy in 1.x. Encrypted entries are detected,
  listed and reported as `skipped` by `verify`; reads fail with `ZIP_UNSUPPORTED_ENCRYPTION`.
- **`--codec` is a trust boundary** — the CLI's only dynamic import of user code (same trust as
  `node -r`): argv only, refused from `.zipnativerc.json`, refused inside a `batch --manifest`
  without `--allow-codec-load`. A module that registers method 0/8 or exports `deflateImpl`
  also shapes what `create`/`modify` write — the envelope's `tier` and a `warning:` line say so,
  and `create --parallel` refuses to run with such a module loaded.
- **Path validation is scoped to data.** Paths typed on the command line (`../a.zip`,
  `-o ../out.zip`) are the invoking user's own filesystem authority and are not second-guessed.
  Values that arrive as data — path flags inside a `batch` manifest and `path` values inside a
  `create` / `modify` manifest — are refused on `..` (`E_INPUT`); entry names are always checked
  with the engine's `sanitizeEntryPath()`, and every extracted destination goes through the sink
  above.
- **JSON size cap** — manifests, drafts and JSON inputs are capped at 50 MB before parsing
  (config files at 1 MB).
- Signed builds with npm provenance (Trusted Publishing / OIDC) and a CycloneDX SBOM per
  release; the SBOM and the tarball are attested with `actions/attest-build-provenance` — verify with
  `npm audit signatures`. CI runs on Ubuntu 22/24, Windows 22/24 (blocking) and macOS 22; the
  veraZIP gate runs on Linux and Windows for every pull request.

See [SECURITY.md](SECURITY.md) for the full security policy and vulnerability disclosure procedure.

## Versioning and stability

Semantic Versioning over an explicit public surface: the 15 commands and their flags, exit
codes `0`/`1`/`2`/`130`/`143`, the 13 `E_*` classes and the `ZIP_*` → `E_*` mapping, the
envelope and report keys, the `schema` subjects and `schema manifest` shape, the
`.zipnativerc.json` keys, the `ZIPNATIVE_*` variables, and the bytes written under
`--deterministic` (a byte change is semver-major). Message wording, text layout and key order
are not a contract. A flag is deprecated in a minor release (it keeps working and prints one
`warning:` line) and removed no earlier than the next major. Details in
[CONTRIBUTING.md](CONTRIBUTING.md#versioning-stability-and-deprecation).

## Getting Help

**Have a question?**
- 📖 Check the [FAQ](docs/KNOWLEDGE_BASE.md#12-frequently-asked-questions) first
- 🔍 Search the samples: `grep -r "your-keyword" samples/`
- 📚 Read [KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) for technical details
- 💬 Open a discussion: [the engine's GitHub Discussions](https://github.com/Nizoka/zipnative/discussions) until the CLI tab is enabled (see [SUPPORT.md](SUPPORT.md))

**Found a bug?**
- 🐛 Open an issue: [GitHub Issues](https://github.com/Nizoka/zipnative-cli/issues)
- 🔐 Security issue? See [SECURITY.md](SECURITY.md) for responsible disclosure

**Want to contribute?**
- 🤝 See [CONTRIBUTING.md](CONTRIBUTING.md)
- 📝 All PRs add value — tests, docs, samples

## Related Projects

- [`zipnative`](https://github.com/Nizoka/zipnative) — the core ZIP engine (zero dependencies, frozen 1.0 API)
- `zipnative-mcp` — Model Context Protocol server for AI clients (planned)
- [pdfnative](https://github.com/Nizoka/pdfnative) / [pdfnative-cli](https://github.com/Nizoka/pdfnative-cli) — the sibling PDF engine and CLI, same doctrine
- [zipnative.dev](https://zipnative.dev) — documentation, guides, playgrounds

## Citation

If you use zipnative-cli in research or academic pipelines, please cite it:

```bibtex
@software{zipnative_cli_2026,
  title  = {zipnative-cli: Official CLI for the zipnative ZIP engine},
  author = {Nizoka},
  year   = {2026},
  url    = {https://github.com/Nizoka/zipnative-cli},
  license = {MIT}
}
```

See [CITATION.cff](CITATION.cff) for the full metadata (auto-detected by GitHub and Zenodo).

## License

MIT — see [LICENSE](LICENSE).
