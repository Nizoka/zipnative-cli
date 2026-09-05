import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    CASE_INSENSITIVE_FS,
    duplicatePolicy,
    ensureSinkDir,
    ensureSinkParent,
    findExistingTarget,
    resolveSinkTarget,
    sinkKey,
    writeSinkFile,
} from '../../src/utils/sink.js';
import { CliError } from '../../src/utils/error.js';

let tmp = '';

async function* chunksOf(...parts: readonly Uint8Array[]): AsyncGenerator<Uint8Array, void, undefined> {
    for (const p of parts) yield p;
}

/** A directory link that needs no privilege: a junction on win32, a symlink elsewhere. */
async function linkDir(target: string, path: string): Promise<void> {
    await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
}

beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'zipnative-cli-sink-'));
});

afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
});

describe('resolveSinkTarget / sinkKey', () => {
    it('joins under the root and derives the platform collision key', () => {
        const root = join(tmp, 'out');
        const t = resolveSinkTarget(root, 'a/B.txt', false);
        expect(t.relPath).toBe('a/B.txt');
        expect(t.target).toBe(resolve(root, 'a', 'B.txt'));
        expect(t.key).toBe(sinkKey(t.target));
        expect(sinkKey(t.target) === t.target.toLowerCase()).toBe(CASE_INSENSITIVE_FS);
    });

    it('--flat keeps the basename only', () => {
        const root = join(tmp, 'out');
        expect(resolveSinkTarget(root, 'deep/er/file.bin', true)).toMatchObject({ relPath: 'file.bin', target: resolve(root, 'file.bin') });
    });

    it('refuses an escape (E_SECURITY) — lexical containment', () => {
        expect(() => resolveSinkTarget(join(tmp, 'out'), '../evil', false)).toThrow(CliError);
    });
});

describe('duplicatePolicy', () => {
    it('"new" when nothing claimed the target', () => {
        expect(duplicatePolicy(undefined, 'a', '/t', 'error', 'why')).toBe('new');
    });

    it('error → E_SECURITY ZIP_EXTRACT_DUPLICATE_PATH naming both entries and the remedy', () => {
        let caught: unknown;
        try {
            duplicatePolicy('first.txt', 'second.txt', '/out/x', 'error', '--flat');
        } catch (e) {
            caught = e;
        }
        expect(caught).toMatchObject({ code: 'E_SECURITY', exitCode: 1, entryName: 'second.txt', zipCode: 'ZIP_EXTRACT_DUPLICATE_PATH' });
        expect((caught as CliError).message).toMatch(/"first.txt" and "second.txt".*--flat.*--on-duplicate first\|last/);
    });

    it('first → skip, last → replace', () => {
        expect(duplicatePolicy('a', 'b', '/t', 'first', 'w')).toBe('skip');
        expect(duplicatePolicy('a', 'b', '/t', 'last', 'w')).toBe('replace');
    });
});

describe('ensureSinkDir / ensureSinkParent', () => {
    it('creates the root and nested parents, and is idempotent', async () => {
        const root = join(tmp, 'out');
        await ensureSinkParent(root, join(root, 'a', 'b', 'file.txt'), 'a/b/file.txt');
        await ensureSinkParent(root, join(root, 'a', 'b', 'file.txt'), 'a/b/file.txt');
        expect((await stat(join(root, 'a', 'b'))).isDirectory()).toBe(true);
    });

    it('refuses a directory link planted inside the destination that points outside (E_SECURITY), creating nothing beyond it', async () => {
        const root = join(tmp, 'out');
        const outside = join(tmp, 'outside');
        await mkdir(root, { recursive: true });
        await mkdir(outside, { recursive: true });
        await linkDir(outside, join(root, 'nested'));
        let caught: unknown;
        try {
            await ensureSinkParent(root, join(root, 'nested', 'deep', 'x.txt'), 'nested/deep/x.txt');
        } catch (e) {
            caught = e;
        }
        expect(caught).toMatchObject({ code: 'E_SECURITY', exitCode: 1, entryName: 'nested/deep/x.txt' });
        expect((caught as CliError).message).toMatch(/leaves the output directory/);
        expect(await readdir(outside)).toEqual([]);
    });

    it('accepts a link that stays inside the destination', async () => {
        const root = join(tmp, 'out');
        await mkdir(join(root, 'real'), { recursive: true });
        await linkDir(join(root, 'real'), join(root, 'alias'));
        await ensureSinkDir(root, join(root, 'alias', 'sub'), 'alias/sub/');
        expect((await stat(join(root, 'real', 'sub'))).isDirectory()).toBe(true);
    });

    it('accepts a root that is itself a link (the user chose it)', async () => {
        const real = join(tmp, 'real-root');
        await mkdir(real, { recursive: true });
        const root = join(tmp, 'linked-root');
        await linkDir(real, root);
        await ensureSinkParent(root, join(root, 'a', 'f.txt'), 'a/f.txt');
        expect(await realpath(join(root, 'a'))).toBe(await realpath(join(real, 'a')));
    });
});

describe('writeSinkFile', () => {
    it('writes the chunks and returns the byte count', async () => {
        const target = join(tmp, 'f.bin');
        expect(await writeSinkFile(target, chunksOf(new Uint8Array([1, 2]), new Uint8Array([3])), { overwrite: false })).toBe(3);
        expect([...(await readFile(target))]).toEqual([1, 2, 3]);
    });

    it('refuses an existing file without overwrite and leaves it intact; replaces it with overwrite', async () => {
        const target = join(tmp, 'f.bin');
        await writeFile(target, 'old');
        await expect(writeSinkFile(target, chunksOf(new Uint8Array([1])), { overwrite: false }))
            .rejects.toMatchObject({ code: 'E_IO', message: expect.stringMatching(/pass --overwrite/) as string });
        expect((await readFile(target)).toString()).toBe('old');
        expect(await writeSinkFile(target, chunksOf(new Uint8Array([9])), { overwrite: true })).toBe(1);
        expect([...(await readFile(target))]).toEqual([9]);
    });

    it('removes the partial file when the source fails', async () => {
        const target = join(tmp, 'partial.bin');
        async function* broken(): AsyncGenerator<Uint8Array, void, undefined> {
            yield new Uint8Array([1]);
            throw new Error('boom');
        }
        await expect(writeSinkFile(target, broken(), { overwrite: false })).rejects.toThrow('boom');
        await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

describe('findExistingTarget', () => {
    it('returns the first existing path, or undefined', async () => {
        const a = join(tmp, 'a');
        const b = join(tmp, 'b');
        await writeFile(b, 'x');
        expect(await findExistingTarget([a, b])).toBe(b);
        expect(await findExistingTarget([a])).toBeUndefined();
        expect(await findExistingTarget([])).toBeUndefined();
    });
});
