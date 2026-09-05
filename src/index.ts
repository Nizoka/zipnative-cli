import { parseArgs, hasFlag, getStringFlag } from './utils/args.js';
import { CliError, ErrorCode } from './utils/error.js';
import { isJsonMode, emitJsonError, remedyFor } from './utils/agent.js';
import { loadConfig, applyConfigDefaults } from './utils/config.js';
import { installSignalCleanup } from './utils/inflight.js';
import { installEpipeGuard } from './utils/io.js';
import { cliVersion, engineVersion } from './utils/version.js';

// Lazy-import commands to keep startup fast for --help / --version
type CommandFn = (args: ReturnType<typeof parseArgs>) => Promise<void>;

const GLOBAL_USAGE = `\
Global options (any command):
  --config <file>   Use a specific .zipnativerc.json (default: nearest upward)
  --no-config       Ignore any .zipnativerc.json
  --quiet,   -q     Suppress progress output and text diagnostics on stderr
  --no-color        Disable ANSI colour on the stderr progress lines (also
                    NO_COLOR; FORCE_COLOR turns it on; TERM=dumb turns it off)
  --json            Agent mode: emit a JSON status/error envelope on stderr
                    (data stays on stdout). Errors carry a stable E_* code and
                    zipnative's ZIP_* code verbatim.
  --pretty          Indent JSON output under --json
  --dry-run         Validate inputs and plan without writing output (create,
                    extract, modify, stream, cat, inflate, batch)
  --strict          Escalate the first engine diagnostic into E_CHECK_FAILED
                    before any output byte (verify: the report is printed and
                    the verdict becomes E_VERIFY_FAILED)
  --max-entries <n>            Security bounds (zipnative ZipLimits); "none"
  --max-entry-size <size>      disables a bound. Defaults: 100000 entries,
  --max-total-size <size>      1 GiB per entry, 8 GiB total, ratio 1024:1,
  --max-ratio <n>              4096-byte names, 65535-byte extra fields and
  --max-name-bytes <size>      comments, 256 MiB central directory.
  --max-extra-bytes <size>     <size> accepts 65536, 512k, 1m, 8g, 1GiB.
  --max-comment-bytes <size>
  --max-cd-bytes <size>
  --max-input-size <size>      Bound on a buffered input read — an archive
                    or payload read from stdin or a file into memory (list,
                    inspect, verify, extract, cat, modify, create --stdin-name,
                    inflate --sync, govern verify-issue). Default 4 GiB;
                    "none" disables it;
                    exceeding it is E_LIMIT. The streaming commands (stream,
                    crc32, inflate, create --stream) are not bounded by it.
  --pure-codecs     Skip node:zlib and run the pure-TS codec tier
  --codec <module>  Load an ESM module exporting { codecs: ZipCodec[] } and
                    register it. A codec for method 0/8 (or a deflateImpl)
                    also drives the writer — reported in the envelope tier
                    and a warning; refused by create --parallel. Executes
                    user code: only accepted on the command line, never
                    from a config file.

Exit codes:
  0  success              1  failure (any E_* class but usage)
  2  usage error          130 / 143  interrupted by SIGINT / SIGTERM (the file
                             being written is removed; finished outputs stay)

Environment:
  ZIPNATIVE_JSON=1         same as --json         ZIPNATIVE_DRY_RUN=1  --dry-run
  ZIPNATIVE_QUIET=1        same as --quiet        ZIPNATIVE_STRICT=1   --strict
  ZIPNATIVE_PURE_CODECS=1  same as --pure-codecs  ZIPNATIVE_DEBUG=1    traces
  NO_COLOR / FORCE_COLOR / TERM=dumb              colour of the stderr lines
`;

const USAGE = `\
zipnative-cli — Official CLI for zipnative

Usage:
  zipnative <command> [options]

Commands (15):

 Create & modify
  create      Build a deterministic ZIP from files, dirs, stdin or a manifest
  modify      Incremental edits: add/replace/remove/rename/comment (append-only
              or --compact)

 Read & extract
  list        List archive entries (text | json | ndjson)
  inspect     Forensic report with determinism/security --check assertions
  cat         Stream one or more entries to stdout
  extract     Extract to a directory (zip-slip, symlink, bomb and duplicate
              guards on by default)
  stream      Forward-only reader over stdin/pipes (no central directory)

 Integrity & codecs
  verify      Deep integrity verification (CRC, sizes, local headers, diags)
  crc32       CRC-32 of files or stdin
  inflate     Decompress a raw DEFLATE (or registered-codec) stream

 Automation & meta
  batch       Archive subfolders, verify a folder of archives, or run a
              manifest pipeline
  doctor      Environment / capability preflight (text or --json)
  schema      Print a JSON Schema / capability manifest for agents
  completion  Emit a shell completion script (bash|zsh|fish|powershell)
  govern      AI-governance / HITL contract (rules, policy, verify-issue)

Options:
  --help,    -h   Show this help message
  --version, -V   Show version (add --json for machine-readable output)

${GLOBAL_USAGE}
Offline, always: no command can open a socket.
For autonomous/agent usage see AGENTS.md.
Run \`zipnative <command> --help\` for per-command options.
`;

const CREATE_USAGE = `\
zipnative create — Build a deterministic ZIP archive

Usage:
  zipnative create [<path>...] --output <out.zip> [options]
  zipnative create --from-manifest <entries.json> -o <out.zip>
  cat file | zipnative create --stdin-name <name> -o <out.zip>

Inputs:
  <path>...           Files and directories (directories are walked recursively)
  --input,   -i       Same as a positional (repeatable; useful in manifests)
  --stdin-name <n>    Read stdin as one entry named <n>
  --from-manifest <f> JSON manifest ({ comment|commentBase64, order, date,
                      compression, entries: [{ name, path|data|dataBase64|
                      directory, method, level, date, comment, mode,
                      extraFields }] }) —
                      see \`zipnative schema create-manifest\`
  --output,  -o       Output path (default: stdout)
  --overwrite         Replace an existing output file (default: refuse, E_IO)

Naming:
  --base <dir>        Entry names are relative to <dir> (default: each input's
                      parent directory)
  --prefix <dir/>     Prepend <dir/> to every entry name
  --dir-entries       Emit explicit directory entries (keeps empty directories)
  --include <glob>    Keep only matching names (repeatable; *, **, ?)
  --exclude <glob>    Drop matching names (repeatable)
  --follow-symlinks   Dereference symlinks (default: skipped with a warning;
                      symlink entries are never written)

Compression & determinism:
  --method store|deflate   (default deflate)
  --level 0-9              (default 6)
  --deterministic          Pin the pure-TS encoder: identical SHA-256 on
                           every runtime
  --order canonical|insertion   Entry order (default canonical raw-name bytes;
                           insertion = argv order, directories walked name-
                           sorted — e.g. an EPUB "mimetype" first)
  --date epoch|now|<ISO>   Timestamp for entries (default: DOS epoch,
                           reproducible). An ISO date is UTC wall-clock time
                           (a string without a zone is read as UTC), so the
                           stored DOS fields are identical on every host;
                           range 1980-2107, 2-second resolution.
  --mtime                  Use each file's modification time (local time,
                           non-reproducible)
  --comment <text>         Archive comment
  --comment-file <path>    Archive comment from a file, raw bytes ("-" = stdin;
                           exclusive with --comment; at most 65535 bytes)
  --entry-comment <name>=<text>   Per-entry comment (repeatable)
  --preserve-mode          Store POSIX mode bits (no setuid/setgid/sticky)
  --store-ext png,jpg,zip  Store (no deflate) entries with these extensions

Output modes:
  --stream                 Constant-memory writer: file inputs are streamed
                           (data-descriptor layout, so the bytes differ from
                           the buffered layout — the content is identical);
                           entries > 4 GiB are refused
                           (ZIP_UNSUPPORTED_ZIP64_STREAMING)
  --chunk-size <size>      Output chunk size for the chunked writer (--stream
                           or --stdin-name; default 65536)
  --parallel               Deflate across a worker pool (zipnative/worker);
                           byte-identical to the sequential writer per tier.
                           Refused (exit 2) with a --codec module registering
                           method 0/8, or a deflateImpl without --deterministic:
                           workers never see the module
  --workers <n>            Worker count (default cores-1, max 8; 0 = main
                           thread)
  --min-job-size <size>    Minimum entry size sent to a worker (default 32k)
  --job-timeout <ms>       Per-job cap before inline fallback (default 60000)

  --dry-run                Walk inputs, validate names, print the plan;
                           write nothing

Status envelope (--json): { ok, command, dryRun, output, entries, files,
directories, bytes, bytesIn, method, level, deterministic, tier, order, stream,
layout, parallel, skipped, diagnostics }.
`;

const LIST_USAGE = `\
zipnative list — List archive entries without decompressing anything

Usage:
  zipnative list --input <a.zip> [options]
  zipnative list <a.zip> [options]

Options:
  --input,   -i       Archive path (default: stdin)
  --format, -f text|json|ndjson   (default text; json under --json)
  --long              Add mode, flags, versions, offsets and extra fields
  --validate lazy|eager       Cross-check every local header up front (eager)
  --include <glob>    Keep only matching names (repeatable)
  --exclude <glob>    Drop matching names (repeatable)
  --summary           { entries, files, directories, compressedSize,
                        uncompressedSize, zip64, encrypted }
  --fields a,b.c      Dot-path projection of the JSON report

JSON shape: \`zipnative schema entries\`.
`;

const INSPECT_USAGE = `\
zipnative inspect — Forensic archive report with CI assertions

Usage:
  zipnative inspect --input <a.zip> [--format json|text] [--check <assert>]...
  zipnative inspect <a.zip> [options]

Options:
  --input,   -i       Archive path (default: stdin). Opened EAGERLY: every local
                      header cross-checked, overlap table built up front.
  --format, -f text|json  (default text; json under --json)
  --entries           Include every entry (long form) in the report
  --entry <name>      Include only the named entries (repeatable)
  --extra             Include extra-field payloads as hex
  --check <assert>    Assertion (repeatable, comma-separable). Any failure
                      prints
                      the report then exits 1 with E_CHECK_FAILED:
                        deterministic (reproducible: epoch timestamps +
                        canonical order + UTF-8 flags), epoch-timestamps,
                        canonical-order, utf8-names, canonical-layout /
                        no-data-descriptor (buffered layout — a --stream
                        archive is reproducible but not canonical), no-zip64,
                        zip64, no-encryption, no-symlinks, safe-names (every
                        name passes sanitizeEntryPath), no-duplicates,
                        no-diagnostics, store-only, deflate-only,
                        max-entries=N, min-entries=N, max-uncompressed=<size>,
                        max-ratio=N, has=<name>, method=store|deflate|<id>
  --summary           { entries, bytes, uncompressedSize, zip64, encrypted,
                        deterministic, canonicalLayout, diagnostics,
                        checksPassed? }
  --fields a,b.c      Dot-path projection

JSON shape: \`zipnative schema inspect\`.
`;

const CAT_USAGE = `\
zipnative cat — Stream one or more entries to stdout

Usage:
  zipnative cat --input <a.zip> --entry <name> [--entry <name>]... [-o <file>]
  zipnative cat <a.zip> <name> [<name>...]

Options:
  --input,   -i       Archive path
  --entry,   -e       Entry name (repeatable); entries are concatenated in order
  --output,  -o       Write to a file instead of stdout
  --overwrite         Replace an existing --output file (default: refuse, E_IO)
  --raw               Output the COMPRESSED payload (zero-copy), no decoding
  --no-verify-crc     Skip the CRC-32 check at the end of the stream
  --dry-run           Resolve the entries and report their sizes; output nothing

Note: the CRC is verified at the END of the stream (like \`unzip -p\`), so
stdout may already carry bytes when E_DATA fires; with --output the partial
file is removed.
`;

const EXTRACT_USAGE = `\
zipnative extract — Extract to a directory, secure by default

Usage:
  zipnative extract --input <a.zip> --output-dir <dir> [options]

Options:
  --input,   -i       Archive path (default: stdin)
  --output-dir, -d    Destination directory (REQUIRED; created if missing).
                      Every path is re-checked with sanitizeEntryPath() and
                      contained under this root.
  --include <glob>    Keep only matching names (repeatable)
  --exclude <glob>    Drop matching names (repeatable)
  --entry <name>      Extract only the named entries (repeatable)
  --overwrite         Replace existing files (default: refuse, E_IO)
  --on-duplicate error|first|last   Same sanitized path twice (default error)
  --skip-unsafe       SKIP entries whose names cannot be made safe instead of
                      failing (zip-slip, absolute, drive/UNC, NUL, ADS, device
                      names). Nothing unsafe is ever written.
  --skip-unsupported  SKIP encrypted entries and methods with no registered
                      codec (reason "unsupported") instead of failing
  --allow-symlinks    Write a symlink entry's TARGET TEXT as a regular file
                      (a symlink is never materialised). Default: refuse.
  --skip-symlinks     Drop symlink entries silently
  --flat              Drop directories, write basenames only
  --buffered          Use the in-memory extractor (many tiny entries)
  --preserve-mode     Apply POSIX mode bits (never setuid/setgid/sticky)
  --preserve-mtime    Apply the entry timestamp to each file
  --dry-run           Plan and validate; write nothing

Refusals (E_SECURITY + zipCode): ZIP_PATH_TRAVERSAL, ZIP_SYMLINK_REJECTED,
ZIP_EXTRACT_DUPLICATE_PATH, ZIP_ENTRY_OVERLAP, ZIP_CD_LFH_MISMATCH.
Bounds (E_LIMIT): --max-entry-size, --max-total-size, --max-ratio, ...
`;

const STREAM_USAGE = `\
zipnative stream — Forward-only reader for UNSEEKABLE input

Usage:
  curl ... | zipnative stream [--list] [--format ndjson]
  curl ... | zipnative stream --output-dir <dir>
  cat a.zip | zipnative stream --cat <name>

Options:
  --input,   -i       File to read sequentially (default: stdin)
  --list              List entries as they arrive (default mode)
  --output-dir, -d    Extract under <dir> (sanitizeEntryPath + containment)
  --cat <name>        Write the named entry's data to stdout (repeatable)
  --format, -f text|json|ndjson   (default text; ndjson under --json, json
                      when --summary or --fields is given)
  --long              Add flags, versions and extra fields to the rows
  --include/--exclude <glob>, --overwrite, --on-duplicate, --flat,
  --preserve-mtime    As in \`extract\`
  --skip-unsafe       Skip unsafe names instead of failing
  --skip-unsupported  Skip encrypted / unknown-method entries instead of failing
  --summary, --fields Token-economy projection of the --format json report
  --dry-run           Iterate and plan; write nothing

TRUST CAVEAT: the forward reader parses local headers ALONE. There is no
central directory to cross-check names, sizes, methods or attributes, so
--preserve-mode / --allow-symlinks / --skip-symlinks are unavailable here and
every JSON output carries trust: "local-headers-only". Prefer \`list\` /
\`extract\` whenever the whole file is available.
`;

const MODIFY_USAGE = `\
zipnative modify — Incremental edits without recompressing untouched entries

Usage:
  zipnative modify --input <a.zip> --output <b.zip> [edits] [--compact]
  zipnative modify --input <a.zip> --in-place [edits]
  zipnative modify --input <a.zip> -o <b.zip> --from-manifest <edits.json>

Edits (applied in this fixed order regardless of argv order):
  --remove <name>            Remove an entry (repeatable)
  --rename <from>=<to>       Rename an entry (repeatable)
  --replace <name>=<path>    Replace an entry's content (repeatable; path "-"
                             = stdin)
  --add <name>=<path>        Add a new entry (repeatable; a bare <path> uses
                             its basename)
  --add-dir <name>           Add an explicit directory entry (repeatable)
  --comment <text>           Set the archive comment ("" clears it)
  --comment-file <path>      Set the archive comment from a file, raw bytes
                             ("-" = stdin; exclusive with --comment)
  --from-manifest <f>        JSON edits ({ comment|commentBase64, edits: [{ op,
                             name, to, path|data|dataBase64, method, level,
                             date, comment, mode, extraFields }] }) —
                             see \`zipnative schema modify-manifest\`

Options:
  --method/--level/--deterministic   Compression for NEW payloads
  --date epoch|now|<ISO>     Timestamp for new payloads (default: DOS epoch)
  --compact                  Canonical rewrite (saveCompact): removed data is
                             truly gone, still no recompression
  --in-place                 Write back to the input path (exclusive temp
                             file + atomic rename)
  --output,  -o              Output path (default: stdout)
  --overwrite                Replace an existing --output file (default:
                             refuse, E_IO)
  --dry-run                  Validate edits against the archive; write nothing

Default save is APPEND-ONLY: original bytes verbatim + appended entries + a new
central directory. Removed/replaced content REMAINS RECOVERABLE (data remanence)
and 7-Zip's CLI is known to mis-read this layout — pass --compact when either
matters.

Every untouched entry is VERIFIED before it is re-emitted verbatim (CRC-32,
sizes, local header vs central directory — one decompress pass, never a
recompress): a lying record is refused (E_DATA / E_SECURITY with the entry
name) instead of being laundered into a clean-looking archive. Encrypted
entries and entries whose codec has no sync decompressor are copied as-is and
counted in verifySkipped.
`;

const VERIFY_USAGE = `\
zipnative verify — Deep integrity verification in one call

Usage:
  zipnative verify --input <a.zip> [--format json|text] [--strict]
  zipnative verify <a.zip> [options]

Options:
  --input,   -i       Archive path (default: stdin)
  --entry,   -e       Verify only the named entries (repeatable): CRC-32, sizes
                      and local header of each, after the eager structural
                      check; the report lists them under "selected". An unknown
                      name is E_NOT_FOUND before any output.
  --format, -f text|json  (default text; json under --json)
  --strict            Also fail when any diagnostic was emitted
  --summary           { ok, entries, failed, skipped, diagnostics, selected?,
                        error? }
  --fields a,b.c      Dot-path projection

Report = zipnative's ZipVerificationReport ({ ok, error, entryCount, entries[
{ name, ok, crcMatch, sizeMatch, localHeaderMatch, skipped? }], diagnostics })
plus { failed, skipped, strict, selected? }. Encrypted entries are honestly
"skipped", never faked as verified. Exit 1 / E_VERIFY_FAILED when ok is false;
the error envelope carries zipCode = report.error.code for structural refusals.
verify proves integrity and structure, NOT path safety: a zip-slip archive with
valid CRCs is "ok". Gate names with \`inspect --check safe-names,no-symlinks\`
(or \`extract --dry-run\`) before extracting.
`;

const CRC32_USAGE = `\
zipnative crc32 — CRC-32 (IEEE, the ZIP checksum) of files or stdin

Usage:
  zipnative crc32 [<file>...] [--seed <hex>] [--expect <hex>]
                  [--format text|json]

Options:
  --input,   -i       File (repeatable); default stdin
  --seed <hex>        Continue a running checksum from this value
  --expect <hex>      Single input: exit 1 / E_CHECK_FAILED on mismatch
  --format, -f text|json  (default text: "<crc>  <bytes>  <file>")

Streams input in 64 KiB chunks — constant memory for any size.
`;

const INFLATE_USAGE = `\
zipnative inflate — Decompress a raw DEFLATE (RFC 1951) or codec stream

Usage:
  zipnative inflate [--input <file>] [--output <file>] [--max-output <size>]

Options:
  --input,   -i       Compressed input (default: stdin)
  --output,  -o       Decompressed output (default: stdout)
  --overwrite         Replace an existing --output file (default: refuse, E_IO)
  --max-output <size> Hard output bound (default: the effective
                      --max-entry-size, 1 GiB); "none" only for trusted input
  --method deflate|store|<id>   Codec (default deflate; ids via --codec)
  --sync              Buffer the input and use the codec's decompressSync
  --allow-trailing    Silence the warning about bytes after the stream end
  --dry-run           Report the plan; decompress nothing

Default path: zipnative's resumable inflater fed chunk by chunk — constant
memory, exact bytesConsumed, trailing bytes reported as "leftover".
Errors: ZIP_DEFLATE_CORRUPT / ZIP_DEFLATE_TRUNCATED → E_PARSE,
ZIP_INFLATE_OUTPUT_OVERFLOW → E_DATA.
`;

const BATCH_USAGE = `\
zipnative batch — Batch orchestration

Usage:
  zipnative batch --input-dir <dir> --output-dir <dir> [--task create]
                  [create flags]
  zipnative batch --input-dir <dir> --task verify
  zipnative batch --manifest <tasks.json> [--continue-on-error]
                  [--allow-codec-load]

Directory mode:
  --input-dir <dir>   --task create: each immediate subdirectory becomes
                      <output-dir>/<name>.zip through the full \`create\`
                      command
                      (every create flag is honoured); --task verify: every
                      *.zip in the directory is verified
  --output-dir <dir>  Destination for --task create
  --overwrite         Replace existing <name>.zip files (default: refuse, E_IO)
  --concurrency <n>   Parallel workers (default 4, max 64)
  --fail-fast         Stop scheduling after the first failure
  --method/--level/--deterministic/--order/--date/--comment
                      Forwarded to every create task (see create --help);
                      any other create flag is forwarded too

Manifest mode:
  --manifest <file>   Ordered pipeline of whitelisted commands (create, list,
                      inspect, extract, cat, verify, stream, modify, crc32,
                      inflate) with "@<id>" output references; tasks run
                      sequentially, fail-fast by default —
                      see \`zipnative schema batch-manifest\`
  --continue-on-error Keep running independent tasks after a failure
  --allow-codec-load  Permit a "codec" flag inside tasks (executes user code)
  Under --json (or --format json) stdout is ONE batch document: each task's
  stdout is captured into tasks[i].report (parsed JSON / NDJSON) or .stdout
  (text) with .stdoutBytes; create/modify/cat/inflate tasks must therefore
  declare an "output" and stream --cat is refused (exit 2, at validation).

Output:
  --format, -f text|json  (default text; json under --json)
  --summary           { ok, command, mode, total, succeeded, failed, skipped }
  --fields a,b.c      Dot-path projection
  --dry-run           Validate and print the plan; execute nothing

Exit 1 carries the first failing task's E_* code.
`;

const DOCTOR_USAGE = `\
zipnative doctor — Environment / capability preflight

Usage:
  zipnative doctor [--format json|text]

Checks: CLI version, Node >= 22, zipnative package vs VERSION export, the
active deflate tier (node-zlib expected; pure under --pure-codecs), the pinned
tier used by --deterministic, platform streaming codecs, worker-thread
availability for \`create --parallel\`, registered codecs, the effective
security limits (with --max-* overrides) and the registered command count.
Exit 0 when every check passes, 1 otherwise. Always offline.
`;

const SCHEMA_USAGE = `\
zipnative schema — Print a JSON Schema (draft 2020-12) or the capability
manifest

Usage:
  zipnative schema [<subject>]
  zipnative schema list

Subjects:
  create-manifest (default), modify-manifest, batch-manifest   — inputs
  entries, entries-summary, inspect, inspect-summary, verify, verify-summary,
  stream, stream-summary, batch, batch-summary, doctor, govern-verify, crc32
                                                               — outputs
  status, error         — the --json envelopes
  errors                — E_* codes + the 39 ZIP_* → E_* mapping + diagnostics
  limits, diagnostics   — ZipLimits and the diagnostic shape
  manifest              — capability manifest (commands, flags, codes, schemas)
`;

const COMPLETION_USAGE = `\
zipnative completion — Emit a shell completion script

Usage:
  zipnative completion <bash|zsh|fish|powershell>

Install:
  zipnative completion bash > /etc/bash_completion.d/zipnative
  zipnative completion zsh  > "\${fpath[1]}/_zipnative"
  zipnative completion fish > ~/.config/fish/completions/zipnative.fish
  zipnative completion powershell >> $PROFILE
`;

const GOVERN_USAGE = `\
zipnative govern — AI-governance / Human-in-the-Loop (HITL) contract

Usage:
  zipnative govern rules                    Print the human/agent protocol
  zipnative govern policy [--pretty]        Print the machine-readable policy
  zipnative govern verify-issue <draft.md>  Validate an issue/PR draft
                                            (exit 1 / E_POLICY on violation)

Options (verify-issue):
  --input, -i         Draft path (alternative to the positional; "-" = stdin)
  --format, -f json|text  Report format (json under --json)

Agents are draftsmen, never autonomous submitters: no runtime dependencies, no
anti-goals (encryption, other formats, multi-disk, repair, I/O in the engine),
no weakened security default, a local reproduction for every bug, and a human
review before anything is submitted under a human identity.
`;

const COMMAND_USAGE: Readonly<Record<string, string>> = {
    create: CREATE_USAGE,
    modify: MODIFY_USAGE,
    list: LIST_USAGE,
    inspect: INSPECT_USAGE,
    cat: CAT_USAGE,
    extract: EXTRACT_USAGE,
    stream: STREAM_USAGE,
    verify: VERIFY_USAGE,
    crc32: CRC32_USAGE,
    inflate: INFLATE_USAGE,
    batch: BATCH_USAGE,
    doctor: DOCTOR_USAGE,
    schema: SCHEMA_USAGE,
    completion: COMPLETION_USAGE,
    govern: GOVERN_USAGE,
};

async function loadCommand(name: string): Promise<CommandFn> {
    switch (name) {
        case 'create': return (await import('./commands/create.js')).create;
        case 'modify': return (await import('./commands/modify.js')).modify;
        case 'list': return (await import('./commands/list.js')).list;
        case 'inspect': return (await import('./commands/inspect.js')).inspect;
        case 'cat': return (await import('./commands/cat.js')).cat;
        case 'extract': return (await import('./commands/extract.js')).extract;
        case 'stream': return (await import('./commands/stream.js')).stream;
        case 'verify': return (await import('./commands/verify.js')).verify;
        case 'crc32': return (await import('./commands/crc32.js')).crc32;
        case 'inflate': return (await import('./commands/inflate.js')).inflate;
        case 'batch': return (await import('./commands/batch.js')).batch;
        case 'doctor': return (await import('./commands/doctor.js')).doctor;
        case 'schema': return (await import('./commands/schema.js')).schema;
        case 'completion': return (await import('./commands/completion.js')).completion;
        case 'govern': return (await import('./commands/govern.js')).govern;
        default:
            return Promise.reject(
                new CliError(`Unknown command: ${name}. Run zipnative --help for usage.`, 2, ErrorCode.USAGE),
            );
    }
}

// The command being dispatched, captured for the agent JSON error envelope.
let activeCommand: string | null = null;

async function main(): Promise<void> {
    installEpipeGuard();
    installSignalCleanup();
    const argv = process.argv.slice(2);
    const args = parseArgs(argv);

    // Global output flags (recognised anywhere in argv).
    if (hasFlag(args.flags, 'no-color') || process.env['NO_COLOR'] !== undefined) {
        process.env['NO_COLOR'] = '1';
    }
    if (hasFlag(args.flags, 'quiet', 'q')) {
        process.env['ZIPNATIVE_QUIET'] = '1';
    }
    if (hasFlag(args.flags, 'json')) {
        process.env['ZIPNATIVE_JSON'] = '1';
    }
    if (hasFlag(args.flags, 'dry-run')) {
        process.env['ZIPNATIVE_DRY_RUN'] = '1';
    }
    if (hasFlag(args.flags, 'strict')) {
        process.env['ZIPNATIVE_STRICT'] = '1';
    }
    if (hasFlag(args.flags, 'pure-codecs')) {
        process.env['ZIPNATIVE_PURE_CODECS'] = '1';
    }

    if (hasFlag(args.flags, 'help', 'h') && args.positionals.length === 0) {
        process.stdout.write(USAGE);
        process.exit(0);
    }

    if (hasFlag(args.flags, 'version', 'V')) {
        const version = cliVersion();
        if (hasFlag(args.flags, 'json')) {
            process.stdout.write(JSON.stringify({ name: 'zipnative-cli', version, zipnative: engineVersion() }) + '\n');
        } else {
            process.stdout.write(version + '\n');
        }
        process.exit(0);
    }

    const commandName = args.positionals[0];

    if (commandName === undefined) {
        if (argv.length === 0) {
            process.stdout.write(USAGE);
            process.exit(0);
        }
        // Flags but no command (`zipnative --frob`, `zipnative --json`): a usage
        // error, never the help text with exit 0.
        throw new CliError(
            `No command given (got: ${argv.join(' ')}). Run zipnative --help for usage.`,
            2,
        );
    }

    activeCommand = commandName;

    if (hasFlag(args.flags, 'help', 'h')) {
        const usage = COMMAND_USAGE[commandName];
        if (usage === undefined) {
            throw new CliError(`Unknown command: ${commandName}. Run zipnative --help for usage.`, 2);
        }
        process.stdout.write(usage);
        process.exit(0);
    }

    // Strip ONLY the first occurrence of the command name from argv.
    let stripped = false;
    const rest = argv.filter((tok) => {
        if (!stripped && tok === commandName) {
            stripped = true;
            return false;
        }
        return true;
    });

    const commandArgs = parseArgs(rest);

    // Apply `.zipnativerc.json` defaults (unless --no-config). CLI flags win.
    let effectiveArgs = commandArgs;
    if (!hasFlag(commandArgs.flags, 'no-config')) {
        const configPath = getStringFlag(commandArgs.flags, 'config');
        const defaults = loadConfig(commandName, configPath);
        effectiveArgs = applyConfigDefaults(commandArgs, defaults);
    }

    const command = await loadCommand(commandName);
    await command(effectiveArgs);
}

main().catch((e: unknown) => {
    // Agent mode: a single JSON error envelope on stderr, with a stable code.
    if (isJsonMode()) {
        emitJsonError(activeCommand, e);
        if (process.env['ZIPNATIVE_DEBUG'] === '1' && e instanceof Error) {
            process.stderr.write((e.stack ?? e.message) + '\n');
        }
        process.exit(e instanceof CliError ? e.exitCode : 1);
    }
    if (e instanceof CliError) {
        if (e.message.length > 0) {
            process.stderr.write(e.message + '\n');
        }
        // The machine-actionable counterpart of the message (same text as the
        // --json envelope's error.remedy); part of the error, never suppressed.
        const remedy = remedyFor(e);
        if (remedy !== undefined) process.stderr.write(`remedy: ${remedy}\n`);
        process.exit(e.exitCode);
    }
    const message = e instanceof Error ? e.message : String(e);
    if (process.env['ZIPNATIVE_DEBUG'] === '1' && e instanceof Error) {
        process.stderr.write((e.stack ?? e.message) + '\n');
    }
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
});
