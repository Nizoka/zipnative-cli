// `zipnative verify` — one-call deep integrity verification through
// zipnative's `verifyZip`: eager structural validation, per-entry CRC-32 /
// size / local-header agreement, diagnostics collected. The core NEVER throws
// for archive problems — a structural refusal lands in `report.error` — so
// the report is always the artefact and the exit code is the verdict:
//
//   ok            → exit 0
//   !ok           → exit 1, E_VERIFY_FAILED (zipCode = report.error.code when set)
//   --strict      → additionally fail when any diagnostic was emitted

import { type ParsedArgs, hasFlag } from '../utils/args.js';
import { isJsonMode, isStrict } from '../utils/agent.js';
import { verifyZip, type ZipVerificationReport } from '../core-bridge/index.js';
import { diagnosticRows, type DiagnosticRow } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { parseLimitFlags } from '../utils/limits.js';
import { emitJsonReport } from '../utils/projection.js';
import { guard } from '../utils/ziperr.js';
import { parseFormat, readArchiveBytes, resolveInputPath } from '../utils/zipops.js';

export interface VerifyReport {
    readonly ok: boolean;
    readonly error: { readonly code: string; readonly message: string } | null;
    readonly entryCount: number;
    readonly entries: ZipVerificationReport['entries'];
    readonly diagnostics: readonly DiagnosticRow[];
    readonly failed: number;
    readonly skipped: number;
    readonly strict: boolean;
}

export function verifySummary(report: VerifyReport): Record<string, unknown> {
    return {
        ok: report.ok,
        entries: report.entryCount,
        failed: report.failed,
        skipped: report.skipped,
        diagnostics: report.diagnostics.length,
        ...(report.error !== null ? { error: report.error.code } : {}),
    };
}

function renderText(report: VerifyReport, source: string): string {
    const lines: string[] = [`Verify: ${source}`];
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
    const verdict = report.ok
        ? `OK: ${report.entryCount} entries, ${report.skipped} skipped, ${report.diagnostics.length} diagnostics`
        : `FAILED: ${report.failed} failed of ${report.entryCount} entries${report.error !== null ? ` (${report.error.code})` : ''}`;
    lines.push(verdict);
    return lines.join('\n') + '\n';
}

export async function verify(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const format = parseFormat(args, ['text', 'json'] as const, isJsonMode() ? 'json' : 'text');
    const strict = isStrict() || hasFlag(args.flags, 'strict');
    const limits = parseLimitFlags(args);

    const inputPath = resolveInputPath(args);
    const bytes = await readArchiveBytes(inputPath, args);
    // verifyZip only throws for caller bugs (invalid limits) — pre-validated,
    // but still mapped so an unexpected throw carries a proper code.
    const core = guard('Verification failed', () => verifyZip(bytes, limits !== undefined ? { limits } : undefined));

    const failed = core.entries.filter((e) => e.skipped === undefined && !e.ok).length;
    const skipped = core.entries.filter((e) => e.skipped !== undefined).length;
    const diagnostics = diagnosticRows(core.diagnostics);
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
    };

    if (format === 'json') {
        emitJsonReport(args, report, () => verifySummary(report));
    } else {
        process.stdout.write(renderText(report, inputPath ?? '-'));
    }

    if (!report.ok) {
        const reason = core.error !== null
            ? core.error.message
            : strictFail && core.ok
                ? `${diagnostics.length} diagnostic(s) under --strict: ${diagnostics.map((d) => d.code).join(', ')}`
                : `${failed} of ${core.entryCount} entries failed verification`;
        throw new CliError(
            format === 'json' ? reason : '',
            1,
            ErrorCode.VERIFY_FAILED,
            core.error !== null ? { zipCode: core.error.code } : undefined,
        );
    }
}
