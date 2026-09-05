import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { walkPaths } from '../../src/utils/walk.js';
import { buildFilter } from '../../src/utils/glob.js';


const IS_WIN = process.platform === 'win32';

// Symlink creation needs privileges on some Windows setups (file links need
// SeCreateSymbolicLinkPrivilege or Developer Mode; directory links can be
// junctions, which never do). Probe both once at collection time so the
// directory-link cases still run where file links are refused.
const DIR_LINK_TYPE = IS_WIN ? 'junction' : 'dir';

function probeFileLinks(): boolean {
    const probe = mkdtempSync(join(tmpdir(), 'zipnative-cli-symlink-probe-'));
    try {
        writeFileSync(join(probe, 't'), 'x');
        symlinkSync(join(probe, 't'), join(probe, 'l'));
        return true;
    } catch {
        return false;
    } finally {
        rmSync(probe, { recursive: true, force: true });
    }
}

function probeDirLinks(): boolean {
    const probe = mkdtempSync(join(tmpdir(), 'zipnative-cli-symlink-probe-'));
    try {
        mkdirSync(join(probe, 'd'));
        symlinkSync(join(probe, 'd'), join(probe, 'l'), DIR_LINK_TYPE);
        return true;
    } catch {
        return false;
    } finally {
        rmSync(probe, { recursive: true, force: true });
    }
}

const FILE_LINKS = probeFileLinks();
const DIR_LINKS = probeDirLinks();

let root = '';
let src = '';

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
    src = join(root, 'src');
    await mkdir(join(src, 'sub'), { recursive: true });
    await writeFile(join(src, 'b.txt'), 'bb');
    await writeFile(join(src, 'a.txt'), 'a');
    await writeFile(join(src, 'sub', 'c.bin'), Buffer.from([1, 2, 3]));
    await writeFile(join(root, 'top.txt'), 'top');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('walkPaths', () => {
    it('walks a directory into sorted, /-separated names relative to its parent', async () => {
        const { files, skipped } = await walkPaths([src]);
        expect(skipped).toEqual([]);
        expect(files.map((f) => f.name)).toEqual(['src/a.txt', 'src/b.txt', 'src/sub/c.bin']);
        for (const f of files) {
            expect(f.isDirectory).toBe(false);
            expect(resolve(f.path)).toBe(f.path);
            expect(f.mtime).toBeInstanceOf(Date);
            if (IS_WIN) expect(f.mode).toBeNull();
            else expect(typeof f.mode).toBe('number');
        }
        expect(files.map((f) => f.size)).toEqual([1, 2, 3]);
    });

    it('is deterministic regardless of input order', async () => {
        const a = await walkPaths([join(src, 'b.txt'), join(src, 'a.txt')]);
        const b = await walkPaths([join(src, 'a.txt'), join(src, 'b.txt')]);
        expect(a.files.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
        expect(b.files.map((f) => f.name)).toEqual(a.files.map((f) => f.name));
    });

    it('names a single file by its basename (parent is the implicit base)', async () => {
        const { files } = await walkPaths([join(src, 'sub', 'c.bin')]);
        expect(files.map((f) => f.name)).toEqual(['c.bin']);
    });

    it('computes names relative to --base', async () => {
        const { files } = await walkPaths([src], { base: src });
        expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'sub/c.bin']);
        const deeper = await walkPaths([join(src, 'sub', 'c.bin')], { base: root });
        expect(deeper.files.map((f) => f.name)).toEqual(['src/sub/c.bin']);
    });

    it('prepends --prefix and adds the trailing slash when missing', async () => {
        const a = await walkPaths([src], { base: src, prefix: 'pkg' });
        expect(a.files.map((f) => f.name)).toEqual(['pkg/a.txt', 'pkg/b.txt', 'pkg/sub/c.bin']);
        const b = await walkPaths([src], { base: src, prefix: 'pkg/v1/' });
        expect(b.files[0]?.name).toBe('pkg/v1/a.txt');
        const c = await walkPaths([src], { base: src, prefix: '\\lead\\' });
        expect(c.files[0]?.name).toBe('lead/a.txt');
        const d = await walkPaths([src], { base: src, prefix: '' });
        expect(d.files[0]?.name).toBe('a.txt');
    });

    it('emits explicit directory entries with dirEntries', async () => {
        const { files } = await walkPaths([src], { dirEntries: true });
        expect(files.map((f) => f.name)).toEqual(['src/', 'src/a.txt', 'src/b.txt', 'src/sub/', 'src/sub/c.bin']);
        const dir = files.find((f) => f.name === 'src/sub/');
        expect(dir).toMatchObject({ isDirectory: true, size: 0 });
        if (IS_WIN) expect(dir?.mode).toBeNull();
    });

    it('does not emit a directory entry for the base itself', async () => {
        const { files } = await walkPaths([src], { base: src, dirEntries: true });
        expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'sub/', 'sub/c.bin']);
    });

    it('reports filtered names as skipped with reason "filtered"', async () => {
        const { files, skipped } = await walkPaths([src], { base: src, filter: buildFilter(['*.txt'], []) });
        expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
        expect(skipped).toEqual([{ path: join(src, 'sub', 'c.bin'), name: 'sub/c.bin', reason: 'filtered' }]);
    });

    it('filters directory entries too', async () => {
        const { files, skipped } = await walkPaths([src], { base: src, dirEntries: true, filter: buildFilter([], ['sub/']) });
        expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
        expect(skipped.map((s) => s.name).sort()).toEqual(['sub/', 'sub/c.bin']);
    });

    it('throws E_INPUT on a duplicate entry name', async () => {
        await expect(walkPaths([join(src, 'a.txt'), join(src, 'a.txt')])).rejects.toMatchObject({
            code: 'E_INPUT',
            exitCode: 1,
            entryName: 'a.txt',
        });
        await expect(walkPaths([join(src, 'a.txt'), join(src, 'a.txt')])).rejects.toThrow(/Duplicate entry name "a.txt"/);
    });

    it('throws E_IO on a missing input', async () => {
        await expect(walkPaths([join(root, 'nope')])).rejects.toMatchObject({ code: 'E_IO', exitCode: 1 });
        await expect(walkPaths([join(root, 'nope')])).rejects.toThrow(/Cannot read input .*ENOENT/);
    });

    it('throws exit 2 when an input lies outside --base', async () => {
        await expect(walkPaths([join(root, 'top.txt')], { base: src })).rejects.toMatchObject({ exitCode: 2, code: 'E_USAGE' });
        await expect(walkPaths([join(root, 'top.txt')], { base: src })).rejects.toThrow(/outside --base/);
    });

    it('throws exit 2 when the input IS the base (empty relative name)', async () => {
        await expect(walkPaths([join(src, 'a.txt')], { base: join(src, 'a.txt') })).rejects.toMatchObject({ exitCode: 2 });
    });

    it('inputs and --base containing ".." are ordinary shell paths (resolved, not refused)', async () => {
        const viaParent = join(src, 'nested', '..', 'a.txt');
        const { files } = await walkPaths([viaParent], { base: join(src, 'nested', '..') });
        expect(files.map((f) => f.name)).toEqual(['a.txt']);
        await expect(walkPaths([join(src, '..', 'no-such-dir-zipnative')])).rejects.toMatchObject({ code: 'E_IO' });
    });

    it('refuses a name that could not be extracted safely (traversal via --prefix)', async () => {
        await expect(walkPaths([join(src, 'a.txt')], { prefix: '../up' })).rejects.toMatchObject({
            code: 'E_INPUT',
            exitCode: 1,
            entryName: '../up/a.txt',
        });
        await expect(walkPaths([join(src, 'a.txt')], { prefix: '../up' })).rejects.toThrow(/would not be extractable safely/);
    });

    it.skipIf(IS_WIN)('refuses a reserved device name (aux.txt) with E_INPUT', async () => {
        await writeFile(join(src, 'aux.txt'), 'x');
        await expect(walkPaths([src], { base: src })).rejects.toMatchObject({
            code: 'E_INPUT',
            entryName: 'aux.txt',
        });
    });

    it('returns empty results for an empty directory', async () => {
        const empty = join(root, 'empty');
        await mkdir(empty);
        const { files, skipped } = await walkPaths([empty]);
        expect(files).toEqual([]);
        expect(skipped).toEqual([]);
    });

    describe.skipIf(!DIR_LINKS)('directory symlinks', () => {
        it('are skipped by default and reported with reason "symlink"', async () => {
            await symlink(join(src, 'sub'), join(src, 'linkdir'), DIR_LINK_TYPE);
            const { files, skipped } = await walkPaths([src], { base: src });
            expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'sub/c.bin']);
            expect(skipped).toEqual([{ path: join(src, 'linkdir'), name: 'linkdir', reason: 'symlink' }]);
        });

        it('are walked through with followSymlinks', async () => {
            await symlink(join(src, 'sub'), join(src, 'linkdir'), DIR_LINK_TYPE);
            const { files, skipped } = await walkPaths([src], { base: src, followSymlinks: true });
            expect(skipped).toEqual([]);
            expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'linkdir/c.bin', 'sub/c.bin']);
            expect(files.find((f) => f.name === 'linkdir/c.bin')?.size).toBe(3);
        });

        it('a cycle is detected when following', async () => {
            await symlink(src, join(src, 'sub', 'loop'), DIR_LINK_TYPE);
            await expect(walkPaths([src], { base: src, followSymlinks: true })).rejects.toMatchObject({ code: 'E_INPUT', exitCode: 1 });
            await expect(walkPaths([src], { base: src, followSymlinks: true })).rejects.toThrow(/Symlink cycle/);
        });

        it('a directory link given directly as input is skipped unless followed', async () => {
            await symlink(join(src, 'sub'), join(root, 'direct'), DIR_LINK_TYPE);
            const off = await walkPaths([join(root, 'direct')]);
            expect(off.files).toEqual([]);
            expect(off.skipped).toEqual([{ path: join(root, 'direct'), name: 'direct', reason: 'symlink' }]);
            const on = await walkPaths([join(root, 'direct')], { followSymlinks: true });
            expect(on.files.map((f) => f.name)).toEqual(['direct/c.bin']);
        });
    });

    describe.skipIf(!FILE_LINKS)('file symlinks', () => {
        it('are skipped by default and reported with reason "symlink"', async () => {
            await symlink(join(src, 'a.txt'), join(src, 'link.txt'));
            const { files, skipped } = await walkPaths([src], { base: src });
            expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'sub/c.bin']);
            expect(skipped).toEqual([{ path: join(src, 'link.txt'), name: 'link.txt', reason: 'symlink' }]);
        });

        it('are dereferenced with followSymlinks', async () => {
            await symlink(join(src, 'a.txt'), join(src, 'link.txt'));
            const { files, skipped } = await walkPaths([src], { base: src, followSymlinks: true });
            expect(skipped).toEqual([]);
            expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'link.txt', 'sub/c.bin']);
            expect(files.find((f) => f.name === 'link.txt')?.size).toBe(1);
        });

        it('a file link given directly as input is skipped unless followed', async () => {
            await symlink(join(src, 'a.txt'), join(root, 'direct.txt'));
            const off = await walkPaths([join(root, 'direct.txt')]);
            expect(off.files).toEqual([]);
            expect(off.skipped).toEqual([{ path: join(root, 'direct.txt'), name: 'direct.txt', reason: 'symlink' }]);
            const on = await walkPaths([join(root, 'direct.txt')], { followSymlinks: true });
            expect(on.files.map((f) => f.name)).toEqual(['direct.txt']);
        });
    });
});

