import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadCodecModule, loadedCodecModules } from '../../src/utils/codecs.js';
import { getCodec, setDeflateImpl, setInflateImpl } from '../../src/core-bridge/index.js';
import { CliError } from '../../src/utils/error.js';

const XOR_MODULE = `
export const codecs = [{
    method: 99,
    name: 'xor',
    decompressSync(d) { return d.map((b) => b ^ 1); },
}];
`;

let dir = '';
let counter = 0;

async function writeModule(source: string): Promise<string> {
    const file = join(dir, `codec-${counter++}.mjs`);
    await writeFile(file, source);
    return file;
}

async function expectInput(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
    let caught: unknown;
    try {
        await promise;
    } catch (e) {
        caught = e;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect(caught).toMatchObject({ code: 'E_INPUT', exitCode: 1 });
    expect((caught as CliError).message).toMatch(pattern);
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
});

afterEach(async () => {
    setInflateImpl(null);
    setDeflateImpl(null);
    await rm(dir, { recursive: true, force: true });
});

describe('loadCodecModule', () => {
    it('registers the exported codecs and returns the descriptor', async () => {
        const file = await writeModule(XOR_MODULE);
        const before = loadedCodecModules().length;
        const loaded = await loadCodecModule(file);
        expect(loaded).toEqual({
            path: resolve(file),
            codecs: [{ method: 99, name: 'xor' }],
            inflateImpl: false,
            deflateImpl: false,
        });
        const codec = getCodec(99);
        expect(codec).not.toBeNull();
        expect(codec?.name).toBe('xor');
        expect(Array.from(codec?.decompressSync?.(new Uint8Array([0, 1, 2]), 10) ?? [])).toEqual([1, 0, 3]);
        expect(loadedCodecModules().length).toBe(before + 1);
        expect(loadedCodecModules()[loadedCodecModules().length - 1]).toBe(loaded);
    });

    it('accepts `export default` (array and single object) forms', async () => {
        const arr = await writeModule(`export default [{ method: 98, name: 'arr', decompressStream: async function* () {} }];`);
        expect((await loadCodecModule(arr)).codecs).toEqual([{ method: 98, name: 'arr' }]);
        const single = await writeModule(`export default { method: 96, name: 'single', compressSync(d) { return d; } };`);
        expect((await loadCodecModule(single)).codecs).toEqual([{ method: 96, name: 'single' }]);
        expect(getCodec(96)?.name).toBe('single');
    });

    it('registers inflateImpl / deflateImpl functions', async () => {
        const file = await writeModule(`
            export const inflateImpl = (d, max) => d.subarray(0, max);
            export const deflateImpl = (d, level) => d;
        `);
        const loaded = await loadCodecModule(file);
        expect(loaded.codecs).toEqual([]);
        expect(loaded.inflateImpl).toBe(true);
        expect(loaded.deflateImpl).toBe(true);
    });

    it('rejects a module exporting nothing usable', async () => {
        const file = await writeModule(`export const unrelated = 1;`);
        await expectInput(loadCodecModule(file), /exports nothing usable/);
    });

    it('rejects an out-of-range or non-integer method', async () => {
        await expectInput(
            loadCodecModule(await writeModule(`export const codecs = [{ method: 70000, name: 'x', decompressSync(d) { return d; } }];`)),
            /invalid codec/,
        );
        await expectInput(
            loadCodecModule(await writeModule(`export const codecs = [{ method: -1, name: 'x', decompressSync(d) { return d; } }];`)),
            /invalid codec/,
        );
        await expectInput(
            loadCodecModule(await writeModule(`export const codecs = [{ method: 1.5, name: 'x', decompressSync(d) { return d; } }];`)),
            /invalid codec/,
        );
    });

    it('rejects a missing or empty name', async () => {
        await expectInput(
            loadCodecModule(await writeModule(`export const codecs = [{ method: 5, name: '', decompressSync(d) { return d; } }];`)),
            /invalid codec/,
        );
        await expectInput(
            loadCodecModule(await writeModule(`export const codecs = [{ method: 5, decompressSync(d) { return d; } }];`)),
            /invalid codec/,
        );
    });

    it('rejects a codec with no implementation function', async () => {
        await expectInput(loadCodecModule(await writeModule(`export const codecs = [{ method: 5, name: 'x' }];`)), /invalid codec/);
    });

    it('rejects a codec whose implementation is not a function', async () => {
        await expectInput(
            loadCodecModule(await writeModule(`export const codecs = [{ method: 5, name: 'x', decompressSync: 'nope' }];`)),
            /invalid codec/,
        );
        await expectInput(
            loadCodecModule(await writeModule(`export const codecs = [{ method: 5, name: 'x', decompressSync(d) { return d; }, compressSync: 42 }];`)),
            /invalid codec/,
        );
    });

    it('rejects non-object codec entries', async () => {
        await expectInput(loadCodecModule(await writeModule(`export const codecs = [null];`)), /invalid codec/);
        await expectInput(loadCodecModule(await writeModule(`export const codecs = ['xor'];`)), /invalid codec/);
    });

    it('rejects a non-function inflateImpl / deflateImpl', async () => {
        await expectInput(loadCodecModule(await writeModule(`export const inflateImpl = 42;`)), /inflateImpl must be a function/);
        await expectInput(loadCodecModule(await writeModule(`export const deflateImpl = 'x';`)), /deflateImpl must be a function/);
    });

    it('rejects a module that cannot be loaded (missing file, syntax error)', async () => {
        await expectInput(loadCodecModule(join(dir, 'missing.mjs')), /Cannot load codec module/);
        await expectInput(loadCodecModule(await writeModule(`export const codecs = [{ method: 5 `)), /Cannot load codec module/);
    });

    it('rejects a traversal path before importing', async () => {
        await expectInput(loadCodecModule('../evil.mjs'), /Path traversal/);
    });

    it('does not record a module that failed validation', async () => {
        const before = loadedCodecModules().length;
        await expectInput(loadCodecModule(await writeModule(`export const codecs = [{ method: 5, name: 'x' }];`)), /invalid codec/);
        expect(loadedCodecModules().length).toBe(before);
    });
});
