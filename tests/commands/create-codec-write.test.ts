// A `--codec` module shapes what the WRITER emits (audit B-07 / B-02): a codec
// registered for method 0/8 replaces the built-in compressor, a deflateImpl
// replaces the sync deflate tier. Registration is process-global, so this
// suite lives in its own file (vitest isolates module state per file).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from '../../src/commands/create.js';
import { parseArgs } from '../../src/utils/args.js';
import { openZip } from '../../src/core-bridge/index.js';

let tmp = '';
let src = '';
let stderr: string[] = [];

async function writeModule(name: string, body: string): Promise<string> {
    const p = join(tmp, name);
    await writeFile(p, body);
    return p;
}

function envelope(): Record<string, unknown> {
    const lines = stderr.join('').split('\n').filter((l) => l.startsWith('{'));
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

async function fails(argv: string[]): Promise<unknown> {
    try {
        await create(parseArgs(argv));
    } catch (e) {
        return e;
    }
    return undefined;
}

beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'zipnative-cli-codec-'));
    src = join(tmp, 'src');
    await mkdir(src);
    await writeFile(join(src, 'a.txt'), 'alpha alpha alpha alpha alpha alpha alpha\n'.repeat(40));
    stderr = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { stderr.push(String(chunk)); return true; }) as typeof process.stderr.write);
    delete process.env['ZIPNATIVE_JSON'];
});

afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env['ZIPNATIVE_JSON'];
    await rm(tmp, { recursive: true, force: true });
});

describe('create with a writer-shaping --codec module', () => {
    it('a deflateImpl under --parallel is refused (exit 2) unless --deterministic pins the encoder', async () => {
        const mod = await writeModule('deflate-impl.mjs', 'export const deflateImpl = (data) => new Uint8Array(data);\n');
        const e = await fails([src, '--codec', mod, '--parallel', '-o', join(tmp, 'p.zip')]);
        expect(e).toMatchObject({ exitCode: 2 });
        expect((e as Error).message).toMatch(/deflateImpl[\s\S]*worker pool[\s\S]*--deterministic/);
        process.env['ZIPNATIVE_JSON'] = '1';
        await create(parseArgs([src, '--codec', mod, '--parallel', '--deterministic', '-o', join(tmp, 'p.zip')]));
        expect(envelope()).toMatchObject({ ok: true, tier: 'pure-pinned', parallel: { workers: 'auto' } });
        const entries = [...openZip(new Uint8Array(await readFile(join(tmp, 'p.zip')))).entries()];
        expect(entries.map((x) => x.name)).toEqual(['src/a.txt']);
    });

    it('a method-8 codec drives the sequential writer (warning + valid archive) and is refused under --parallel', async () => {
        const mod = await writeModule('deflate8.mjs', [
            "import { deflateRawSync, inflateRawSync } from 'node:zlib';",
            'export const codecs = [{ method: 8, name: "zlib-via-module",',
            '  compressSync: (d, o) => new Uint8Array(deflateRawSync(d, { level: o?.level ?? 6 })),',
            '  decompressSync: (d) => new Uint8Array(inflateRawSync(d)) }];',
            '',
        ].join('\n'));
        const refused = await fails([src, '--codec', mod, '--parallel', '--deterministic', '-o', join(tmp, 'p.zip')]);
        expect(refused).toMatchObject({ exitCode: 2 });
        expect((refused as Error).message).toMatch(/registers method 8/);

        process.env['ZIPNATIVE_JSON'] = '1';
        await create(parseArgs([src, '--codec', mod, '-o', join(tmp, 's.zip')]));
        expect(stderr.join('')).toMatch(/warning: --codec .*registers method 8 and replaces the built-in compressor/);
        expect(envelope()).toMatchObject({ ok: true, entries: 1 });
        const reader = openZip(new Uint8Array(await readFile(join(tmp, 's.zip'))));
        expect(Buffer.from(reader.readEntry('src/a.txt')).toString()).toMatch(/^alpha alpha/);

        stderr = [];
        await create(parseArgs([src, '--codec', mod, '-o', join(tmp, 'd.zip'), '--dry-run']));
        expect(stderr.join('')).not.toMatch(/warning: --codec/);
    });
});
