// Deterministic filesystem walk for `create`.
//
//   • Entry names are `/`-separated paths relative to `--base` (default: each
//     positional's parent directory, so `create src/` yields `src/a.ts`).
//   • `readdir` output is sorted by name so the walk order is identical on
//     every platform; the final list is name-sorted too unless
//     `preserveInputOrder` keeps the argv order (`--order insertion`).
//   • Symlinks (files and directories, detected with `lstat`) are SKIPPED by
//     default and reported; `--follow-symlinks` dereferences them with a
//     realpath cycle guard. No symlink entries are ever written.
//   • Every final name is pre-checked with the core's `sanitizeEntryPath()`:
//     a name that could not be extracted safely (reserved device name,
//     traversal) is refused at creation time.

import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { sanitizeEntryPath } from '../core-bridge/index.js';
import { CliError, ErrorCode } from './error.js';
import type { NameFilter } from './glob.js';
import { isFsError } from './ziperr.js';

export interface FileSpec {
    /** `/`-separated archive entry name (directories end with `/`). */
    readonly name: string;
    /** Absolute filesystem path. */
    readonly path: string;
    readonly isDirectory: boolean;
    readonly size: number;
    /** POSIX mode bits (0o7777 masked), `null` on win32. */
    readonly mode: number | null;
    readonly mtime: Date;
}

export interface SkippedPath {
    readonly path: string;
    readonly name: string;
    readonly reason: 'symlink' | 'special' | 'filtered';
}

export interface WalkOptions {
    /** Names are computed relative to this directory (absolute or cwd-relative). */
    readonly base?: string;
    /** Prepended to every name (a trailing `/` is added when missing). */
    readonly prefix?: string;
    readonly followSymlinks?: boolean;
    /** Emit explicit directory entries (`dir/`) for every walked directory. */
    readonly dirEntries?: boolean;
    readonly filter?: NameFilter;
    /**
     * Keep the argv order of the inputs (each directory still walks in sorted
     * `readdir` order) instead of the global name sort — `--order insertion`,
     * e.g. an EPUB whose `mimetype` must be the first entry.
     */
    readonly preserveInputOrder?: boolean;
}

export interface WalkResult {
    readonly files: readonly FileSpec[];
    readonly skipped: readonly SkippedPath[];
}

function toEntryName(rel: string): string {
    return rel.split(sep).join('/');
}

function normalisePrefix(prefix: string | undefined): string {
    if (prefix === undefined || prefix.length === 0) return '';
    const p = prefix.replace(/\\/g, '/').replace(/^\/+/, '');
    return p.endsWith('/') ? p : p + '/';
}

function checkName(name: string, path: string): void {
    const bare = name.endsWith('/') ? name.slice(0, -1) : name;
    if (bare.length === 0 || sanitizeEntryPath(bare) === null) {
        throw new CliError(
            `Entry name "${name}" (from ${path}) would not be extractable safely (reserved device name, `
            + 'traversal or empty segment) — rename the file or use --base/--prefix.',
            1,
            ErrorCode.INPUT,
            { entryName: name },
        );
    }
}

/**
 * Walk `inputs` (files or directories) and produce the sorted list of
 * archive entries. Throws `E_IO` when an input does not exist.
 */
export async function walkPaths(inputs: readonly string[], options: WalkOptions = {}): Promise<WalkResult> {
    const files: FileSpec[] = [];
    const skipped: SkippedPath[] = [];
    const seenNames = new Set<string>();
    const prefix = normalisePrefix(options.prefix);
    const follow = options.followSymlinks === true;
    const visiting = new Set<string>();
    const baseAbs = options.base !== undefined ? resolve(options.base) : undefined;

    const pushSpec = (spec: FileSpec): void => {
        if (options.filter !== undefined && !options.filter(spec.name)) {
            skipped.push({ path: spec.path, name: spec.name, reason: 'filtered' });
            return;
        }
        checkName(spec.name, spec.path);
        if (seenNames.has(spec.name)) {
            throw new CliError(
                `Duplicate entry name "${spec.name}" (from ${spec.path}) — inputs overlap; use --base or --prefix.`,
                1,
                ErrorCode.INPUT,
                { entryName: spec.name },
            );
        }
        seenNames.add(spec.name);
        files.push(spec);
    };

    const nameFor = (abs: string, rootBase: string): string => {
        const rel = relative(rootBase, abs);
        if (rel === '' || rel.startsWith('..')) {
            throw new CliError(
                `Input "${abs}" is outside --base "${rootBase}" — entry names must be relative to the base.`,
                2,
            );
        }
        return prefix + toEntryName(rel);
    };

    const visit = async (abs: string, rootBase: string): Promise<void> => {
        let st;
        try {
            st = await lstat(abs);
        } catch (e) {
            throw isFsError(e)
                ? new CliError(`Cannot read input "${abs}": ${e.code}`, 1, ErrorCode.IO)
                : e;
        }
        if (st.isSymbolicLink()) {
            if (!follow) {
                skipped.push({ path: abs, name: nameFor(abs, rootBase), reason: 'symlink' });
                return;
            }
            const real = await realpath(abs);
            if (visiting.has(real)) {
                throw new CliError(`Symlink cycle detected at "${abs}" (→ ${real}).`, 1, ErrorCode.INPUT);
            }
            st = await stat(abs);
            if (st.isDirectory()) {
                visiting.add(real);
                await visitDir(abs, rootBase, st.mtime);
                visiting.delete(real);
                return;
            }
        }
        if (st.isDirectory()) {
            await visitDir(abs, rootBase, st.mtime);
            return;
        }
        if (!st.isFile()) {
            skipped.push({ path: abs, name: nameFor(abs, rootBase), reason: 'special' });
            return;
        }
        pushSpec({
            name: nameFor(abs, rootBase),
            path: abs,
            isDirectory: false,
            size: st.size,
            mode: process.platform === 'win32' ? null : st.mode & 0o7777,
            mtime: st.mtime,
        });
    };

    const visitDir = async (abs: string, rootBase: string, mtime: Date): Promise<void> => {
        const rel = relative(rootBase, abs);
        if (options.dirEntries === true && rel !== '' && !rel.startsWith('..')) {
            const dirSt = process.platform === 'win32' ? null : (await stat(abs)).mode & 0o7777;
            pushSpec({
                name: prefix + toEntryName(rel) + '/',
                path: abs,
                isDirectory: true,
                size: 0,
                mode: dirSt,
                mtime,
            });
        }
        const names = (await readdir(abs)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        for (const n of names) {
            await visit(join(abs, n), rootBase);
        }
    };

    for (const input of inputs) {
        const abs = resolve(input);
        const rootBase = baseAbs ?? dirname(abs);
        await visit(abs, rootBase);
    }

    // Deterministic output regardless of input order — unless the caller asked
    // for the argv order (the writer's `order: 'insertion'` then honours it).
    if (options.preserveInputOrder !== true) {
        files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    }
    return { files, skipped };
}

/** Basename helper (exported for callers building single-entry names). */
export function entryBasename(path: string): string {
    return basename(path.replace(/\\/g, '/'));
}
