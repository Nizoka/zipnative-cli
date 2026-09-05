# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

To report a security vulnerability, please use [GitHub's private vulnerability reporting](https://github.com/Nizoka/zipnative-cli/security/advisories/new) — this is the channel today.

As a fallback, `security@pdfnative.dev` is the shared maintainer inbox of the pdfnative and zipnative ecosystems. A dedicated `security@zipnative.dev` inbox is a maintainer decision that has not been taken yet; this file and [SUPPORT.md](SUPPORT.md) will name it when it exists.

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues. A vulnerability in the engine itself should be reported to [zipnative](https://github.com/Nizoka/zipnative/security/advisories/new); the CLI will ship the fixed engine version in a patch release.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |
| < 1.0   | ❌        |

## Security Model

zipnative-cli is a thin dispatch layer over the [`zipnative`](https://github.com/Nizoka/zipnative) engine. It introduces zero additional runtime dependencies and **contains no ZIP parsing logic of its own**: every byte of ZIP structure — end-of-central-directory records, central directory, local headers, Zip64, DEFLATE, CRC-32 — is parsed, validated and bounded inside `zipnative`. See the [zipnative security policy](https://github.com/Nizoka/zipnative/blob/main/SECURITY.md) for the engine's threat model and its frozen compatibility promise.

The engine, by design, never touches the filesystem, never opens a socket and never evals. That makes **the CLI the filesystem trust boundary**: it reads the archive bytes, hands them to the engine, and is the sink that writes extracted data to disk. The invariants the CLI adds on top of the engine are described below.

The CLI exposes 15 commands (run `zipnative --help` or `zipnative schema manifest` for the authoritative list). **No command can open a socket, in any mode** — there is no network opt-in.

### Agent Mode (`--json`, `--dry-run`, `--strict`)

The agent-native contract is a **pure local presentation/validation layer** and adds **no network surface**:

- `--json` only changes how diagnostics are formatted on **stderr** (a machine-readable envelope). It never alters what is written to stdout and never relaxes any security check. Under `batch --manifest --json` every task's stdout is captured into the single batch document (64 MiB cap → `E_LIMIT`), and a task that would write an artefact to stdout is refused at validation.
- `--dry-run` validates inputs and plans — archives are opened, every destination is proven safe, edits are applied to the modifier, `modify` verifies the entries it would re-emit, manifests are resolved — and short-circuits **before** producing or writing output.
- `--strict` only tightens: the first engine diagnostic becomes a hard error before any output byte.
- Stable `E_*` classes carry a failure class; `error.zipCode` carries the engine's frozen `ZIP_*` cause verbatim; `detail` carries only the structured fields the engine (or the CLI-owned `--max-input-size` bound) defines (`{ limit, configured, observed }`, `{ feature }`, `{ expectedCrc, actualCrc }`). Internal parser state and byte offsets are never exposed beyond what the engine's own remedy-bearing message states.
- The same switches are honoured from the environment (`ZIPNATIVE_JSON`, `ZIPNATIVE_DRY_RUN`, `ZIPNATIVE_QUIET`, `ZIPNATIVE_STRICT`, `ZIPNATIVE_PURE_CODECS`), so a manifest task inherits the mode of its `batch` invocation; there is no environment variable that loosens a check.

### Extraction sink

The engine's `extractZip` / `extractZipStream` yield `{ path, entry, data | stream() }` with `path` already run through `sanitizeEntryPath()` and the hostile shapes already refused (`rejectTraversal`, `rejectSymlinks`, `onDuplicate: 'error'`, the limits). `extract` and `stream --output-dir` share **one sink** (`src/utils/sink.ts`), hardened in two phases:

1. **Plan (lexical)** — the extraction generator is drained **without decompressing anything**. For every entry the CLI recomputes the destination with `safeJoin(root, path)` (`src/utils/io.ts`), which resolves the absolute target and proves it stays inside the resolved `--output-dir` (a relative-path escape, an absolute result or a `..` segment throws `E_SECURITY`). Existing files are refused unless `--overwrite` (`E_IO`). On case-insensitive filesystems (win32, darwin) two entries whose targets fold to the same path are refused (`ZIP_EXTRACT_DUPLICATE_PATH`) unless `--on-duplicate first|last` resolves it deliberately. Directory entries go through `sanitizeEntryPath()` + `safeJoin` too.
2. **Write (physical)** — before `mkdir -p` of a target's parent, the nearest **existing** ancestor is `realpath`'d and must lie under the root's `realpath`; after the directory is created it is re-checked the same way. A symbolic link or junction planted inside the destination that points outside is refused with `E_SECURITY` ("Refusing to write through a link that leaves the output directory…") and nothing is created beyond the link. Every file is then opened **exclusively** (`wx`) unless `--overwrite`, so a file that appears between the plan and the write is refused like any pre-existing one — there is no check-then-write window. Each entry streams into its file with backpressure; a CRC / size failure removes the partial file. `--preserve-mode` applies `mode & 0o777` to files only (never setuid, setgid or sticky; POSIX only).

**Residual window.** The only gap left is between the `realpath` check and the exclusive `open`: an attacker who can replace a directory with a link *inside that interval* and who already has write access to the destination could redirect one file. The posture is therefore: **extract into an empty or trusted destination**; the CLI never extracts into a location it did not check, but it cannot lock a directory it does not own.

Opt-outs are **skip-not-write**: `--skip-unsafe` skips entries whose names cannot be made safe (they are listed in the envelope as `skipped: unsafe-path` and never written); `--skip-symlinks` drops symlink entries; `--allow-symlinks` writes the link **target text** as a regular file — **a symlink is never materialised by the CLI under any flag**; `--skip-unsupported` skips encrypted entries and methods with no registered codec (`skipped: unsupported`). `--flat` writes basenames only and applies the same duplicate policy.

`stream --output-dir` is the same sink over the forward reader: because `iterateZipEntries` does not sanitise names, the CLI applies `sanitizeEntryPath()` itself before `safeJoin`, entry by entry.

### Overwrite policy

The policy is **uniform** across every writer, not only the sink: `create -o`, `modify -o`, `cat -o`, `inflate -o`, `extract`, `stream --output-dir` and `batch --task create` (directory mode) refuse an existing file with `E_IO` ("Refusing to overwrite existing file <path> (pass --overwrite)") and leave it intact; `--overwrite` replaces it. `modify --in-place` never writes into the original: it writes to an unpredictable, exclusively created temporary file (`<input>.tmp-<pid>-<12 hex>`) and renames atomically. Writing to stdout (`-` or no `-o`) is unaffected. Partial outputs are removed on failure, and a `SIGINT` / `SIGTERM` handler removes **only the file currently being written** (never a completed output, never the original of `--in-place`) before exiting 130 / 143.

### Input Validation

- **Argv paths are the user's own filesystem authority.** `zipnative list ../a.zip`, `-o ../out.zip` or `--output-dir ../x` are ordinary shell usage and are accepted; the CLI does not second-guess where the invoking user may read or write. `validatePath()` — the `..` refusal, `E_INPUT` "Path traversal detected" — applies to paths that arrive as **data**: the path flags of `batch --manifest` tasks and the `path` values of `create` / `modify` manifests. Entry **names** are a different matter (see below).
- **`--max-input-size <size>`** (global; default **4 GiB**; `none` disables it with a one-shot warning) bounds every **buffered** read: stdin is byte-counted and the read aborted, files are `stat`'d before reading — `list`, `inspect`, `verify`, `extract`, `cat`, `modify`, `create --stdin-name`, `inflate --sync`, `govern verify-issue`. Exceeding it is `E_LIMIT` with `detail { limit: "maxInputSize", configured, observed }` (CWE-400). It is a CLI-owned bound, not a `ZipLimits` key; `doctor` reports it under `limits`. The streaming paths — `stream`, `crc32`, `inflate` (default), `create --stream` — are constant-memory and are not bounded by it. Random-access commands hold the whole archive in memory, so the bound is also the memory envelope.
- JSON input size is capped at **50 MB** before `JSON.parse` — `create --from-manifest`, `modify --from-manifest`, `batch --manifest`, `govern verify-issue` drafts. Batch manifests are additionally bounded to **1 000 tasks**. `.zipnativerc.json` is capped at 1 MB.
- **Manifest values** — `batch --manifest` is validated strictly before anything executes: structural violations exit 2 / `E_USAGE`, value violations (bad or duplicate id, non-whitelisted command, forward or unknown `@ref`) exit 1 / `E_INPUT`; only 10 archive commands may appear (never `batch`, `govern`, `schema`, `completion`, `doctor`); a `codec` flag is refused unless the `batch` invocation itself carries `--allow-codec-load`. A manifest has the filesystem access of the user who invokes `batch` — the same trust level as flags typed on the command line, no more.
- **`--max-*` semantics** — the eight flags map one-to-one onto the engine's `ZipLimits` and are pre-validated (`E_USAGE` on malformed or zero values), so an invalid limits object can never reach the engine. `none` disables a bound (`Infinity`) and prints a one-shot warning; the defaults are always on when no flag is given. `inflate` derives its mandatory `--max-output` default from the effective `--max-entry-size`. The bounds also apply on the write side (`create` / `modify`).
- Every entry name the CLI **writes** (`create` inputs, `--stdin-name`, manifests, `modify --add` / `--rename` / `--add-dir`) is pre-checked with the engine's `sanitizeEntryPath()`: a name that could not be extracted safely is refused at creation time (`E_INPUT`, with `entryName`). Malformed flags stay `E_USAGE`; unsafe **data** is `E_INPUT`.
- Dates are data too: `--date <ISO>` and manifest `date` values are read as **UTC wall-clock**, so the stored DOS fields — and the archive bytes — do not depend on the host time zone.
- `list` / `inspect` JSON output is derived from the engine's typed entry objects; raw payload bytes are never emitted except by `cat` / `stream --cat` / `inflate`, whose purpose is exactly that. Raw name and comment bytes are exposed only as hex (`rawNameHex`, `commentHex` under `--long`; `archive.commentHex`) and extra-field payloads only as hex under `inspect --extra`.

### The engine's guards

Every row below is enforced by zipnative on every code path the CLI uses; the last column is the CLI switch, if any.

| Threat | Defence | CWE | `zipCode` | CLI switch |
|---|---|---|---|---|
| Zip-slip path traversal (`../`, absolute paths, drive letters, UNC, backslashes, NUL, NTFS ADS, Windows reserved device names) | `rejectTraversal: true` by default; `sanitizeEntryPath()` for external sinks | CWE-22 / CWE-67 | `ZIP_PATH_TRAVERSAL` | `extract --skip-unsafe` (skip, never write) |
| Decompression bombs (high ratio, nesting, entry floods) | per-entry and total output caps, ratio bound, entry-count cap — enforced *during* inflation | CWE-400 / CWE-409 | `ZIP_LIMIT_EXCEEDED` | `--max-entry-size`, `--max-total-size`, `--max-ratio`, `--max-entries` |
| Symlink entries redirecting extraction | `rejectSymlinks: true` by default | CWE-59 | `ZIP_SYMLINK_REJECTED` | `extract --allow-symlinks` (target text as data) / `--skip-symlinks` |
| Overlapping entries | always-on overlap detection over central-directory ranges | CWE-405 | `ZIP_ENTRY_OVERLAP` | none |
| Parser-differential smuggling (central directory vs local headers) | the central directory is authoritative; method divergence is fatal, name divergence is diagnosed | CWE-436 | `ZIP_CD_LFH_MISMATCH` | none |
| Ambiguous EOCD (trailing garbage, multiple candidates) | only a self-consistent EOCD closest to EOF is accepted; ambiguity is refused | — | `ZIP_EOCD_NOT_FOUND` | none |
| Zip64 field spoofing | Zip64 records cross-checked against every non-sentinel classic field | CWE-1288 | `ZIP_ZIP64_CONTRADICTION` | none |
| Duplicate entry names (shadowing) | `onDuplicate: 'error'` by default | CWE-694 | `ZIP_EXTRACT_DUPLICATE_PATH` | `--on-duplicate first\|last` |
| Integer overflow (> 2^53 sizes / offsets) | 64-bit fields read via BigInt and rejected above `Number.MAX_SAFE_INTEGER` | CWE-190 | `ZIP_VALUE_UNREPRESENTABLE` | none |
| Oversized names / extra fields / comments / central directory | `maxNameBytes`, `maxExtraFieldBytes`, `maxCommentBytes`, `maxCentralDirectoryBytes` | CWE-400 | `ZIP_LIMIT_EXCEEDED` | `--max-name-bytes`, `--max-extra-bytes`, `--max-comment-bytes`, `--max-cd-bytes` |

The defaults (100000 entries, 1 GiB per entry, 8 GiB total, 1024:1 ratio, 4096-byte names, 65535-byte extra fields and comments, 256 MiB central directory) are the safe path for untrusted input; raising one is always an explicit decision.

### The CLI's own guards

The rows the CLI adds because it owns the process and the filesystem (the knowledge base §6 carries the full table):

| Threat | Defence | Status / residual |
|---|---|---|
| Unbounded stdin / file buffering (memory exhaustion) | `--max-input-size` (4 GiB default) on every buffered read; streaming commands are constant-memory | `none` disables it with a visible warning |
| Symlink / junction planted inside `--output-dir` | `realpath` anchor of the nearest existing ancestor before `mkdir`, re-check after; refused with `E_SECURITY` | the realpath → open window: use an empty or trusted destination |
| File appearing between plan and write | exclusive `wx` open unless `--overwrite`; `E_IO` refusal | none |
| Partial output under its final name (failure or interrupt) | removed on failure; `SIGINT` / `SIGTERM` remove the in-flight file only, exit 130 / 143 | signals are POSIX-only in practice |
| `modify` laundering a hostile record into a canonical-looking archive | eager open + `verifyEntry()` on every re-emitted entry before the save (see below) | encrypted / stream-only-codec entries are copied as-is and counted |
| A `--codec` module shaping the writer silently | override announced (`warning:` line, `tier`); `create --parallel` refuses such a module | see Code Safety |

### Data remanence (`modify`)

The default `modify` save is the engine's append-only `save()`: the original bytes are kept verbatim and a new central directory is appended, so untouched entries are never recompressed — and **removed or replaced content remains recoverable** from the output file. `--compact` selects `saveCompact()`, a canonical rewrite (still no recompression) in which removed content is truly gone. The CLI prints an `info:` line whenever a destructive edit is saved append-only, and the engine emits the `ZIP_DEAD_BYTES_RATIO` diagnostic above 50 % dead bytes. 7-Zip's CLI is also known to mis-read the append-only layout (it does not honour the final central directory); ship `--compact` output when interoperability with 7-Zip matters.

### `modify` verifies what it re-emits

Because both save modes copy untouched records verbatim, `modify` must not launder a hostile archive into a clean-looking one. It opens the archive **eagerly** (overlaps and the central-directory ↔ local-header structure are checked before any edit) and, before `save()` / `saveCompact()`, calls `reader.verifyEntry()` on **every entry that will be re-emitted** (every entry not removed or replaced; renamed entries are verified under their original record): CRC-32, sizes and the local header against the central directory — one decompress pass, never a recompress. A lying record is refused with the entry named: `E_SECURITY` `ZIP_CD_LFH_MISMATCH`, `E_DATA` `ZIP_CRC_MISMATCH` or `ZIP_SIZE_MISMATCH`. Encrypted entries and entries whose registered codec has no `decompressSync` cannot be verified: they are copied as-is and counted in `verifySkipped`; an entry with an unregistered method is refused (`E_UNSUPPORTED`, load `--codec`). The check runs under `--dry-run` too and has **no opt-out** — an opt-out would write unverified bytes. The envelope reports `verified`, `verifySkipped`, `tier`, `changed` and `layout: append-only | compact`.

### Forward reader trust caveat (`stream`)

`stream` reads local headers **alone** through `iterateZipEntries` — there is no central directory to cross-check names, sizes, methods or attributes, so a hostile archive can present different content there than `list` / `extract` authoritatively report. Consequently `--preserve-mode`, `--allow-symlinks` and `--skip-symlinks` are refused in forward mode (`E_USAGE`), every JSON output carries `trust: "local-headers-only"`, a `warning:` line is printed at start, and every name written to disk goes through `sanitizeEntryPath()` + `safeJoin`. All size limits are enforced by output counting and CRCs are verified. Entries written with data descriptors carry zero sizes in their local header, so `--summary` reports `descriptorEntries` and `bytesKnown: false` rather than pretending. Custom-method entries can be listed and skipped but not decoded in forward mode (the engine's pump knows store and deflate): `--cat` / `--output-dir` on such an entry fail with `E_DATA` `ZIP_DECOMPRESSION_FAILED`, which `--skip-unsupported` does not cover — use `cat` / `extract --codec` on the complete file. Use `stream` only for input you cannot seek; prefer `list` / `extract` on a complete file.

### Code Safety

- No `eval()`, `Function()`, or dynamic code execution — with **one declared exception**: `--codec <module>` dynamically imports a user-supplied ESM module and registers its codecs (`registerCodec`, `setInflateImpl`, `setDeflateImpl`). It runs with the invoking user's privileges (the same trust as `node -r`), so it is honoured **only from argv**: `.zipnativerc.json` refuses the `codec` key (a hostile repository cannot run code when you type `zipnative list` inside it), a `batch --manifest` task carrying `codec` is refused unless the invocation itself passes `--allow-codec-load`, and a loaded module is reported truthfully. Registered codecs are **not confined to the reader**: the engine resolves methods 0 (store) and 8 (deflate) through the registry, so a module that registers either **replaces the built-in compressor** for `create` / `modify` — even under `--deterministic`, which pins only the engine's own encoder — and a sequential `create` announces it with a `warning:` line (silent under `--dry-run`); a module exporting `deflateImpl` replaces the sync deflate tier and shows up as `tier: "injected"` in the envelope unless `--deterministic` pins the engine's encoder (`pure-pinned`). `create --parallel` refuses (exit 2) a module registering method 0 / 8, and a `deflateImpl` without `--deterministic`, because the worker pool never sees the module and the envelope would lie. `batch --manifest` otherwise dispatches only to a fixed whitelist of CLI command modules.
- **No sockets.** No command opens a network connection; there is no flag that could. `doctor`, `govern` and `schema` are fully local.
- The CLI never post-processes archive bytes: what the engine writes is what is written to disk, so the engine's `deterministic: true` byte contract holds end to end.
- **Signals.** `SIGINT` / `SIGTERM` remove exactly the files being written at that moment (`src/utils/inflight.ts` registers a file only once the CLI created it) and exit 130 / 143; completed outputs and the original of `modify --in-place` are never touched. POSIX only in practice (Windows has no signals for child processes).
- **Supply chain.** The package ships the CJS bin only (`dist/cli.cjs`, no ESM build, no `.d.ts`, no source maps) plus `AGENTS.md`, `llms.txt`, `docs/data/errors.json`, `README.md`, `LICENSE` and `package.json` — 7 files. `publish.yml` re-runs the entire gate (typecheck, lint, tests with coverage, build, built-binary smoke, veraZIP), generates a CycloneDX SBOM, **attests it** with `actions/attest-build-provenance` (verify with `gh attestation verify sbom.cdx.json -R Nizoka/zipnative-cli`), attaches it to the GitHub Release, verifies the packed tarball's contents (bin, agent docs and error catalogue present; no maps, no tests) and only then publishes via **Trusted Publishing (OIDC)** with npm provenance (verify with `npm audit signatures`). CodeQL runs on every code push and PR, OpenSSF Scorecard on every push to `main`; every action is SHA-pinned and Dependabot keeps them current.

### Not supported by policy

- **Encryption, read or write.** ZipCrypto is cryptographically broken; the engine will never write it and does not read it in 1.x. Encrypted entries are detected (`isEncrypted`), listed, counted by `inspect`, reported as `skipped` by `verify` (and by `verify --entry`), skippable with `extract --skip-unsupported` / `stream --skip-unsupported`, copied unverified by `modify` (counted in `verifySkipped`), and refused on read with `ZIP_UNSUPPORTED_ENCRYPTION`. There is no password flag.
- **Multi-disk / spanned archives** — refused (`ZIP_UNSUPPORTED_MULTI_DISK`).
- **Archive repair / salvage** — structural problems are reported (`verify`, `inspect`), never guessed at.
- **Other archive formats** — none.

### False conformance claims → veraZIP gate

Every archive the CLI writes is validated against **ISO/IEC 21320-1:2015** by `scripts/validate-zip.mjs`, a validator vendored from the engine (`zipnative/scripts/validate-zip.ts`, commit `4f1bc36`) that raw-parses the bytes with its own reader and **never imports `zipnative`** — so it cannot attest the engine with the engine. `npm run validate:zip` builds the CLI, drives the built binary to write a 37-archive corpus (33 conformant, including 3 hostile-but-conformant archives — zip-slip, a Windows device name, duplicate paths — that pass the ISO profile and that `extract` must refuse; plus 4 raw-crafted negative canaries the validator must reject with a declared check id), and validates every file: the expected verdict is **33 PASS, 4 XFAIL, 0 FAIL**. An unexpected pass of a canary is fatal, and a coverage canary fails the run if a required check id has no canary. Level 0 always runs; level 1 foreign integrity tools skip visibly when absent and `VERAZIP_REQUIRED=1` fails closed in CI. The gate is blocking in `.github/workflows/verazip.yml` (Linux + Windows, on every push and PR — no path filter) and again before every publish. **Conformance is not safety** — hostile-but-spec-valid archives are exactly why the guards above exist.

## Disclosure Policy

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). We ask that you:

1. Report vulnerabilities privately (see above).
2. Allow us reasonable time to fix and release a patch before public disclosure.
3. Avoid testing against systems you do not own.

Confirmed vulnerabilities are fixed in a patch release with a GitHub Security Advisory and a CHANGELOG entry crediting the reporter (unless anonymity is requested).
