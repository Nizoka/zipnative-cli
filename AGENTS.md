# AGENTS.md — Driving zipnative-cli from autonomous agents

`zipnative-cli` is built so that an autonomous AI agent — or any program — can
drive it inside a larger automated process **deterministically and safely**.

There is **no separate runtime** for this: agent support is a thin presentation
layer over the normal command dispatch. The planned `zipnative-mcp` server is a
different integration; this document is about driving the **CLI** directly
(spawn a process, pass flags, read stdout/stderr, branch on the exit code).

The CLI is a thin dispatch layer over the [`zipnative`](https://github.com/Nizoka/zipnative)
engine: every ZIP decision is the engine's, and every engine error reaches you
with its frozen `ZIP_*` code intact.

---

## 1. The process contract

**Prerequisite:** Node.js ≥ 22 (check with `zipnative doctor`).

| Channel | Carries |
|---------|---------|
| **stdout** | The primary artifact: archive bytes (`create`, `modify`), entry bytes (`cat`, `stream --cat`, `inflate`), a JSON or text report (`list`, `inspect`, `verify`, `crc32`, `batch`, `doctor`, `govern verify-issue`), a JSON Schema (`schema`), the governance protocol / policy (`govern rules` / `policy`), or a completion script (`completion`). `extract` and `stream --output-dir` write files under `--output-dir`. |
| **stderr** | All diagnostics: progress, warnings, engine diagnostics as text, and the agent JSON envelopes below. |
| **exit code** | `0` success · `1` runtime / check failure · `2` usage error. Unchanged in every mode. |

Keep stdout binary-clean: write archives and entries to `--output <file>` /
`--output-dir <dir>` or redirect stdout, and read the envelope from stderr.
**Nothing here opens a socket** — there is no network opt-in to guard.

---

## 2. Agent mode — `--json`

Pass the global `--json` flag to any command to switch on machine-readable
envelopes (the data on stdout is unchanged; the JSON-on-stdout commands switch
to their JSON format and compact it).

**On failure**, a single JSON object is written to stderr (`zipnative schema error`):

```json
{ "ok": false, "command": "extract", "error": { "code": "E_SECURITY", "message": "Failed to extract: zipnative: entry '../etc/passwd' escapes the extraction root …", "zipCode": "ZIP_PATH_TRAVERSAL", "entryName": "../etc/passwd" } }
```

```json
{ "ok": false, "command": "extract", "error": { "code": "E_LIMIT", "message": "Failed to extract: zipnative: maxCompressionRatio exceeded …", "zipCode": "ZIP_LIMIT_EXCEEDED", "entryName": "bomb.bin", "detail": { "limit": "maxCompressionRatio", "configured": 1024, "observed": 4096 } } }
```

```json
{ "ok": false, "command": "cat", "error": { "code": "E_UNSUPPORTED", "message": "Failed to read entry \"secret.txt\": zipnative: entry is encrypted …", "zipCode": "ZIP_UNSUPPORTED_ENCRYPTION", "entryName": "secret.txt", "detail": { "feature": "zipcrypto" } } }
```

`error.code` is the **class** (13 values, below), `error.zipCode` is the exact
**cause** — zipnative's frozen `err.code`, verbatim (39 values). `entryName` and
`detail` appear when the engine knows them: `{ limit, configured, observed }`
for `E_LIMIT`, `{ feature }` for `E_UNSUPPORTED`, `{ expectedCrc, actualCrc }`
for `E_DATA` / `crc32 --expect`.

**On success**, `create` / `modify` / `extract` / `stream` (extract and cat
modes, or list mode under `--dry-run`) / `cat` / `inflate` / `crc32` write a
status line to stderr (`zipnative schema status`):

```json
{ "ok": true, "command": "create", "output": "out.zip", "entries": 12, "files": 11, "directories": 1, "bytesIn": 131072, "method": "deflate", "level": 6, "deterministic": true, "order": "canonical", "stream": false, "parallel": false, "skipped": [], "dryRun": false, "bytes": 48213, "tier": "pure-pinned", "diagnostics": [] }
```

```json
{ "ok": true, "command": "extract", "outputDir": "/work/out", "entries": 11, "files": 11, "directories": 1, "bytes": 131072, "skipped": [{ "name": "aux.h", "reason": "unsafe-path" }], "symlinksAsData": 0, "dryRun": false, "diagnostics": [] }
```

Command-specific fields: `modify` adds `edits: [{ op, name, to? }]`, `layout:
"append-only" | "compact"`, `changed`; `cat` adds `entries: [names]`, `raw`,
`verifyCrc`; `stream` adds `mode`, `trust: "local-headers-only"`, `stoppedAt`;
`inflate` adds `method`, `methodName`, `bytesIn`, `bytesOut`, `leftover`,
`maxOutput`, `sync`, `tier`; `crc32` reports `files`, `bytes`. Every archive
envelope carries the engine's `diagnostics: [{ code, severity, message, entryName? }]`.

`list`, `inspect`, `verify`, `stream --list`, `batch`, `doctor`, `crc32` and
`govern verify-issue` put their result document on **stdout** as JSON;
`--json` only adds the failure envelope on stderr and selects / compacts the
JSON format.

### Stable error classes

Branch on `error.code` for the class, on `error.zipCode` for the cause — never
on the human message:

| Code | Meaning | Typical exit |
|------|---------|--------------|
| `E_USAGE` | Missing/invalid flag or argument (also `ZIP_INVALID_OPTION`, `ZIP_LIMIT_INVALID`) | 2 |
| `E_INPUT` | User-supplied payload, entry name or manifest failed validation, or a conflict (entry exists, duplicate name, unsafe name at creation) | 1 |
| `E_PARSE` | The bytes are not a valid ZIP / DEFLATE stream / JSON document (structural) | 1 |
| `E_IO` | Filesystem or stream I/O failure, including refusing to overwrite an existing file | 1 |
| `E_SECURITY` | Hostile archive shape (zip-slip / device name, overlap, symlink, duplicate path, CD/LFH mismatch, Zip64 spoofing) or the CLI sink guard tripped | 1 |
| `E_DATA` | Integrity failure: CRC / size / data-descriptor mismatch, decompression failure, output overflow | 1 |
| `E_LIMIT` | A named security bound (`ZipLimits`) was exceeded | 1 |
| `E_UNSUPPORTED` | Encryption, unknown method, multi-disk, zip64 streaming, CD-less descriptor, codec mode | 1 |
| `E_NOT_FOUND` | A named entry does not exist in the archive | 1 |
| `E_VERIFY_FAILED` | `verify` verdict is negative (`zipCode` set for structural refusals) | 1 |
| `E_CHECK_FAILED` | `inspect --check`, `crc32 --expect`, or a `--strict` diagnostic escalation failed | 1 |
| `E_POLICY` | `govern verify-issue` found an AI-governance policy violation | 1 |
| `E_RUNTIME` | Catch-all runtime error (also `ZIP_API_MISUSE`, `ZIP_INTERNAL` — report these) | 1 |

### The 39 causes — `error.zipCode` → `error.code`

The mapping is `ZIP_TO_CLI` in `src/utils/ziperr.ts`, also printed by
`zipnative schema errors`; `raisedWhen` / `remedy` per code live in
[`docs/data/errors.json`](docs/data/errors.json).

| `zipCode` | `code` | What it means for you |
|-----------|--------|-----------------------|
| `ZIP_INVALID_OPTION` | `E_USAGE` | An option value the engine forbids reached it — a CLI bug; report it |
| `ZIP_INPUT_TOO_LARGE` | `E_LIMIT` | > 2 GiB in one pure-TS deflate call — split the input or drop `--deterministic` for that entry |
| `ZIP_ENTRY_NOT_FOUND` | `E_NOT_FOUND` | Names are case-sensitive — `list` first |
| `ZIP_ENTRY_EXISTS` | `E_INPUT` | `modify --add` over an existing name, or `--rename` onto one — use `--replace` / `--remove` first |
| `ZIP_API_MISUSE` | `E_RUNTIME` | Engine usage contract violated — a CLI bug; report it |
| `ZIP_STRICT_DIAGNOSTIC` | `E_CHECK_FAILED` | `--strict` escalated a diagnostic; the message embeds its code |
| `ZIP_INTERNAL` | `E_RUNTIME` | Engine invariant broke — report it with the archive |
| `ZIP_EOCD_NOT_FOUND` | `E_PARSE` | Not a ZIP, truncated, or hostile trailing bytes |
| `ZIP_EOCD_INCONSISTENT` | `E_PARSE` | Corrupt or hostile — re-obtain the file |
| `ZIP_ZIP64_LOCATOR_MISSING` | `E_PARSE` | Truncated or corrupt zip64 archive |
| `ZIP_ZIP64_EOCD_MISPLACED` | `E_PARSE` | Corrupt, or an unsupported prepended-data layout |
| `ZIP_CD_INCONSISTENT` | `E_PARSE` | Central directory contradicts its declared counts / size |
| `ZIP_RECORD_TRUNCATED` | `E_PARSE` | A record or payload overruns the file — verify the transfer completed |
| `ZIP_SIGNATURE_MISMATCH` | `E_PARSE` | No PK signature where one is declared |
| `ZIP_STREAM_TRUNCATED` | `E_PARSE` | `stream` input ended mid-record / mid-entry (or without a central directory) |
| `ZIP_VALUE_UNREPRESENTABLE` | `E_PARSE` | A 64-bit field exceeds 2^53 — 1 — unsupported by design |
| `ZIP_INVALID_ENTRY_NAME` | `E_INPUT` | A name you asked to write is unsafe (empty, NUL, backslash, absolute, `..`) |
| `ZIP_DUPLICATE_ENTRY_NAME` | `E_INPUT` | Duplicate names at creation, or a duplicate-name archive given to `modify` — extract and rebuild |
| `ZIP_DEFLATE_TRUNCATED` | `E_PARSE` | Deflate stream ends mid-block |
| `ZIP_DEFLATE_CORRUPT` | `E_PARSE` | Deflate stream structurally invalid |
| `ZIP_ENTRY_OVERLAP` | `E_SECURITY` | Entries share bytes — always refused, no opt-out |
| `ZIP_CD_LFH_MISMATCH` | `E_SECURITY` | Local header contradicts the central directory (method) — refused |
| `ZIP_ZIP64_CONTRADICTION` | `E_SECURITY` | Zip64 value contradicts a classic field — refused |
| `ZIP_PATH_TRAVERSAL` | `E_SECURITY` | Zip-slip or a Windows device name — `extract --skip-unsafe` skips such entries (never writes them) |
| `ZIP_SYMLINK_REJECTED` | `E_SECURITY` | Symlink entry — `--skip-symlinks`, or `--allow-symlinks` to get the target text as a file |
| `ZIP_EXTRACT_DUPLICATE_PATH` | `E_SECURITY` | Two entries → one path — `--on-duplicate first\|last` decides deliberately |
| `ZIP_CRC_MISMATCH` | `E_DATA` | Corrupt payload; `detail` carries both CRCs |
| `ZIP_SIZE_MISMATCH` | `E_DATA` | Metadata lies about sizes — treat as corrupt or hostile |
| `ZIP_INFLATE_OUTPUT_OVERFLOW` | `E_DATA` | More output than declared / permitted (`inflate --max-output`) |
| `ZIP_DESCRIPTOR_MISMATCH` | `E_DATA` | Bit-3 entry's descriptor matches nothing — use the complete file |
| `ZIP_DECOMPRESSION_FAILED` | `E_DATA` | Codec failed mid-stream on a corrupt payload |
| `ZIP_LIMIT_EXCEEDED` | `E_LIMIT` | `detail.limit` names the bound — raise the matching `--max-*` only for trusted input |
| `ZIP_LIMIT_INVALID` | `E_USAGE` | Unreachable from the CLI (values are pre-validated) |
| `ZIP_UNSUPPORTED_ENCRYPTION` | `E_UNSUPPORTED` | Encrypted entry — route around it (`list` shows `isEncrypted`; `stream --skip-unsupported`) |
| `ZIP_UNSUPPORTED_METHOD` | `E_UNSUPPORTED` | No codec for the method — `--codec <module>` |
| `ZIP_UNSUPPORTED_MULTI_DISK` | `E_UNSUPPORTED` | Spanned archive — an explicit anti-goal |
| `ZIP_UNSUPPORTED_ZIP64_STREAMING` | `E_UNSUPPORTED` | `create --stream` entry > 4 GiB — buffer (omit `--stream`) or split |
| `ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR` | `E_UNSUPPORTED` | `stream` cannot delimit this bit-3 entry — use `list` / `extract` on the whole file |
| `ZIP_UNSUPPORTED_CODEC_MODE` | `E_UNSUPPORTED` | The codec supports only the other access mode |

### Diagnostics (informational, 11 codes)

Non-fatal conformance concerns never throw by default. They reach you as
`warning:` / `info:` lines on stderr (text mode, suppressed by `--quiet`), or as
`diagnostics: [{ code, severity, message, entryName? }]` inside the status
envelope / the stdout report under `--json`. `--strict` escalates the **first**
one into `ZIP_STRICT_DIAGNOSTIC` → `E_CHECK_FAILED` before any output byte
(`verify --strict`: report printed, then `E_VERIFY_FAILED`).

| Code | Severity | Meaning |
|------|----------|---------|
| `ZIP_PREPENDED_DATA` | info | Bytes precede the archive (SFX stub / concatenation); offsets shifted |
| `ZIP_MULTIPLE_EOCD` | info | Several EOCD signatures; the last self-consistent one was used |
| `ZIP_NAME_MISMATCH` | warning | Local header name differs from the central directory; the CD wins |
| `ZIP_UNICODE_PATH_CONFLICT` | warning | 0x7075 Unicode Path extra disagrees with the header name; header wins |
| `ZIP_INVALID_UTF8_NAME` | warning | Bit 11 claims UTF-8 but the bytes are not; decoded as CP437 |
| `ZIP_DUPLICATE_NAME` | warning | Duplicate names in the central directory; `getEntry` returns the last |
| `ZIP_EXTRA_FIELD_MALFORMED` | warning | An extra field overruns its length and was skipped |
| `ZIP_ZIP64_EXTRA_IGNORED` | warning | Zip64 extra supplied a value for a non-sentinel field; header wins |
| `ZIP_TIMESTAMP_NOT_PINNED` | info | `--date now` makes the output non-reproducible |
| `ZIP_NONDETERMINISTIC_CODEC` | info | Timestamps pinned but a platform codec in use — pass `--deterministic` |
| `ZIP_DEAD_BYTES_RATIO` | info | An append-only `modify` left > 50 % dead bytes — pass `--compact` |

---

## 3. Token economy — compact JSON, `--summary`, `--fields`

The JSON that `list` / `inspect` / `verify` / `stream` / `batch` write to
**stdout** is the bulk of what an agent pays for in tokens. Three composable
levers shrink it — typically by ~90 % — without losing the fields you branch on.

**Compact by default under `--json`.** In agent mode the stdout JSON is minified
(no indentation). Pass `--pretty` to force indentation back on. Outside `--json`
the output stays pretty for humans.

**`--summary` — the canonical minimal verdict.**

| Command | `--summary` shape |
|---------|-------------------|
| `list` | `{ "entries": <int>, "files": <int>, "directories": <int>, "compressedSize": <int>, "uncompressedSize": <int>, "zip64": <bool>, "encrypted": <int> }` |
| `inspect` | `{ "entries": <int>, "bytes": <int>, "uncompressedSize": <int>, "zip64": <bool>, "encrypted": <int>, "deterministic": <bool>, "diagnostics": <int>, "checksPassed"?: <bool> }` |
| `verify` | `{ "ok": <bool>, "entries": <int>, "failed": <int>, "skipped": <int>, "diagnostics": <int>, "error"?: "ZIP_*" }` |
| `stream` | `{ "entries": <int>, "bytes": <int>, "trust": "local-headers-only" }` |
| `batch` | `{ "ok": <bool>, "command": "batch", "mode": "directory" \| "manifest", "task"?: …, "total": <int>, "succeeded": <int>, "failed": <int>, "skipped"?: <int> }` (drops `results` / `tasks`) |

**`--fields a,b.c` — dot-path projection.** Keep only the paths you name. A
segment landing on an array maps over every element; unknown paths are silently
omitted (so a conditionally-absent field never crashes the run). `--summary`
wins when both are given.

```bash
# Smallest possible "is this archive intact?" probe:
zipnative verify --input a.zip --json --summary             # → {"ok":true,"entries":12,"failed":0,"skipped":0,"diagnostics":0}
zipnative inspect --input a.zip --json --fields determinism.deterministic,stats.encrypted
zipnative list --input a.zip --json --fields entries.name,entries.uncompressedSize
zipnative batch --manifest tasks.json --json --summary
```

The compact shapes are schema-pinned — validate them with `schema
entries-summary`, `inspect-summary`, `verify-summary`, `stream-summary`,
`batch-summary`. `list --format ndjson` / `stream --format ndjson` emit one
`EntryRow` per line for streaming consumers.

---

## 4. Validate first — `--dry-run`

`create`, `extract`, `modify`, `stream`, `cat`, `inflate` and `batch` accept
`--dry-run`: inputs are fully validated (inputs walked and names checked,
archives opened and every destination proven safe, edits applied to the
modifier, manifests parsed and their `@ref` graph resolved) but **no output is
produced or written**. Text mode prints `plan …` / `skip …` lines; combine with
`--json` for a `{ "ok": true, "dryRun": true, … }` envelope that already carries
`entries`, `bytes`, `skipped` and `diagnostics`.

```bash
zipnative extract --input upload.zip --output-dir out/ --dry-run --json
```

---

## 5. Discover shapes — `schema`

Fetch a versioned JSON Schema (Draft 2020-12) and validate input with your own
tooling before invoking a command. Each schema carries a `$id` embedding the CLI
version so you can detect drift.

```bash
zipnative schema list              # → { "subjects": [ …22 subjects… ] }
zipnative schema create-manifest   # input accepted by `create --from-manifest`
zipnative schema modify-manifest   # input accepted by `modify --from-manifest`
zipnative schema batch-manifest    # pipeline file accepted by `batch --manifest`
zipnative schema entries           # output of `list --format json` (rows of ndjson)
zipnative schema inspect           # output of `inspect --format json`
zipnative schema verify            # output of `verify --format json`
zipnative schema stream            # output of `stream --format json`
zipnative schema batch             # output of `batch --format json`
zipnative schema doctor            # output of `doctor --format json`
zipnative schema govern-verify     # output of `govern verify-issue --json`
zipnative schema crc32             # output of `crc32 --format json`
zipnative schema entries-summary | inspect-summary | verify-summary | stream-summary | batch-summary
zipnative schema status            # the --json success envelope
zipnative schema error             # the --json error envelope (code, zipCode, entryName, detail)
zipnative schema errors            # E_* codes + the 39 ZIP_* → E_* mapping + diagnostics (DATA, not a schema)
zipnative schema limits            # ZipLimits: eight bounds, defaults, CWEs, flags
zipnative schema diagnostics       # the diagnostic row shape (11 codes)
zipnative schema manifest          # capability manifest: commands, flags, codes, schemas (DATA, not a schema)
```

**Tool discovery.** `zipnative schema manifest` emits a single JSON document
listing every command (group, summary, flags), the global flags, the dry-run /
projected / manifest command lists, the `E_*` and `ZIP_*` codes, the diagnostic
codes and the limits — enough to register the CLI as a tool set at runtime. A
prose/LLM-facing version lives in `llms.txt` at the repo root (shipped in the
npm package).

**Listing for RAG.** `list --format ndjson` emits one JSON object per entry
(`{ name, method, compressedSize, uncompressedSize, crc32, lastModified,
isEncrypted, … }`) which streams cleanly into a retrieval pipeline; add `--long`
for flags, offsets and extra fields.

---

## 6. Governance & Human-in-the-Loop — `govern`

The zipnative ecosystem's governance model treats AI agents as **draftsmen**,
never autonomous submitters. The `govern` command makes that contract actionable
from any agent pipeline — entirely offline:

```bash
zipnative govern rules                  # the human/agent protocol on stdout
zipnative govern policy --json          # machine-readable policy JSON on stdout
zipnative govern verify-issue draft.md  # gate a draft: exit 1 / E_POLICY on a violation
```

Rules an agent MUST honour:

- **No autonomous GitHub writes.** Never open, edit, label, close, comment on, or submit
  issues / PRs / releases. Produce a **local draft** plus a compliance report and hand it
  to the human.
- **Zero runtime dependencies.** Never propose adding an npm runtime package — this is a
  hard block that `verify-issue` enforces.
- **No anti-goals.** Do not propose encryption, other archive formats, multi-disk
  archives, archive repair, or filesystem / network I/O inside the engine
  (`verify-issue` warns).
- **Never weaken a security default.** `rejectTraversal`, `rejectSymlinks`,
  `onDuplicate`, every `ZipLimits` bound and the CLI's extraction-sink containment stay
  as they are unless a human records the decision. Bytes under `--deterministic` are a
  frozen contract (a byte change is semver-major).
- **Local reproduction required.** A bug draft must include a minimal, executed repro
  inside a fenced code block; `verify-issue` fails the draft otherwise.
- **Identity integrity.** Anything submitted is published under the **human's** GitHub
  identity; remind them of their shared responsibility.

`govern verify-issue` returns `{ ok, errors, warnings }` under `--json`. A passing check is
**necessary but not sufficient** — the human review gate always applies. Recommended flow:
draft locally → `govern verify-issue` → present to the human → the **human** submits.

---

## 7. Recommended agent loop

1. `zipnative doctor --format json` → confirm the CLI, Node ≥ 22 and the engine are
   present, the deflate tier is `node-zlib`, workers are available if you plan
   `create --parallel`, and read the **effective limits**.
2. `zipnative inspect --input a.zip --json --summary` → cheap facts (entries, bytes,
   encrypted count, determinism verdict, diagnostics count) before touching anything.
   Add `--check no-encryption,no-symlinks,max-ratio=100` to turn policy into an exit code.
3. `zipnative extract --input a.zip --output-dir out/ --dry-run --json` → the plan:
   every destination proven safe, `skipped` inventory, nothing written.
4. `zipnative extract --input a.zip --output-dir out/ --json` → do it; read the status
   envelope from stderr.
5. On any non-zero exit, parse the last stderr line and branch on `error.code`
   (class) then `error.zipCode` (cause): `E_SECURITY` → quarantine the archive;
   `E_LIMIT` → only for trusted input, retry with the named `--max-*` raised;
   `E_UNSUPPORTED` → route around the feature (`detail.feature`); `E_PARSE` /
   `E_DATA` → the bytes are corrupt or hostile, re-obtain them; `E_IO` → an existing
   file (`--overwrite`) or a filesystem problem.

For `verify` / `inspect`, read the JSON result on stdout and use `--strict` /
`--check` to turn findings into exit codes for unattended gating. Add
`--summary` (or `--fields`) to keep that stdout JSON token-cheap — see §3.

**Conformance changes → veraZIP gate.** An agent working **on this repository** must
run `npm run validate:zip` for any change touching what the CLI writes (`create`,
`modify`, `batch --task create`, the corpus generator, name handling): it builds the
CLI, drives the built binary to write the 34-archive corpus (30 conformant archives
including 3 hostile-but-conformant ones `extract` must refuse, plus 4 raw-crafted
negative canaries) and validates every file against ISO/IEC 21320-1:2015 with an
engine-independent parser. Level 0 needs no external tool and always runs; level 1
(foreign integrity tools) skips visibly when a tool is absent — set
`VERAZIP_REQUIRED=1` to fail closed as CI does. Exit 0/1/2/3 semantics are in
[CONTRIBUTING.md](CONTRIBUTING.md#conformance-validation-verazip).

**Orchestrate with `batch --manifest`.** Instead of shelling out N times, declare
the whole pipeline once and run it fail-fast in a single process:

```json
{ "version": 1, "tasks": [
  { "id": "build",   "command": "create",  "flags": { "input": "dist", "output": "release.zip", "deterministic": true } },
  { "id": "check",   "command": "inspect", "flags": { "input": "@build", "check": ["deterministic", "no-symlinks"], "format": "json" } },
  { "id": "verify",  "command": "verify",  "flags": { "input": "@build", "strict": true } },
  { "id": "unpack",  "command": "extract", "flags": { "input": "@build", "output-dir": "staging" } }
] }
```

`"@<id>"` references the resolved output (or output-dir) of an **earlier** task;
relative paths resolve against the manifest's directory after the same traversal check
as direct flags; 10 manifest commands are whitelisted — `create`, `list`, `inspect`,
`extract`, `cat`, `verify`, `stream`, `modify`, `crc32`, `inflate` (never `batch`,
`govern`, `schema`, `completion`, `doctor`). Validate the file with `schema
batch-manifest`, pre-flight with `--dry-run`, and remember: a `codec` flag inside a
manifest additionally requires `--allow-codec-load` on the command line — a manifest
obtained from elsewhere can never execute user code on its own. A manifest has the
filesystem access of the user who invokes `batch` — the same trust level as flags typed
on the command line. Manifests are size-capped (50 MB) and bounded to 1 000 tasks. The
JSON summary lists every task with its `ok` / `skipped` / `error: { code, message,
zipCode? }`, and exit 1 carries the first failing task's `E_*` code.

---

## 8. Safety notes for unattended use

- **Offline, always.** No command opens a socket — not `doctor`, not `govern`, not
  `schema`, not `--json`. The engine never touches the network either. There is nothing
  to allow-list.
- **The sink is guarded twice.** The engine sanitises every path (`sanitizeEntryPath`)
  and refuses hostile shapes; the CLI then re-proves that each destination stays under
  `--output-dir` (`safeJoin`), refuses existing files without `--overwrite`, refuses
  case-fold collisions on case-insensitive filesystems, and never materialises a symlink.
  Opt-outs skip; they never write anything unsafe.
- **Bounded input.** The engine's eight CWE-tagged limits are always on (100000 entries,
  1 GiB per entry, 8 GiB total, 1024:1 ratio, 4096-byte names, 65535-byte extra fields and
  comments, 256 MiB central directory); tighten them for untrusted uploads
  (`--max-total-size 512m --max-ratio 50`). `none` disables a bound and warns — never do
  that on untrusted input. JSON inputs are capped at 50 MB; paths are checked against
  traversal. `inflate` always has an output bound.
- **Data remanence.** `modify` without `--compact` keeps removed / replaced bytes
  recoverable in the output. When deletion matters, pass `--compact`. The CLI prints an
  `info:` line and the engine emits `ZIP_DEAD_BYTES_RATIO` when it is significant.
- **Forward reading is unverified metadata.** `stream` trusts local headers alone — no
  central directory to cross-check names, sizes or methods — so mode / symlink policy is
  unavailable and every JSON output says `trust: "local-headers-only"`. Use it only for
  streams you cannot seek; prefer `list` / `extract` on a complete file.
- **`--codec` runs user code.** It is the CLI's only dynamic import (same trust as
  `node -r`): argv only, refused from `.zipnativerc.json`, refused inside a
  `batch --manifest` without `--allow-codec-load`, read-side only. Never pass a module
  you did not author or vet.
- **No encryption.** Encrypted entries are detected, listed and reported as `skipped`
  by `verify`; reads fail with `ZIP_UNSUPPORTED_ENCRYPTION`. Do not expect a password
  flag.
- **Human-in-the-loop for governance.** `govern` never submits anything; it only drafts
  and verifies. A human must review and submit under their own identity (see §6).
- **One process per task.** The CLI is stateless; run it per unit of work and let the
  exit code drive your orchestration (or a `batch --manifest` for a fixed pipeline).

See [SECURITY.md](SECURITY.md) for the full security model and
[docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) for the deep reference.
