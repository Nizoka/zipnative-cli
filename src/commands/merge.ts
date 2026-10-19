// `zipnative merge` — combine archives (or split one with filters) without
// recompressing anything: zipnative 1.1 `ZipWriter.addFromReader()`
// transplants each entry's COMPRESSED bytes with its method, CRC, sizes,
// timestamp, attributes, comment and extra fields (Zip64 recomputed).
//
//   merge a.zip b.zip -o all.zip              ten archives into one, O(bytes copied)
//   merge a.zip --include 'docs/**' -o d.zip  "split": a filtered copy of one archive
//
// Security posture (docs/adr/0012):
//   • every source is opened EAGERLY (overlap / CD↔LFH structure first) and
//     bounded by --max-input-size;
//   • every transplanted entry is VERIFIED first (`verify: true` — CRC and
//     size, one decompress pass): a lying source is refused, never laundered,
//     with no opt-out (the `modify` rule);
//   • an entry name met twice is refused (`--on-duplicate first|last` picks
//     one); a directory entry met twice is one directory;
//   • an encrypted entry cannot be checked: refused (E_UNSUPPORTED), or
//     skipped with --skip-unsupported (skip, never write unverified bytes).

import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from '../utils/args.js';
import { emitStatus, isDryRun, progress } from '../utils/agent.js';
import { createDiagnosticSink } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { writeOutput } from '../utils/io.js';
import { guard, mapZipError } from '../utils/ziperr.js';
import {
    commonOptions,
    openArchive,
    parseArchiveComment,
    parseNameFilter,
    parseOnDuplicate,
    readArchiveBytes,
} from '../utils/zipops.js';
import { createZip, getCodec, type ZipEntry, type ZipReader } from '../core-bridge/index.js';

interface Planned {
    readonly reader: ZipReader;
    readonly entry: ZipEntry;
    readonly input: string;
}

function parseMergeOrder(args: ParsedArgs): 'canonical' | 'insertion' {
    const raw = getStringFlag(args.flags, 'order') ?? 'canonical';
    if (raw !== 'canonical' && raw !== 'insertion') {
        throw new CliError(`--order must be "canonical" or "insertion", got "${raw}".`, 2);
    }
    return raw;
}

export async function merge(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const inputs = [...getStringFlagAll(args.flags, 'input', 'i'), ...args.positionals];
    if (inputs.length === 0) throw new CliError('merge requires at least one archive (positional or --input).', 2);
    if (inputs.filter((i) => i === '-').length > 1) throw new CliError('stdin can only be read once.', 2);
    const outputPath = getStringFlag(args.flags, 'output', 'o');
    if (outputPath === undefined) throw new CliError('merge requires --output <file> (or -o - for stdout).', 2);
    const filter = parseNameFilter(args);
    const onDuplicate = parseOnDuplicate(args);
    const order = parseMergeOrder(args);
    const skipUnsupported = hasFlag(args.flags, 'skip-unsupported');
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();
    if (inputs.includes('-') && getStringFlag(args.flags, 'comment-file') === '-') throw new CliError('stdin can only be read once (an input and --comment-file both name "-").', 2);
    const comment = await parseArchiveComment(args);

    const sink = createDiagnosticSink();
    const common = commonOptions(args, sink, 'merge');

    // ── Plan: one name → one source entry (the duplicate policy decides).
    const plan = new Map<string, Planned>();
    const skipped: { name: string; input: string; reason: 'filtered' | 'duplicate' | 'unsupported' }[] = [];
    for (const input of inputs) {
        const bytes = await readArchiveBytes(input, args);
        const reader = openArchive(bytes, { ...common, validate: 'eager' });
        const entries = guard('Failed to read the central directory', () => [...reader.entries()]);
        for (const entry of entries) {
            if (filter !== undefined && !filter(entry.name)) {
                skipped.push({ name: entry.name, input, reason: 'filtered' });
                continue;
            }
            if (entry.isEncrypted) {
                if (skipUnsupported) { skipped.push({ name: entry.name, input, reason: 'unsupported' }); continue; }
                throw new CliError(
                    `Entry "${entry.name}" of ${input} is encrypted: its payload cannot be verified before it is copied (pass --skip-unsupported to leave it out).`,
                    1,
                    ErrorCode.UNSUPPORTED,
                    { entryName: entry.name, zipCode: 'ZIP_UNSUPPORTED_ENCRYPTION', remedy: '--skip-unsupported' },
                );
            }
            // No registered codec: the engine would copy the bytes UNVERIFIED —
            // refused like `modify` refuses it (E_UNSUPPORTED), or skipped.
            if (!entry.isDirectory && getCodec(entry.compressionMethod) === null) {
                if (skipUnsupported) { skipped.push({ name: entry.name, input, reason: 'unsupported' }); continue; }
                throw new CliError(
                    `Entry "${entry.name}" of ${input} uses compression method ${entry.compressionMethod}, which no registered codec decodes: it cannot be verified before it is copied (pass --skip-unsupported, or --codec <module>).`,
                    1,
                    ErrorCode.UNSUPPORTED,
                    { entryName: entry.name, zipCode: 'ZIP_UNSUPPORTED_METHOD', remedy: '--skip-unsupported' },
                );
            }
            const prior = plan.get(entry.name);
            if (prior !== undefined) {
                if (entry.isDirectory && prior.entry.isDirectory) continue; // one directory
                if (onDuplicate === 'error') {
                    throw new CliError(
                        prior.input === input && prior.reader === reader
                            ? `Entry "${entry.name}" appears twice in ${input}: refusing to pick one silently (pass --on-duplicate first|last).`
                            : `Entry "${entry.name}" is in ${prior.input} and in ${input}: refusing to pick one silently (pass --on-duplicate first|last).`,
                        1,
                        ErrorCode.INPUT,
                        { entryName: entry.name, remedy: '--on-duplicate first|last' },
                    );
                }
                skipped.push({ name: entry.name, input: onDuplicate === 'first' ? input : prior.input, reason: 'duplicate' });
                if (onDuplicate === 'first') continue;
                plan.delete(entry.name); // 'last': re-inserted below, in its new position
            }
            plan.set(entry.name, { reader, entry, input });
        }
    }

    // ── Transplant (verified) — also under --dry-run, so the plan is proven.
    const writer = createZip({ ...common, order, ...(typeof comment === 'string' ? { comment } : {}) });
    if (comment instanceof Uint8Array) {
        try { writer.setComment(comment); } catch (e) { throw mapZipError(e, 'Failed to set the archive comment'); }
    }
    for (const p of plan.values()) {
        try {
            writer.addFromReader(p.reader, p.entry, { verify: true });
        } catch (e) {
            throw mapZipError(e, `Failed to copy "${p.entry.name}" from ${p.input}`, p.entry.name);
        }
    }
    const directories = [...plan.values()].filter((p) => p.entry.isDirectory).length;
    const summary = {
        command: 'merge',
        output: outputPath,
        inputs: inputs.length,
        entries: plan.size,
        files: plan.size - directories,
        directories,
        order,
        layout: 'buffered',
        skipped,
    };
    if (dryRun) {
        emitStatus({ ...summary, dryRun: true, ...sink.field() });
        return;
    }
    for (const s of skipped) {
        if (s.reason !== 'filtered') progress(`warning: skipped ${s.name} from ${s.input} (${s.reason})`);
    }
    const out = guard('Failed to assemble the merged archive', () => writer.toBytes());
    try {
        await writeOutput(out, outputPath, { exclusive: !hasFlag(args.flags, 'overwrite') });
    } catch (e) {
        throw mapZipError(e, 'Failed to write the merged archive');
    }
    emitStatus({ ...summary, dryRun: false, bytes: out.length, ...sink.field() });
}
