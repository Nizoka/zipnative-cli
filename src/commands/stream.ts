// `zipnative stream` — forward-only reader over UNSEEKABLE input (stdin, a
// pipe, an upload body) through zipnative's `iterateZipEntries`.
//
// TRUST CAVEAT (from the core): the forward reader parses local headers
// ALONE. There is no central directory to cross-check names, sizes, methods
// or attributes, and names are NOT sanitised by the engine. Consequences:
//   • every name written to disk goes through `sanitizeEntryPath()` + the
//     sink containment check here;
//   • mode / symlink policy is impossible (`StreamedZipHeader` has no
//     external attributes) — `--preserve-mode`, `--allow-symlinks` and
//     `--skip-symlinks` are refused with E_USAGE;
//   • a `warning:` line is printed at start (suppressed by --quiet) and every
//     JSON output carries `trust: "local-headers-only"`.
// Prefer `list` / `extract` whenever the whole file is available.

import { utimes } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from '../utils/args.js';
import { emitStatus, isDryRun, isJsonMode, progress } from '../utils/agent.js';
import {
    iterateZipEntries,
    sanitizeEntryPath,
    type ByteSource,
    type StreamedZipEntry,
} from '../core-bridge/index.js';
import { createDiagnosticSink } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { rowFromHeader, renderTable, type EntryRow } from '../utils/entryfmt.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { openInputStream, overwriteRefused, pathExists, readableToByteSource, safeJoin, writeStreamingOutput } from '../utils/io.js';
import { emitJsonReport, serializeJson } from '../utils/projection.js';
import { duplicatePolicy, ensureSinkDir, ensureSinkParent, resolveSinkTarget, writeSinkFile } from '../utils/sink.js';
import { mapZipError } from '../utils/ziperr.js';
import { commonOptions, parseFormat, parseNameFilter, parseOnDuplicate } from '../utils/zipops.js';

const TRUST = 'local-headers-only';
const CAVEAT = 'warning: forward streaming trusts local headers only (no central-directory cross-check); prefer `list`/`extract` on a complete file.';

export interface StreamReport {
    readonly mode: 'list';
    readonly trust: typeof TRUST;
    readonly entries: readonly EntryRow[];
    readonly diagnostics: readonly unknown[];
}

export function streamSummary(report: StreamReport): Record<string, unknown> {
    // A data-descriptor entry's local header carries zero sizes (they trail
    // the payload), so `bytes` under-counts by exactly those entries.
    const descriptorEntries = report.entries.filter((e) => e.usesDataDescriptor).length;
    return {
        entries: report.entries.length,
        bytes: report.entries.reduce((n, e) => n + e.uncompressedSize, 0),
        descriptorEntries,
        bytesKnown: descriptorEntries === 0,
        trust: report.trust,
    };
}

export async function stream(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);

    for (const forbidden of ['preserve-mode', 'allow-symlinks', 'skip-symlinks']) {
        if (hasFlag(args.flags, forbidden)) {
            throw new CliError(`--${forbidden} is not available in forward mode: attributes live only in the central directory.`, 2);
        }
    }
    const outputDir = getStringFlag(args.flags, 'output-dir', 'd');
    const catNames = getStringFlagAll(args.flags, 'cat');
    if (outputDir !== undefined && catNames.length > 0) {
        throw new CliError('--output-dir and --cat are mutually exclusive.', 2);
    }
    const mode: 'list' | 'extract' | 'cat' = outputDir !== undefined ? 'extract' : catNames.length > 0 ? 'cat' : 'list';
    const format = parseFormat(args, ['text', 'json', 'ndjson'] as const, isJsonMode() ? 'ndjson' : 'text');
    const long = hasFlag(args.flags, 'long');
    const overwrite = hasFlag(args.flags, 'overwrite');
    const skipUnsafe = hasFlag(args.flags, 'skip-unsafe');
    const skipUnsupported = hasFlag(args.flags, 'skip-unsupported');
    const flat = hasFlag(args.flags, 'flat');
    const preserveMtime = hasFlag(args.flags, 'preserve-mtime');
    const onDuplicate = parseOnDuplicate(args);
    const filter = parseNameFilter(args);
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();
    const inputPath = getStringFlag(args.flags, 'input', 'i') ?? args.positionals[0];

    progress(CAVEAT);

    const sink = createDiagnosticSink(format === 'ndjson' && isJsonMode());
    const source = readableToByteSource(openInputStream(inputPath)) as ByteSource;
    const iterator = iterateZipEntries(source, commonOptions(args, sink));

    const rows: EntryRow[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const written = new Map<string, string>();
    const root = outputDir !== undefined ? resolve(outputDir) : null;
    const remainingCat = new Set(catNames);
    let bytes = 0;
    let stoppedAt: 'central-directory' | 'eof' = 'eof';
    let current = '';

    const emitRow = (row: EntryRow): void => {
        rows.push(row);
        if (mode === 'list' && format === 'ndjson' && !dryRun) process.stdout.write(serializeJson(row, false) + '\n');
    };

    try {
        for await (const item of iterator) {
            const header = item.header;
            current = header.name;
            const row = rowFromHeader(header, { long });

            if (filter !== undefined && !filter(header.name)) {
                await item.skip();
                skipped.push({ name: header.name, reason: 'filtered' });
                continue;
            }

            if (mode === 'list') {
                emitRow(row);
                await item.skip();
                continue;
            }

            if (mode === 'cat') {
                if (!remainingCat.has(header.name) || header.isDirectory) {
                    await item.skip();
                    continue;
                }
                remainingCat.delete(header.name);
                emitRow(row);
                if (dryRun) { await item.skip(); continue; }
                bytes += await pumpEntry(item, undefined, false, skipUnsupported, skipped, header.name);
                continue;
            }

            // mode === 'extract'
            if (header.isDirectory) {
                await item.skip();
                const safeDir = sanitizeEntryPath(header.name);
                if (safeDir === null) {
                    if (skipUnsafe) { skipped.push({ name: header.name, reason: 'unsafe-path' }); continue; }
                    throw new CliError(`Directory entry "${header.name}" is not a safe path.`, 1, ErrorCode.SECURITY, { entryName: header.name, zipCode: 'ZIP_PATH_TRAVERSAL' });
                }
                if (!flat && !dryRun) await ensureSinkDir(root as string, safeJoin(root as string, safeDir), header.name);
                emitRow(row);
                continue;
            }
            const safe = sanitizeEntryPath(header.name);
            if (safe === null) {
                await item.skip();
                if (skipUnsafe) { skipped.push({ name: header.name, reason: 'unsafe-path' }); continue; }
                throw new CliError(
                    `Entry name "${header.name}" is not a safe path (traversal, absolute, drive/UNC, NUL, ADS or reserved device name).`,
                    1,
                    ErrorCode.SECURITY,
                    { entryName: header.name, zipCode: 'ZIP_PATH_TRAVERSAL' },
                );
            }
            const { target, key } = resolveSinkTarget(root as string, safe, flat);
            let verdict: 'new' | 'skip' | 'replace';
            try {
                verdict = duplicatePolicy(written.get(key), header.name, target, onDuplicate, flat ? '--flat' : 'duplicate or case-insensitive filesystem');
            } catch (e) {
                await item.skip();
                throw e;
            }
            if (verdict === 'skip') {
                await item.skip();
                skipped.push({ name: header.name, reason: 'duplicate' });
                continue;
            }
            // 'replace' → overwrite what THIS run wrote earlier; a pre-existing
            // file is still refused unless --overwrite (exclusive open below).
            if (verdict === 'new' && !overwrite && !dryRun && await pathExists(target)) {
                await item.skip();
                throw overwriteRefused(target, header.name);
            }
            written.set(key, header.name);
            emitRow(row);
            if (dryRun) { await item.skip(); continue; }
            await ensureSinkParent(root as string, target, header.name);
            bytes += await pumpEntry(item, target, overwrite || verdict === 'replace', skipUnsupported, skipped, header.name);
            if (preserveMtime) await utimes(target, header.lastModified, header.lastModified);
        }
        stoppedAt = 'central-directory';
    } catch (e) {
        if (e instanceof CliError) throw e;
        // Before the first local header there is no entry to name.
        const mapped = current.length > 0
            ? mapZipError(e, `Forward read failed at "${current}"`, current)
            : mapZipError(e, 'Forward read failed before the first local header');
        // `iterateZipEntries` ends at the central directory; hitting EOF
        // without one is reported by the core as ZIP_STREAM_TRUNCATED.
        throw mapped;
    }

    if (mode === 'cat' && remainingCat.size > 0) {
        const missing = [...remainingCat];
        throw new CliError(`Entry not found in stream: ${missing.join(', ')} (forward mode sees local headers only; try \`zipnative stream --list\`).`, 1, ErrorCode.NOT_FOUND, { entryName: missing[0] as string, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
    }

    for (const s of skipped) progress(`warning: skipped ${s.name} (${s.reason})`);

    if (mode === 'list') {
        if (format === 'text') {
            process.stdout.write(renderTable(rows, long));
        } else if (format === 'json') {
            const report: StreamReport = { mode: 'list', trust: TRUST, entries: rows, diagnostics: sink.diagnostics };
            emitJsonReport(args, report, () => streamSummary(report));
        } else if (isJsonMode()) {
            for (const d of sink.diagnostics) {
                process.stderr.write(`${d.severity}: [${d.code}]${d.entryName !== undefined ? ` entry '${d.entryName}':` : ''} ${d.message}\n`);
            }
        }
        if (dryRun) emitStatus({ command: 'stream', mode, trust: TRUST, dryRun: true, entries: rows.length, stoppedAt, ...sink.field() });
        return;
    }

    emitStatus({
        command: 'stream',
        mode,
        trust: TRUST,
        dryRun,
        ...(root !== null ? { outputDir: root } : {}),
        entries: rows.length,
        bytes,
        skipped,
        stoppedAt,
        ...sink.field(),
    });
}

/** Decompress one streamed entry into a file (or stdout when `target` is undefined). */
async function pumpEntry(
    item: StreamedZipEntry,
    target: string | undefined,
    overwrite: boolean,
    skipUnsupported: boolean,
    skipped: { name: string; reason: string }[],
    name: string,
): Promise<number> {
    try {
        if (target === undefined) return await writeStreamingOutput(item.data(), undefined);
        return await writeSinkFile(target, item.data(), { overwrite });
    } catch (e) {
        const mapped = mapZipError(e, `Failed to read entry "${name}"`, name);
        if (skipUnsupported && mapped.code === ErrorCode.UNSUPPORTED) {
            skipped.push({ name, reason: 'unsupported' });
            // The payload could not be decoded — discard its raw bytes so the
            // forward iterator can advance (it refuses to seek past an
            // unconsumed entry with ZIP_API_MISUSE).
            await item.skip();
            return 0;
        }
        throw mapped;
    }
}
