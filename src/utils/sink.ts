// The extraction sink — the ONE place that turns a sanitised archive path
// into a file on disk. The engine never touches the filesystem, so this is
// the CLI's own trust boundary (SECURITY.md → Extraction sink). Shared by
// `extract` (plan-then-write) and `stream` (write-per-entry).
//
// Guards, in order:
//   1. lexical containment  — `safeJoin(root, path)` (utils/io.ts) proves the
//      resolved target stays under the root before any I/O;
//   2. duplicate targets     — a case-folded key on case-insensitive
//      filesystems (win32, darwin) and `--flat` collisions follow the same
//      `--on-duplicate error|first|last` policy as the engine's own
//      sanitised-path duplicates;
//   3. physical containment  — before creating a directory, the nearest
//      EXISTING ancestor's `realpath` must sit under the root's `realpath`
//      (a symlink or junction pre-planted inside the destination cannot
//      redirect `mkdir -p`), and the created directory is re-checked after;
//   4. exclusive open        — without `--overwrite` the file is created with
//      `wx`, so a file that appears between the plan and the write is refused
//      like any other existing file (no check-then-write window);
//   5. no partial output     — a failed write removes the partial file.

import { mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { CliError, ErrorCode } from './error.js';
import { pathExists, safeJoin, unlinkQuiet, writeFileStream } from './io.js';
import type { OnDuplicate } from './zipops.js';

/** Filesystems where `A.txt` and `a.txt` are the same file. */
export const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

/** Key under which two targets collide on this platform. */
export function sinkKey(target: string): string {
    return CASE_INSENSITIVE_FS ? target.toLowerCase() : target;
}

export interface SinkTarget {
    /** `/`-separated relative path actually used (basename under `--flat`). */
    readonly relPath: string;
    /** Absolute destination (lexically inside the root). */
    readonly target: string;
    readonly key: string;
}

/** Resolve a sanitised archive path under the root (lexical containment). */
export function resolveSinkTarget(root: string, sanitisedPath: string, flat: boolean): SinkTarget {
    const relPath = flat ? basename(sanitisedPath) : sanitisedPath;
    const target = safeJoin(root, relPath);
    return { relPath, target, key: sinkKey(target) };
}

/**
 * Apply the duplicate policy for a target already claimed by `prior` (an
 * entry name). Returns `'new'` (unclaimed), `'skip'` (keep the first),
 * `'replace'` (keep the last) or throws E_SECURITY
 * (`ZIP_EXTRACT_DUPLICATE_PATH`, the engine's own code for the condition).
 */
export function duplicatePolicy(
    prior: string | undefined,
    entryName: string,
    target: string,
    onDuplicate: OnDuplicate,
    why: string,
): 'new' | 'skip' | 'replace' {
    if (prior === undefined) return 'new';
    if (onDuplicate === 'error') {
        throw new CliError(
            `Entries "${prior}" and "${entryName}" would extract to the same file ${target} (${why}); pass --on-duplicate first|last to choose one.`,
            1,
            ErrorCode.SECURITY,
            { entryName, zipCode: 'ZIP_EXTRACT_DUPLICATE_PATH' },
        );
    }
    return onDuplicate === 'first' ? 'skip' : 'replace';
}

function isUnder(realRoot: string, realPath: string): boolean {
    const rel = relative(realRoot, realPath);
    return rel === '' || (!rel.startsWith('..') && !rel.split(sep).includes('..') && resolve(realRoot, rel) === realPath);
}

function escapes(root: string, path: string, resolved: string, entryName: string): CliError {
    return new CliError(
        `Refusing to write through a link that leaves the output directory: ${path} resolves to ${resolved}, outside ${root} (a symlink or junction inside the destination points elsewhere; use an empty or trusted destination).`,
        1,
        ErrorCode.SECURITY,
        { entryName },
    );
}

/** Nearest existing ancestor of `path` (or `path` itself). */
async function nearestExisting(path: string): Promise<string> {
    let probe = path;
    for (;;) {
        if (await pathExists(probe)) return probe;
        const up = dirname(probe);
        if (up === probe) return probe;
        probe = up;
    }
}

/**
 * Create `dir` (and parents) under the root and prove that its PHYSICAL
 * location sits under the root: the nearest existing ancestor is resolved
 * before `mkdir -p` (so nothing is created on the far side of a planted
 * link) and the directory itself is resolved after. The root is created
 * when missing — it is the user's chosen destination.
 */
export async function ensureSinkDir(root: string, dir: string, entryName: string): Promise<void> {
    await mkdir(root, { recursive: true });
    const realRoot = await realpath(root);
    const anchor = await nearestExisting(dir);
    const realAnchor = await realpath(anchor);
    if (!isUnder(realRoot, realAnchor)) throw escapes(root, anchor, realAnchor, entryName);
    await mkdir(dir, { recursive: true });
    const realDir = await realpath(dir);
    if (!isUnder(realRoot, realDir)) throw escapes(root, dir, realDir, entryName);
}

/** {@link ensureSinkDir} for the parent directory of a file target. */
export function ensureSinkParent(root: string, target: string, entryName: string): Promise<void> {
    return ensureSinkDir(root, dirname(target), entryName);
}

export interface SinkWriteOptions {
    /** Replace an existing file (`--overwrite`, or the `last` of a duplicate pair). */
    readonly overwrite: boolean;
}

/**
 * Stream an entry's bytes into `target` (parent must exist — see
 * {@link ensureSinkParent}). Exclusive open unless `overwrite`; a failed
 * write never leaves a partial file behind. Returns the bytes written.
 */
export async function writeSinkFile(
    target: string,
    chunks: AsyncIterable<Uint8Array>,
    options: SinkWriteOptions,
): Promise<number> {
    let written = 0;
    try {
        await writeFileStream(target, chunks, (n) => { written += n; }, { exclusive: !options.overwrite });
    } catch (e) {
        // An exclusive-open refusal never touched the existing file; anything
        // else may have left a partial file of our own making.
        if (!(e instanceof CliError && e.code === ErrorCode.IO && e.message.startsWith('Refusing to overwrite'))) {
            await unlinkQuiet(target);
        }
        throw e;
    }
    return written;
}

/** Early, whole-plan refusal: does any planned target already exist? */
export async function findExistingTarget(targets: readonly string[]): Promise<string | undefined> {
    for (const t of targets) {
        if (await pathExists(t)) return t;
    }
    return undefined;
}
