import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPureCodecs, prepareEngine } from '../../src/utils/engine.js';
import { loadedCodecModules } from '../../src/utils/codecs.js';
import { activeDeflateTier, getCodec } from '../../src/core-bridge/index.js';
import { parseArgs } from '../../src/utils/args.js';

let dir = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
});

afterEach(async () => {
    delete process.env['ZIPNATIVE_PURE_CODECS'];
    await rm(dir, { recursive: true, force: true });
});

describe('isPureCodecs', () => {
    it('is false by default', () => {
        expect(isPureCodecs()).toBe(false);
        expect(isPureCodecs(parseArgs([]))).toBe(false);
    });

    it('reads ZIPNATIVE_PURE_CODECS=1', () => {
        process.env['ZIPNATIVE_PURE_CODECS'] = '1';
        expect(isPureCodecs()).toBe(true);
        expect(isPureCodecs(parseArgs([]))).toBe(true);
    });

    it('reads the --pure-codecs flag', () => {
        expect(isPureCodecs(parseArgs(['--pure-codecs']))).toBe(true);
    });

    it('ignores other env values', () => {
        process.env['ZIPNATIVE_PURE_CODECS'] = 'true';
        expect(isPureCodecs()).toBe(false);
    });
});

describe('prepareEngine', () => {
    it('resolves node:zlib so the active deflate tier is node-zlib', async () => {
        await prepareEngine(parseArgs([]));
        expect(activeDeflateTier(false)).toBe('node-zlib');
        expect(activeDeflateTier(true)).toBe('pure-pinned');
    });

    it('is idempotent', async () => {
        await prepareEngine(parseArgs([]));
        await prepareEngine(parseArgs([]));
        await prepareEngine(parseArgs(['--pure-codecs']));
        expect(activeDeflateTier(false)).toBe('node-zlib');
    });

    it('loads --codec modules once each, even when repeated', async () => {
        const file = join(dir, 'codec.mjs');
        await writeFile(file, `export const codecs = [{ method: 95, name: 'engine-xor', decompressSync(d) { return d; } }];`);
        const before = loadedCodecModules().length;
        await prepareEngine(parseArgs(['--codec', file]));
        expect(getCodec(95)?.name).toBe('engine-xor');
        expect(loadedCodecModules().length).toBe(before + 1);
        await prepareEngine(parseArgs(['--codec', file, '--codec', file]));
        expect(loadedCodecModules().length).toBe(before + 1);
    });

    it('propagates E_INPUT from an invalid codec module', async () => {
        const file = join(dir, 'bad.mjs');
        await writeFile(file, `export const nothing = true;`);
        await expect(prepareEngine(parseArgs(['--codec', file]))).rejects.toMatchObject({ code: 'E_INPUT', exitCode: 1 });
    });
});
