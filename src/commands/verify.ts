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

import { type ParsedArgs, getStringFlagAll, hasFlag } from '../utils/args.js';
import { isJsonMode, isStrict } from '../utils/agent.js';
import {
    METHOD_DEFLATE,
    METHOD_STORE,
    getCodec,
    verifyZip,
    type EntryVerification,
    type ZipVerificationReport,
} from '../core-bridge/index.js';
import { createDiagnosticSink, diagnosticRows, type DiagnosticRow } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { parseLimitFlags } from '../utils/limits.js';
import { emitJsonReport } from '../utils/projection.js';
import { guard, mapZipError } from '../utils/ziperr.js';
import { commonOptions, openArchive, parseFormat, readArchiveBytes, resolveInputPath } from '../utils/zipops.js';

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
        if (e.skipped !== undefined) {
            lines.push(`  skip  ${e.name}  (${e.skipped})`);
        } else if (e.ok) {
            lines.push(`  ok    ${e.name}`);
        } else {
            const why = [
                !e.crcMatch ? 'crc' : null,
                !e.sizeMatch ? 'size' : null,
                !e.localHeaderMatch ? 'local-header' : null,
            ].filter((x) => x !== null).join(',');
            lines.push(`  FAIL  ${e.name}  (${why})`);
        }
    }
    for (const d of report.diagnostics) {
        lines.push(`  ${d.severity} [${d.code}]${d.entryName !== undefined ? ` ${d.entryName}:` : ''} ${d.message}`);
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
function verifyAll(bytes: Uint8Array, args: ParsedArgs): { core: CoreOutcome; diagnostics: readonly DiagnosticRow[] } {
    const limits = parseLimitFlags(args);
    // verifyZip only throws for caller bugs (invalid limits) — pre-validated,
    // but still mapped so an unexpected throw carries a proper code.
    const core = guard('Verification failed', () => verifyZip(bytes, limits !== undefined ? { limits } : undefined));
    return { core, diagnostics: diagnosticRows(core.diagnostics) };
}

/**
 * `--entry`: open eagerly (structure first, like `verifyZip`), then
 * `verifyEntry()` each requested name. Encrypted entries and stream-only
 * codecs are `skipped` with the same two reasons the engine reports.
 */
function verifySelected(bytes: Uint8Array, args: ParsedArgs, names: readonly string[]): { core: CoreOutcome; diagnostics: readonly DiagnosticRow[] } {
    const sink = createDiagnosticSink();
    let reader;
    try {
        reader = openArchive(bytes, { ...commonOptions(args, sink), validate: 'eager' });
    } catch (e) {
        if (!(e instanceof CliError)) throw e;
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
            throw new CliError(`Entry not found: ${name}`, 1, ErrorCode.NOT_FOUND, { entryName: name, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
        }
        const custom = entry.compressionMethod !== METHOD_STORE && entry.compressionMethod !== METHOD_DEFLATE;
        const codec = custom ? getCodec(entry.compressionMethod) : null;
        const skipped: VerifiedEntry['skipped'] | undefined = entry.isEncrypted
            ? 'encrypted'
            : custom && codec !== null && codec.decompressSync === undefined
                ? 'stream-only-codec'
                : undefined;
        let v: EntryVerification;
        if (skipped !== undefined) {
            v = { ok: true, crcMatch: true, sizeMatch: true, localHeaderMatch: true };
        } else {
            try {
                v = reader.verifyEntry(entry);
            } catch (e) {
                throw mapZipError(e, `Cannot verify entry "${name}"`, name);
            }
        }
        entries.push({ name: entry.name, ...v, ...(skipped !== undefined ? { skipped } : {}) });
    }
    const ok = entries.every((e) => e.skipped !== undefined || e.ok);
    return {
        core: { ok, error: null, entryCount: reader.entryCount, entries },
        diagnostics: sink.diagnostics,
    };
}

export async function verify(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const format = parseFormat(args, ['text', 'json'] as const, isJsonMode() ? 'json' : 'text');
    const strict = isStrict() || hasFlag(args.flags, 'strict');
    const selected = getStringFlagAll(args.flags, 'entry', 'e');

    const inputPath = resolveInputPath(args);
    const bytes = await readArchiveBytes(inputPath, args);
    const { core, diagnostics } = selected.length > 0 ? verifySelected(bytes, args, selected) : verifyAll(bytes, args);

    const failed = core.entries.filter((e) => e.skipped === undefined && !e.ok).length;
    const skipped = core.entries.filter((e) => e.skipped !== undefined).length;
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
        process.stdout.write(renderText(report, inputPath ?? '-'));
    }

    if (!report.ok) {
        const total = selected.length > 0 ? selected.length : core.entryCount;
        const reason = core.error !== null
            ? core.error.message
            : strictFail && core.ok
                ? `${diagnostics.length} diagnostic(s) under --strict: ${diagnostics.map((d) => d.code).join(', ')}`
                : `${failed} of ${total} entries failed verification`;
        throw new CliError(
            format === 'json' ? reason : '',
            1,
            ErrorCode.VERIFY_FAILED,
            core.error !== null ? { zipCode: core.error.code } : undefined,
        );
    }
}
