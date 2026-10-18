// Diagnostics bridge — the CLI owns stderr, so the core never gets to use its
// deduplicated `console.warn` default. Every core call receives the sink's
// `onDiagnostic`; the sink decides how to present:
//
//   • text mode  — one `warning: [CODE] message` / `info: [CODE] message` line
//                  on stderr per (code, entryName), suppressed by `--quiet`;
//   • `--json`   — nothing per diagnostic; the collected array travels in the
//                  success envelope (`emitStatus({..., ...sink.field()})`) or in
//                  the stdout report's `diagnostics` field;
//   • `--strict` — handled by the core itself (`strict: true` → the first
//                  diagnostic throws ZIP_STRICT_DIAGNOSTIC → E_CHECK_FAILED).

import type { ZipDiagnostic, ZipDiagnosticHandler } from '../core-bridge/index.js';
import { isJsonMode, isQuiet } from './agent.js';
import { escapeTerminal } from './sanitize.js';

export interface DiagnosticRow {
    readonly code: string;
    readonly severity: 'warning' | 'info';
    readonly message: string;
    readonly entryName?: string;
}

export interface DiagnosticSink {
    /** Pass to every core call as `onDiagnostic`. */
    readonly onDiagnostic: ZipDiagnosticHandler;
    /** Everything received so far (deduplicated by code + entryName). */
    readonly diagnostics: readonly DiagnosticRow[];
    /** `{ diagnostics: [...] }` for envelope / report spreading. */
    field(): { readonly diagnostics: readonly DiagnosticRow[] };
    /** Number of diagnostics received (after dedup). */
    readonly count: number;
}

function toRow(d: ZipDiagnostic): DiagnosticRow {
    return {
        code: d.code,
        severity: d.severity,
        message: d.message,
        ...(d.entryName !== undefined ? { entryName: d.entryName } : {}),
    };
}

/**
 * Create a diagnostic sink for one command invocation.
 *
 * @param silent  when true, never writes text lines (used by callers that
 *                render diagnostics themselves, e.g. NDJSON list output).
 */
export function createDiagnosticSink(silent = false): DiagnosticSink {
    const rows: DiagnosticRow[] = [];
    const seen = new Set<string>();
    const onDiagnostic: ZipDiagnosticHandler = (d) => {
        // NUL separator, written as an escape so the source stays plain text.
        const key = `${d.code}\u0000${d.entryName ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        const row = toRow(d);
        rows.push(row);
        if (!silent && !isJsonMode() && !isQuiet()) {
            process.stderr.write(formatDiagnosticLine(row) + '\n');
        }
    };
    return {
        onDiagnostic,
        get diagnostics(): readonly DiagnosticRow[] {
            return rows;
        },
        get count(): number {
            return rows.length;
        },
        field() {
            return { diagnostics: rows };
        },
    };
}

/**
 * The one text form of a diagnostic — `severity: [CODE] entry 'name': message`
 * — shared by the sink, the NDJSON listings (`list`, `stream`) and the text
 * reports, so an agent can match every stderr diagnostic with one pattern.
 */
export function formatDiagnosticLine(row: DiagnosticRow): string {
    const where = row.entryName !== undefined ? ` entry '${row.entryName}':` : '';
    // A text line: the entry name and the engine message quote archive bytes.
    return escapeTerminal(`${row.severity}: [${row.code}]${where} ${row.message}`);
}

/** Render already-collected diagnostics (e.g. from a `verifyZip` report) as rows. */
export function diagnosticRows(list: readonly ZipDiagnostic[]): DiagnosticRow[] {
    return list.map(toRow);
}
