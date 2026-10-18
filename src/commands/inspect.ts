// `zipnative inspect` — forensic archive report + CI assertions.
//
// Opens the archive EAGERLY (every local header cross-checked, overlap table
// built up front), then reports archive facts, per-method statistics, a
// determinism verdict and every diagnostic the parse emitted. `--check`
// turns the report into a gate: any failed assertion exits 1 with
// `E_CHECK_FAILED` after the report has been printed.
//
// Determinism is measured by the engine's `analyzeDeterminism()` (zipnative
// 1.1 — before it the CLI re-derived the same facts from the entry fields).
// `deterministic` keeps its 1.0 definition (epoch timestamps + canonical
// order + UTF-8 flags: reproducibility); the engine's stricter verdict, which
// also requires Zip64-only extras and the constant version-made-by, is
// reported as `canonicalForm` with every `offender`, and gated by
// `--check canonical-form`.

import { type ParsedArgs, getStringFlagAll, hasFlag } from '../utils/args.js';
import { isJsonMode } from '../utils/agent.js';
import {
    METHOD_DEFLATE,
    METHOD_STORE,
    analyzeDeterminism,
    isSymlinkEntry,
    sanitizeEntryPath,
    type DeterminismOffender,
    type DeterminismReport,
    type ZipEntry,
} from '../core-bridge/index.js';
import { createDiagnosticSink, type DiagnosticRow } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { methodName, rowFromEntry, type EntryRow } from '../utils/entryfmt.js';
import { emitJsonReport } from '../utils/projection.js';
import { escapeTerminal } from '../utils/sanitize.js';
import { formatBytes, parseByteSize, parseCount } from '../utils/sizes.js';
import { guard } from '../utils/ziperr.js';
import { runSignal } from '../utils/control.js';
import { parseLimitFlags } from '../utils/limits.js';
import {
    commonOptions,
    bytesToHex,
    decodeComment,
    openArchive,
    parseFormat,
    readArchiveBytes,
    resolveInputPath,
} from '../utils/zipops.js';

export interface InspectReport {
    readonly archive: {
        readonly bytes: number;
        readonly entryCount: number;
        readonly isZip64: boolean;
        readonly comment: string;
        readonly commentBytes: number;
        /** Raw comment bytes, hex — present when the archive has a comment. */
        readonly commentHex?: string;
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
        /** Names the engine's sanitizeEntryPath() refuses (traversal, absolute, drive/UNC, NUL, ADS, device names). */
        readonly unsafeNames: number;
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
        /** No extra field other than Zip64 (0x0001) on any entry (engine, 1.1). */
        readonly canonicalExtras: boolean;
        /** Every entry carries zipnative's version-made-by 0x032D (engine, 1.1). */
        readonly canonicalVersionMadeBy: boolean;
        /** The engine's verdict: the canonical form zipnative itself writes (data descriptors excluded). */
        readonly canonicalForm: boolean;
        /** Every canonical-form rule an entry breaks, in central-directory order. */
        readonly offenders: readonly DeterminismOffender[];
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

function buildReport(
    entries: readonly ZipEntry[],
    archive: InspectReport['archive'],
    diagnostics: readonly DiagnosticRow[],
    det: DeterminismReport,
): Omit<InspectReport, 'entries' | 'checks'> {
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
    let unsafeNames = 0;
    let earliest: Date | null = null;
    let latest: Date | null = null;

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
        // Same rule as the extraction sink: a name the engine cannot sanitise
        // (directory names are checked without their trailing slash).
        if (sanitizeEntryPath(e.isDirectory && e.name.endsWith('/') ? e.name.slice(0, -1) : e.name) === null) unsafeNames++;
        if (earliest === null || e.lastModified < earliest) earliest = e.lastModified;
        if (latest === null || e.lastModified > latest) latest = e.lastModified;
    }
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
            unsafeNames,
            earliestDate: earliest === null ? null : earliest.toISOString(),
            latestDate: latest === null ? null : latest.toISOString(),
        },
        determinism: {
            epochTimestamps: det.epochTimestamps,
            canonicalOrder: det.canonicalOrder,
            utf8Flags: det.utf8Flags,
            noDataDescriptors: det.noDataDescriptors,
            canonicalLayout: det.noDataDescriptors,
            // Reproducibility only (the 1.0 verdict, unchanged): the data-
            // descriptor layout produced by streamed writers is byte-stable for
            // identical inputs, so it must not falsify the verdict, and neither
            // a foreign version-made-by nor a preserved extra field makes an
            // archive irreproducible.
            deterministic: det.epochTimestamps && det.canonicalOrder && det.utf8Flags,
            canonicalExtras: det.canonicalExtras,
            canonicalVersionMadeBy: det.canonicalVersionMadeBy,
            canonicalForm: det.deterministic,
            offenders: det.offenders,
        },
        diagnostics,
    };
}

// ── --check assertions ────────────────────────────────────────────────

const SIMPLE_CHECKS: readonly string[] = [
    'deterministic', 'canonical-form', 'epoch-timestamps', 'canonical-order', 'utf8-names', 'no-data-descriptor',
    'canonical-layout', 'no-zip64', 'zip64', 'no-encryption', 'no-symlinks', 'safe-names', 'no-duplicates',
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
            case 'deterministic': {
                ok = d.deterministic;
                // The verdict flags only: the offender list has its own check.
                detail = JSON.stringify(d, (k, v: unknown) => (k === 'offenders' ? undefined : v));
                break;
            }
            case 'canonical-form': {
                ok = d.canonicalForm;
                const breaking = d.offenders.filter((o) => o.concern !== 'data-descriptor');
                detail = ok
                    ? 'every entry is in the canonical form zipnative writes'
                    : `${breaking.length} offence(s): ${breaking.slice(0, 5).map((o) => `${o.name} (${o.concern})`).join(', ')}${breaking.length > 5 ? ', …' : ''}`;
                break;
            }
            case 'epoch-timestamps': ok = d.epochTimestamps; detail = ok ? 'all entries at the DOS epoch' : 'non-epoch timestamps present'; break;
            case 'canonical-order': ok = d.canonicalOrder; detail = ok ? 'central directory in canonical raw-name order' : 'not in canonical order'; break;
            case 'utf8-names': ok = d.utf8Flags; detail = ok ? 'non-ASCII names carry the UTF-8 flag' : 'non-ASCII name without the UTF-8 flag'; break;
            case 'no-data-descriptor':
            case 'canonical-layout': ok = s.dataDescriptor === 0; detail = `${s.dataDescriptor} data-descriptor entries`; break;
            case 'no-zip64': ok = !report.archive.isZip64 && s.zip64Entries === 0; detail = `zip64 EOCD: ${report.archive.isZip64}, zip64 entries: ${s.zip64Entries}`; break;
            case 'zip64': ok = report.archive.isZip64 || s.zip64Entries > 0; detail = `zip64 EOCD: ${report.archive.isZip64}, zip64 entries: ${s.zip64Entries}`; break;
            case 'no-encryption': ok = s.encrypted === 0; detail = `${s.encrypted} encrypted entries`; break;
            case 'no-symlinks': ok = s.symlinks === 0; detail = `${s.symlinks} symlink entries`; break;
            case 'safe-names': ok = s.unsafeNames === 0; detail = `${s.unsafeNames} unsafe names (traversal, absolute, drive/UNC, NUL, ADS or reserved device name)`; break;
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
    lines.push(`  names           ${s.utf8Names} utf-8, ${s.cp437Names} cp437, ${s.duplicateNames} duplicates, ${s.unsafeNames} unsafe`);
    lines.push(`  dates           ${s.earliestDate ?? '-'} .. ${s.latestDate ?? '-'}`);
    lines.push('');
    lines.push(`Determinism: ${d.deterministic ? 'reproducible' : 'NOT reproducible'}, layout ${d.canonicalLayout ? 'canonical' : 'data-descriptor (streamed)'}`);
    lines.push(`  epoch timestamps    ${d.epochTimestamps}`);
    lines.push(`  canonical order     ${d.canonicalOrder}`);
    lines.push(`  utf-8 flags         ${d.utf8Flags}`);
    lines.push(`  no data descriptors ${d.noDataDescriptors}`);
    lines.push(`  canonical extras    ${d.canonicalExtras}`);
    lines.push(`  version-made-by     ${d.canonicalVersionMadeBy}`);
    lines.push(`  canonical form      ${d.canonicalForm}`);
    const breaking = d.offenders.filter((o) => o.concern !== 'data-descriptor');
    if (breaking.length > 0) {
        const shown = breaking.slice(0, 10).map((o) => `${o.name} (${o.concern})`).join(', ');
        lines.push(`  offenders           ${shown}${breaking.length > 10 ? `, … (${breaking.length} in all)` : ''}`);
    }
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
        canonicalForm: report.determinism.canonicalForm,
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
    const bytes = await readArchiveBytes(inputPath, args);
    const sink = createDiagnosticSink(true);
    const common = commonOptions(args, sink, 'inspect');
    const reader = openArchive(bytes, { ...common, validate: 'eager' });
    const entries: ZipEntry[] = guard('Failed to read the central directory', () => [...reader.entries()]);

    const archive: InspectReport['archive'] = {
        bytes: bytes.length,
        entryCount: reader.entryCount,
        isZip64: reader.isZip64,
        comment: decodeComment(reader.comment),
        commentBytes: reader.comment.length,
        ...(reader.comment.length > 0 ? { commentHex: bytesToHex(reader.comment) } : {}),
        prependedData: sink.diagnostics.some((d) => d.code === 'ZIP_PREPENDED_DATA'),
        multipleEocd: sink.diagnostics.some((d) => d.code === 'ZIP_MULTIPLE_EOCD'),
    };
    // The engine owns the determinism definition (1.1); same bounds and name
    // decoder as the open above, so it measures exactly the archive reported.
    const limits = parseLimitFlags(args);
    const signal = runSignal();
    const det = guard('Failed to analyse determinism', () => analyzeDeterminism(bytes, {
        ...(limits !== undefined ? { limits } : {}),
        ...(common.nameDecoder !== undefined ? { nameDecoder: common.nameDecoder } : {}),
        ...(signal !== undefined ? { signal } : {}),
    }));
    const base = buildReport(entries, archive, sink.diagnostics, det);

    let rows: EntryRow[] | undefined;
    if (wantNames.length > 0) {
        rows = [];
        for (const name of wantNames) {
            const entry = reader.getEntry(name);
            if (entry === null) {
                throw new CliError(`Entry not found: ${name} (run \`zipnative list\` for the exact names).`, 1, ErrorCode.NOT_FOUND, { entryName: name, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
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
        process.stdout.write(escapeTerminal(renderText(report, inputPath ?? '-')));
    }

    if (checkResults !== undefined) {
        const failed = checkResults.filter((c) => !c.ok);
        if (failed.length > 0) {
            const detail = failed.map((c) => `${c.check} (${c.detail})`).join('; ');
            throw new CliError(format === 'json' ? `${failed.length} check(s) failed: ${detail}` : '', 1, ErrorCode.CHECK_FAILED);
        }
    }
}
