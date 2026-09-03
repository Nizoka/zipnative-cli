# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

To report a security vulnerability, please use [GitHub's private vulnerability reporting](https://github.com/Nizoka/zipnative-cli/security/advisories/new).

Alternatively, contact us at: **security@pdfnative.dev**

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

- `--json` only changes how diagnostics are formatted on **stderr** (a machine-readable envelope). It never alters what is written to stdout and never relaxes any security check.
- `--dry-run` validates inputs and plans — archives are opened, every destination is proven safe, edits are applied to the modifier, manifests are resolved — and short-circuits **before** producing or writing output.
- `--strict` only tightens: the first engine diagnostic becomes a hard error before any output byte.
- Stable `E_*` classes carry a failure class; `error.zipCode` carries the engine's frozen `ZIP_*` cause verbatim; `detail` carries only the structured fields the engine defines (`{ limit, configured, observed }`, `{ feature }`, `{ expectedCrc, actualCrc }`). Internal parser state and byte offsets are never exposed beyond what the engine's own remedy-bearing message states.

### Extraction sink

The engine's `extractZip` / `extractZipStream` yield `{ path, entry, data | stream() }` with `path` already run through `sanitizeEntryPath()` and the hostile shapes already refused (`rejectTraversal`, `rejectSymlinks`, `onDuplicate: 'error'`, the limits). `extract` and `stream --output-dir` are the sinks, hardened in two phases:

1. **Plan** — the extraction generator is drained **without decompressing anything**. For every entry the CLI recomputes the destination with `safeJoin(root, path)` (`src/utils/io.ts`), which resolves the absolute target and proves it stays inside the resolved `--output-dir` (a relative-path escape, an absolute result or a `..` segment throws `E_SECURITY`). Existing files are refused unless `--overwrite` (`E_IO`). On case-insensitive filesystems (win32, darwin) two entries whose targets fold to the same path are refused (`ZIP_EXTRACT_DUPLICATE_PATH`) unless `--on-duplicate first|last` resolves it deliberately. Directory entries go through `sanitizeEntryPath()` + `safeJoin` too.
2. **Write** — each entry streams into its file with backpressure; a CRC / size failure removes the partial file. `--preserve-mode` applies `mode & 0o777` only (never setuid, setgid or sticky; POSIX only).

Opt-outs are **skip-not-write**: `--skip-unsafe` skips entries whose names cannot be made safe (they are listed in the envelope as `skipped: unsafe-path` and never written); `--skip-symlinks` drops symlink entries; `--allow-symlinks` writes the link **target text** as a regular file — **a symlink is never materialised by the CLI under any flag**. `--flat` writes basenames only and applies the same duplicate policy.

`stream --output-dir` is the same sink over the forward reader: because `iterateZipEntries` does not sanitise names, the CLI applies `sanitizeEntryPath()` itself before `safeJoin`.

### Input Validation

- All file path arguments (`--input`, `--output`, `--output-dir`, `--from-manifest`, `--manifest`, `--base`, `--config`, `--codec`, the positional inputs of `create` / `crc32` / `cat` / `list`, the `<path>` half of `--add` / `--replace`, and every path-carrying value inside a `batch --manifest` or a `create` / `modify` manifest) are validated against path traversal (`../`) sequences before any filesystem access.
- JSON input size is capped at **50 MB** before `JSON.parse` — `create --from-manifest`, `modify --from-manifest`, `batch --manifest`, `govern verify-issue` drafts. Batch manifests are additionally bounded to **1 000 tasks**. `.zipnativerc.json` is capped at 1 MB.
- **Manifest values** — `batch --manifest` is validated strictly before anything executes: structural violations exit 2 / `E_USAGE`, value violations (bad or duplicate id, non-whitelisted command, forward or unknown `@ref`) exit 1 / `E_INPUT`; only 10 archive commands may appear (never `batch`, `govern`, `schema`, `completion`, `doctor`); a `codec` flag is refused unless the `batch` invocation itself carries `--allow-codec-load`. A manifest has the filesystem access of the user who invokes `batch` — the same trust level as flags typed on the command line, no more.
- **`--max-*` semantics** — the eight flags map one-to-one onto the engine's `ZipLimits` and are pre-validated (`E_USAGE` on malformed or zero values), so an invalid limits object can never reach the engine. `none` disables a bound (`Infinity`) and prints a one-shot warning; the defaults are always on when no flag is given. `inflate` derives its mandatory `--max-output` default from the effective `--max-entry-size`.
- Every entry name the CLI **writes** (`create` inputs, `--stdin-name`, manifests, `modify --add` / `--rename` / `--add-dir`) is pre-checked with the engine's `sanitizeEntryPath()`: a name that could not be extracted safely is refused at creation time (`E_INPUT`).
- `list` / `inspect` JSON output is derived from the engine's typed entry objects; raw payload bytes are never emitted except by `cat` / `stream --cat` / `inflate`, whose purpose is exactly that, and extra-field payloads only as hex under `inspect --extra`.

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

### Data remanence (`modify`)

The default `modify` save is the engine's append-only `save()`: the original bytes are kept verbatim and a new central directory is appended, so untouched entries are never recompressed — and **removed or replaced content remains recoverable** from the output file. `--compact` selects `saveCompact()`, a canonical rewrite (still no recompression) in which removed content is truly gone. The CLI prints an `info:` line whenever a destructive edit is saved append-only, and the engine emits the `ZIP_DEAD_BYTES_RATIO` diagnostic above 50 % dead bytes. 7-Zip's CLI is also known to mis-read the append-only layout (it does not honour the final central directory); ship `--compact` output when interoperability with 7-Zip matters.

### Forward reader trust caveat (`stream`)

`stream` reads local headers **alone** through `iterateZipEntries` — there is no central directory to cross-check names, sizes, methods or attributes, so a hostile archive can present different content there than `list` / `extract` authoritatively report. Consequently `--preserve-mode`, `--allow-symlinks` and `--skip-symlinks` are refused in forward mode (`E_USAGE`), every JSON output carries `trust: "local-headers-only"`, a `warning:` line is printed at start, and every name written to disk goes through `sanitizeEntryPath()` + `safeJoin`. All size limits are enforced by output counting and CRCs are verified. Use `stream` only for input you cannot seek; prefer `list` / `extract` on a complete file.

### Code Safety

- No `eval()`, `Function()`, or dynamic code execution — with **one declared exception**: `--codec <module>` dynamically imports a user-supplied ESM module and registers its codecs (`registerCodec`, `setInflateImpl`, `setDeflateImpl`). It runs with the invoking user's privileges (the same trust as `node -r`), so it is honoured **only from argv**: `.zipnativerc.json` refuses the `codec` key (a hostile repository cannot run code when you type `zipnative list` inside it), a `batch --manifest` task carrying `codec` is refused unless the invocation itself passes `--allow-codec-load`, and registered codecs are read-side only (the writer knows store and deflate). `batch --manifest` otherwise dispatches only to a fixed whitelist of CLI command modules.
- **No sockets.** No command opens a network connection; there is no flag that could. `doctor`, `govern` and `schema` are fully local.
- The CLI never post-processes archive bytes: what the engine writes is what is written to disk, so the engine's `deterministic: true` byte contract holds end to end.
- npm provenance — published from CI via **Trusted Publishing (OIDC)** with provenance attestations (verify with `npm audit signatures`); a CycloneDX SBOM is attached to every GitHub Release; CodeQL and OpenSSF Scorecard run on every push.

### Not supported by policy

- **Encryption, read or write.** ZipCrypto is cryptographically broken; the engine will never write it and does not read it in 1.x. Encrypted entries are detected (`isEncrypted`), listed, counted by `inspect`, reported as `skipped` by `verify`, skippable with `stream --skip-unsupported`, and refused on read with `ZIP_UNSUPPORTED_ENCRYPTION`. There is no password flag.
- **Multi-disk / spanned archives** — refused (`ZIP_UNSUPPORTED_MULTI_DISK`).
- **Archive repair / salvage** — structural problems are reported (`verify`, `inspect`), never guessed at.
- **Other archive formats** — none.

### False conformance claims → veraZIP gate

Every archive the CLI writes is validated against **ISO/IEC 21320-1:2015** by `scripts/validate-zip.mjs`, a validator vendored from the engine (`zipnative/scripts/validate-zip.ts`, commit `4f1bc36`) that raw-parses the bytes with its own reader and **never imports `zipnative`** — so it cannot attest the engine with the engine. `npm run validate:zip` builds the CLI, drives the built binary to write a 34-archive corpus (30 conformant, including 3 hostile-but-conformant archives — zip-slip, a Windows device name, duplicate paths — that pass the ISO profile and that `extract` must refuse; plus 4 raw-crafted negative canaries the validator must reject with a declared check id), and validates every file. An unexpected pass of a canary is fatal, and a coverage canary fails the run if a required check id has no canary. Level 0 always runs; level 1 foreign integrity tools skip visibly when absent and `VERAZIP_REQUIRED=1` fails closed in CI. The gate is blocking in `.github/workflows/verazip.yml` (Linux + Windows) and again before every publish. **Conformance is not safety** — hostile-but-spec-valid archives are exactly why the guards above exist.

## Disclosure Policy

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). We ask that you:

1. Report vulnerabilities privately (see above).
2. Allow us reasonable time to fix and release a patch before public disclosure.
3. Avoid testing against systems you do not own.

Confirmed vulnerabilities are fixed in a patch release with a GitHub Security Advisory and a CHANGELOG entry crediting the reporter (unless anonymity is requested).
