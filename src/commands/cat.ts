// `zipnative cat` — stream one or more entries to stdout (or `--output`).
//
// Random access: only the named entries are located and decompressed, chunk
// by chunk (`readEntryStream`), so a single file from a multi-gigabyte
// archive never materialises the rest. `--raw` writes the COMPRESSED payload
// zero-copy (`readEntryRaw`). CRC is verified at the end of the stream, so —
// exactly like `unzip -p` — stdout may already carry bytes when `E_DATA`
// fires; with `--output` the partial file is removed.

import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from '../utils/args.js';
import { emitStatus, isDryRun } from '../utils/agent.js';
import { METHOD_DEFLATE, METHOD_STORE, getCodec, type ZipEntry } from '../core-bridge/index.js';
import { createDiagnosticSink } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { unlinkQuiet, writeStreamingOutput } from '../utils/io.js';
import { mapZipError } from '../utils/ziperr.js';
import { commonOptions, openArchive, readArchiveBytes } from '../utils/zipops.js';

/** True for a `--codec` method that decompresses synchronously only. */
function isSyncOnlyCodec(method: number): boolean {
    if (method === METHOD_STORE || method === METHOD_DEFLATE) return false;
    const codec = getCodec(method);
    return codec !== null && codec.decompressStream === undefined && codec.decompressSync !== undefined;
}

export async function cat(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);

    // `cat --input a.zip --entry x` | `cat a.zip x [y…]` | `cat --input a.zip x`
    const inputFlag = getStringFlag(args.flags, 'input', 'i');
    const inputPath = inputFlag ?? args.positionals[0];
    const names = [
        ...getStringFlagAll(args.flags, 'entry', 'e'),
        ...(inputFlag !== undefined ? args.positionals : args.positionals.slice(1)),
    ];
    if (inputPath === undefined) {
        throw new CliError('cat requires an archive: --input <file> (or a positional path).', 2);
    }
    if (names.length === 0) {
        throw new CliError('cat requires at least one entry name: --entry <name> (or positionals after the archive).', 2);
    }
    const outputPath = getStringFlag(args.flags, 'output', 'o');
    const raw = hasFlag(args.flags, 'raw');
    const verifyCrc = !hasFlag(args.flags, 'no-verify-crc');
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();

    const bytes = await readArchiveBytes(inputPath, args);
    const sink = createDiagnosticSink();
    const reader = openArchive(bytes, commonOptions(args, sink));

    const entries: ZipEntry[] = [];
    for (const name of names) {
        let entry: ZipEntry | null;
        try {
            entry = reader.getEntry(name);
        } catch (e) {
            throw mapZipError(e, 'Failed to read the central directory');
        }
        if (entry === null) {
            throw new CliError(`Entry not found: ${name} (run \`zipnative list\` for the exact names).`, 1, ErrorCode.NOT_FOUND, { entryName: name, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
        }
        if (entry.isDirectory) {
            throw new CliError(`"${name}" is a directory entry — nothing to output.`, 1, ErrorCode.INPUT, { entryName: name });
        }
        entries.push(entry);
    }

    if (dryRun) {
        emitStatus({
            command: 'cat',
            dryRun: true,
            entries: entries.map((e) => e.name),
            bytes: entries.reduce((n, e) => n + (raw ? e.compressedSize : e.uncompressedSize), 0),
            raw,
            verifyCrc,
            ...sink.field(),
        });
        return;
    }

    let current = '';
    async function* chunks(): AsyncGenerator<Uint8Array, void, undefined> {
        for (const entry of entries) {
            current = entry.name;
            if (raw) {
                yield reader.readEntryRaw(entry);
            } else if (isSyncOnlyCodec(entry.compressionMethod)) {
                // A registered codec with decompressSync but no decompressStream
                // cannot feed readEntryStream(); readEntry() buffers this one entry.
                yield reader.readEntry(entry, { verifyCrc });
            } else {
                for await (const chunk of reader.readEntryStream(entry, { verifyCrc })) yield chunk;
            }
        }
    }

    let written = 0;
    try {
        written = await writeStreamingOutput(chunks(), outputPath, { exclusive: !hasFlag(args.flags, 'overwrite') });
    } catch (e) {
        if (e instanceof CliError && e.code === ErrorCode.IO) throw e; // overwrite refusal: the existing file is untouched
        if (outputPath !== undefined) await unlinkQuiet(outputPath);
        throw mapZipError(e, `Failed to read entry "${current}"`, current);
    }

    emitStatus({
        command: 'cat',
        dryRun: false,
        output: outputPath ?? '-',
        entries: entries.map((e) => e.name),
        bytes: written,
        raw,
        verifyCrc,
        ...sink.field(),
    });
}
