// `zipnative canonicalize` — rewrite an archive from ANY producer into
// zipnative's canonical deterministic form (zipnative 1.1 `canonicalizeZip`),
// the "fix" half of `inspect --check canonical-form`.
//
// No recompression: every payload is copied bit for bit, so an encrypted or a
// corrupt entry travels unchanged (nothing is decoded — run `verify` first
// when integrity matters). What changes is everything around the payloads:
// timestamps pinned (the DOS epoch, or --date), entries sorted by raw name
// bytes, names re-encoded as UTF-8 with flag bit 11, extra fields and
// comments dropped (Zip64 recomputed; --keep-comments keeps the comments),
// version-made-by and internal attributes constant, external attributes kept
// unless --normalize-modes. Canonicalising twice yields the same bytes.
//
// Envelope: { output, entries, bytes, changed, deterministic, canonicalForm }
// — the last two are `analyzeDeterminism()` on the OUTPUT, so the agent reads
// the proof, not the promise.

import { type ParsedArgs, getStringFlag, hasFlag } from '../utils/args.js';
import { emitStatus, isDryRun } from '../utils/agent.js';
import { createDiagnosticSink } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError } from '../utils/error.js';
import { writeOutput } from '../utils/io.js';
import { guard, mapZipError } from '../utils/ziperr.js';
import { commonOptions, openArchive, parseIsoDateUtc, readArchiveBytes, resolveInputPath } from '../utils/zipops.js';
import { analyzeDeterminism, canonicalizeZip } from '../core-bridge/index.js';

/** `--date epoch|<ISO 8601>` → the canonical timestamp (undefined = the DOS epoch). `now` would not be canonical. */
export function parseCanonicalDate(args: ParsedArgs): Date | undefined {
    const raw = getStringFlag(args.flags, 'date');
    if (raw === undefined || raw === 'epoch') return undefined;
    if (raw === 'now') {
        throw new CliError('--date now is not a canonical form (the bytes would change with every run): pass epoch (the default) or an ISO 8601 date.', 2);
    }
    return parseIsoDateUtc(raw, '--date');
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export async function canonicalize(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const outputPath = getStringFlag(args.flags, 'output', 'o');
    if (outputPath === undefined) {
        throw new CliError('canonicalize requires --output <file> (or -o - for stdout).', 2);
    }
    const date = parseCanonicalDate(args);
    const keepComments = hasFlag(args.flags, 'keep-comments');
    const keepExternalAttributes = !hasFlag(args.flags, 'normalize-modes');
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();

    const bytes = await readArchiveBytes(resolveInputPath(args), args);
    const sink = createDiagnosticSink();
    const common = commonOptions(args, sink, 'canonicalize');
    // Structure first (eager): a hostile layout is refused with its own code
    // before anything is rewritten.
    const reader = openArchive(bytes, { ...common, validate: 'eager' });
    const entries = reader.entryCount;

    const out = guard('Failed to canonicalize the archive', () => canonicalizeZip(bytes, {
        ...common,
        keepComments,
        keepExternalAttributes,
        ...(date !== undefined ? { date } : {}),
    }));
    const report = guard('Failed to analyse the canonical archive', () => analyzeDeterminism(out, date !== undefined ? { date } : undefined));
    const summary = {
        command: 'canonicalize',
        output: outputPath,
        entries,
        bytes: out.length,
        changed: !sameBytes(out, bytes),
        // The same two verdicts `inspect` reports (reproducibility; the engine's full form).
        deterministic: report.epochTimestamps && report.canonicalOrder && report.utf8Flags,
        canonicalForm: report.deterministic,
    };

    if (dryRun) {
        emitStatus({ ...summary, dryRun: true, ...sink.field() });
        return;
    }
    try {
        await writeOutput(out, outputPath, { exclusive: !hasFlag(args.flags, 'overwrite') });
    } catch (e) {
        throw mapZipError(e, 'Failed to write the canonical archive');
    }
    emitStatus({ ...summary, dryRun: false, ...sink.field() });
}
