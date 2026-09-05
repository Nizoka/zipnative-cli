# zipnative-cli — Samples

A comprehensive collection of runnable samples covering every command of zipnative-cli, organized by command: **41 demos**, each a **`.sh` + `.ps1` pair** with identical behaviour, plus a dependency-free runner (`run-all.js`, **73 jobs**) that exercises the same invocations from Node.js.

> **Generated archives are not committed.** All output goes to `samples/output/` which is git-ignored. The committed inputs under `samples/input/` are tiny, deterministic and text-only (except one 4 KiB pattern binary), so every `--deterministic` build hashes the same on every machine.

Every sample is **offline** (no command in zipnative-cli can open a socket) and needs **no `unzip` / `7z`** — the CLI is the only archive tool involved. Scripts call `zipnative` when it is on `PATH` and fall back to the local build (`node dist/cli.cjs`) otherwise.

> **Re-running.** The CLI never overwrites an existing file without `--overwrite` (`E_IO`, uniformly on `create` / `modify` / `cat` / `inflate --output`, `extract`, `stream --output-dir` and `batch`). Delete `samples/output/` — or pass `--clean` to `run-all.js` — before a second run; a script that reuses an archive from an earlier step only builds it when it is missing.

---

## Quick Navigation

**New to zipnative-cli?** Follow this path:
1. ✅ Build the CLI once: `npm run build`
2. ✅ Run every sample job: `node samples/run-all.js --clean`
3. ✅ Read one script end to end: [create/03-deterministic.sh](create/03-deterministic.sh) (reproducible builds) or [extract/04-refusals.sh](extract/04-refusals.sh) (secure-by-default extraction)
4. ✅ Drive it from a program: [agent/02-error-envelope.sh](agent/02-error-envelope.sh) + the [agent loop](#agent-loop-branch-on-errorcode-then-errorzipcode) below
5. ✅ Read the docs: [../README.md](../README.md), [../AGENTS.md](../AGENTS.md), `zipnative <command> --help`

---

## Quick Start

### Run all samples at once

```bash
# Prerequisites: Node.js >= 22 and a built CLI (npm run build),
# or zipnative-cli installed globally: npm install -g zipnative-cli

# From the repo root — runs every job and writes to samples/output/
node samples/run-all.js --clean
```

### Run a single sample

```bash
bash samples/create/01-basic.sh
```

**Windows (PowerShell 7.4+):**

```powershell
pwsh -File samples\create\01-basic.ps1
```

### Run a single command by hand

```bash
zipnative create samples/input/text --deterministic --output samples/output/text.zip
zipnative inspect --input samples/output/text.zip --check deterministic --summary --format json
```

---

## Directory Structure

```
samples/
├── run-all.js                    Cross-platform job runner (Node.js ≥ 22, no dependencies)
├── input/                        Committed source trees (small, deterministic)
│   ├── text/                     Three text files (dash / underscore / dots in one name)
│   ├── binary/pattern.bin        4096 bytes, byte i = (i*31+7) & 0xff
│   ├── unicode/                  café/résumé.txt, 文档/说明.md, emoji-📦.txt — UTF-8 names
│   ├── manifest/entries.json     `create --from-manifest` demo (path, data, dataBase64, directory, mode, comment)
│   ├── manifest/empty.json       {"entries":[]} — a valid, empty manifest
│   ├── manifest/edits.json       `modify --from-manifest` demo (remove, rename, replace, add, add-dir)
│   ├── batch/tasks.json          `batch --manifest` pipeline: create → verify → inspect → extract → crc32 (@id refs)
│   ├── config/.zipnativerc.json  { create: { deterministic, level 9 }, extract: { overwrite } }
│   └── govern/draft-{good,bad}.md  HITL drafts for `govern verify-issue` (bad one proposes `npm install some-lib`)
├── create/                       Build archives: basic, store/deflate, deterministic, manifest, stdin, parallel, comments
├── list/                         Central-directory listing: table, JSON + --fields, NDJSON
├── inspect/                      Forensic report, --check gates, --strict diagnostics
├── extract/                      Secure extraction: basic, globs + --flat, --dry-run, refusals
├── cat/                          Stream entries to stdout (decoded and --raw)
├── verify/                       Integrity verification + tamper detection
├── stream/                       Forward-only reader over a pipe: list, extract, cat
├── modify/                       Append-only edits, --compact, rename/comment/in-place, manifest
├── crc32/                        CRC-32 of files / stdin, --expect gate
├── inflate/                      Raw DEFLATE decompression, --max-output bound
├── batch/                        Directory mode, manifest pipeline, --dry-run
├── doctor/                       Environment / capability preflight
├── schema/                       JSON Schemas, error catalogue, capability manifest
├── completion/                   bash / zsh / fish / powershell completion scripts
├── config/                       .zipnativerc.json defaults, --config, --no-config
├── agent/                        --json envelopes, --dry-run, error codes, token economy
├── govern/                       AI-governance rules / policy / verify-issue
└── output/                       (git-ignored) every sample writes under output/<command>/
```

Every script resolves `ROOT_DIR` from its own location, reads from `samples/input/` and writes under `samples/output/<command>/`, so it can be launched from any working directory.

---

## create Samples

Build a deterministic ZIP from files, directories, stdin or a manifest.

| File | Description |
|------|-------------|
| [01-basic.sh](create/01-basic.sh) / [.ps1](create/01-basic.ps1) | Archive two directory trees; `list` the result; rebase entry names with `--base` / `--prefix` (dry run) |
| [02-store-vs-deflate.sh](create/02-store-vs-deflate.sh) / [.ps1](create/02-store-vs-deflate.ps1) | `--method store`, `--method deflate --level 9`, `--store-ext bin`; size comparison |
| [03-deterministic.sh](create/03-deterministic.sh) / [.ps1](create/03-deterministic.ps1) | **Reproducible builds** — build twice with `--deterministic`, compare SHA-256, gate with `inspect --check deterministic` |
| [04-from-manifest.sh](create/04-from-manifest.sh) / [.ps1](create/04-from-manifest.ps1) | `--from-manifest`: file path (manifest-relative), inline `data`, `dataBase64`, `directory`, `mode`, `comment`; empty manifest |
| [05-stdin-stream.sh](create/05-stdin-stream.sh) / [.ps1](create/05-stdin-stream.ps1) | Pipe a file into `--stdin-name <name> --stream --chunk-size`; the data-descriptor layout (same content as the buffered writer, different bytes — `inspect` reports `canonicalLayout: false`); CRC round trip |
| [06-parallel.sh](create/06-parallel.sh) / [.ps1](create/06-parallel.ps1) | `--parallel --workers 2 --min-job-size 1k`; proves byte identity with the sequential writer |
| [07-comment-and-order.sh](create/07-comment-and-order.sh) / [.ps1](create/07-comment-and-order.ps1) | `--comment`, `--entry-comment name=text`, `--order insertion` (the **argv order**, directories still name-sorted — how an EPUB gets `mimetype` first), `--date <ISO>` (UTC wall-clock, 2-second resolution); what `inspect` reports for each |

## list Samples

List archive entries without decompressing anything.

| File | Description |
|------|-------------|
| [01-table.sh](list/01-table.sh) / [.ps1](list/01-table.ps1) | Text table, `--long` (mode + flags; no `-l` short form — flags and positionals are order-independent), `--validate eager`, `--include` glob |
| [02-json-fields.sh](list/02-json-fields.sh) / [.ps1](list/02-json-fields.ps1) | `--format json`, `--summary`, `--fields entries.name,entries.uncompressedSize`, compact vs `--pretty` under `--json` |
| [03-ndjson.sh](list/03-ndjson.sh) / [.ps1](list/03-ndjson.ps1) | `--format ndjson` — one row per line, filtered with `--exclude` and a shell / `ConvertFrom-Json` pipeline |

## inspect Samples

Forensic archive report with determinism / security assertions.

| File | Description |
|------|-------------|
| [01-report.sh](inspect/01-report.sh) / [.ps1](inspect/01-report.ps1) | Text and JSON report, `--entries`, `--fields determinism` |
| [02-check-gates.sh](inspect/02-check-gates.sh) / [.ps1](inspect/02-check-gates.ps1) | **CI gate** — passing `--check` set, then a failing `store-only` check → exit 1 / `E_CHECK_FAILED` |
| [03-strict-diagnostics.sh](inspect/03-strict-diagnostics.sh) / [.ps1](inspect/03-strict-diagnostics.ps1) | Prepend a stub with `node -e` → `ZIP_PREPENDED_DATA` diagnostic; `--strict` escalates it to `E_CHECK_FAILED` (and `verify --strict` to `E_VERIFY_FAILED`) |

## extract Samples

Extract to a directory — zip-slip, symlink, bomb and duplicate guards on by default.

| File | Description |
|------|-------------|
| [01-basic.sh](extract/01-basic.sh) / [.ps1](extract/01-basic.ps1) | `--output-dir` extraction with `--json`; UTF-8 names round-trip; byte check against the source |
| [02-filter-and-flat.sh](extract/02-filter-and-flat.sh) / [.ps1](extract/02-filter-and-flat.ps1) | `--include` / `--exclude` globs, `--entry`, `--flat` |
| [03-dry-run-plan.sh](extract/03-dry-run-plan.sh) / [.ps1](extract/03-dry-run-plan.ps1) | `--dry-run` plan (text and JSON); proves the output directory is never created |
| [04-refusals.sh](extract/04-refusals.sh) / [.ps1](extract/04-refusals.ps1) | Overwrite refusal (`E_IO`, the existing file is left intact) → `--overwrite`; `--skip-unsafe --skip-symlinks` tolerance (skip, never write); refusal catalogue. Hostile shapes are exercised byte-for-byte in `tests/integration/refusal-posture.test.ts` |

## cat Samples

| File | Description |
|------|-------------|
| [01-cat-entry.sh](cat/01-cat-entry.sh) / [.ps1](cat/01-cat-entry.ps1) | Stream one entry, concatenate two to a file, `--dry-run` sizes, `--raw` compressed payload → `inflate` round trip |

## verify Samples

| File | Description |
|------|-------------|
| [01-verify.sh](verify/01-verify.sh) / [.ps1](verify/01-verify.ps1) | Text verdict, JSON report, `--json --summary` one-liner |
| [02-tamper-detect.sh](verify/02-tamper-detect.sh) / [.ps1](verify/02-tamper-detect.ps1) | Flip one byte of a STORED payload with `node -e` → `FAIL (crc)`, exit 1 / `E_VERIFY_FAILED`; `cat` fails with `E_DATA` + `ZIP_CRC_MISMATCH` |

## stream Samples

Forward-only reader for unseekable input (pipes). Every JSON output carries `trust: "local-headers-only"`.

| File | Description |
|------|-------------|
| [01-forward-list.sh](stream/01-forward-list.sh) / [.ps1](stream/01-forward-list.ps1) | Pipe an archive into `stream`: text table, `--format ndjson`, `--json --summary`, `--input` file mode |
| [02-forward-extract.sh](stream/02-forward-extract.sh) / [.ps1](stream/02-forward-extract.ps1) | `stream --output-dir` from a pipe; byte-identical to a regular `extract`; `--dry-run` |
| [03-forward-cat.sh](stream/03-forward-cat.sh) / [.ps1](stream/03-forward-cat.ps1) | `stream --cat <name>` (repeatable) piped into `crc32` |

## modify Samples

Incremental edits without recompressing untouched entries.

| File | Description |
|------|-------------|
| [01-append-only.sh](modify/01-append-only.sh) / [.ps1](modify/01-append-only.ps1) | `--add` / `--replace` / `--remove`; the default **append-only** layout, data remanence and the `ZIP_MULTIPLE_EOCD` diagnostic it leaves behind |
| [02-compact.sh](modify/02-compact.sh) / [.ps1](modify/02-compact.ps1) | `--compact` canonical rewrite (true deletion) vs append-only: sizes, `multipleEocd`, both verify |
| [03-rename-and-comment.sh](modify/03-rename-and-comment.sh) / [.ps1](modify/03-rename-and-comment.ps1) | `--rename from=to`, `--add-dir`, `--comment`, `--dry-run`, `--in-place` (exclusively created temp file + atomic rename). Every untouched entry is verified before it is copied — see `verified` in the envelope |
| [04-from-manifest.sh](modify/04-from-manifest.sh) / [.ps1](modify/04-from-manifest.ps1) | `--from-manifest` with [input/manifest/edits.json](input/manifest/edits.json) |

## crc32 Samples

| File | Description |
|------|-------------|
| [01-crc32.sh](crc32/01-crc32.sh) / [.ps1](crc32/01-crc32.ps1) | Files, stdin, `--format json`, `--expect <hex>` pass, then an expected mismatch (`E_CHECK_FAILED` with both CRCs in `detail`) |

## inflate Samples

| File | Description |
|------|-------------|
| [01-inflate.sh](inflate/01-inflate.sh) / [.ps1](inflate/01-inflate.ps1) | `node -e deflateRawSync` → `inflate` (`--dry-run`, to file, from stdin); `--max-output 16` trips `E_DATA` / `ZIP_INFLATE_OUTPUT_OVERFLOW` |

## batch Samples

| File | Description |
|------|-------------|
| [01-directory-mode.sh](batch/01-directory-mode.sh) / [.ps1](batch/01-directory-mode.ps1) | `--input-dir` subfolders → one archive each (`--deterministic --concurrency 2`; every `create` flag is forwarded), then `--task verify` on the folder |
| [02-manifest-pipeline.sh](batch/02-manifest-pipeline.sh) / [.ps1](batch/02-manifest-pipeline.ps1) | `--manifest` pipeline with `@id` references: create → verify → inspect → extract → crc32 (staged under `output/batch/02-pipeline/` because manifest paths are anchored to the manifest's directory and refused on `..`). Under `--json` stdout is one batch document with each task's report inside |
| [03-dry-run.sh](batch/03-dry-run.sh) / [.ps1](batch/03-dry-run.ps1) | `--dry-run` for both modes: validates structure, whitelist, `@id` graph and codec policy; writes nothing |

## doctor Samples

| File | Description |
|------|-------------|
| [01-doctor.sh](doctor/01-doctor.sh) / [.ps1](doctor/01-doctor.ps1) | Text and JSON preflight; `--pure-codecs` + `--max-*` overrides reflected in the report (the `limits` check carries the numbers under `data`); `--version --json` |

## schema Samples

| File | Description |
|------|-------------|
| [01-schema.sh](schema/01-schema.sh) / [.ps1](schema/01-schema.ps1) | `schema list`; saves the manifest schemas, `errors` and the capability `manifest`; prints E_* → exit code; unknown subject → `E_USAGE` exit 2 |

## completion Samples

| File | Description |
|------|-------------|
| [01-generate.sh](completion/01-generate.sh) / [.ps1](completion/01-generate.ps1) | Generate bash / zsh / fish / powershell completers into `output/completion/` (path flags such as `--input` complete files); install one-liners in the header |

## config Samples

| File | Description |
|------|-------------|
| [01-config.sh](config/01-config.sh) / [.ps1](config/01-config.ps1) | `--config samples/input/config/.zipnativerc.json` vs `--no-config`; upward discovery from the config's directory; CLI flag precedence; command-scoped `extract.overwrite` |

## agent Samples

The agent-native contract: stdout carries the artefact, stderr carries one JSON envelope.

| File | Description |
|------|-------------|
| [01-json-and-dry-run.sh](agent/01-json-and-dry-run.sh) / [.ps1](agent/01-json-and-dry-run.ps1) | `--json` status envelope (anywhere on the command line — flags and positionals are order-independent), `--dry-run` (nothing written), capturing stderr separately, `--pretty` |
| [02-error-envelope.sh](agent/02-error-envelope.sh) / [.ps1](agent/02-error-envelope.ps1) | Deterministic failures: `E_NOT_FOUND` (+ `ZIP_ENTRY_NOT_FOUND`), `E_PARSE` + `zipCode`, `E_IO`, `E_USAGE` (exit 2), `E_INPUT`, `E_DATA` + `detail` |
| [03-token-economy.sh](agent/03-token-economy.sh) / [.ps1](agent/03-token-economy.ps1) | Six report sizes side by side: pretty vs compact, `--summary`, `--fields`, `list --fields entries.name` |

## govern Samples

AI-governance / Human-in-the-Loop contract.

| File | Description |
|------|-------------|
| [01-rules-policy.sh](govern/01-rules-policy.sh) / [.ps1](govern/01-rules-policy.ps1) | `govern rules` (human/agent protocol) and `govern policy --pretty` (machine-readable JSON) |
| [02-verify-issue.sh](govern/02-verify-issue.sh) / [.ps1](govern/02-verify-issue.ps1) | `verify-issue`: [draft-good.md](input/govern/draft-good.md) passes, [draft-bad.md](input/govern/draft-bad.md) is blocked (exit 1 / `E_POLICY`); JSON report; stdin input |

---

## run-all.js Options

`samples/run-all.js` executes a declarative table of CLI invocations (one or more per sample) directly with Node.js — no shell needed — and asserts what the scripts assert: byte identity for the deterministic and parallel builds, `stream` vs `extract` parity, and the expected exit code + `E_*` code for every failure demo.

```bash
node samples/run-all.js                     # every job (73 jobs across the 41 demos)
node samples/run-all.js --category extract  # one directory's jobs
node samples/run-all.js --clean             # wipe samples/output/ first
node samples/run-all.js --verbose           # echo every command line
```

| Flag | Effect |
|------|--------|
| `--category <name>` | Only run the jobs of `samples/<name>/` |
| `--clean` | Delete `samples/output/` before running |
| `--verbose` | Print each `zipnative …` command line before it runs |
| `ZIPNATIVE_CLI=<path>` | Environment variable: run another built `cli.cjs` instead of `dist/cli.cjs` |

Exit codes: `0` all jobs passed, `1` at least one failed (stderr is surfaced under the job), `2` no built CLI found (run `npm run build`).

`completion` and `govern` are print-only categories: their jobs run and are checked for exit code, but no artefact is kept.

---

## Integration Patterns

### Shell pipeline

```bash
# Build, gate, verify — stop at the first non-zero exit.
set -euo pipefail
zipnative create dist/ --deterministic --output release.zip --quiet
zipnative inspect --input release.zip --check deterministic,no-symlinks,max-uncompressed=512m --summary --format json
zipnative verify  --input release.zip --strict --json --summary
sha256sum release.zip > release.zip.sha256
```

### GitHub Actions — reproducible-build gate

```yaml
- name: Build archive twice and require identical bytes
  run: |
    zipnative create dist/ --deterministic --output build-a.zip --quiet
    zipnative create dist/ --deterministic --output build-b.zip --quiet
    sha256sum build-a.zip > expected.sha256
    sed 's/build-a.zip/build-b.zip/' expected.sha256 | sha256sum --check
    zipnative inspect --input build-a.zip --check deterministic,epoch-timestamps,canonical-order --summary --format json

- name: Upload artifact
  uses: actions/upload-artifact@v4
  with:
    name: release
    path: build-a.zip
```

### Docker

```dockerfile
FROM node:22-alpine
RUN npm install --global zipnative-cli
WORKDIR /work
COPY dist/ ./dist/
RUN zipnative create dist --deterministic --output /out/release.zip \
 && zipnative verify --input /out/release.zip --strict
```

### TypeScript integration (spawn child process)

```typescript
import { spawn } from 'node:child_process';

interface Envelope {
  ok: boolean;
  command: string | null;
  error?: { code: string; message: string; zipCode?: string; entryName?: string; detail?: Record<string, unknown> };
  [key: string]: unknown;
}

/** Run zipnative in agent mode: stdout is the artefact, stderr holds ONE JSON envelope. */
function zipnative(args: string[], stdin?: Buffer): Promise<{ stdout: Buffer; envelope: Envelope; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('zipnative', [...args, '--json'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => { err += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      const line = err.trim().split('\n').findLast((l) => l.startsWith('{')) ?? '{"ok":false,"command":null}';
      resolve({ stdout: Buffer.concat(out), envelope: JSON.parse(line) as Envelope, code: code ?? 1 });
    });
    if (stdin) child.stdin.end(stdin); else child.stdin.end();
  });
}

const build = await zipnative(['create', 'dist', '--deterministic', '--output', 'release.zip']);
if (!build.ok) throw new Error(`${build.envelope.error?.code}: ${build.envelope.error?.message}`);
```

### Agent loop: branch on `error.code`, then `error.zipCode`

```typescript
const result = await zipnative(['extract', '--input', archive, '--output-dir', dest]);
if (!result.envelope.ok) {
  const { code, zipCode, entryName } = result.envelope.error!;
  switch (code) {
    case 'E_USAGE':        // exit 2 — fix the invocation, never retry blindly
      throw new Error('bad flags');
    case 'E_IO':           // e.g. refusing to overwrite → retry with --overwrite if that is intended
      return zipnative(['extract', '--input', archive, '--output-dir', dest, '--overwrite']);
    case 'E_SECURITY':     // hostile shape — decide per cause, never weaken guards by default
      if (zipCode === 'ZIP_PATH_TRAVERSAL' || zipCode === 'ZIP_SYMLINK_REJECTED') {
        return zipnative(['extract', '--input', archive, '--output-dir', dest, '--skip-unsafe', '--skip-symlinks']);
      }
      throw new Error(`refused: ${zipCode} (${entryName})`);
    case 'E_LIMIT':        // a ZipLimits bound tripped — raise it only for trusted input
      throw new Error(`limit: ${zipCode}`);
    case 'E_DATA':         // corrupt payload (ZIP_CRC_MISMATCH …) — quarantine the archive
    case 'E_PARSE':        // not a ZIP at all (ZIP_EOCD_NOT_FOUND …)
    default:
      throw new Error(`${code}/${zipCode ?? '-'}: ${result.envelope.error!.message}`);
  }
}
```

The complete catalogue — every `E_*` code with its exit code and the full `ZIP_*` → `E_*` mapping — comes from `zipnative schema errors`.

---

## See Also

- [../README.md](../README.md) — Installation, quick start, command reference
- [../AGENTS.md](../AGENTS.md) — Agent automation contract (`--json`, `--dry-run`, schemas, error codes)
- `zipnative <command> --help` — per-command flags
- [zipnative](https://github.com/Nizoka/zipnative) — the engine (deterministic writer, secure reader, ISO/IEC 21320-1 conformance)
