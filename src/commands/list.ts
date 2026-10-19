// `zipnative list` — entry listing through zipnative's random-access reader.
// Nothing is decompressed: `openZip` validates the end-of-central-directory
// structures and the central directory is parsed on first access.
//
//   text   (default)  an `unzip -l`-style table (`--long` adds mode/flags)
//   json              { archive, entries: [EntryRow], diagnostics }
//   ndjson            one EntryRow per line (RAG / streaming consumers)

import { type ParsedArgs, getStringFlag, hasFlag } from '../utils/args.js';
import { isJsonMode, progress } from '../utils/agent.js';
import { createDiagnosticSink, formatDiagnosticLine } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError } from '../utils/error.js';
import { rowFromEntry, renderTable, type EntryRow } from '../utils/entryfmt.js';
import { escapeTerminal } from '../utils/sanitize.js';
import { emitJsonReport, serializeJson, warnTextProjection } from '../utils/projection.js';
import { guard } from '../utils/ziperr.js';
import {
    commonOptions,
    bytesToHex,
    decodeComment,
    type ArchiveReader,
    openArchiveSource,
    parseFormat,
    parseNameFilter,
    resolveInputPath,
} from '../utils/zipops.js';

export interface ListReport {
    readonly archive: {
        readonly bytes: number;
        readonly entryCount: number;
        readonly isZip64: boolean;
        readonly comment: string;
        readonly commentBytes: number;
        /** Raw comment bytes, hex — present when the archive has a comment. */
        readonly commentHex?: string;
    };
    readonly entries: readonly EntryRow[];
    readonly diagnostics: readonly unknown[];
}

export function listSummary(report: ListReport): Record<string, unknown> {
    let files = 0;
    let directories = 0;
    let compressedSize = 0;
    let uncompressedSize = 0;
    let encrypted = 0;
    for (const e of report.entries) {
        if (e.isDirectory) directories++;
        else files++;
        compressedSize += e.compressedSize;
        uncompressedSize += e.uncompressedSize;
        if (e.isEncrypted) encrypted++;
    }
    return {
        entries: report.entries.length,
        files,
        directories,
        compressedSize,
        uncompressedSize,
        // The Zip64 EOCD record and the entries carrying a Zip64 extra field:
        // a streamed --zip64 archive has the second without the first.
        zip64: report.archive.isZip64,
        zip64Entries: report.entries.filter((e) => e.usesZip64 === true).length,
        encrypted,
    };
}

export async function list(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const format = parseFormat(args, ['text', 'json', 'ndjson'] as const, isJsonMode() ? 'json' : 'text');
    const validate = getStringFlag(args.flags, 'validate');
    if (validate !== undefined && validate !== 'lazy' && validate !== 'eager') {
        throw new CliError(`--validate must be "lazy" or "eager", got "${validate}".`, 2);
    }
    const long = hasFlag(args.flags, 'long');
    const filter = parseNameFilter(args);

    const sink = createDiagnosticSink(format === 'ndjson' && isJsonMode());
    // Buffered by default; --range reads the archive by byte ranges (never whole).
    const source = await openArchiveSource(args, resolveInputPath(args), {
        ...commonOptions(args, sink, 'list'),
        ...(validate !== undefined ? { validate } : {}),
    });
    try {
        render(args, source.reader, source.size, { format, long, filter, sink });
    } finally {
        await source.close();
    }
}

function render(
    args: ParsedArgs,
    reader: ArchiveReader,
    size: number,
    o: { readonly format: 'text' | 'json' | 'ndjson'; readonly long: boolean; readonly filter: ReturnType<typeof parseNameFilter>; readonly sink: ReturnType<typeof createDiagnosticSink> },
): void {
    const { format, long, filter, sink } = o;

    const rows: EntryRow[] = guard('Failed to read the central directory', () => {
        const out: EntryRow[] = [];
        for (const entry of reader.entries()) {
            if (filter !== undefined && !filter(entry.name)) continue;
            out.push(rowFromEntry(entry, { long }));
        }
        return out;
    });

    if (format === 'text') {
        warnTextProjection(args);
        process.stdout.write(escapeTerminal(renderTable(rows, long)));
        return;
    }

    if (format === 'ndjson') {
        // NDJSON rows are complete: the projection flags shape the JSON report
        // only, and a silent no-op would hide that (release audit D-25).
        const ignored = ['summary', 'fields'].filter((f) => args.flags[f] !== undefined && args.flags[f] !== false);
        if (ignored.length > 0) progress(`warning: ${ignored.map((f) => `--${f}`).join(' and ')} shape the JSON report only; NDJSON rows are complete (use --format json).`);
        for (const row of rows) process.stdout.write(serializeJson(row, false) + '\n');
        // No wrapper to carry diagnostics: surface them as text on stderr
        // (progress lines — suppressed by --quiet like every other text line).
        if (isJsonMode()) {
            for (const d of sink.diagnostics) progress(formatDiagnosticLine(d));
        }
        return;
    }

    const report: ListReport = {
        archive: {
            bytes: size,
            entryCount: reader.entryCount,
            isZip64: reader.isZip64,
            comment: decodeComment(reader.comment),
            commentBytes: reader.comment.length,
            ...(reader.comment.length > 0 ? { commentHex: bytesToHex(reader.comment) } : {}),
        },
        entries: rows,
        diagnostics: sink.diagnostics,
    };
    emitJsonReport(args, report, () => listSummary(report));
}
