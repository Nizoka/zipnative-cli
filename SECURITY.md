# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

To report a security vulnerability, please use [GitHub's private vulnerability reporting](https://github.com/Nizoka/zipnative-cli/security/advisories/new) — this is the channel today.

As a fallback, `security@pdfnative.dev` is the shared maintainer inbox of the pdfnative and zipnative ecosystems. A dedicated `security@zipnative.dev` inbox is a maintainer decision that has not been taken yet; this file and [SUPPORT.md](SUPPORT.md) will name it when it exists.

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues. A vulnerability in the engine itself should be reported to [zipnative](https://github.com/Nizoka/zipnative/security/advisories/new); the CLI will ship the fixed engine version in a patch release.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.1.x   | ✅        |
| 1.0.x   | ⚠️ security fixes only, until 2027-04-18 (six months after 1.1.0) |
| < 1.0   | ❌        |

1.1.0 ships the security fixes recorded below — configuration limited to presentation, strict
invocation, finite bounds, symlink-safe overwrites, single-descriptor reads, terminal-safe text.
Three of them narrow what 1.0 accepted; the [CHANGELOG](CHANGELOG.md) lists each with its
migration. A security fix may narrow an input in a minor release; it never widens one.

## Security Model

zipnative-cli is a thin dispatch layer over the [`zipnative`](https://github.com/Nizoka/zipnative) engine. It introduces zero additional runtime dependencies and **contains no ZIP parsing logic of its own**: every byte of ZIP structure — end-of-central-directory records, central directory, local headers, Zip64, DEFLATE, CRC-32 — is parsed, validated and bounded inside `zipnative`. See the [zipnative security policy](https://github.com/Nizoka/zipnative/blob/main/SECURITY.md) for the engine's threat model and its frozen compatibility promise.

The engine, by design, never touches the filesystem, never opens a socket and never evals. That makes **the CLI the filesystem trust boundary**: it reads the archive bytes, hands them to the engine, and is the sink that writes extracted data to disk. The invariants the CLI adds on top of the engine are described below.

The CLI exposes 15 commands (run `zipnative --help` or `zipnative schema manifest` for the authoritative list). **No command can open a socket, in any mode** — there is no network opt-in.

### Configuration cannot relax a check

A `.zipnativerc.json` planted in a cloned repository is found by the upward discovery the moment
someone types `zipnative extract …` inside it. Since 1.1.0 a configuration file is
**presentation only** (`src/utils/config.ts`, [ADR 0001](docs/adr/0001-configuration-is-presentation-only.md)):
it may set `format`, `fields`, `json`, `pretty`, `quiet`, `no-color`, `progress`, `strict`,
`long` and `summary` — how a result is shown, or a stricter run — and nothing else. Every other
key (`overwrite`, `skip-unsafe`, `skip-unsupported`, `allow-symlinks`, every `--max-*`, input and
output paths, `name-encoding`, `timeout`, `codec`, …), the prototype names (`__proto__`,
`constructor`, `prototype`) and a value of the wrong type are `E_USAGE` naming the file; the
whole file is validated whatever command runs. Only a regular file of at most 1 MiB is read
(size checked on the open descriptor). A key applies only where the command declares the flag,
and the file that supplied defaults is announced on stderr and carried as `config: { path,
applied }` in the `--json` envelopes. `--no-config` skips discovery entirely — the recommended
posture for unattended runs. Before 1.1.0 every key but `codec` was accepted, so a planted file
could disable the limits or turn on `--overwrite` / `--skip-unsafe` / `--allow-symlinks`.

### Strict invocation

The parser stores flags in a prototype-free record and refuses `__proto__` / `constructor` /
`prototype` as names; since 1.1.0 the dispatcher also refuses, before any input is read, a flag
the command does not declare, a switch given twice, a single-value flag given twice, a flag given
both bare and with a value, more positionals than the command takes, and an operand together
with the flag it stands for — all `E_USAGE`, exit 2. A typo such as `--overwite` or
`--skip-unsafe` on the wrong command is therefore never a silent no-op. Every task of a `batch
--manifest` gets the same check, for all tasks before the first one runs. A refused value is
never echoed (it may be a secret typed in the wrong place).

### Terminal-safe text

Entry names, comments and the engine messages that quote them come from whoever produced the
archive. In **text** mode every such string is printed through `escapeTerminal()`
(`src/utils/sanitize.ts`): C0 controls other than TAB / LF, DEL, C1 controls and the Unicode
bidi embedding / override / isolate controls are rendered as visible escapes (`\x1b`,
`\u202e`), so a hostile name cannot clear the screen, retitle the window, rewrite earlier lines
of a listing or make `evil\u202etxt.exe` display as `evilexe.txt` (Trojan Source,
CVE-2021-42574). JSON output keeps the exact text (`JSON.stringify` escapes C0 controls) and
`--long` keeps the bytes in `rawNameHex`. The repository holds itself to the same rule:
`tests/docs/source-hygiene.test.ts` fails on any raw control or bidi character in a tracked text
file.

### Agent Mode (`--json`, `--dry-run`, `--strict`)

The agent-native contract is a **pure local presentation/validation layer** and adds **no network surface**:

- `--json` only changes how diagnostics are formatted on **stderr** (a machine-readable envelope). It never alters what is written to stdout and never relaxes any security check. Under `batch --manifest --json` every task's stdout is captured into the single batch document (64 MiB cap → `E_LIMIT`), and a task that would write an artefact to stdout is refused at validation.
- `--dry-run` validates inputs and plans — archives are opened, every destination is proven safe, edits are applied to the modifier, `modify` verifies the entries it would re-emit, manifests are resolved — and short-circuits **before** producing or writing output.
- `--strict` only tightens: the first engine diagnostic becomes a hard error before any output byte.
- Stable `E_*` classes carry a failure class; `error.zipCode` carries the engine's frozen `ZIP_*` cause verbatim; `detail` carries only the structured fields the engine (or the CLI-owned `--max-input-size` bound) defines (`{ limit, configured, observed }`, `{ feature }`, `{ expectedCrc, actualCrc }`). Internal parser state and byte offsets are never exposed beyond what the engine's own remedy-bearing message states.
- The same switches are honoured from the environment (`ZIPNATIVE_JSON`, `ZIPNATIVE_DRY_RUN`, `ZIPNATIVE_QUIET`, `ZIPNATIVE_STRICT`, `ZIPNATIVE_PURE_CODECS`, `ZIPNATIVE_PROGRESS`), so a manifest task inherits the mode of its `batch` invocation; there is no environment variable that loosens a check.
- `--timeout <duration>` only bounds a run: past the deadline the engine (zipnative 1.1 `signal`) and the CLI's own byte loops stop at the next chunk or entry boundary with `E_LIMIT` (`detail.limit: "timeout"`) and the file being written is removed. `--progress` writes snapshots to stderr only.

### Extraction sink

The engine's `extractZip` / `extractZipStream` yield `{ path, entry, data | stream() }` with `path` already run through `sanitizeEntryPath()` and the hostile shapes already refused (`rejectTraversal`, `rejectSymlinks`, `onDuplicate: 'error'`, the limits). `extract` and `stream --output-dir` share **one sink** (`src/utils/sink.ts`), hardened in two phases:

1. **Plan (lexical)** — the extraction generator is drained **without decompressing anything**. For every entry the CLI recomputes the destination with `safeJoin(root, path)` (`src/utils/io.ts`), which resolves the absolute target and proves it stays inside the resolved `--output-dir` (a relative-path escape, an absolute result or a `..` segment throws `E_SECURITY`). Existing files are refused unless `--overwrite` (`E_IO`). On case-insensitive filesystems (win32, darwin) two entries whose targets fold to the same path are refused (`ZIP_EXTRACT_DUPLICATE_PATH`) unless `--on-duplicate first|last` resolves it deliberately. Directory entries go through `sanitizeEntryPath()` + `safeJoin` too.
2. **Write (physical)** — before `mkdir -p` of a target's parent, the nearest **existing** ancestor is `realpath`'d and must lie under the root's `realpath`; after the directory is created it is re-checked the same way. A symbolic link or junction planted inside the destination that points outside is refused with `E_SECURITY` ("Refusing to write through a link that leaves the output directory…") and nothing is created beyond the link. Without `--overwrite` any existing path — a dangling symlink included (`lstat`, which also closes Windows' `CREATE_NEW`-follows-a-dangling-link hole) — is refused and every file is created **exclusively** (`wx`), so a file that appears between the plan and the write is refused like any pre-existing one — there is no check-then-write window. With `--overwrite` the entry is written to an exclusively created temp sibling and `rename()`d over the target, so a symlink planted **at** the target is replaced, never followed (1.0 opened it with `w`, which truncated and wrote through the link). Each entry streams in with backpressure; a CRC / size failure removes only the file the write created — a pre-existing target is never truncated or removed. `--preserve-mode` applies `mode & 0o777` to files only (never setuid, setgid or sticky; POSIX only).

**Residual window.** The only gap left is between the `realpath` check and the exclusive `open`: an attacker who can replace a directory with a link *inside that interval* and who already has write access to the destination could redirect one file. The posture is therefore: **extract into an empty or trusted destination**; the CLI never extracts into a location it did not check, but it cannot lock a directory it does not own.

Opt-outs are **skip-not-write**: `--skip-unsafe` skips entries whose names cannot be made safe (they are listed in the envelope as `skipped: unsafe-path` and never written); `--skip-symlinks` drops symlink entries; `--allow-symlinks` writes the link **target text** as a regular file — **a symlink is never materialised by the CLI under any flag**; `--skip-unsupported` skips encrypted entries and methods with no registered codec (`skipped: unsupported`). `--flat` writes basenames only and applies the same duplicate policy.

`stream --output-dir` is the same sink over the forward reader: because `iterateZipEntries` does not sanitise names, the CLI applies `sanitizeEntryPath()` itself before `safeJoin`, entry by entry.

### Overwrite policy

The policy is **uniform** across every writer, not only the sink: `create -o`, `modify -o`, `cat -o`, `inflate -o`, `extract`, `stream --output-dir` and `batch --task create` (directory mode) refuse an existing path — a dangling symlink included — with `E_IO` ("Refusing to overwrite existing file <path> (pass --overwrite)") and leave it intact; `--overwrite` writes an exclusive temp file next to the target and renames it into place (a planted symlink is replaced, not followed; a failed write leaves the original untouched). The write layer is the only code that removes a partial file, and only one it created: before 1.1.0 an engine error raised before the deferred exclusive open could make `cat` / `inflate` / `create` unlink a **pre-existing** output. `modify --in-place` never writes into the original: it writes to an unpredictable, exclusively created temporary file (`<input>.tmp-<pid>-<12 hex>`) and renames atomically. Writing to stdout (`-` or no `-o`) is unaffected. Partial outputs are removed on failure, and a `SIGINT` / `SIGTERM` handler removes **only the file currently being written** (never a completed output, never the original of `--in-place`) before exiting 130 / 143.

### Input Validation

- **Argv paths are the user's own filesystem authority.** `zipnative list ../a.zip`, `-o ../out.zip` or `--output-dir ../x` are ordinary shell usage and are accepted; the CLI does not second-guess where the invoking user may read or write. `validatePath()` — the `..` refusal, `E_INPUT` "Path traversal detected" — applies to paths that arrive as **data**: the path flags of `batch --manifest` tasks and the `path` values of `create` / `modify` manifests. Entry **names** are a different matter (see below).
- **`--max-input-size <size>`** (global; default **4 GiB**; always finite) bounds every **buffered** read through **one descriptor**: stdin is byte-counted and the read aborted; a regular file is size-checked on its open descriptor and read to that size only (a file that grows after the check is never read past it; short reads loop); a pipe, FIFO or device (`<(curl …)`, `/dev/zero`) is byte-counted like stdin — 1.0 `stat`'d the path, saw size 0 for `/dev/zero` and read it whole — `list`, `inspect`, `verify`, `extract`, `cat`, `modify`, `create --stdin-name`, `inflate --sync`, `govern verify-issue`. Exceeding it is `E_LIMIT` with `detail { limit: "maxInputSize", configured, observed }` (CWE-400). It is a CLI-owned bound, not a `ZipLimits` key; `doctor` reports it under `limits`. The streaming paths — `stream`, `crc32`, `inflate` (default), `create --stream` — are constant-memory and are not bounded by it. Random-access commands hold the whole archive in memory, so the bound is also the memory envelope.
- JSON input size is capped at **50 MB** before `JSON.parse` — `create --from-manifest`, `modify --from-manifest`, `batch --manifest`, `govern verify-issue` drafts. Batch manifests are additionally bounded to **1 000 tasks**. `.zipnativerc.json` is capped at 1 MiB (checked on the open descriptor).
- **Manifest values** — `batch --manifest` is validated strictly before anything executes: structural violations exit 2 / `E_USAGE`, value violations (bad or duplicate id, non-whitelisted command, forward or unknown `@ref`) exit 1 / `E_INPUT`; only 10 archive commands may appear (never `batch`, `govern`, `schema`, `completion`, `doctor`); a `codec` flag is refused unless the `batch` invocation itself carries `--allow-codec-load`. A manifest has the filesystem access of the user who invokes `batch` — the same trust level as flags typed on the command line, no more.
- **`--max-*` semantics** — the eight flags map one-to-one onto the engine's `ZipLimits` and are pre-validated (`E_USAGE` on malformed or zero values), so an invalid limits object can never reach the engine. **Every bound is finite**: the 1.0 `none` / `inf` form (`Infinity`) is refused since 1.1.0 with a remedy naming an explicit value ([ADR 0002](docs/adr/0002-every-bound-is-finite.md)), and no bound can come from a config file; the defaults are always on when no flag is given. zipnative 1.1's ninth bound, `maxEntryCompressedSize` (CWE-770), is consulted only by the byte-range reader, which no 1.1.0 command uses: `doctor` / `schema limits` report its default and it has no flag. `inflate` derives its mandatory `--max-output` default from the effective `--max-entry-size`. The bounds also apply on the write side (`create` / `modify`).
- Every entry name the CLI **writes** (`create` inputs, `--stdin-name`, manifests, `modify --add` / `--rename` / `--add-dir`) is pre-checked with the engine's `sanitizeEntryPath()`: a name that could not be extracted safely is refused at creation time (`E_INPUT`, with `entryName`). Malformed flags stay `E_USAGE`; unsafe **data** is `E_INPUT`.
- Dates are data too: `--date <ISO>` and manifest `date` values are read as **UTC wall-clock**, so the stored DOS fields — and the archive bytes — do not depend on the host time zone. A date outside 1980–2107 is clamped by the engine and reported (`ZIP_TIMESTAMP_CLAMPED`, zipnative 1.1), an error under `--strict`.
- `--name-encoding <label>` hands the engine a `TextDecoder` (the runtime's own, no table shipped) for names without the UTF-8 flag; the engine decodes **before** `sanitizeEntryPath()`, so a decoded name passes exactly the same guards (zipnative 1.1, CWE-22).
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
| Unbounded stdin / file / device buffering (memory exhaustion) | `--max-input-size` (4 GiB default) on every buffered read, through one descriptor (devices and pipes byte-counted); streaming commands are constant-memory | always finite (1.1.0) |
| Hostile `.zipnativerc.json` in a cloned repository | presentation-only keys; every other key `E_USAGE` naming the file; the applying file named on stderr and in the envelope | `--no-config` for unattended runs |
| A typo or a misplaced flag silently ignored | unknown / repeated / surplus flags and operands `E_USAGE` before any input is read (argv and every manifest task) | none |
| Terminal escape / bidi injection through entry names | text output escaped (`escapeTerminal`); JSON exact; `rawNameHex` | none |
| A symlink planted at an output path | `lstat` refusal without `--overwrite`; temp + `rename()` with it (replaced, never followed) | none |
| Symlink / junction planted inside `--output-dir` | `realpath` anchor of the nearest existing ancestor before `mkdir`, re-check after; refused with `E_SECURITY` | the realpath → open window: use an empty or trusted destination |
| File appearing between plan and write | exclusive `wx` open unless `--overwrite`; `E_IO` refusal | none |
| Partial output under its final name (failure or interrupt) | the write layer removes only the file it created (a pre-existing target is never removed); `SIGINT` / `SIGTERM` remove the in-flight file only, exit 130 / 143 | signals are POSIX-only in practice |
| `modify` laundering a hostile record into a canonical-looking archive | eager open + `verifyEntry()` on every re-emitted entry before the save (see below) | encrypted / stream-only-codec content cannot be checked: their local header is, and they are counted |
| A `--codec` module shaping the writer silently | override announced (`warning:` line, `tier`); `create --parallel` refuses such a module | see Code Safety |

### Data remanence (`modify`)

The default `modify` save is the engine's append-only `save()`: the original bytes are kept verbatim and a new central directory is appended, so untouched entries are never recompressed — and **removed or replaced content remains recoverable** from the output file. `--compact` selects `saveCompact()`, a canonical rewrite (still no recompression) in which removed content is truly gone. The CLI prints an `info:` line whenever a destructive edit is saved append-only, and the engine emits the `ZIP_DEAD_BYTES_RATIO` diagnostic above 50 % dead bytes. 7-Zip's CLI is also known to mis-read the append-only layout (it does not honour the final central directory); ship `--compact` output when interoperability with 7-Zip matters.

### `modify` verifies what it re-emits

Because both save modes copy untouched records verbatim, `modify` must not launder a hostile archive into a clean-looking one. It opens the archive **eagerly** (overlaps and the central-directory ↔ local-header structure are checked before any edit) and, before `save()` / `saveCompact()`, calls `reader.verifyEntry()` on **every entry that will be re-emitted** (every entry not removed or replaced; renamed entries are verified under their original record): CRC-32, sizes and the local header against the central directory — one decompress pass, never a recompress. A lying record is refused with the entry named: `E_SECURITY` `ZIP_CD_LFH_MISMATCH`, `E_DATA` `ZIP_CRC_MISMATCH` or `ZIP_SIZE_MISMATCH`. Encrypted entries and entries whose registered codec has no `decompressSync` cannot have their content verified: since zipnative 1.1 their **local header is still cross-checked** (a mismatch is refused like any other, `ZIP_CD_LFH_MISMATCH`) and they are counted in `verifySkipped`; an entry with an unregistered method is refused (`E_UNSUPPORTED` / `ZIP_UNSUPPORTED_METHOD`, load `--codec`). The check runs under `--dry-run` too and has **no opt-out** — an opt-out would write unverified bytes. The envelope reports `verified`, `verifySkipped`, `tier`, `changed` and `layout: append-only | compact`.

### Forward reader trust caveat (`stream`)

`stream` reads local headers **alone** through `iterateZipEntries` — there is no central directory to cross-check names, sizes, methods or attributes, so a hostile archive can present different content there than `list` / `extract` authoritatively report. Consequently `--preserve-mode`, `--allow-symlinks` and `--skip-symlinks` are refused in forward mode (`E_USAGE`), every JSON output carries `trust: "local-headers-only"`, a `warning:` line is printed at start, and every name written to disk goes through `sanitizeEntryPath()` + `safeJoin`. All size limits are enforced by output counting and CRCs are verified. Entries written with data descriptors carry zero sizes in their local header, so `--summary` reports `descriptorEntries` and `bytesKnown: false` rather than pretending. A custom-method entry is decoded in forward mode only when its `--codec` exposes `createDecompressor()` (zipnative 1.1); otherwise the engine refuses it **before the first byte** (`E_UNSUPPORTED` `ZIP_UNSUPPORTED_CODEC_MODE`), which `--skip-unsupported` skips — `cat` / `extract --codec` read it from the complete file. Use `stream` only for input you cannot seek; prefer `list` / `extract` on a complete file.

### Code Safety

- No `eval()`, `Function()`, or dynamic code execution — with **one declared exception**: `--codec <module>` dynamically imports a user-supplied ESM module and registers its codecs (`registerCodec`, `setInflateImpl`, `setDeflateImpl`). It runs with the invoking user's privileges (the same trust as `node -r`), so it is honoured **only from argv**: `.zipnativerc.json` refuses the `codec` key (a hostile repository cannot run code when you type `zipnative list` inside it), a `batch --manifest` task carrying `codec` is refused unless the invocation itself passes `--allow-codec-load`, and a loaded module is reported truthfully. Registered codecs are **not confined to the reader**: the engine resolves methods 0 (store) and 8 (deflate) through the registry, so a module that registers either **replaces the built-in compressor** for `create` / `modify` — even under `--deterministic`, which pins only the engine's own encoder — and a sequential `create` announces it with a `warning:` line (silent under `--dry-run`); a module exporting `deflateImpl` replaces the sync deflate tier and shows up as `tier: "injected"` in the envelope unless `--deterministic` pins the engine's encoder (`pure-pinned`). `create --parallel` refuses (exit 2) a module registering method 0 / 8, and a `deflateImpl` without `--deterministic`, because the worker pool never sees the module and the envelope would lie. `batch --manifest` otherwise dispatches only to a fixed whitelist of CLI command modules.
- **No sockets.** No command opens a network connection; there is no flag that could. `doctor`, `govern` and `schema` are fully local.
- The CLI never post-processes archive bytes: what the engine writes is what is written to disk, so the engine's `deterministic: true` byte contract holds end to end.
- **Signals.** `SIGINT` / `SIGTERM` remove exactly the files being written at that moment (`src/utils/inflight.ts` registers a file only once the CLI created it) and exit 130 / 143; completed outputs and the original of `modify --in-place` are never touched. POSIX only in practice (Windows has no signals for child processes).
- **Supply chain.** The package ships the CJS bin only (`dist/cli.cjs`, no ESM build, no `.d.ts`, no source maps, no `main` entry) plus `AGENTS.md`, `llms.txt`, `docs/data/errors.json`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, `THIRD-PARTY-NOTICES.md`, `LICENSE` and `package.json` — 10 files, pinned in `docs/data/package-files.json` (legal texts by SHA-256). `scripts/lib/bundle-probe.mjs` fails the build if engine code is inlined, a module outside the allow-list is required, or a `console.log`, an attribution trailer or embedded binary data appears; `scripts/smoke-install.mjs` installs the packed tarball into an empty project and proves it pulls exactly one runtime dependency. The release ([ADR 0009](docs/adr/0009-release-integrity.md)) runs in four jobs — `guard` (tag = `v<version>`, tags only), `build and pack` (the whole publish gate with no `id-token` and no cache, one tarball and its SHA-256 / SHA-512), `publish to npm` (behind the `npm-publish` environment, `.nvmrc` only, digests re-checked, an npm client pinned by SHA-512, Trusted Publishing with provenance — no `NPM_TOKEN` anywhere) and `attest and attach` (the tarball fetched back from the registry and compared, `npm audit signatures`, the installed bin run, CycloneDX + SPDX + toolchain SBOMs written by `npm sbom`, everything attested with `actions/attest-build-provenance` and attached to the GitHub Release with the Sigstore bundle). **Verify a release:** `npm install zipnative-cli@<version> && npm audit signatures`; `gh attestation verify zipnative-cli-<version>.tgz -R Nizoka/zipnative-cli`. Repository side: every workflow job starts with `step-security/harden-runner`, installs with `npm ci --ignore-scripts` (the tracked `.npmrc` says the same for every machine), keeps no checkout credentials and pins every action to one SHA; zizmor, actionlint and `reuse lint` check the workflows and licences; CodeQL `security-extended` covers the TypeScript and the workflows; OpenSSF Scorecard, dependency review, a weekly npm audit + OSV-Scanner and Dependabot (seven-day cooldown, the engine bumping alone) watch the dependencies; `.github/rulesets/` holds branch and tag protection as code; `tests/tools/workflows.test.ts` pins all of it. CI also proves the bundle is byte-reproducible (two builds, one hash). Contacts: [security.txt](docs/.well-known/security.txt), [Security Insights](.github/SECURITY-INSIGHTS.yml).

### Not supported by policy

- **Encryption, read or write.** ZipCrypto is cryptographically broken; the engine will never write it and does not read it in 1.x. Encrypted entries are detected (`isEncrypted`; since zipnative 1.1 the scheme is named — `detail.feature` `zipcrypto`, `aes` or `strong-encryption`), listed, counted by `inspect`, reported as `skipped: "encrypted"` by `verify` (passing only when their local header agrees), skippable with `extract --skip-unsupported` / `stream --skip-unsupported`, copied with their header checked by `modify` (counted in `verifySkipped`), and refused on read with `ZIP_UNSUPPORTED_ENCRYPTION`. There is no password flag.
- **Multi-disk / spanned archives** — refused (`ZIP_UNSUPPORTED_MULTI_DISK`).
- **Archive repair / salvage** — structural problems are reported (`verify`, `inspect`), never guessed at.
- **Other archive formats** — none.

### False conformance claims → veraZIP gate

Every archive the CLI writes is validated against **ISO/IEC 21320-1:2015** by `scripts/validate-zip.mjs`, a validator vendored from the engine (`zipnative/scripts/validate-zip.ts`, commit `1e2ab42`, zipnative 1.1.0) that raw-parses the bytes with its own reader and **never imports `zipnative`** — so it cannot attest the engine with the engine. `npm run validate:zip` builds the CLI, drives the built binary to write a 39-archive corpus (35 conformant, including 3 hostile-but-conformant archives — zip-slip, a Windows device name, duplicate paths — that pass the ISO profile and that `extract` must refuse; plus 4 raw-crafted negative canaries the validator must reject with a declared check id), and validates every file: the expected verdict is **35 PASS, 4 XFAIL, 0 FAIL**. An unexpected pass of a canary is fatal, and a coverage canary fails the run if a required check id has no canary. Level 0 always runs; level 1 foreign integrity tools skip visibly when absent and `VERAZIP_REQUIRED=1` fails closed in CI. The gate is blocking in `.github/workflows/verazip.yml` (Linux + Windows, on every push and PR — no path filter) and again before every publish. **Conformance is not safety** — hostile-but-spec-valid archives are exactly why the guards above exist.

## Disclosure Policy

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). We ask that you:

1. Report vulnerabilities privately (see above).
2. Allow us reasonable time to fix and release a patch before public disclosure.
3. Avoid testing against systems you do not own.

Confirmed vulnerabilities are fixed in a patch release with a GitHub Security Advisory and a CHANGELOG entry crediting the reporter (unless anonymity is requested).
