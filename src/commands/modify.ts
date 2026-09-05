// `zipnative modify` — incremental edits through zipnative's modifier.
//
// Untouched entries are NEVER recompressed. Two save layouts:
//   • append-only (default) `save()`   — original bytes verbatim + appended
//     entries + a new central directory. Removed / replaced content REMAINS
//     in the file (data remanence) and 7-Zip's CLI is known to mis-read this
//     layout; the CLI prints one `info:` line whenever it matters.
//   • compact `--compact` `saveCompact()` — canonical rewrite, true deletion,
//     still no recompression.
//
// Edits are applied in a FIXED order regardless of argv order (the parser
// does not preserve relative order across flags):
//     remove → rename → replace → add / add-dir → comment

import { randomBytes } from 'node:crypto';
import { readFile, rename as fsRename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from '../utils/args.js';
import { emitStatus, isDryRun, progress } from '../utils/agent.js';
import {
    METHOD_DEFLATE,
    METHOD_STORE,
    activeDeflateTier,
    createZipModifier,
    getCodec,
    sanitizeEntryPath,
    type AddEntryOptions,
    type EntryVerification,
    type ZipCompressionOptions,
    type ZipEntry,
    type ZipExtraField,
    type ZipModifierOptions,
    type ZipReader,
} from '../core-bridge/index.js';
import { createDiagnosticSink } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { readJsonInput, readStdin, unlinkQuiet, validatePath, writeOutput } from '../utils/io.js';
import { mapZipError } from '../utils/ziperr.js';
import {
    commonOptions,
    describeComment,
    externalAttributesFor,
    openArchive,
    parseArchiveComment,
    parseCompression,
    parseDateFlag,
    parseExtraFields,
    parseFromEqualsTo,
    parseIsoDateUtc,
    parseManifestComment,
    parseMode,
    parseNameEqualsPath,
    readArchiveBytes,
} from '../utils/zipops.js';

type Op = 'remove' | 'rename' | 'replace' | 'add' | 'add-dir' | 'comment';

interface Edit {
    readonly op: Op;
    readonly name: string;
    readonly to?: string;
    readonly path?: string;
    readonly data?: Uint8Array;
    readonly options?: AddEntryOptions;
}

const ORDER: readonly Op[] = ['remove', 'rename', 'replace', 'add', 'add-dir', 'comment'];

/** An entry NAME is data (E_INPUT), not a mis-typed flag (E_USAGE). */
function assertSafeName(name: string, flag: string): void {
    const bare = name.endsWith('/') ? name.slice(0, -1) : name;
    if (bare.length === 0 || sanitizeEntryPath(bare) === null) {
        throw new CliError(
            `--${flag}: "${name}" would not be extractable safely (traversal, absolute, drive/UNC, reserved device name or empty segment); use a plain relative name.`,
            1,
            ErrorCode.INPUT,
            { entryName: name },
        );
    }
}

/** `--add dir/=payload` is a contradiction: a directory entry carries no payload. */
function assertFileName(name: string, flag: string): void {
    if (name.endsWith('/')) {
        throw new CliError(
            `--${flag}: "${name}" names a directory (trailing "/") but carries a payload; use --add-dir ${name} for an empty directory entry, or drop the trailing slash.`,
            1,
            ErrorCode.INPUT,
            { entryName: name },
        );
    }
}

async function loadPayload(path: string, baseDir: string | undefined, stdinUsed: { used: boolean }): Promise<Uint8Array> {
    if (path === '-') {
        if (stdinUsed.used) throw new CliError('stdin can only be consumed once.', 2);
        stdinUsed.used = true;
        const buf = await readStdin();
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    // A manifest-supplied path is data, not the user: traversal-checked.
    if (baseDir !== undefined) validatePath(path);
    const abs = baseDir !== undefined ? resolve(baseDir, path) : resolve(path);
    try {
        const st = await stat(abs);
        if (!st.isFile()) throw new CliError(`"${path}" is not a regular file; a payload must be a file (use --add-dir for a directory entry).`, 1, ErrorCode.INPUT);
        const buf = await readFile(abs);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (e) {
        if (e instanceof CliError) throw e;
        throw new CliError(`Cannot read "${path}": ${e instanceof Error ? e.message : String(e)}`, 1, ErrorCode.IO);
    }
}

interface EntryExtras {
    readonly comment?: string;
    readonly date?: Date;
    readonly externalAttributes?: number;
    readonly extraFields?: readonly ZipExtraField[];
}

function entryOptions(compression: ZipCompressionOptions | undefined, extras: EntryExtras = {}): AddEntryOptions | undefined {
    const out: { -readonly [K in keyof AddEntryOptions]: AddEntryOptions[K] } = {};
    if (compression !== undefined) out.compression = compression;
    if (extras.comment !== undefined) out.comment = extras.comment;
    if (extras.date !== undefined) out.date = extras.date;
    if (extras.externalAttributes !== undefined) out.externalAttributes = extras.externalAttributes;
    if (extras.extraFields !== undefined) out.extraFields = extras.extraFields;
    return Object.keys(out).length > 0 ? out : undefined;
}

const MANIFEST_KEYS = new Set(['version', 'comment', 'commentBase64', 'edits']);
const EDIT_KEYS = new Set(['op', 'name', 'to', 'path', 'data', 'dataBase64', 'method', 'level', 'deterministic', 'date', 'comment', 'mode', 'extraFields']);

async function editsFromManifest(manifestPath: string, stdinUsed: { used: boolean }): Promise<{ edits: Edit[]; comment: string | Uint8Array | undefined }> {
    const parsed = await readJsonInput(manifestPath, 'manifest');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CliError('--from-manifest must be a JSON object: { "edits": [...] }.', 1, ErrorCode.INPUT);
    }
    const m = parsed as Record<string, unknown>;
    for (const key of Object.keys(m)) {
        if (!MANIFEST_KEYS.has(key)) throw new CliError(`Unknown key "${key}" in manifest. Valid: ${[...MANIFEST_KEYS].join(', ')}.`, 1, ErrorCode.INPUT);
    }
    if (m['version'] !== undefined && m['version'] !== 1) {
        throw new CliError(`Unsupported manifest version ${JSON.stringify(m['version'])} (expected 1).`, 1, ErrorCode.INPUT);
    }
    if (!Array.isArray(m['edits'])) throw new CliError('Manifest "edits" must be an array.', 1, ErrorCode.INPUT);
    const archiveComment = parseManifestComment(m, 'manifest');
    const baseDir = manifestPath === '-' ? process.cwd() : dirname(resolve(manifestPath));

    const edits: Edit[] = [];
    let index = 0;
    for (const item of m['edits'] as unknown[]) {
        const where = `edits[${index}]`;
        index++;
        if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new CliError(`${where}: must be an object.`, 1, ErrorCode.INPUT);
        const e = item as Record<string, unknown>;
        for (const key of Object.keys(e)) {
            if (!EDIT_KEYS.has(key)) throw new CliError(`${where}: unknown key "${key}".`, 1, ErrorCode.INPUT);
        }
        const op = e['op'];
        if (op !== 'add' && op !== 'replace' && op !== 'remove' && op !== 'rename' && op !== 'add-dir') {
            throw new CliError(`${where}: "op" must be add, replace, remove, rename or add-dir.`, 1, ErrorCode.INPUT);
        }
        if (typeof e['name'] !== 'string' || e['name'].length === 0) throw new CliError(`${where}: "name" is required.`, 1, ErrorCode.INPUT);
        const name = e['name'];
        if (op === 'add' || op === 'add-dir' || op === 'rename') {
            const target = op === 'rename' ? e['to'] : name;
            if (typeof target !== 'string' || target.length === 0) throw new CliError(`${where}: "to" is required for rename.`, 1, ErrorCode.INPUT);
            const bare = target.endsWith('/') ? target.slice(0, -1) : target;
            if (sanitizeEntryPath(bare) === null) throw new CliError(`${where}: "${target}" would not be extractable safely (traversal, absolute, drive/UNC, reserved device name or empty segment); use a plain relative name.`, 1, ErrorCode.INPUT, { entryName: target });
        }
        const compression: { method?: 'store' | 'deflate'; level?: number; deterministic?: boolean } = {};
        if (e['method'] !== undefined) {
            if (e['method'] !== 'store' && e['method'] !== 'deflate') throw new CliError(`${where}: "method" must be "store" or "deflate".`, 1, ErrorCode.INPUT);
            compression.method = e['method'];
        }
        if (e['level'] !== undefined) {
            if (!Number.isInteger(e['level']) || (e['level'] as number) < 0 || (e['level'] as number) > 9) throw new CliError(`${where}: "level" must be an integer from 0 to 9.`, 1, ErrorCode.INPUT);
            compression.level = e['level'] as number;
        }
        if (e['deterministic'] !== undefined) {
            if (typeof e['deterministic'] !== 'boolean') throw new CliError(`${where}: "deterministic" must be a boolean.`, 1, ErrorCode.INPUT);
            compression.deterministic = e['deterministic'];
        }
        let date: Date | undefined;
        if (e['date'] !== undefined) {
            if (typeof e['date'] !== 'string') throw new CliError(`${where}: "date" must be an ISO 8601 string.`, 1, ErrorCode.INPUT);
            date = parseIsoDateUtc(e['date'], where, false);
        }
        const comment = e['comment'];
        if (comment !== undefined && typeof comment !== 'string') throw new CliError(`${where}: "comment" must be a string.`, 1, ErrorCode.INPUT);
        const extras: { -readonly [K in keyof EntryExtras]: EntryExtras[K] } = {};
        if (comment !== undefined) extras.comment = comment;
        if (date !== undefined) extras.date = date;
        if (e['mode'] !== undefined) extras.externalAttributes = externalAttributesFor(parseMode(e['mode'], where), op === 'add-dir');
        if (e['extraFields'] !== undefined) extras.extraFields = parseExtraFields(e['extraFields'], where);
        const options = entryOptions(Object.keys(compression).length > 0 ? compression : undefined, extras);

        if (op === 'add' || op === 'replace') {
            if (name.endsWith('/')) {
                throw new CliError(`${where}: "${name}" names a directory (trailing "/") but op "${op}" carries a payload; use op "add-dir".`, 1, ErrorCode.INPUT, { entryName: name });
            }
            const sources = ['path', 'data', 'dataBase64'].filter((k) => e[k] !== undefined);
            if (sources.length !== 1) throw new CliError(`${where}: exactly one of "path", "data" or "dataBase64" is required.`, 1, ErrorCode.INPUT);
            let data: Uint8Array;
            if (typeof e['path'] === 'string') data = await loadPayload(e['path'], baseDir, stdinUsed);
            else if (typeof e['data'] === 'string') data = new TextEncoder().encode(e['data']);
            else if (typeof e['dataBase64'] === 'string') data = new Uint8Array(Buffer.from(e['dataBase64'], 'base64'));
            else throw new CliError(`${where}: "path", "data" and "dataBase64" must be strings.`, 1, ErrorCode.INPUT);
            edits.push({ op, name, data, ...(options !== undefined ? { options } : {}) });
        } else if (op === 'rename') {
            edits.push({ op, name, to: e['to'] as string });
        } else if (op === 'add-dir') {
            edits.push({ op, name, ...(options !== undefined ? { options } : {}) });
        } else {
            edits.push({ op, name });
        }
    }
    return { edits, comment: archiveComment };
}

export async function modify(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);

    const inputPath = getStringFlag(args.flags, 'input', 'i') ?? args.positionals[0];
    const outputFlag = getStringFlag(args.flags, 'output', 'o');
    const inPlace = hasFlag(args.flags, 'in-place');
    const compact = hasFlag(args.flags, 'compact');
    const manifestPath = getStringFlag(args.flags, 'from-manifest');
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();
    const compression = parseCompression(args);
    const defaultDate = parseDateFlag(args);

    if (inputPath === undefined) throw new CliError('modify requires an archive: --input <file>.', 2);
    if (inPlace && outputFlag !== undefined) throw new CliError('--in-place and --output are mutually exclusive.', 2);
    if (inPlace && (inputPath === '-')) throw new CliError('--in-place requires a file input, not stdin.', 2);
    const outputPath = inPlace ? inputPath : outputFlag;

    // ── Collect edits (flags), or from the manifest.
    const stdinUsed = { used: inputPath === '-' };
    const edits: Edit[] = [];
    let comment: string | Uint8Array | undefined = await parseArchiveComment(args);
    const flagEdits =
        getStringFlagAll(args.flags, 'add').length
        + getStringFlagAll(args.flags, 'add-dir').length
        + getStringFlagAll(args.flags, 'replace').length
        + getStringFlagAll(args.flags, 'remove').length
        + getStringFlagAll(args.flags, 'rename').length;
    if (manifestPath !== undefined && (flagEdits > 0 || comment !== undefined)) {
        throw new CliError('--from-manifest is mutually exclusive with --add/--replace/--remove/--rename/--add-dir/--comment/--comment-file.', 2);
    }
    if (manifestPath !== undefined) {
        const m = await editsFromManifest(manifestPath, stdinUsed);
        edits.push(...m.edits);
        comment = m.comment;
    } else {
        for (const raw of getStringFlagAll(args.flags, 'remove')) edits.push({ op: 'remove', name: raw });
        for (const raw of getStringFlagAll(args.flags, 'rename')) {
            const { from, to } = parseFromEqualsTo(raw, 'rename');
            assertSafeName(to, 'rename');
            edits.push({ op: 'rename', name: from, to });
        }
        for (const raw of getStringFlagAll(args.flags, 'replace')) {
            const { name, path } = parseNameEqualsPath(raw, 'replace');
            assertFileName(name, 'replace');
            edits.push({ op: 'replace', name, path });
        }
        for (const raw of getStringFlagAll(args.flags, 'add')) {
            const { name, path } = parseNameEqualsPath(raw, 'add');
            assertSafeName(name, 'add');
            assertFileName(name, 'add');
            edits.push({ op: 'add', name, path });
        }
        for (const raw of getStringFlagAll(args.flags, 'add-dir')) {
            assertSafeName(raw, 'add-dir');
            edits.push({ op: 'add-dir', name: raw });
        }
    }
    if (edits.length === 0 && comment === undefined) {
        throw new CliError('modify requires at least one edit: --add, --replace, --remove, --rename, --add-dir, --comment, --comment-file or --from-manifest.', 2);
    }

    // ── Open (eagerly: overlap / CD↔LFH structure is checked before any
    // edit, since untouched records are re-emitted verbatim) + wrap.
    const bytes = await readArchiveBytes(inputPath, args);
    const sink = createDiagnosticSink();
    const reader = openArchive(bytes, { ...commonOptions(args, sink), validate: 'eager' });
    const modifierOptions: ZipModifierOptions = {
        ...commonOptions(args, sink),
        ...(compression !== undefined ? { compression } : {}),
        ...(defaultDate !== undefined ? { defaultDate } : {}),
    };
    let modifier;
    try {
        modifier = createZipModifier(reader, modifierOptions);
    } catch (e) {
        throw mapZipError(e, 'Failed to open the archive for modification');
    }

    // ── Apply in fixed order (payloads loaded lazily here, after validation).
    const ordered = [...edits].sort((a, b) => ORDER.indexOf(a.op) - ORDER.indexOf(b.op));
    const applied: { op: Op; name: string; to?: string }[] = [];
    for (const e of ordered) {
        try {
            switch (e.op) {
                case 'remove':
                    modifier.removeEntry(e.name);
                    break;
                case 'rename':
                    modifier.renameEntry(e.name, e.to as string);
                    break;
                case 'replace':
                case 'add': {
                    const data = e.data ?? await loadPayload(e.path as string, undefined, stdinUsed);
                    const opts = e.options ?? entryOptions(undefined);
                    if (e.op === 'replace') modifier.replaceEntry(e.name, data, opts);
                    else modifier.addEntry(e.name, data, opts);
                    break;
                }
                case 'add-dir': {
                    const name = e.name.endsWith('/') ? e.name : `${e.name}/`;
                    modifier.addEntry(name, new Uint8Array(0), e.options);
                    break;
                }
                case 'comment':
                    break;
            }
        } catch (err) {
            throw mapZipError(err, `Failed to apply ${e.op} "${e.name}"`, e.name);
        }
        applied.push({ op: e.op, name: e.name, ...(e.to !== undefined ? { to: e.to } : {}) });
    }
    if (comment !== undefined) {
        try {
            modifier.setComment(comment);
        } catch (e) {
            throw mapZipError(e, 'Failed to set the archive comment');
        }
        applied.push({ op: 'comment', name: describeComment(comment) });
    }

    // ── Verify every entry that will be re-emitted VERBATIM. The modifier
    // copies untouched records byte for byte, so a CRC lie, a size lie or a
    // local header that disagrees with the central directory would otherwise
    // be laundered into a fresh, canonical-looking archive. One decompress
    // pass over the survivors (never a recompress); no opt-out (an opt-out
    // would write unverified bytes). Runs under --dry-run too.
    const gone = new Set(ordered.filter((e) => e.op === 'remove' || e.op === 'replace').map((e) => e.name));
    const { verified, verifySkipped } = verifySurvivors(reader, gone);
    const tier = activeDeflateTier(compression?.deterministic === true);

    const destructive = ordered.some((e) => e.op === 'remove' || e.op === 'replace' || e.op === 'rename');
    const layout = compact ? 'compact' : 'append-only';
    if (!compact && destructive && !dryRun) {
        progress('info: append-only save keeps removed/replaced bytes recoverable and some readers (7-Zip) mis-read append-only output — pass --compact for a canonical rewrite.');
    }

    if (dryRun) {
        emitStatus({ command: 'modify', dryRun: true, output: outputPath ?? '-', edits: applied, layout, verified, verifySkipped, tier, ...sink.field() });
        return;
    }

    let out: Uint8Array;
    try {
        out = compact ? modifier.saveCompact() : modifier.save();
    } catch (e) {
        throw mapZipError(e, 'Failed to save the modified archive');
    }
    const changed = out !== reader.bytes;

    if (inPlace) {
        // Unpredictable, exclusively-created temp name next to the target, then
        // an atomic rename: a pre-planted file or symlink at the temp path is
        // refused (EEXIST) rather than followed.
        const tmp = `${outputPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
        try {
            await writeOutput(out, tmp, { exclusive: true });
            await fsRename(tmp, outputPath as string);
        } catch (e) {
            await unlinkQuiet(tmp);
            throw mapZipError(e, 'Failed to write the modified archive');
        }
    } else {
        try {
            await writeOutput(out, outputPath, { exclusive: !hasFlag(args.flags, 'overwrite') });
        } catch (e) {
            throw mapZipError(e, 'Failed to write the modified archive');
        }
    }

    emitStatus({
        command: 'modify',
        dryRun: false,
        output: outputPath ?? '-',
        bytes: out.length,
        edits: applied,
        layout,
        changed,
        verified,
        verifySkipped,
        tier,
        ...sink.field(),
    });
}

/**
 * Cross-check (CRC, sizes, local header) every central-directory entry the
 * save will copy verbatim. Encrypted entries and entries whose registered
 * codec has no sync decompressor cannot be verified and are counted as
 * skipped — exactly the two `skipped` reasons of `verifyZip`. An entry with
 * no registered codec at all is refused (E_UNSUPPORTED via the engine).
 */
function verifySurvivors(reader: ZipReader, gone: ReadonlySet<string>): { verified: number; verifySkipped: number } {
    let verified = 0;
    let verifySkipped = 0;
    let entries: ZipEntry[];
    try {
        entries = [...reader.entries()];
    } catch (e) {
        throw mapZipError(e, 'Failed to read the central directory');
    }
    for (const entry of entries) {
        if (gone.has(entry.name)) continue;
        const custom = entry.compressionMethod !== METHOD_STORE && entry.compressionMethod !== METHOD_DEFLATE;
        const codec = custom ? getCodec(entry.compressionMethod) : null;
        if (entry.isEncrypted || (custom && codec !== null && codec.decompressSync === undefined)) {
            verifySkipped++;
            continue;
        }
        let v: EntryVerification;
        try {
            v = reader.verifyEntry(entry);
        } catch (e) {
            throw mapZipError(e, `Cannot verify entry "${entry.name}" before re-emitting it`, entry.name);
        }
        if (!v.ok) throw survivorFailure(entry, v);
        verified++;
    }
    return { verified, verifySkipped };
}

function survivorFailure(entry: ZipEntry, v: EntryVerification): CliError {
    const tail = 'it would be re-emitted verbatim — refusing to launder it. Run `zipnative verify` for the full report, or --remove/--replace the entry.';
    if (!v.localHeaderMatch) {
        return new CliError(
            `Entry "${entry.name}": local header disagrees with the central directory; ${tail}`,
            1,
            ErrorCode.SECURITY,
            { entryName: entry.name, zipCode: 'ZIP_CD_LFH_MISMATCH' },
        );
    }
    if (!v.crcMatch) {
        return new CliError(
            `Entry "${entry.name}": CRC-32 does not match its central-directory record; ${tail}`,
            1,
            ErrorCode.DATA,
            { entryName: entry.name, zipCode: 'ZIP_CRC_MISMATCH' },
        );
    }
    return new CliError(
        `Entry "${entry.name}": decompressed size does not match its central-directory record; ${tail}`,
        1,
        ErrorCode.DATA,
        { entryName: entry.name, zipCode: 'ZIP_SIZE_MISMATCH' },
    );
}
