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
> **`--summary`** / **`--fields`**, **`--strict`** and eight **`--max-*`** security bounds
> complete the agent contract. Every archive the CLI writes is validated against
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
  `--exclude` globs, `--store-ext`, `--preserve-mode`, per-entry comments, and a `--dry-run` plan.
- **`list` / `inspect`** — list entries without decompressing anything (`text` | `json` |
  `ndjson`, `--long` for flags, offsets and extra fields), or open the archive **eagerly** for a
  forensic report — per-method statistics, a determinism verdict, every engine diagnostic — and
  turn it into a CI gate with repeatable **`--check`** assertions (`deterministic`,
  `no-encryption`, `no-symlinks`, `max-ratio=N`, `has=<name>`, …; exit 1 / `E_CHECK_FAILED`).
- **`extract`** — secure by default. The engine sanitises every path; the CLI is the filesystem
  sink and re-proves containment under `--output-dir` before writing a byte. Zip-slip, Windows
  device names, symlink entries, overlapping entries, central-directory / local-header
  disagreement, duplicate output paths and decompression bombs are **refused**, each with its
  `ZIP_*` code. Opt-outs are skip-not-write (`--skip-unsafe`, `--skip-symlinks`;
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
  recompressing untouched entries**. The default save is append-only (original bytes verbatim);
  **`--compact`** rewrites canonically so removed content is truly gone. `--in-place` writes back
  through a temp file + rename.
- **`crc32` / `inflate`** — the ZIP checksum of files or stdin in constant memory (`--expect`
  turns it into a check, `--seed` continues a running value), and a raw-DEFLATE decoder with a
  **mandatory output bound** driven by zipnative's resumable inflater (`--method <id>` for
  codecs loaded with `--codec`).
- **`batch`** — archive every subdirectory of a folder (the full `create` command per
  directory, bounded concurrency), verify every `*.zip` in a folder, or run a declarative
  **`--manifest`** pipeline (`create` → `verify` → `extract` → …) with `@<id>` output references
  and a codec-load policy (`--allow-codec-load`).
- **`doctor`** — an offline capability preflight: CLI / Node / zipnative versions (package vs
  the engine's `VERSION` export), the active deflate tier (`node-zlib` expected, `pure` under
  `--pure-codecs`), the pinned tier used by `--deterministic`, platform streaming codecs,
  worker-thread availability for `create --parallel`, registered codecs, the **effective
  security limits**, and the command count. Text or `--format json`; exit 0/1.
- **`schema`** — 22 versioned JSON Schemas (Draft 2020-12) for every input and output shape
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
  `--max-extra-bytes`, `--max-comment-bytes` and `--max-cd-bytes` (`none` disables a bound, with
  a visible warning).
- **`.zipnativerc.json`** — optional config file for default flags (global + per-command);
  precedence is CLI flags > config > built-in. `codec` is refused from config files.
- **Zero extra dependencies** — `zipnative` is the sole runtime dependency; all ZIP logic lives
  there. No ZIP parsing in the CLI.
- **Offline, always** — no command can open a socket. There is no network opt-in to forget.
- **Stdin / stdout by default** — every command is shell-pipeline friendly.
- **ESM-first, TypeScript strict** — built with tsup, typed declarations included.
- **npm provenance** — Trusted Publishing (OIDC) with provenance attestations and a CycloneDX
  SBOM per release.

## Supported Features

| Feature | Status | Notes |
|---------|--------|-------|
| **Commands** | | |
| `create` deterministic archives | ✅ | Files, directories, stdin, `--from-manifest`; `--method`, `--level`, `--deterministic`, `--order`, `--date`, `--stream`, `--parallel`, `--include`/`--exclude`, `--store-ext`, `--preserve-mode`, `--dir-entries` |
| `modify` incremental edits | ✅ | `--add`, `--add-dir`, `--replace`, `--remove`, `--rename`, `--comment`, `--from-manifest`; append-only `save()` or `--compact`; `--in-place` |
| `list` entries | ✅ | `text` \| `json` \| `ndjson`, `--long`, `--validate eager`, globs, `--summary` / `--fields` |
| `inspect` forensic report | ✅ | Eager open, stats, determinism verdict, diagnostics, `--entries` / `--entry` / `--extra`, 19 `--check` assertions |
| `cat` entries to stdout | ✅ | Random access, `--raw` (compressed payload), `--no-verify-crc`, `--output` |
| `extract` to a directory | ✅ | Guards on by default; `--skip-unsafe`, `--allow-symlinks`, `--skip-symlinks`, `--on-duplicate`, `--overwrite`, `--flat`, `--buffered`, `--preserve-mode`, `--preserve-mtime` |
| `stream` forward-only reader | ✅ | stdin/pipes; `--list` (default), `--output-dir`, `--cat`; `trust: "local-headers-only"`; `--skip-unsupported` |
| `verify` deep integrity | ✅ | `verifyZip` report + `failed` / `skipped` / `strict`; exit 1 / `E_VERIFY_FAILED` |
| `crc32` checksum | ✅ | Files or stdin, 64 KiB chunks; `--seed`, `--expect` (exit 1 / `E_CHECK_FAILED`) |
| `inflate` raw DEFLATE | ✅ | Resumable inflater, mandatory `--max-output`, `--sync`, `--method <id>` for registered codecs |
| `batch` orchestration | ✅ | Directory mode (`--task create` \| `verify`, `--concurrency`, `--fail-fast`) or `--manifest` pipelines (10 whitelisted manifest commands) |
| `doctor` preflight | ✅ | Versions, deflate tiers, web streams, workers, codecs, effective limits, command count; text or `--json` |
| `schema` JSON Schema export | ✅ | 22 subjects incl. `errors`, `limits`, `diagnostics`, `status`, `error` and the capability `manifest` |
| `completion` shell scripts | ✅ | `bash` / `zsh` / `fish` / `powershell` |
| `govern` AI-governance / HITL | ✅ | `rules` / `policy` / `verify-issue`; gates drafts with `E_POLICY` |
| `.zipnativerc.json` config file | ✅ | Global + per-command defaults; flags > config; `codec` refused from config |
| **Agent & automation** | | |
| Global `--json` envelope | ✅ | Status on success, `{ ok: false, command, error: { code, message, zipCode?, entryName?, detail? } }` on failure |
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
| Sink containment (CLI) | ✅ | `safeJoin(root, path)` re-proves every destination stays under `--output-dir` (`E_SECURITY`); case-fold collisions refused on win32/darwin |
| Existing files | ✅ | Never overwritten without `--overwrite` (`E_IO`) |
| **Determinism** | | |
| Canonical entry order, DOS-epoch timestamps, UTF-8 names | ✅ | The engine's defaults — structurally reproducible everywhere |
| Cross-runtime byte identity | ✅ | `--deterministic` pins the pure-TS encoder (`tier: "pure-pinned"`); default tier is byte-stable per environment |
| Parallel identity | ✅ | `create --parallel` is byte-identical to the sequential writer (per tier; unconditional with `--deterministic`); `create --stream` yields the same content in the data-descriptor layout (not the same bytes) |
| Determinism verdict | ✅ | `inspect` reports `determinism.{epochTimestamps, canonicalOrder, utf8Flags, noDataDescriptors, canonicalLayout, deterministic}` — `deterministic` is reproducibility (epoch + canonical order + UTF-8 flags), `canonicalLayout` is the buffered layout (a `--stream` archive is reproducible but not canonical); `--check deterministic` / `--check canonical-layout` gate them |
| **Not supported** | | |
| Encryption (read or write) | ❌ | Policy of the engine in 1.x (ZipCrypto is broken); encrypted entries are detected, listed and refused with `ZIP_UNSUPPORTED_ENCRYPTION` |
| Other archive formats / exotic codecs | ❌ | No 7z, RAR, tar, gzip; the read-side codec registry (`--codec`) is the extension point |
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
the CLI, drives the **built binary** to write a **34-archive corpus** (30 conformant archives
across every writer path — buffered, `--stream`, `--parallel`, `--deterministic`, `modify`
append-only and `--compact`, manifests — plus **4 raw-crafted negative canaries** the validator
must reject with a declared clause id), then validates every file clause by clause. Three of the
conformant archives are **hostile-but-conformant** (zip-slip, a Windows device name, duplicate
paths): the ISO profile constrains the container, not the meaning of names, so they PASS the
validator and `extract` **must refuse** them — the gate checks both. Level 0 (the ISO clauses)
needs no external tool and always runs; level 1 re-tests every conformant archive with the
foreign integrity tools present on the machine (`unzip -t`, `7z t`, `python -m zipfile -t`,
`tar -tf`, `jar tf`) and **skips** the absent ones visibly; `VERAZIP_REQUIRED=1` (set in CI)
fails closed. Blocking in [`verazip.yml`](.github/workflows/verazip.yml) on Linux and Windows and
again before every publish. See [CONTRIBUTING.md](CONTRIBUTING.md#conformance-validation-verazip).
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

**Requirements:** Node.js ≥ 22 (CI runs 22 and 24 on Ubuntu, 22 on Windows) | Bun | Deno (`node dist/cli.cjs`)

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
zipnative inspect --input a.zip --check deterministic,no-data-descriptor
```

Without `--deterministic` the bytes are stable per environment (same Node + zlib build) but may
differ across zlib builds; timestamps default to the DOS epoch and entries are sorted by raw name
bytes either way.

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
{ "entries": 12, "bytes": 48213, "uncompressedSize": 131072, "zip64": false, "encrypted": 0, "deterministic": true, "diagnostics": 0, "checksPassed": true }
```

### Extract safely

```bash
# Guards on by default: zip-slip, device names, symlinks, duplicates, bombs, overlaps are refused
zipnative extract --input a.zip --output-dir out/

# Plan first (nothing written), then extract only what you need
zipnative extract --input a.zip -d out/ --dry-run
zipnative extract --input a.zip -d out/ --include 'docs/**' --exclude '*.png'

# Hostile archive: skip the unsafe names instead of failing (nothing unsafe is ever written)
zipnative extract --input untrusted.zip -d out/ --skip-unsafe --skip-symlinks

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
```

### Modify without recompressing

```bash
# Append-only save: untouched entries are never recompressed; original bytes stay verbatim
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
zipnative cat a.zip big.bin --raw | zipnative inflate > big.bin
```

### Batch and pipelines

```bash
# Every subdirectory of projects/ → archives/<name>.zip (all create flags honoured)
zipnative batch --input-dir projects/ --output-dir archives/ --deterministic --concurrency 8

# Verify every *.zip in a folder
zipnative batch --input-dir archives/ --task verify --json --summary

# Declarative pipeline with @id references (schema: `zipnative schema batch-manifest`)
zipnative batch --manifest tasks.json --dry-run
zipnative batch --manifest tasks.json --json
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

Ready-to-run examples are in [`samples/`](samples/), one directory per command, each script
shipped as a Bash (`.sh`) **and** a PowerShell (`.ps1`) pair:

| Category | Description |
|----------|-------------|
| [`create/`](samples/create/) | Directory, stdin, manifest, deterministic + SHA-256 twice, `--stream`, `--parallel`, globs |
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
| [`govern/`](samples/govern/) | Rules, policy, `verify-issue` on a passing and a failing draft |
| [`agent/`](samples/agent/) | The recommended agent loop: `doctor` → `inspect --summary` → `extract --dry-run` → `extract` |

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
| `--from-manifest <file>` | — | JSON manifest `{ entries: [{ name, path\|data\|dataBase64\|directory, method, level, date, comment, mode }] }` — see `zipnative schema create-manifest`; mutually exclusive with paths / `--stdin-name` |
| `--output <file>`, `-o` | stdout | Output path |
| `--base <dir>` | each input's parent directory | Entry names are relative to `<dir>` |
| `--prefix <dir/>` | — | Prepend `<dir/>` to every entry name |
| `--dir-entries` | false | Emit explicit directory entries (keeps empty directories) |
| `--include <glob>` _(repeatable)_ | — | Keep only matching names (`*`, `**`, `?`, `[abc]`; a pattern without `/` matches at any depth) |
| `--exclude <glob>` _(repeatable)_ | — | Drop matching names |
| `--follow-symlinks` | false | Dereference symlinks (default: skipped with a warning; symlink entries are never written) |
| `--method store\|deflate` | `deflate` | Compression method |
| `--level 0-9` | `6` | Deflate level |
| `--deterministic` | false | Pin the pure-TS encoder: identical SHA-256 on every runtime |
| `--order canonical\|insertion` | `canonical` | Entry order (canonical = raw-name bytes; `insertion` preserves walk order, e.g. EPUB/JAR `mimetype` first) |
| `--date epoch\|now\|<ISO 8601>` | `epoch` | Timestamp for entries (DOS epoch is reproducible; `now` emits `ZIP_TIMESTAMP_NOT_PINNED`) |
| `--mtime` | false | Use each file's modification time (non-reproducible) |
| `--comment <text>` | — | Archive comment |
| `--entry-comment <name>=<text>` _(repeatable)_ | — | Per-entry comment |
| `--preserve-mode` | false | Store POSIX mode bits (never setuid/setgid/sticky; no effect on Windows) |
| `--store-ext png,jpg,zip` | — | Store (no deflate) entries with these extensions |
| `--stream` | false | Constant-memory writer: file inputs are streamed (data-descriptor layout — same content as the buffered layout, not the same bytes); entries > 4 GiB are refused (`ZIP_UNSUPPORTED_ZIP64_STREAMING`) |
| `--chunk-size <size>` | `65536` | Chunk size for `--stream` |
| `--parallel` | false | Deflate across a worker pool (`zipnative/worker`); byte-identical to the sequential writer per tier |
| `--workers <n>` | cores − 1, max 8 | Worker count (`0` = main thread); requires `--parallel` |
| `--min-job-size <size>` | `32k` | Minimum entry size dispatched to a worker; requires `--parallel` |
| `--job-timeout <ms>` | `60000` | Per-job cap before inline fallback; requires `--parallel` |
| `--dry-run` | false | Walk inputs, validate names, print the plan; write nothing |

`--parallel` resolves `node:zlib` inside its worker bundle, so `--pure-codecs` cannot govern it —
combining the two requires `--deterministic` (exit 2 otherwise). Every entry name is pre-checked
with the engine's `sanitizeEntryPath()`: a name that could not be extracted safely (reserved
device name, traversal, empty segment) is refused at creation time (`E_INPUT`).

Status envelope (`--json`): `{ ok, command, output, entries, files, directories, bytes, bytesIn,
method, level, deterministic, tier, order, stream, parallel, skipped, diagnostics }`.

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
| `--input <file>`, `-i` | — **(required)** | Source archive (a positional path also works) |
| `--output <file>`, `-o` | stdout | Output path |
| `--in-place` | false | Write back to the input path (temp file + rename); mutually exclusive with `--output`, requires a file input |
| `--remove <name>` _(repeatable)_ | — | Remove an entry |
| `--rename <from>=<to>` _(repeatable)_ | — | Rename an entry (never overwrites implicitly) |
| `--replace <name>=<path>` _(repeatable)_ | — | Replace an entry's content (path `-` = stdin) |
| `--add <name>=<path>` _(repeatable)_ | — | Add a new entry (a bare `<path>` uses its basename) |
| `--add-dir <name>` _(repeatable)_ | — | Add an explicit directory entry |
| `--comment <text>` | — | Set the archive comment (`""` clears it) |
| `--from-manifest <file>` | — | JSON edits — see `zipnative schema modify-manifest`; mutually exclusive with the edit flags |
| `--method` / `--level` / `--deterministic` | engine defaults | Compression for **new** payloads |
| `--date epoch\|now\|<ISO>` | `epoch` | Timestamp for new payloads |
| `--compact` | false | Canonical rewrite (`saveCompact`): removed data is truly gone, still no recompression |
| `--dry-run` | false | Validate edits against the archive; write nothing |

The default save is **append-only**: original bytes verbatim + appended entries + a new central
directory. Removed / replaced content **remains recoverable** (data remanence), and 7-Zip's CLI is
known to mis-read this layout — pass `--compact` when either matters (the CLI prints one `info:`
line whenever a destructive edit is saved append-only). Archives with duplicate entry names cannot
be modified incrementally (`ZIP_DUPLICATE_ENTRY_NAME`).

Status envelope: `{ ok, command, output, bytes, edits: [{ op, name, to? }], layout:
"append-only" | "compact", changed, diagnostics }`.

### `zipnative list`

```bash
zipnative list --input <a.zip> [options]
zipnative list <a.zip> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | Archive path |
| `--format text\|json\|ndjson` | `text` (`json` under `--json`) | Output format; `ndjson` is one `EntryRow` per line |
| `--long`, `-l` | false | Add mode, flags, versions, offsets and extra fields |
| `--validate lazy\|eager` | `lazy` | Cross-check every local header up front (`eager`) |
| `--include <glob>` / `--exclude <glob>` _(repeatable)_ | — | Name filters |
| `--summary` | — | `{ entries, files, directories, compressedSize, uncompressedSize, zip64, encrypted }` |
| `--fields a,b.c` | — | Dot-path projection of the JSON report |

Nothing is decompressed. JSON shape: `zipnative schema entries`.

### `zipnative inspect`

```bash
zipnative inspect --input <a.zip> [--format json|text] [--check <assert>]...
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | Archive path. Opened **eagerly**: every local header cross-checked, overlap table built up front |
| `--format text\|json` | `text` (`json` under `--json`) | Output format |
| `--entries` | false | Include every entry (long form) in the report |
| `--entry <name>` _(repeatable)_ | — | Include only the named entries (`E_NOT_FOUND` if absent) |
| `--extra` | false | Include extra-field payloads as hex |
| `--check <assert>` _(repeatable, comma-separable)_ | — | Assertion; any failure prints the report then exits 1 with `E_CHECK_FAILED` |
| `--summary` | — | `{ entries, bytes, uncompressedSize, zip64, encrypted, deterministic, diagnostics, checksPassed? }` |
| `--fields a,b.c` | — | Dot-path projection |

Assertions: `deterministic`, `epoch-timestamps`, `canonical-order`, `utf8-names`,
`no-data-descriptor` / `canonical-layout`, `no-zip64`, `zip64`, `no-encryption`, `no-symlinks`, `no-duplicates`,
`no-diagnostics`, `store-only`, `deflate-only`, `max-entries=N`, `min-entries=N`,
`max-uncompressed=<size>`, `max-ratio=N`, `has=<name>`, `method=store|deflate|<id>`.
JSON shape: `zipnative schema inspect`.

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
| `--raw` | false | Output the **compressed** payload (zero-copy), no decoding |
| `--no-verify-crc` | false | Skip the CRC-32 check at the end of the stream |
| `--dry-run` | false | Resolve the entries and report their sizes; output nothing |

The CRC is verified at the **end** of the stream (like `unzip -p`), so stdout may already carry
bytes when `E_DATA` fires; with `--output` the partial file is removed. Directory entries are
refused (`E_INPUT`).

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
two-phase: the plan is drained without decompressing anything, every destination is proven to
stay under the root, existing files are checked; only then is each entry streamed into its file
with backpressure (a CRC / size failure removes the partial file).

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
| `--format text\|json\|ndjson` | `text` (`ndjson` under `--json`) | Listing format |
| `--long`, `-l` | false | Add flags, versions and extra fields to the rows |
| `--include` / `--exclude`, `--overwrite`, `--on-duplicate`, `--flat`, `--preserve-mtime` | as in `extract` | Extraction controls |
| `--skip-unsafe` | false | Skip unsafe names instead of failing |
| `--skip-unsupported` | false | Skip encrypted / unknown-method entries instead of failing |
| `--summary` / `--fields` | — | Projection of the `--format json` report (`{ entries, bytes, trust }`) |
| `--dry-run` | false | Iterate and plan; write nothing |

**Trust caveat:** the forward reader parses local headers **alone**. There is no central directory
to cross-check names, sizes, methods or attributes, so `--preserve-mode` / `--allow-symlinks` /
`--skip-symlinks` are unavailable here (`E_USAGE`) and every JSON output carries
`trust: "local-headers-only"`. A `warning:` line says so at start (suppressed by `--quiet`). Prefer
`list` / `extract` whenever the whole file is available. Data-descriptor entries the engine
cannot delimit without the central directory (store, encrypted or custom-codec + bit 3) are
refused with `ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR`.

### `zipnative verify`

```bash
zipnative verify --input <a.zip> [--format json|text] [--strict]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | Archive path |
| `--format text\|json` | `text` (`json` under `--json`) | Output format |
| `--strict` | false | Also fail when any diagnostic was emitted |
| `--summary` | — | `{ ok, entries, failed, skipped, diagnostics, error? }` |
| `--fields a,b.c` | — | Dot-path projection |

The report is zipnative's `ZipVerificationReport` (`{ ok, error, entryCount, entries: [{ name,
ok, crcMatch, sizeMatch, localHeaderMatch, skipped? }], diagnostics }`) plus `{ failed, skipped,
strict }`. Encrypted entries are honestly `skipped`, never faked as verified. Exit 1 /
`E_VERIFY_FAILED` when `ok` is false; the error envelope carries `zipCode = report.error.code` for
structural refusals. The `--max-*` bounds apply.

### `zipnative crc32`

```bash
zipnative crc32 [<file>...] [--seed <hex>] [--expect <hex>] [--format text|json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `<file>...` / `--input <file>`, `-i` _(repeatable)_ | stdin | Inputs |
| `--seed <hex>` | `0` | Continue a running checksum from this value |
| `--expect <hex>` | — | Single input: exit 1 / `E_CHECK_FAILED` on mismatch (`detail: { expectedCrc, actualCrc }`) |
| `--format text\|json` | `text` (`json` under `--json`) | `text` is `"<crc>  <bytes>  <file>"`; JSON shape: `zipnative schema crc32` |

Streams input in 64 KiB chunks through zipnative's incremental `crc32()` — constant memory for
any size.

### `zipnative inflate`

```bash
zipnative inflate [--input <file>] [--output <file>] [--max-output <size>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | stdin | Compressed input |
| `--output <file>`, `-o` | stdout | Decompressed output |
| `--max-output <size>` | the effective `--max-entry-size` (1 GiB) | Hard output bound; `none` only for trusted input |
| `--method deflate\|store\|<id>` | `deflate` | Codec (ids via `--codec`); `store` is a bounded pass-through |
| `--sync` | false | Buffer the input and use the codec's `decompressSync` |
| `--allow-trailing` | false | Silence the warning about bytes after the stream end |
| `--dry-run` | false | Report the plan; decompress nothing |

Default path: zipnative's resumable inflater fed chunk by chunk — constant memory, exact
`bytesConsumed`, trailing bytes reported as `leftover`. Errors: `ZIP_DEFLATE_CORRUPT` /
`ZIP_DEFLATE_TRUNCATED` → `E_PARSE`, `ZIP_INFLATE_OUTPUT_OVERFLOW` → `E_DATA`.

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
| `--concurrency <n>` | `4` | Parallel workers |
| `--fail-fast` | false | Stop scheduling after the first failure |
| `--manifest <file>` | — | Ordered pipeline of whitelisted commands with `"@<id>"` output references; tasks run sequentially, fail-fast by default — see `zipnative schema batch-manifest` |
| `--continue-on-error` | false | Keep running independent tasks after a failure (tasks depending on a failed task are skipped) |
| `--allow-codec-load` | false | Permit a `codec` flag inside tasks (executes user code) |
| `--format text\|json` | `text` (`json` under `--json`) | Summary format |
| `--summary` | — | `{ ok, command, mode, task?, total, succeeded, failed, skipped? }` |
| `--fields a,b.c` | — | Dot-path projection |
| `--dry-run` | false | Validate and print the plan; execute nothing |

The manifest whitelist holds 10 manifest commands: `create`, `list`, `inspect`, `extract`,
`cat`, `verify`, `stream`, `modify`, `crc32`, `inflate` — never `batch`, `govern`, `schema`,
`completion` or `doctor`. A flag value `"@<id>"` references the resolved `output` (or
`output-dir`) of an **earlier** task; relative paths resolve against the manifest's directory
after the same traversal check the CLI applies to direct flags. Manifests are JSON-size-capped
(50 MB) and bounded to 1 000 tasks. Exit 1 carries the **first failing task's** `E_*` code (and
`zipCode`).

### `zipnative doctor`

```bash
zipnative doctor [--format json|text]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--format text\|json` | `text` (`json` under `--json`) | Output format |

Checks: `cli`, `node` (≥ 22), `zipnative` (package vs `VERSION` export), `deflate-tier`
(`node-zlib` expected; `pure` under `--pure-codecs`), `deflate-pinned` (the tier used by
`--deterministic`), `web-streams` (`CompressionStream` / `DecompressionStream`), `workers`
(`create --parallel`), `codecs` (registered methods), `limits` (the effective bounds, with
`--max-*` overrides), `commands`. Exit 0 when every check passes, 1 otherwise. Always offline.

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

### `zipnative govern`

```bash
zipnative govern rules                    # the human/agent protocol on stdout
zipnative govern policy [--pretty]        # the machine-readable policy (JSON)
zipnative govern verify-issue <draft.md>  # validate a draft; exit 1 / E_POLICY on violation
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>`, `-i` | positional | Draft path (`-` = stdin), for `verify-issue` |
| `--format json\|text` | `text` (`json` under `--json`) | Report format for `verify-issue` |

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
| `--no-color` | — | Disable ANSI colour (also respects the `NO_COLOR` env var) |
| `--json` | — | Agent mode: emit a JSON status/error envelope on stderr (data stays on stdout). Errors carry a stable `E_*` code and zipnative's `ZIP_*` code verbatim |
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
| `--pure-codecs` | — | Skip `node:zlib` and run the pure-TS codec tier |
| `--codec <module>` | — | Load an ESM module exporting `{ codecs: ZipCodec[] }` (and optional `inflateImpl` / `deflateImpl`) and register it — **read-side only**. Executes user code: only accepted on the command line, never from a config file |
| `--version --json` | — | `{ name, version, zipnative }` — machine-readable version output |
| `--help`, `-h` | — | Global or per-command usage |

`<size>` accepts `65536`, `512k`, `1m`, `8g`, `1GiB`; `none` disables a bound (a visible warning
is printed — not recommended for untrusted input). Limits are also flat keys in
`.zipnativerc.json` (global or command-scoped).

## Driving from AI agents

`zipnative-cli` is designed so an autonomous agent (or any program) can drive it
deterministically — no MCP server, no daemon, just the process contract:

- **stdout = the artifact** (archive bytes, entry bytes, JSON report, text, schema, script);
  **stderr = diagnostics.**
- Pass **`--json`** to get a single machine-readable envelope on stderr. On failure:
  `{ "ok": false, "command": "...", "error": { "code": "E_*", "message": "...", "zipCode"?: "ZIP_*", "entryName"?: "...", "detail"?: { ... } } }`.
  On success for `create` / `modify` / `extract` / `stream` / `cat` / `inflate` / `crc32`: a
  `{ "ok": true, "command": "...", ... }` status line.
- Branch on **`error.code`** for the *class* (`E_USAGE`, `E_INPUT`, `E_PARSE`, `E_IO`,
  `E_SECURITY`, `E_DATA`, `E_LIMIT`, `E_UNSUPPORTED`, `E_NOT_FOUND`, `E_VERIFY_FAILED`,
  `E_CHECK_FAILED`, `E_POLICY`, `E_RUNTIME`) and on **`error.zipCode`** for the exact *cause*
  (zipnative's frozen `ZIP_*` code, e.g. `ZIP_PATH_TRAVERSAL`, `ZIP_LIMIT_EXCEEDED`) — never on
  the message text. Numeric **exit codes** stay `0` (success), `1` (runtime / check failure),
  `2` (usage).
- Use **`--dry-run`** to validate input and print the plan without producing output.
- Fetch a **`schema`** (or **`schema manifest`** / **`llms.txt`**) to discover and validate
  before calling, and run **`doctor --format json`** as a capability pre-flight.

See [AGENTS.md](AGENTS.md) and the [`samples/agent/`](samples/agent) scripts.

## Security

- **Offline, always** — no command can open a socket; there is no network opt-in to forget.
  `--dry-run`, `--json`, `govern`, `doctor` are all local.
- **The CLI is the filesystem trust boundary.** The engine never touches the filesystem: it
  returns sanitised paths and data. `extract` and `stream` re-prove containment of every
  destination under `--output-dir` (`safeJoin`), refuse existing files without `--overwrite`,
  and refuse case-fold collisions on case-insensitive filesystems. A symlink is never
  materialised, whatever the flags.
- **Refusals, not guesses** — zip-slip and device names, symlink entries, overlapping entries,
  central/local header disagreement, Zip64 spoofing, duplicate output paths, ambiguous EOCDs and
  > 2^53 sizes are refused by default with their `ZIP_*` code. Opt-outs skip; they never write
  anything unsafe.
- **Bounded by default** — the engine's eight CWE-tagged limits are always on (`--max-*` to
  tune; `none` warns). `inflate` has a mandatory output bound.
- **Data remanence** — `modify` without `--compact` keeps removed / replaced bytes recoverable
  in the output. Use `--compact` when deletion matters.
- **No encryption** — read or write, by engine policy in 1.x. Encrypted entries are detected,
  listed and reported as `skipped` by `verify`; reads fail with `ZIP_UNSUPPORTED_ENCRYPTION`.
- **`--codec` is a trust boundary** — the CLI's only dynamic import of user code (same trust as
  `node -r`): argv only, refused from `.zipnativerc.json`, refused inside a `batch --manifest`
  without `--allow-codec-load`, and read-side only.
- **Path traversal protection** — every file-path argument (and every path inside a manifest)
  is validated against `../` before filesystem access.
- **JSON size cap** — manifests, drafts and JSON inputs are capped at 50 MB before parsing
  (config files at 1 MB).
- Signed builds with npm provenance (Trusted Publishing / OIDC) and a CycloneDX SBOM per
  release — verify with `npm audit signatures`.

See [SECURITY.md](SECURITY.md) for the full security policy and vulnerability disclosure procedure.

## Getting Help

**Have a question?**
- 📖 Check the [FAQ](docs/KNOWLEDGE_BASE.md#12-frequently-asked-questions) first
- 🔍 Search the samples: `grep -r "your-keyword" samples/`
- 📚 Read [KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) for technical details
- 💬 Open a discussion: [GitHub Discussions](https://github.com/Nizoka/zipnative-cli/discussions)

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
