// `zipnative inspect` — forensic archive report + CI assertions.
//
// Opens the archive EAGERLY (every local header cross-checked, overlap table
// built up front), then reports archive facts, per-method statistics, a
// determinism verdict and every diagnostic the parse emitted. `--check`
// turns the report into a gate: any failed assertion exits 1 with
// `E_CHECK_FAILED` after the report has been printed.

import { type ParsedArgs, getStringFlagAll, hasFlag } from '../utils/args.js';
import { isJsonMode } from '../utils/agent.js';
import {
    FLAG_UTF8,
    METHOD_DEFLATE,
    METHOD_STORE,
    isSymlinkEntry,
    type ZipEntry,
} from '../core-bridge/index.js';
import { createDiagnosticSink, type DiagnosticRow } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { methodName, rowFromEntry, type EntryRow } from '../utils/entryfmt.js';
import { emitJsonReport } from '../utils/projection.js';
import { formatBytes, parseByteSize, parseCount } from '../utils/sizes.js';
import { guard } from '../utils/ziperr.js';
import {
    commonOptions,
    decodeComment,
    openArchive,
    parseFormat,
    readArchiveBytes,
    resolveInputPath,
} from '../utils/zipops.js';

const DOS_EPOCH_DATE = 0x0021; // 1980-01-01
const DOS_EPOCH_TIME = 0x0000;

export interface InspectReport {
    readonly archive: {
        readonly bytes: number;
        readonly entryCount: number;
        readonly isZip64: boolean;
        readonly comment: string;
        readonly commentBytes: number;
        readonly prependedData: boolean;
        readonly multipleEocd: boolean;
    };
    readonly stats: {
        readonly files: number;
        readonly directories: number;
        readonly compressedSize: number;
        readonly uncompressedSize: number;
        readonly ratio: string;
        readonly methods: Record<string, number>;
        readonly encrypted: number;
        readonly symlinks: number;
        readonly dataDescriptor: number;
        readonly zip64Entries: number;
        readonly utf8Names: number;
        readonly cp437Names: number;
        readonly duplicateNames: number;
        readonly earliestDate: string | null;
        readonly latestDate: string | null;
    };
    readonly determinism: {
        readonly epochTimestamps: boolean;
        readonly canonicalOrder: boolean;
        readonly utf8Flags: boolean;
        /** No entry uses a data descriptor (the buffered / `add()` layout). */
        readonly noDataDescriptors: boolean;
        /**
         * Same as `noDataDescriptors`: the archive has the canonical buffered
         * layout. A streamed archive (`create --stream`, `addStream()`) is
         * reproducible run-to-run but carries data descriptors, so it is
         * `deterministic: true` and `canonicalLayout: false`.
         */
        readonly canonicalLayout: boolean;
        /** Reproducible: epoch timestamps + canonical order + UTF-8 flags. */
        readonly deterministic: boolean;
    };
    readonly entries?: readonly EntryRow[];
    readonly diagnostics: readonly DiagnosticRow[];
    readonly checks?: readonly CheckResult[];
}

export interface CheckResult {
    readonly check: string;
    readonly ok: boolean;
    readonly detail: string;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const d = (a[i] as number) - (b[i] as number);
        if (d !== 0) return d;
    }
    return a.length - b.length;
}

function isAscii(bytes: Uint8Array): boolean {
    for (const b of bytes) if (b > 0x7f) return false;
    return true;
}

function buildReport(entries: readonly ZipEntry[], archive: InspectReport['archive'], diagnostics: readonly DiagnosticRow[]): Omit<InspectReport, 'entries' | 'checks'> {
    let files = 0;
    let directories = 0;
    let compressedSize = 0;
    let uncompressedSize = 0;
    const methods: Record<string, number> = {};
    let encrypted = 0;
    let symlinks = 0;
    let dataDescriptor = 0;
    let zip64Entries = 0;
    let utf8Names = 0;
    let cp437Names = 0;
    const seen = new Set<string>();
    let duplicateNames = 0;
    let earliest: Date | null = null;
    let latest: Date | null = null;
    let epochTimestamps = true;
    let canonicalOrder = true;
    let utf8Flags = true;
    let prev: ZipEntry | null = null;

    for (const e of entries) {
        if (e.isDirectory) directories++;
        else files++;
        compressedSize += e.compressedSize;
        uncompressedSize += e.uncompressedSize;
        const key = `${e.compressionMethod}`;
        methods[key] = (methods[key] ?? 0) + 1;
        if (e.isEncrypted) encrypted++;
        if (isSymlinkEntry(e)) symlinks++;
        if (e.usesDataDescriptor) dataDescriptor++;
        if (e.usesZip64) zip64Entries++;
        if (e.nameEncoding === 'utf-8') utf8Names++;
        else cp437Names++;
        if (seen.has(e.name)) duplicateNames++;
        seen.add(e.name);
        if (earliest === null || e.lastModified < earliest) earliest = e.lastModified;
        if (latest === null || e.lastModified > latest) latest = e.lastModified;
        if (e.dosDate !== DOS_EPOCH_DATE || e.dosTime !== DOS_EPOCH_TIME) epochTimestamps = false;
        if (prev !== null && compareBytes(prev.rawName, e.rawName) > 0) canonicalOrder = false;
        if ((e.flags & FLAG_UTF8) === 0 && !isAscii(e.rawName)) utf8Flags = false;
        prev = e;
    }
    const noDataDescriptors = dataDescriptor === 0;
    return {
        archive,
        stats: {
            files,
            directories,
            compressedSize,
            uncompressedSize,
            ratio: uncompressedSize === 0 ? '0%' : `${Math.max(0, Math.round(100 - (compressedSize / uncompressedSize) * 100))}%`,
            methods,
            encrypted,
            symlinks,
            dataDescriptor,
            zip64Entries,
            utf8Names,
            cp437Names,
            duplicateNames,
            earliestDate: earliest === null ? null : (earliest as Date).toISOString(),
            latestDate: latest === null ? null : (latest as Date).toISOString(),
        },
        determinism: {
            epochTimestamps,
            canonicalOrder,
            utf8Flags,
            noDataDescriptors,
            canonicalLayout: noDataDescriptors,
            // Reproducibility only: the data-descriptor layout produced by
            // streamed writers is byte-stable for identical inputs, so it must
            // not falsify the verdict (see determinism.md in the engine).
            deterministic: epochTimestamps && canonicalOrder && utf8Flags,
        },
        diagnostics,
    };
}

// ── --check assertions ────────────────────────────────────────────────

const SIMPLE_CHECKS: readonly string[] = [
    'deterministic', 'epoch-timestamps', 'canonical-order', 'utf8-names', 'no-data-descriptor',
    'canonical-layout', 'no-zip64', 'zip64', 'no-encryption', 'no-symlinks', 'no-duplicates',
    'no-diagnostics', 'store-only', 'deflate-only',
];
const PARAM_CHECKS: readonly string[] = ['max-entries', 'min-entries', 'max-uncompressed', 'max-ratio', 'has', 'method'];

export function parseChecks(args: ParsedArgs): string[] {
    const out: string[] = [];
    for (const raw of getStringFlagAll(args.flags, 'check')) {
        for (const part of raw.split(',')) {
            const c = part.trim();
            if (c.length === 0) continue;
            const key = c.includes('=') ? c.slice(0, c.indexOf('=')) : c;
            if (!SIMPLE_CHECKS.includes(key) && !PARAM_CHECKS.includes(key)) {
                throw new CliError(
                    `Unknown --check "${c}". Valid: ${[...SIMPLE_CHECKS, ...PARAM_CHECKS.map((p) => `${p}=<value>`)].join(', ')}.`,
                    2,
                );
            }
            if (PARAM_CHECKS.includes(key) && !c.includes('=')) {
                throw new CliError(`--check ${key} requires a value: ${key}=<value>.`, 2);
            }
            if (SIMPLE_CHECKS.includes(key) && c.includes('=')) {
                throw new CliError(`--check ${key} takes no value.`, 2);
            }
            out.push(c);
        }
    }
    return out;
}

function evaluateChecks(checks: readonly string[], report: Omit<InspectReport, 'entries' | 'checks'>, entries: readonly ZipEntry[]): CheckResult[] {
    const s = report.stats;
    const d = report.determinism;
    const results: CheckResult[] = [];
    for (const c of checks) {
        const eq = c.indexOf('=');
        const key = eq === -1 ? c : c.slice(0, eq);
        const value = eq === -1 ? '' : c.slice(eq + 1);
        let ok = false;
        let detail = '';
        switch (key) {
            case 'deterministic': ok = d.deterministic; detail = JSON.stringify(d); break;
            case 'epoch-timestamps': ok = d.epochTimestamps; detail = ok ? 'all entries at the DOS epoch' : 'non-epoch timestamps present'; break;
            case 'canonical-order': ok = d.canonicalOrder; detail = ok ? 'central directory in canonical raw-name order' : 'not in canonical order'; break;
            case 'utf8-names': ok = d.utf8Flags; detail = ok ? 'non-ASCII names carry the UTF-8 flag' : 'non-ASCII name without the UTF-8 flag'; break;
            case 'no-data-descriptor':
            case 'canonical-layout': ok = s.dataDescriptor === 0; detail = `${s.dataDescriptor} data-descriptor entries`; break;
            case 'no-zip64': ok = !report.archive.isZip64 && s.zip64Entries === 0; detail = `zip64 EOCD: ${report.archive.isZip64}, zip64 entries: ${s.zip64Entries}`; break;
            case 'zip64': ok = report.archive.isZip64 || s.zip64Entries > 0; detail = `zip64 EOCD: ${report.archive.isZip64}, zip64 entries: ${s.zip64Entries}`; break;
            case 'no-encryption': ok = s.encrypted === 0; detail = `${s.encrypted} encrypted entries`; break;
            case 'no-symlinks': ok = s.symlinks === 0; detail = `${s.symlinks} symlink entries`; break;
            case 'no-duplicates': ok = s.duplicateNames === 0; detail = `${s.duplicateNames} duplicate names`; break;
            case 'no-diagnostics': ok = report.diagnostics.length === 0; detail = `${report.diagnostics.length} diagnostics`; break;
            case 'store-only': ok = entries.every((e) => e.compressionMethod === METHOD_STORE); detail = `methods: ${Object.keys(s.methods).join(',') || 'none'}`; break;
            case 'deflate-only': ok = entries.every((e) => e.compressionMethod === METHOD_DEFLATE); detail = `methods: ${Object.keys(s.methods).join(',') || 'none'}`; break;
            case 'max-entries': { const n = parseCount(value, 'check max-entries'); ok = entries.length <= n; detail = `${entries.length} entries (max ${n})`; break; }
            case 'min-entries': { const n = parseCount(value, 'check min-entries'); ok = entries.length >= n; detail = `${entries.length} entries (min ${n})`; break; }
            case 'max-uncompressed': { const n = parseByteSize(value, 'check max-uncompressed'); ok = s.uncompressedSize <= n; detail = `${formatBytes(s.uncompressedSize)} uncompressed (max ${formatBytes(n)})`; break; }
            case 'max-ratio': {
                const n = parseCount(value, 'check max-ratio');
                const worst = entries.reduce((m, e) => (e.compressedSize > 0 ? Math.max(m, e.uncompressedSize / e.compressedSize) : m), 0);
                ok = worst <= n;
                detail = `worst entry ratio ${worst.toFixed(1)}:1 (max ${n}:1)`;
                break;
            }
            case 'has': ok = entries.some((e) => e.name === value); detail = ok ? `entry "${value}" present` : `entry "${value}" missing`; break;
            case 'method': {
                const want = value === 'store' ? METHOD_STORE : value === 'deflate' ? METHOD_DEFLATE : Number(value);
                if (!Number.isInteger(want)) throw new CliError(`--check method expects store, deflate or a method id, got "${value}".`, 2);
                ok = entries.every((e) => e.compressionMethod === want);
                detail = `all entries use ${methodName(want)}: ${ok}`;
                break;
            }
            default: ok = false; detail = 'unknown check';
        }
        results.push({ check: c, ok, detail });
    }
    return results;
}

// ── Text rendering ────────────────────────────────────────────────────

function renderText(report: InspectReport, source: string): string {
    const a = report.archive;
    const s = report.stats;
    const d = report.determinism;
    const lines: string[] = [];
    lines.push(`Archive: ${source}`);
    lines.push(`  size            ${a.bytes} bytes (${formatBytes(a.bytes)})`);
    lines.push(`  entries         ${a.entryCount} (${s.files} files, ${s.directories} directories)`);
    lines.push(`  zip64           ${a.isZip64}${s.zip64Entries > 0 ? ` (${s.zip64Entries} zip64 entries)` : ''}`);
    lines.push(`  comment         ${a.commentBytes > 0 ? JSON.stringify(a.comment) : '(none)'}`);
    lines.push(`  prepended data  ${a.prependedData}`);
    lines.push('');
    lines.push('Contents:');
    lines.push(`  compressed      ${s.compressedSize} bytes`);
    lines.push(`  uncompressed    ${s.uncompressedSize} bytes (${s.ratio} saved)`);
    lines.push(`  methods         ${Object.entries(s.methods).map(([m, n]) => `${methodName(Number(m))}=${n}`).join(', ') || '(none)'}`);
    lines.push(`  encrypted       ${s.encrypted}`);
    lines.push(`  symlinks        ${s.symlinks}`);
    lines.push(`  data descriptor ${s.dataDescriptor}`);
    lines.push(`  names           ${s.utf8Names} utf-8, ${s.cp437Names} cp437, ${s.duplicateNames} duplicates`);
    lines.push(`  dates           ${s.earliestDate ?? '-'} .. ${s.latestDate ?? '-'}`);
    lines.push('');
    lines.push(`Determinism: ${d.deterministic ? 'reproducible' : 'NOT reproducible'}, layout ${d.canonicalLayout ? 'canonical' : 'data-descriptor (streamed)'}`);
    lines.push(`  epoch timestamps    ${d.epochTimestamps}`);
    lines.push(`  canonical order     ${d.canonicalOrder}`);
    lines.push(`  utf-8 flags         ${d.utf8Flags}`);
    lines.push(`  no data descriptors ${d.noDataDescriptors}`);
    if (report.diagnostics.length > 0) {
        lines.push('');
        lines.push(`Diagnostics (${report.diagnostics.length}):`);
        for (const diag of report.diagnostics) {
            lines.push(`  ${diag.severity} [${diag.code}]${diag.entryName !== undefined ? ` ${diag.entryName}:` : ''} ${diag.message}`);
        }
    }
    if (report.entries !== undefined) {
        lines.push('');
        lines.push(`Entries (${report.entries.length}):`);
        for (const e of report.entries) {
            lines.push(`  ${e.name}`);
            lines.push(`    ${e.methodName} ${e.compressedSize} -> ${e.uncompressedSize} bytes, crc ${e.crc32}, ${e.lastModified}${e.unixMode !== null ? `, mode ${e.unixMode}` : ''}${e.isSymlink ? ', symlink' : ''}${e.isEncrypted ? ', ENCRYPTED' : ''}`);
            if (e.flags !== undefined) {
                lines.push(`    flags 0x${e.flags.raw.toString(16).padStart(4, '0')} (utf8=${e.flags.utf8} descriptor=${e.flags.dataDescriptor} encrypted=${e.flags.encrypted}), made-by ${e.versionMadeBy}, needed ${e.versionNeeded}, offset ${e.localHeaderOffset}`);
            }
            if (e.extraFields !== undefined && e.extraFields.length > 0) {
                lines.push(`    extra: ${e.extraFields.map((x) => `${x.idHex}${x.name !== null ? ` ${x.name}` : ''} (${x.length} bytes)${x.hex !== undefined ? ` ${x.hex}` : ''}`).join('; ')}`);
            }
        }
    }
    if (report.checks !== undefined) {
        lines.push('');
        lines.push('Checks:');
        for (const c of report.checks) lines.push(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.check}  (${c.detail})`);
    }
    return lines.join('\n') + '\n';
}

export function inspectSummary(report: InspectReport): Record<string, unknown> {
    return {
        entries: report.archive.entryCount,
        bytes: report.archive.bytes,
        uncompressedSize: report.stats.uncompressedSize,
        zip64: report.archive.isZip64,
        encrypted: report.stats.encrypted,
        deterministic: report.determinism.deterministic,
        canonicalLayout: report.determinism.canonicalLayout,
        diagnostics: report.diagnostics.length,
        ...(report.checks !== undefined ? { checksPassed: report.checks.every((c) => c.ok) } : {}),
    };
}

export async function inspect(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const format = parseFormat(args, ['text', 'json'] as const, isJsonMode() ? 'json' : 'text');
    const checks = parseChecks(args);
    const wantEntries = hasFlag(args.flags, 'entries');
    const wantNames = getStringFlagAll(args.flags, 'entry');
    const extraHex = hasFlag(args.flags, 'extra');

    const inputPath = resolveInputPath(args);
    const bytes = await readArchiveBytes(inputPath);
    const sink = createDiagnosticSink(true);
    const reader = openArchive(bytes, { ...commonOptions(args, sink), validate: 'eager' });
    const entries: ZipEntry[] = guard('Failed to read the central directory', () => [...reader.entries()]);

    const archive: InspectReport['archive'] = {
        bytes: bytes.length,
        entryCount: reader.entryCount,
        isZip64: reader.isZip64,
        comment: decodeComment(reader.comment),
        commentBytes: reader.comment.length,
        prependedData: sink.diagnostics.some((d) => d.code === 'ZIP_PREPENDED_DATA'),
        multipleEocd: sink.diagnostics.some((d) => d.code === 'ZIP_MULTIPLE_EOCD'),
    };
    const base = buildReport(entries, archive, sink.diagnostics);

    let rows: EntryRow[] | undefined;
    if (wantNames.length > 0) {
        rows = [];
        for (const name of wantNames) {
            const entry = reader.getEntry(name);
            if (entry === null) {
                throw new CliError(`Entry not found: ${name}`, 1, ErrorCode.NOT_FOUND, { entryName: name });
            }
            rows.push(rowFromEntry(entry, { long: true, extraHex }));
        }
    } else if (wantEntries) {
        rows = entries.map((e) => rowFromEntry(e, { long: true, extraHex }));
    }

    const checkResults = checks.length > 0 ? evaluateChecks(checks, base, entries) : undefined;
    const report: InspectReport = {
        ...base,
        ...(rows !== undefined ? { entries: rows } : {}),
        ...(checkResults !== undefined ? { checks: checkResults } : {}),
    };

    if (format === 'json') {
        emitJsonReport(args, report, () => inspectSummary(report));
    } else {
        process.stdout.write(renderText(report, inputPath ?? '-'));
    }

    if (checkResults !== undefined) {
        const failed = checkResults.filter((c) => !c.ok);
        if (failed.length > 0) {
            const detail = failed.map((c) => `${c.check} (${c.detail})`).join('; ');
            throw new CliError(format === 'json' ? `${failed.length} check(s) failed: ${detail}` : '', 1, ErrorCode.CHECK_FAILED);
        }
    }
}
