// `zipnative extract` — write an archive's entries to disk.
//
// The engine never touches the filesystem: `extractZipStream` yields
// `{ path, entry, stream() }` with `path` already sanitised, and THIS command
// is the sink. It is therefore the CLI's own trust boundary, hardened in two
// phases:
//
//   1. PLAN  — drain the (lazy) extraction generator into a plan: nothing is
//      decompressed yet (the `stream()` thunks are deferred). Every path is
//      then re-checked with `safeJoin(root, path)` (lexical containment),
//      existing files are refused unless `--overwrite`, and on
//      case-insensitive filesystems (win32/darwin) case-folded collisions
//      follow `--on-duplicate`.
//   2. WRITE — through utils/sink.ts: the parent's realpath must stay under
//      the root (no symlink/junction redirection), files are opened
//      exclusively unless `--overwrite` (no check-then-write window), each
//      entry streams with backpressure, and a CRC / size failure removes the
//      partial file. Optional `--preserve-mode` (POSIX only, never
//      setuid/setgid/sticky) and `--preserve-mtime`.
//
// Security defaults are the core's (zip-slip, symlinks, duplicates, bombs
// refused). Opt-outs are skip-not-write: `--skip-unsafe` drops unsafe names,
// `--allow-symlinks` writes the link TARGET TEXT as a regular file (a symlink
// is never materialised), `--skip-symlinks` drops them.

import { chmod, mkdir, utimes } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from '../utils/args.js';
import { emitStatus, isDryRun, progress } from '../utils/agent.js';
import {
    extractZip,
    extractZipStream,
    getUnixMode,
    isSymlinkEntry,
    sanitizeEntryPath,
    type ExtractOptions,
    type ZipEntry,
} from '../core-bridge/index.js';
import { createDiagnosticSink } from '../utils/diagnostics.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { overwriteRefused, safeJoin } from '../utils/io.js';
import {
    duplicatePolicy,
    ensureSinkDir,
    ensureSinkParent,
    findExistingTarget,
    resolveSinkTarget,
    writeSinkFile,
} from '../utils/sink.js';
import { mapZipError } from '../utils/ziperr.js';
import {
    commonOptions,
    openArchive,
    parseNameFilter,
    parseOnDuplicate,
    readArchiveBytes,
    resolveInputPath,
} from '../utils/zipops.js';

interface PlannedFile {
    readonly entry: ZipEntry;
    /** Sanitised, `/`-separated relative path (possibly flattened). */
    readonly relPath: string;
    /** Absolute destination. */
    readonly target: string;
    /** Platform collision key of `target` (see utils/sink.ts). */
    readonly key: string;
    readonly stream: () => AsyncGenerator<Uint8Array, void, undefined>;
}

interface Skipped {
    readonly name: string;
    readonly reason: 'unsafe-path' | 'symlink' | 'filtered' | 'duplicate';
}

export async function extract(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);

    const outputDir = getStringFlag(args.flags, 'output-dir', 'd');
    if (outputDir === undefined) {
        throw new CliError('extract requires --output-dir <dir> (use "-d ." to extract into the current directory).', 2);
    }
    const overwrite = hasFlag(args.flags, 'overwrite');
    const skipUnsafe = hasFlag(args.flags, 'skip-unsafe');
    const allowSymlinks = hasFlag(args.flags, 'allow-symlinks');
    const skipSymlinks = hasFlag(args.flags, 'skip-symlinks');
    const flat = hasFlag(args.flags, 'flat');
    const buffered = hasFlag(args.flags, 'buffered');
    const preserveMode = hasFlag(args.flags, 'preserve-mode');
    const preserveMtime = hasFlag(args.flags, 'preserve-mtime');
    const onDuplicate = parseOnDuplicate(args);
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();
    if (allowSymlinks && skipSymlinks) {
        throw new CliError('--allow-symlinks and --skip-symlinks are mutually exclusive.', 2);
    }
    const nameFilter = parseNameFilter(args);
    const wanted = new Set(getStringFlagAll(args.flags, 'entry', 'e'));

    const inputPath = resolveInputPath(args);
    const bytes = await readArchiveBytes(inputPath, args);
    const sink = createDiagnosticSink();
    const common = commonOptions(args, sink);

    // Directory entries and the "skipped because unsafe" inventory come from
    // the central directory (the extraction generator never yields them).
    const reader = openArchive(bytes, common);
    const allEntries: ZipEntry[] = [];
    try {
        for (const e of reader.entries()) allEntries.push(e);
    } catch (e) {
        throw mapZipError(e, 'Failed to read the central directory');
    }

    const skipped: Skipped[] = [];
    const filter = (entry: ZipEntry): boolean => {
        if (wanted.size > 0 && !wanted.has(entry.name)) return false;
        if (nameFilter !== undefined && !nameFilter(entry.name)) {
            skipped.push({ name: entry.name, reason: 'filtered' });
            return false;
        }
        if (skipSymlinks && isSymlinkEntry(entry)) {
            skipped.push({ name: entry.name, reason: 'symlink' });
            return false;
        }
        return true;
    };
    const options: ExtractOptions = {
        ...common,
        rejectTraversal: !skipUnsafe,
        rejectSymlinks: !(allowSymlinks || skipSymlinks),
        onDuplicate,
        filter,
    };

    // ── Phase 1: plan (no decompression yet)
    const root = resolve(outputDir);
    const planned: PlannedFile[] = [];
    const seenTargets = new Map<string, string>();
    const planOne = (entry: ZipEntry, sanitised: string, stream: () => AsyncGenerator<Uint8Array, void, undefined>): void => {
        const { relPath, target, key } = resolveSinkTarget(root, sanitised, flat);
        // A collision here is reached only under --flat or a case-fold on a
        // case-insensitive filesystem (the core already applied onDuplicate
        // to identical sanitised paths).
        const verdict = duplicatePolicy(seenTargets.get(key), entry.name, target, onDuplicate, flat ? '--flat' : 'case-insensitive filesystem');
        if (verdict === 'skip') {
            skipped.push({ name: entry.name, reason: 'duplicate' });
            return;
        }
        if (verdict === 'replace') {
            const idx = planned.findIndex((p) => p.key === key);
            if (idx !== -1) planned.splice(idx, 1);
        }
        seenTargets.set(key, entry.name);
        planned.push({ entry, relPath, target, key, stream });
    };

    try {
        if (buffered) {
            for (const item of extractZip(bytes, options)) {
                const data = item.data;
                planOne(item.entry, item.path, async function* () { yield data; });
            }
        } else {
            for await (const item of extractZipStream(bytes, options)) {
                planOne(item.entry, item.path, item.stream);
            }
        }
    } catch (e) {
        throw mapZipError(e, 'Failed to extract');
    }

    // Names the core dropped silently under --skip-unsafe / --allow-symlinks=false+skip.
    const yielded = new Set(planned.map((p) => p.entry.name));
    for (const e of allEntries) {
        if (e.isDirectory || yielded.has(e.name)) continue;
        if (wanted.size > 0 && !wanted.has(e.name)) continue;
        if (skipped.some((s) => s.name === e.name)) continue;
        if (skipUnsafe) skipped.push({ name: e.name, reason: 'unsafe-path' });
    }

    // Directory entries (create even when empty) — through the same guards.
    const dirTargets: { readonly name: string; readonly target: string }[] = [];
    if (!flat) {
        for (const e of allEntries) {
            if (!e.isDirectory) continue;
            if (wanted.size > 0 && !wanted.has(e.name)) continue;
            if (nameFilter !== undefined && !nameFilter(e.name)) continue;
            const safe = sanitizeEntryPath(e.name);
            if (safe === null) {
                if (skipUnsafe) { skipped.push({ name: e.name, reason: 'unsafe-path' }); continue; }
                throw new CliError(`Directory entry "${e.name}" is not a safe path.`, 1, ErrorCode.SECURITY, { entryName: e.name, zipCode: 'ZIP_PATH_TRAVERSAL' });
            }
            dirTargets.push({ name: e.name, target: safeJoin(root, safe) });
        }
    }

    // ── Phase 2a: whole-plan refusal before writing anything (the exclusive
    // open in phase 2b is the authoritative guard; this keeps a refused run
    // from producing a partial tree).
    if (!overwrite) {
        const existing = await findExistingTarget(planned.map((p) => p.target));
        if (existing !== undefined) {
            const hit = planned.find((p) => p.target === existing) as PlannedFile;
            throw overwriteRefused(existing, hit.entry.name);
        }
    }

    const totalBytes = planned.reduce((n, p) => n + p.entry.uncompressedSize, 0);
    const symlinksAsData = planned.filter((p) => isSymlinkEntry(p.entry)).length;
    const summary = {
        command: 'extract',
        outputDir: root,
        entries: planned.length,
        files: planned.length,
        directories: dirTargets.length,
        bytes: totalBytes,
        skipped,
        symlinksAsData,
    };

    if (dryRun) {
        if (!hasFlag(args.flags, 'json')) {
            const lines = planned.map((p) => `plan  ${p.relPath}  ${p.entry.uncompressedSize}`);
            for (const s of skipped) lines.push(`skip  ${s.name}  (${s.reason})`);
            process.stdout.write(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
        }
        emitStatus({ ...summary, dryRun: true, ...sink.field() });
        return;
    }

    if (preserveMode && process.platform === 'win32') {
        progress('warning: --preserve-mode has no effect on Windows.');
    }
    for (const s of skipped) progress(`warning: skipped ${s.name} (${s.reason})`);

    // ── Phase 2b: write (utils/sink.ts: realpath containment + exclusive open)
    await mkdir(root, { recursive: true });
    for (const d of dirTargets) await ensureSinkDir(root, d.target, d.name);
    let written = 0;
    for (const p of planned) {
        await ensureSinkParent(root, p.target, p.entry.name);
        try {
            written += await writeSinkFile(p.target, p.stream(), { overwrite });
        } catch (e) {
            throw mapZipError(e, `Failed to extract "${p.entry.name}"`, p.entry.name);
        }
        if (preserveMode && process.platform !== 'win32') {
            const mode = getUnixMode(p.entry);
            if (mode !== null) {
                try {
                    await chmod(p.target, mode & 0o777);
                } catch (e) {
                    throw mapZipError(e, `Failed to apply mode to "${p.relPath}"`, p.entry.name);
                }
            }
        }
        if (preserveMtime) {
            try {
                await utimes(p.target, p.entry.lastModified, p.entry.lastModified);
            } catch (e) {
                throw mapZipError(e, `Failed to apply mtime to "${p.relPath}"`, p.entry.name);
            }
        }
    }

    emitStatus({ ...summary, dryRun: false, bytes: written, ...sink.field() });
}
