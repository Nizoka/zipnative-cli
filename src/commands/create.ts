// `zipnative create` — build an archive from files, directories, stdin or a
// JSON manifest through zipnative's deterministic writer.
//
// Three writers, one plan:
//   • buffered  (default)   createZip → add() → toBytes()
//   • streaming (--stream)  createZip → addStream() → stream()  — bounded memory,
//                           data-descriptor layout, byte-identical for buffered content
//   • parallel  (--parallel) createParallelZip (zipnative/worker) — per-entry
//                           deflate fanned out across a worker pool, byte-identical
//                           to createZip per resolved tier
//
// Determinism defaults are the core's: canonical entry order, DOS-epoch
// timestamps, UTF-8 names. `--deterministic` additionally pins the pure-TS
// encoder so the SHA-256 is identical on every runtime.

import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from '../utils/args.js';
import { emitStatus, isDryRun } from '../utils/agent.js';
import {
    activeDeflateTier,
    createZip,
    loadParallelZip,
    sanitizeEntryPath,
    type AddEntryOptions,
    type ByteSource,
    type CreateZipOptions,
    type ParallelZipWriter,
    type ZipCompressionOptions,
    type ZipWriter,
} from '../core-bridge/index.js';
import { createDiagnosticSink } from '../utils/diagnostics.js';
import { isPureCodecs, prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import {
    readJsonInput,
    readStdin,
    readableToByteSource,
    validatePath,
    writeOutput,
    writeStreamingOutput,
} from '../utils/io.js';
import { parseByteSize } from '../utils/sizes.js';
import { walkPaths, type SkippedPath } from '../utils/walk.js';
import { mapZipError } from '../utils/ziperr.js';
import {
    commonOptions,
    parseChunkSize,
    parseCompression,
    parseDateFlag,
    parseIntFlag,
    parseNameFilter,
} from '../utils/zipops.js';

// ── Plan ─────────────────────────────────────────────────────────────

type Source =
    | { readonly kind: 'file'; readonly path: string; readonly size: number }
    | { readonly kind: 'bytes'; readonly data: Uint8Array }
    | { readonly kind: 'stdin' };

interface PlannedEntry {
    readonly name: string;
    readonly isDirectory: boolean;
    readonly source: Source;
    readonly options: AddEntryOptions;
}

interface Plan {
    readonly entries: PlannedEntry[];
    readonly skipped: SkippedPath[];
    readonly archive: {
        readonly order?: 'canonical' | 'insertion';
        readonly defaultDate?: Date | 'now';
        readonly compression?: ZipCompressionOptions;
        readonly comment?: string;
    };
}

const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const DOS_ATTR_DIRECTORY = 0x10;

function externalAttributesFor(mode: number, isDirectory: boolean): number {
    // setuid / setgid / sticky are never propagated into an archive.
    const perm = mode & 0o777;
    if (isDirectory) return (((S_IFDIR | perm) << 16) >>> 0) | DOS_ATTR_DIRECTORY;
    return ((S_IFREG | perm) << 16) >>> 0;
}

function parseOrder(args: ParsedArgs): 'canonical' | 'insertion' | undefined {
    const raw = getStringFlag(args.flags, 'order');
    if (raw === undefined) return undefined;
    if (raw === 'canonical' || raw === 'insertion') return raw;
    throw new CliError(`--order must be "canonical" or "insertion", got "${raw}".`, 2);
}

function parseEntryComments(args: ParsedArgs): Map<string, string> {
    const out = new Map<string, string>();
    for (const raw of getStringFlagAll(args.flags, 'entry-comment')) {
        const idx = raw.indexOf('=');
        if (idx <= 0) throw new CliError(`--entry-comment expects <name>=<text>, got "${raw}".`, 2);
        out.set(raw.slice(0, idx), raw.slice(idx + 1));
    }
    return out;
}

function parseStoreExt(args: ParsedArgs): Set<string> {
    const raw = getStringFlag(args.flags, 'store-ext');
    const out = new Set<string>();
    if (raw === undefined) return out;
    for (const ext of raw.split(',')) {
        const e = ext.trim().toLowerCase().replace(/^\./, '');
        if (e.length > 0) out.add(e);
    }
    return out;
}

function parseMode(raw: unknown, where: string): number {
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 0o7777) return raw;
    if (typeof raw === 'string' && /^0?[0-7]{3,4}$/.test(raw)) return Number.parseInt(raw, 8);
    throw new CliError(`${where}: "mode" must be an octal string like "0644" or "0755".`, 1, ErrorCode.INPUT);
}

function parseManifestDate(raw: unknown, where: string): Date | 'now' | undefined {
    if (raw === undefined) return undefined;
    if (raw === 'epoch') return undefined;
    if (raw === 'now') return 'now';
    if (typeof raw === 'string') {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) return d;
    }
    throw new CliError(`${where}: "date" must be "epoch", "now" or an ISO 8601 string.`, 1, ErrorCode.INPUT);
}

function parseManifestCompression(raw: unknown, where: string): ZipCompressionOptions | undefined {
    if (raw === undefined) return undefined;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new CliError(`${where}: "compression" must be an object { method?, level?, deterministic? }.`, 1, ErrorCode.INPUT);
    }
    const c = raw as Record<string, unknown>;
    const out: { method?: 'store' | 'deflate'; level?: number; deterministic?: boolean } = {};
    if (c['method'] !== undefined) {
        if (c['method'] !== 'store' && c['method'] !== 'deflate') {
            throw new CliError(`${where}: "method" must be "store" or "deflate".`, 1, ErrorCode.INPUT);
        }
        out.method = c['method'];
    }
    if (c['level'] !== undefined) {
        if (!Number.isInteger(c['level']) || (c['level'] as number) < 0 || (c['level'] as number) > 9) {
            throw new CliError(`${where}: "level" must be an integer from 0 to 9.`, 1, ErrorCode.INPUT);
        }
        out.level = c['level'] as number;
    }
    if (c['deterministic'] !== undefined) {
        if (typeof c['deterministic'] !== 'boolean') {
            throw new CliError(`${where}: "deterministic" must be a boolean.`, 1, ErrorCode.INPUT);
        }
        out.deterministic = c['deterministic'];
    }
    return out;
}

const MANIFEST_KEYS = new Set(['version', 'comment', 'order', 'date', 'compression', 'entries']);
const ENTRY_KEYS = new Set(['name', 'path', 'data', 'dataBase64', 'directory', 'method', 'level', 'deterministic', 'date', 'comment', 'mode']);

/** Parse a `create-manifest` document into a plan (paths resolve against the manifest's directory). */
async function planFromManifest(manifestPath: string, storeExt: Set<string>): Promise<Plan> {
    const parsed = await readJsonInput(manifestPath, 'manifest');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CliError('--from-manifest must be a JSON object: { "entries": [...] }.', 1, ErrorCode.INPUT);
    }
    const m = parsed as Record<string, unknown>;
    for (const key of Object.keys(m)) {
        if (!MANIFEST_KEYS.has(key)) {
            throw new CliError(`Unknown key "${key}" in manifest. Valid: ${[...MANIFEST_KEYS].join(', ')}.`, 1, ErrorCode.INPUT);
        }
    }
    if (m['version'] !== undefined && m['version'] !== 1) {
        throw new CliError(`Unsupported manifest version ${String(m['version'])} (expected 1).`, 1, ErrorCode.INPUT);
    }
    if (!Array.isArray(m['entries'])) {
        throw new CliError('Manifest "entries" must be an array.', 1, ErrorCode.INPUT);
    }
    const baseDir = manifestPath === '-' ? process.cwd() : dirname(resolve(manifestPath));
    const order = m['order'];
    if (order !== undefined && order !== 'canonical' && order !== 'insertion') {
        throw new CliError('Manifest "order" must be "canonical" or "insertion".', 1, ErrorCode.INPUT);
    }
    if (m['comment'] !== undefined && typeof m['comment'] !== 'string') {
        throw new CliError('Manifest "comment" must be a string.', 1, ErrorCode.INPUT);
    }

    const entries: PlannedEntry[] = [];
    const seen = new Set<string>();
    let index = 0;
    for (const item of m['entries'] as unknown[]) {
        const where = `entries[${index}]`;
        index++;
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
            throw new CliError(`${where}: must be an object.`, 1, ErrorCode.INPUT);
        }
        const e = item as Record<string, unknown>;
        for (const key of Object.keys(e)) {
            if (!ENTRY_KEYS.has(key)) {
                throw new CliError(`${where}: unknown key "${key}". Valid: ${[...ENTRY_KEYS].join(', ')}.`, 1, ErrorCode.INPUT);
            }
        }
        if (typeof e['name'] !== 'string' || e['name'].length === 0) {
            throw new CliError(`${where}: "name" is required.`, 1, ErrorCode.INPUT);
        }
        const isDirectory = e['directory'] === true;
        const name = isDirectory && !e['name'].endsWith('/') ? `${e['name']}/` : e['name'];
        const bare = name.endsWith('/') ? name.slice(0, -1) : name;
        if (sanitizeEntryPath(bare) === null) {
            throw new CliError(`${where}: name "${name}" would not be extractable safely.`, 1, ErrorCode.INPUT, { entryName: name });
        }
        if (seen.has(name)) {
            throw new CliError(`${where}: duplicate entry name "${name}".`, 1, ErrorCode.INPUT, { entryName: name });
        }
        seen.add(name);

        const sources = ['path', 'data', 'dataBase64'].filter((k) => e[k] !== undefined);
        if (isDirectory && sources.length > 0) {
            throw new CliError(`${where}: a directory entry cannot carry "${sources[0]}".`, 1, ErrorCode.INPUT);
        }
        if (!isDirectory && sources.length !== 1) {
            throw new CliError(`${where}: exactly one of "path", "data" or "dataBase64" is required.`, 1, ErrorCode.INPUT);
        }

        let source: Source;
        if (isDirectory) {
            source = { kind: 'bytes', data: new Uint8Array(0) };
        } else if (typeof e['path'] === 'string') {
            validatePath(e['path']);
            const abs = resolve(baseDir, e['path']);
            let size = 0;
            try {
                const { stat } = await import('node:fs/promises');
                const st = await stat(abs);
                if (!st.isFile()) throw new CliError(`${where}: "${e['path']}" is not a regular file.`, 1, ErrorCode.INPUT);
                size = st.size;
            } catch (err) {
                if (err instanceof CliError) throw err;
                throw new CliError(`${where}: cannot read "${e['path']}": ${err instanceof Error ? err.message : String(err)}`, 1, ErrorCode.IO);
            }
            source = { kind: 'file', path: abs, size };
        } else if (typeof e['data'] === 'string') {
            source = { kind: 'bytes', data: new TextEncoder().encode(e['data']) };
        } else if (typeof e['dataBase64'] === 'string') {
            source = { kind: 'bytes', data: new Uint8Array(Buffer.from(e['dataBase64'], 'base64')) };
        } else {
            throw new CliError(`${where}: "path", "data" and "dataBase64" must be strings.`, 1, ErrorCode.INPUT);
        }

        const options: { -readonly [K in keyof AddEntryOptions]: AddEntryOptions[K] } = {};
        const compression: { method?: 'store' | 'deflate'; level?: number; deterministic?: boolean } = {};
        if (e['method'] !== undefined) {
            if (e['method'] !== 'store' && e['method'] !== 'deflate') {
                throw new CliError(`${where}: "method" must be "store" or "deflate".`, 1, ErrorCode.INPUT);
            }
            compression.method = e['method'];
        } else if (storeExt.has(extname(bare).slice(1).toLowerCase())) {
            compression.method = 'store';
        }
        if (e['level'] !== undefined) {
            if (!Number.isInteger(e['level']) || (e['level'] as number) < 0 || (e['level'] as number) > 9) {
                throw new CliError(`${where}: "level" must be an integer from 0 to 9.`, 1, ErrorCode.INPUT);
            }
            compression.level = e['level'] as number;
        }
        if (e['deterministic'] !== undefined) {
            if (typeof e['deterministic'] !== 'boolean') throw new CliError(`${where}: "deterministic" must be a boolean.`, 1, ErrorCode.INPUT);
            compression.deterministic = e['deterministic'];
        }
        if (Object.keys(compression).length > 0) options.compression = compression;
        const date = parseManifestDate(e['date'], where);
        if (date instanceof Date) options.date = date;
        if (date === 'now') options.date = new Date();
        if (e['comment'] !== undefined) {
            if (typeof e['comment'] !== 'string') throw new CliError(`${where}: "comment" must be a string.`, 1, ErrorCode.INPUT);
            options.comment = e['comment'];
        }
        if (e['mode'] !== undefined) {
            options.externalAttributes = externalAttributesFor(parseMode(e['mode'], where), isDirectory);
        }
        entries.push({ name, isDirectory, source, options });
    }

    const archive: Plan['archive'] = {
        ...(order !== undefined ? { order: order as 'canonical' | 'insertion' } : {}),
        ...(parseManifestDate(m['date'], 'manifest') !== undefined ? { defaultDate: parseManifestDate(m['date'], 'manifest') } : {}),
        ...(m['compression'] !== undefined ? { compression: parseManifestCompression(m['compression'], 'manifest') } : {}),
        ...(typeof m['comment'] === 'string' ? { comment: m['comment'] } : {}),
    };
    return { entries, skipped: [], archive };
}

/** Plan from positionals / `--input` / `--stdin-name` (filesystem walk). */
async function planFromPaths(args: ParsedArgs, inputs: readonly string[], stdinName: string | undefined, storeExt: Set<string>): Promise<Plan> {
    const base = getStringFlag(args.flags, 'base');
    const prefix = getStringFlag(args.flags, 'prefix');
    const walk = await walkPaths(inputs, {
        ...(base !== undefined ? { base } : {}),
        ...(prefix !== undefined ? { prefix } : {}),
        followSymlinks: hasFlag(args.flags, 'follow-symlinks'),
        dirEntries: hasFlag(args.flags, 'dir-entries'),
        ...(parseNameFilter(args) !== undefined ? { filter: parseNameFilter(args) } : {}),
    });
    const preserveMode = hasFlag(args.flags, 'preserve-mode');
    const useMtime = hasFlag(args.flags, 'mtime');
    const comments = parseEntryComments(args);
    const entries: PlannedEntry[] = [];
    for (const f of walk.files) {
        const options: { -readonly [K in keyof AddEntryOptions]: AddEntryOptions[K] } = {};
        if (preserveMode && f.mode !== null) options.externalAttributes = externalAttributesFor(f.mode, f.isDirectory);
        if (useMtime) options.date = f.mtime;
        const c = comments.get(f.name);
        if (c !== undefined) options.comment = c;
        if (!f.isDirectory && storeExt.has(extname(f.name).slice(1).toLowerCase())) options.compression = { method: 'store' };
        entries.push({
            name: f.name,
            isDirectory: f.isDirectory,
            source: f.isDirectory ? { kind: 'bytes', data: new Uint8Array(0) } : { kind: 'file', path: f.path, size: f.size },
            options,
        });
    }
    if (stdinName !== undefined) {
        const bare = stdinName.replace(/\\/g, '/');
        if (bare.endsWith('/') || sanitizeEntryPath(bare) === null) {
            throw new CliError(`--stdin-name "${stdinName}" is not a safe entry name.`, 2);
        }
        if (entries.some((e) => e.name === bare)) {
            throw new CliError(`--stdin-name "${stdinName}" collides with an input file name.`, 2);
        }
        const options: { -readonly [K in keyof AddEntryOptions]: AddEntryOptions[K] } = {};
        const c = comments.get(bare);
        if (c !== undefined) options.comment = c;
        entries.push({ name: bare, isDirectory: false, source: { kind: 'stdin' }, options });
    }
    for (const [name] of comments) {
        if (!entries.some((e) => e.name === name)) {
            throw new CliError(`--entry-comment names "${name}", which is not an entry of this archive.`, 2);
        }
    }
    if (preserveMode && process.platform === 'win32' && entries.length > 0) {
        const { progress } = await import('../utils/agent.js');
        progress('warning: --preserve-mode has no effect on Windows (no POSIX mode bits to preserve).');
    }
    return { entries, skipped: [...walk.skipped], archive: {} };
}

// ── Command ──────────────────────────────────────────────────────────

export async function create(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);

    const outputPath = getStringFlag(args.flags, 'output', 'o');
    const manifestPath = getStringFlag(args.flags, 'from-manifest');
    const stdinName = getStringFlag(args.flags, 'stdin-name');
    const inputs = [...args.positionals, ...getStringFlagAll(args.flags, 'input', 'i')];
    const streaming = hasFlag(args.flags, 'stream');
    const parallel = hasFlag(args.flags, 'parallel');
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();

    // Validate scalar flags up-front so usage errors (exit 2) precede any I/O.
    const compression = parseCompression(args);
    const order = parseOrder(args);
    const defaultDate = parseDateFlag(args);
    const chunkSize = parseChunkSize(args);
    const workers = parseIntFlagAllowZero(args, 'workers');
    const minJobSizeRaw = getStringFlag(args.flags, 'min-job-size');
    const minWorkerJobSize = minJobSizeRaw !== undefined ? parseByteSize(minJobSizeRaw, 'min-job-size') : undefined;
    const jobTimeout = parseIntFlag(args, 'job-timeout');
    const comment = getStringFlag(args.flags, 'comment');
    const storeExt = parseStoreExt(args);

    if (manifestPath !== undefined && (inputs.length > 0 || stdinName !== undefined)) {
        throw new CliError('--from-manifest is mutually exclusive with input paths and --stdin-name.', 2);
    }
    if (manifestPath === undefined && inputs.length === 0 && stdinName === undefined) {
        throw new CliError('create requires at least one input path, --stdin-name <name>, or --from-manifest <file>.', 2);
    }
    if (stdinName !== undefined && inputs.includes('-')) {
        throw new CliError('stdin can only be consumed once.', 2);
    }
    if (parallel && isPureCodecs(args) && compression?.deterministic !== true) {
        throw new CliError(
            '--parallel resolves node:zlib inside its worker bundle, so --pure-codecs cannot govern it; '
            + 'add --deterministic for unconditional byte identity.',
            2,
        );
    }
    if (!parallel && (workers !== undefined || minWorkerJobSize !== undefined || jobTimeout !== undefined)) {
        throw new CliError('--workers, --min-job-size and --job-timeout require --parallel.', 2);
    }
    if (!streaming && chunkSize !== undefined) {
        throw new CliError('--chunk-size requires --stream.', 2);
    }
    if (outputPath !== undefined) validatePath(outputPath);

    const plan = manifestPath !== undefined
        ? await planFromManifest(manifestPath, storeExt)
        : await planFromPaths(args, inputs, stdinName, storeExt);

    const hasStdin = plan.entries.some((e) => e.source.kind === 'stdin');
    if (hasStdin && !streaming) {
        // Buffered stdin: read it now so toBytes() can size the entry.
        const data = await readStdin();
        const idx = plan.entries.findIndex((e) => e.source.kind === 'stdin');
        const prev = plan.entries[idx] as PlannedEntry;
        plan.entries[idx] = { ...prev, source: { kind: 'bytes', data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) } };
    }

    const sink = createDiagnosticSink();
    const effectiveCompression = compression ?? plan.archive.compression;
    const effectiveOrder = order ?? plan.archive.order;
    const effectiveDate = defaultDate ?? plan.archive.defaultDate;
    const effectiveComment = comment ?? plan.archive.comment;
    const createOptions: CreateZipOptions = {
        ...commonOptions(args, sink),
        ...(effectiveOrder !== undefined ? { order: effectiveOrder } : {}),
        ...(effectiveDate !== undefined ? { defaultDate: effectiveDate } : {}),
        ...(effectiveCompression !== undefined ? { compression: effectiveCompression } : {}),
        ...(effectiveComment !== undefined ? { comment: effectiveComment } : {}),
    };

    const files = plan.entries.filter((e) => !e.isDirectory).length;
    const directories = plan.entries.length - files;
    const bytesIn = plan.entries.reduce((n, e) => n + (e.source.kind === 'file' ? e.source.size : e.source.kind === 'bytes' ? e.source.data.length : 0), 0);
    const method = effectiveCompression?.method ?? 'deflate';
    const level = effectiveCompression?.level ?? 6;
    const deterministic = effectiveCompression?.deterministic === true;
    const skipped = plan.skipped.map((s) => ({ name: s.name, path: s.path, reason: s.reason }));
    const summary = {
        command: 'create',
        output: outputPath ?? '-',
        entries: plan.entries.length,
        files,
        directories,
        bytesIn,
        method,
        level,
        deterministic,
        order: effectiveOrder ?? 'canonical',
        stream: streaming,
        parallel: parallel ? { workers: workers ?? 'auto' } : false,
        skipped,
    };

    if (dryRun) {
        if (!hasFlag(args.flags, 'json')) {
            const lines = plan.entries.map((e) => {
                const size = e.source.kind === 'file' ? e.source.size : e.source.kind === 'bytes' ? e.source.data.length : '?';
                const m = e.isDirectory ? 'dir' : (e.options.compression?.method ?? method);
                return `plan  ${e.name}  ${size}  ${m}`;
            });
            for (const s of skipped) lines.push(`skip  ${s.name}  (${s.reason})`);
            process.stdout.write(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
        }
        emitStatus({ ...summary, dryRun: true, ...sink.field() });
        return;
    }

    for (const s of plan.skipped) {
        const { progress } = await import('../utils/agent.js');
        progress(`warning: skipped ${s.path} (${s.reason})`);
    }

    // ── Writer
    let writer: ZipWriter | ParallelZipWriter;
    let parallelInfo: { workers: number | 'auto' } | false = false;
    try {
        if (parallel) {
            const mod = await loadParallelZip();
            writer = mod.createParallelZip({
                ...createOptions,
                ...(workers !== undefined ? { workers } : {}),
                ...(minWorkerJobSize !== undefined ? { minWorkerJobSize } : {}),
                ...(jobTimeout !== undefined ? { jobTimeout } : {}),
                workerUrl: mod.workerUrl,
            });
            parallelInfo = { workers: workers ?? 'auto' };
        } else {
            writer = createZip(createOptions);
        }
    } catch (e) {
        throw mapZipError(e, 'Failed to initialise the archive writer');
    }

    try {
        for (const e of plan.entries) {
            if (e.isDirectory) {
                writer.addDirectory(e.name, e.options);
                continue;
            }
            switch (e.source.kind) {
                case 'bytes':
                    writer.add(e.name, e.source.data, e.options);
                    break;
                case 'file':
                    if (streaming) {
                        writer.addStream(e.name, readableToByteSource(createReadStream(e.source.path)) as ByteSource, e.options);
                    } else {
                        const buf = await readFile(e.source.path);
                        writer.add(e.name, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), e.options);
                    }
                    break;
                case 'stdin':
                    writer.addStream(e.name, readableToByteSource(process.stdin) as ByteSource, e.options);
                    break;
            }
        }
    } catch (e) {
        throw mapZipError(e, 'Failed to add entries');
    }

    // ── Output
    let bytes = 0;
    try {
        if (streaming || hasStdin) {
            bytes = await writeStreamingOutput(
                writer.stream(chunkSize !== undefined ? { chunkSize } : undefined),
                outputPath,
            );
        } else {
            const out = await writer.toBytes();
            await writeOutput(out, outputPath);
            bytes = out.length;
        }
    } catch (e) {
        throw mapZipError(e, 'Failed to write archive');
    }

    emitStatus({
        ...summary,
        dryRun: false,
        parallel: parallelInfo,
        bytes,
        tier: activeDeflateTier(deterministic),
        ...sink.field(),
    });
}

/** `--workers` accepts 0 (main thread only), unlike the other positive-int flags. */
function parseIntFlagAllowZero(args: ParsedArgs, flag: string): number | undefined {
    const raw = getStringFlag(args.flags, flag);
    if (raw === undefined) return undefined;
    if (!/^\d+$/.test(raw.trim())) throw new CliError(`--${flag} expects a non-negative integer, got "${raw}".`, 2);
    return Number(raw);
}
