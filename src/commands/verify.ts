// `zipnative verify` — one-call deep integrity verification through
// zipnative's `verifyZip`: eager structural validation, per-entry CRC-32 /
// size / local-header agreement, diagnostics collected. The core NEVER throws
// for archive problems — a structural refusal lands in `report.error` — so
// the report is always the artefact and the exit code is the verdict:
//
//   ok            → exit 0
//   !ok           → exit 1, E_VERIFY_FAILED (zipCode = report.error.code when set)
//   --strict      → additionally fail when any diagnostic was emitted
//
// `--entry <name>` (repeatable) verifies only the named entries through
// `ZipReader.verifyEntry()` — same per-entry outcome shape, `selected` lists
// the names, and an unknown name is E_NOT_FOUND before any output.

import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from '../utils/args.js';
import { isJsonMode, isStrict } from '../utils/agent.js';
import {
    DEFAULT_ZIP_LIMITS,
    verifyZip,
    type EntryVerification,
    type ZipEntry,
    type ZipVerificationReport,
} from '../core-bridge/index.js';
import { createDiagnosticSink, diagnosticRows, type DiagnosticRow } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { parseLimitFlags } from '../utils/limits.js';
import { emitJsonReport, warnTextProjection } from '../utils/projection.js';
import { escapeTerminal, escapeLine } from '../utils/sanitize.js';
import { guard, mapZipError } from '../utils/ziperr.js';
import { type ArchiveSource, commonOptions, entryPasses, openArchive, openArchiveSource, parseFormat, readArchiveBytes, resolveInputPath } from '../utils/zipops.js';

type VerifiedEntry = ZipVerificationReport['entries'][number];

/** The engine-level outcome (whole archive or the selected entries). */
interface CoreOutcome {
    readonly ok: boolean;
    readonly error: { readonly code: string; readonly message: string } | null;
    readonly entryCount: number;
    readonly entries: readonly VerifiedEntry[];
}

export interface VerifyReport {
    readonly ok: boolean;
    readonly error: { readonly code: string; readonly message: string } | null;
    readonly entryCount: number;
    readonly entries: readonly VerifiedEntry[];
    readonly diagnostics: readonly DiagnosticRow[];
    readonly failed: number;
    readonly skipped: number;
    readonly strict: boolean;
    /** Present under `--entry`: the names that were verified (the rest were not read). */
    readonly selected?: readonly string[];
}

export function verifySummary(report: VerifyReport): Record<string, unknown> {
    return {
        ok: report.ok,
        entries: report.entryCount,
        failed: report.failed,
        skipped: report.skipped,
        diagnostics: report.diagnostics.length,
        ...(report.selected !== undefined ? { selected: report.selected.length } : {}),
        ...(report.error !== null ? { error: report.error.code } : {}),
    };
}

function renderText(report: VerifyReport, source: string): string {
    const lines: string[] = [`Verify: ${source}${report.selected !== undefined ? `  (${report.selected.length} selected of ${report.entryCount})` : ''}`];
    if (report.error !== null) {
        lines.push(`  STRUCTURE  ${report.error.code}: ${report.error.message}`);
    }
    for (const e of report.entries) {
        if (e.ok) {
            lines.push(`  ok    ${escapeLine(e.name)}`);
        } else if (e.skipped !== undefined && entryPasses(e)) {
            lines.push(`  skip  ${escapeLine(e.name)}  (${e.skipped})`);
        } else if (e.skipped !== undefined) {
            // A skip that fails the archive: no codec for the method, or a
            // design-time skip whose local header disagrees.
            lines.push(`  FAIL  ${escapeLine(e.name)}  (${e.skipped}${e.localHeaderMatch ? '' : ',local-header'})`);
        } else {
            const why = [
                !e.crcMatch ? 'crc' : null,
                !e.sizeMatch ? 'size' : null,
                !e.localHeaderMatch ? 'local-header' : null,
            ].filter((x) => x !== null).join(',');
            lines.push(`  FAIL  ${escapeLine(e.name)}  (${why})`);
        }
    }
    for (const d of report.diagnostics) {
        lines.push(`  ${d.severity} [${d.code}]${d.entryName !== undefined ? ` ${escapeLine(d.entryName)}:` : ''} ${escapeLine(d.message)}`);
    }
    lines.push('');
    const verified = report.selected !== undefined ? report.selected.length : report.entryCount;
    const verdict = report.ok
        ? `OK: ${verified} entries, ${report.skipped} skipped, ${report.diagnostics.length} diagnostics`
        : `FAILED: ${report.failed} failed of ${verified} entries${report.error !== null ? ` (${report.error.code})` : ''}`;
    lines.push(verdict);
    return lines.join('\n') + '\n';
}

/** The whole-archive report from the engine's `verifyZip`. */
/** The per-entry bound a verifier's fetch applies, keyed by `ZipLimits`. */
const ENTRY_BOUNDS = {
    maxEntryCompressedSize: { flag: 'max-entry-compressed-size', what: 'compressed size', of: (e: ZipEntry) => e.compressedSize },
    maxEntryUncompressedSize: { flag: 'max-entry-size', what: 'uncompressed size', of: (e: ZipEntry) => e.uncompressedSize },
} as const;

/**
 * A declared size over a bound is a refusal, not a verdict: the engine's
 * verifiers (`verifyZip`, `verifyEntry` on both readers) report a fetch their
 * bound stopped as a plain CRC / size mismatch, which reads as corruption
 * (engine draft: .github/drafts/upstream-range-verify-swallows-limit.md). The
 * same bound is checked here first, so the verdict is E_LIMIT with the flag
 * that lifts it, as `cat` and `extract` report it (release audit A-70, D-03f).
 */
function entryBoundBreach(entry: ZipEntry, args: ParsedArgs, keys: readonly (keyof typeof ENTRY_BOUNDS)[]): CliError | null {
    const limits = { ...DEFAULT_ZIP_LIMITS, ...parseLimitFlags(args) };
    for (const key of keys) {
        const bound = ENTRY_BOUNDS[key];
        const configured = limits[key];
        const observed = bound.of(entry);
        if (observed > configured) {
            return new CliError(
                `Entry "${entry.name}" ${bound.what} ${observed} exceeds --${bound.flag} (${configured} bytes); the entry was not verified.`,
                1,
                ErrorCode.LIMIT,
                {
                    entryName: entry.name,
                    zipCode: 'ZIP_LIMIT_EXCEEDED',
                    detail: { limit: key, configured, observed },
                    remedy: `--${bound.flag} <size> (raise the bound for trusted input only)`,
                },
            );
        }
    }
    return null;
}

const BUFFERED_BOUNDS = ['maxEntryUncompressedSize'] as const;
const RANGE_BOUNDS = ['maxEntryCompressedSize', 'maxEntryUncompressedSize'] as const;

/** The whole-archive verification `verify` and `batch --task verify` share: the bound check, then `verifyZip`. */
export function verifyAll(bytes: Uint8Array, args: ParsedArgs): { core: CoreOutcome; diagnostics: readonly DiagnosticRow[] } {
    const limits = parseLimitFlags(args);
    // The declared sizes first (a lazy open, metadata only): a bound the
    // verification would hit is E_LIMIT, and a structural limit refusal
    // (maxEntries, maxCentralDirectoryBytes, …) surfaces as the bound it is
    // instead of a failed verification. Anything else is verifyZip's report.
    let declared: readonly ZipEntry[] = [];
    try {
        const reader = openArchive(bytes, { ...commonOptions(args, createDiagnosticSink(), 'verify'), strict: false });
        declared = guard('Failed to read the central directory', () => [...reader.entries()]);
    } catch (e) {
        // A structural refusal is verifyZip's report; only a bound surfaces here.
        if (e instanceof CliError && e.code === ErrorCode.LIMIT) throw e;
    }
    for (const entry of declared) {
        const breach = entryBoundBreach(entry, args, BUFFERED_BOUNDS);
        if (breach !== null) throw breach;
    }
    // verifyZip only throws for caller bugs (invalid limits) — pre-validated,
    // but still mapped so an unexpected throw carries a proper code.
    const core = guard('Verification failed', () => verifyZip(bytes, limits !== undefined ? { limits } : undefined));
    return { core, diagnostics: diagnosticRows(core.diagnostics) };
}

/**
 * `--entry`: open eagerly (structure first, like `verifyZip`), then
 * `verifyEntry()` each requested name. Since zipnative 1.1 the engine names
 * the `skipped` reason itself (issue #12) and cross-checks the local header
 * of every entry, encrypted ones included; the verdict follows verifyZip's
 * own archive rule ({@link entryPasses}).
 */
function verifySelected(bytes: Uint8Array, args: ParsedArgs, names: readonly string[]): { core: CoreOutcome; diagnostics: readonly DiagnosticRow[] } {
    const sink = createDiagnosticSink();
    let reader;
    try {
        reader = openArchive(bytes, { ...commonOptions(args, sink, 'verify'), validate: 'eager' });
    } catch (e) {
        if (!(e instanceof CliError)) throw e;
        // A bound is not a verdict: it keeps its class and its detail (V-03).
        if (e.code === ErrorCode.LIMIT) throw e;
        // A structural refusal is the report's `error`, as with verifyZip.
        return {
            core: { ok: false, error: { code: e.zipCode ?? e.code, message: e.message }, entryCount: 0, entries: [] },
            diagnostics: sink.diagnostics,
        };
    }
    const entries: VerifiedEntry[] = [];
    for (const name of names) {
        const entry = guard('Failed to read the central directory', () => reader.getEntry(name));
        if (entry === null) {
            throw new CliError(`Entry not found: ${name} (run \`zipnative list\` for the exact names).`, 1, ErrorCode.NOT_FOUND, { entryName: name, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
        }
        const breach = entryBoundBreach(entry, args, BUFFERED_BOUNDS);
        if (breach !== null) throw breach;
        let v: EntryVerification;
        try {
            v = reader.verifyEntry(entry);
        } catch (e) {
            throw mapZipError(e, `Cannot verify entry "${name}"`, name);
        }
        entries.push({ name: entry.name, ...v });
    }
    const ok = entries.every(entryPasses);
    return {
        core: { ok, error: null, entryCount: reader.entryCount, entries },
        diagnostics: sink.diagnostics,
    };
}

/**
 * `--range`: the same per-entry verdict through zipnative 1.1 `openZipRange()`
 * — the archive is opened eagerly (structure first) by byte ranges and every
 * entry (or every `--entry`) goes through `verifyEntry()`, one entry in memory
 * at a time, each fetch bounded by `--max-entry-compressed-size`. The archive
 * rule is verifyZip's own ({@link entryPasses}).
 */
async function verifyRange(args: ParsedArgs, inputPath: string | undefined, names: readonly string[]): Promise<{ core: CoreOutcome; diagnostics: readonly DiagnosticRow[] }> {
    const sink = createDiagnosticSink();
    let source: ArchiveSource;
    try {
        source = await openArchiveSource(args, inputPath, { ...commonOptions(args, sink, 'verify'), validate: 'eager' });
    } catch (e) {
        // A structural refusal is the report's `error`, as with verifyZip; a
        // bound keeps its class and its detail (V-03).
        if (!(e instanceof CliError) || e.zipCode === undefined || e.code === ErrorCode.LIMIT) throw e;
        return { core: { ok: false, error: { code: e.zipCode, message: e.message }, entryCount: 0, entries: [] }, diagnostics: sink.diagnostics };
    }
    try {
        const reader = source.reader;
        const targets = names.length > 0
            ? names.map((name) => {
                const entry = guard('Failed to read the central directory', () => reader.getEntry(name));
                if (entry === null) {
                    throw new CliError(`Entry not found: ${name} (run \`zipnative list\` for the exact names).`, 1, ErrorCode.NOT_FOUND, { entryName: name, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
                }
                return entry;
            })
            : guard('Failed to read the central directory', () => [...reader.entries()]);
        const entries: VerifiedEntry[] = [];
        for (const entry of targets) {
            // Both fetch bounds apply under --range (see entryBoundBreach).
            const breach = entryBoundBreach(entry, args, RANGE_BOUNDS);
            if (breach !== null) throw breach;
            try {
                entries.push({ name: entry.name, ...(await reader.verifyEntry(entry)) });
            } catch (e) {
                throw mapZipError(e, `Cannot verify entry "${entry.name}"`, entry.name);
            }
        }
        return { core: { ok: entries.every(entryPasses), error: null, entryCount: reader.entryCount, entries }, diagnostics: sink.diagnostics };
    } finally {
        await source.close();
    }
}

export async function verify(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const format = parseFormat(args, ['text', 'json'] as const, isJsonMode() ? 'json' : 'text');
    const strict = isStrict() || hasFlag(args.flags, 'strict');
    const selected = getStringFlagAll(args.flags, 'entry', 'e');
    // The whole-archive verifyZip takes no name decoder: --name-encoding only
    // decodes the names --entry looks up (a flag never accepted for nothing).
    if (selected.length === 0 && getStringFlag(args.flags, 'name-encoding') !== undefined) {
        throw new CliError('--name-encoding applies to --entry lookups (the whole-archive verification reports names as stored): add --entry <decoded name>.', 2, ErrorCode.USAGE, { remedy: '--entry <decoded name> (or omit --name-encoding)' });
    }

    const inputPath = resolveInputPath(args);
    const { core, diagnostics } = hasFlag(args.flags, 'range')
        ? await verifyRange(args, inputPath, selected)
        : await (async () => {
            const bytes = await readArchiveBytes(inputPath, args);
            return selected.length > 0 ? verifySelected(bytes, args, selected) : verifyAll(bytes, args);
        })();

    // verifyZip's archive rule: a design-time skip with a matching local
    // header passes; everything else that is not ok — corrupt, a mismatching
    // header, an unregistered method — is a failure (zipnative 1.1).
    const failed = core.entries.filter((e) => !entryPasses(e)).length;
    const skipped = core.entries.filter((e) => e.skipped !== undefined && entryPasses(e)).length;
    const strictFail = strict && diagnostics.length > 0;
    const report: VerifyReport = {
        ok: core.ok && !strictFail,
        error: core.error,
        entryCount: core.entryCount,
        entries: core.entries,
        diagnostics,
        failed,
        skipped,
        strict,
        ...(selected.length > 0 ? { selected } : {}),
    };

    if (format === 'json') {
        emitJsonReport(args, report, () => verifySummary(report));
    } else {
        warnTextProjection(args);
        process.stdout.write(escapeTerminal(renderText(report, inputPath ?? '-')));
    }

    if (!report.ok) {
        const total = selected.length > 0 ? selected.length : core.entryCount;
        const reason = core.error !== null
            ? core.error.message
            : strictFail && core.ok
                ? `${diagnostics.length} diagnostic(s) under --strict: ${diagnostics.map((d) => d.code).join(', ')}`
                : `${failed} of ${total} entries failed verification`;
        // The failing names travel with the error, so an agent on --summary
        // learns WHICH entries failed without re-running (capped at 16).
        const failedNames = core.entries.filter((e) => !entryPasses(e)).map((e) => e.name);
        throw new CliError(reason, 1, ErrorCode.VERIFY_FAILED, {
            ...(core.error !== null ? { zipCode: core.error.code } : {}),
            // The strict escalation names its cause like `list --strict` does.
            ...(core.error === null && strictFail && core.ok ? { zipCode: 'ZIP_STRICT_DIAGNOSTIC' } : {}),
            ...(failedNames.length === 1 ? { entryName: failedNames[0] as string } : {}),
            ...(failedNames.length > 0 ? { detail: { failedEntries: failedNames.slice(0, 16).join(', '), failedCount: failedNames.length } } : {}),
        });
    }
}
