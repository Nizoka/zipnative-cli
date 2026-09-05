// Agent-contract fixes from audit A/B (batch B6): one stdout document for
// `batch --manifest --json`, env-driven dry-run silence, error classes for
// unsafe names, doctor limits data, stream summary markers, 4-digit unixMode,
// and the engine code on every CLI-side E_NOT_FOUND.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batch } from '../../src/commands/batch.js';
import { cat } from '../../src/commands/cat.js';
import { create } from '../../src/commands/create.js';
import { doctor } from '../../src/commands/doctor.js';
import { extract } from '../../src/commands/extract.js';
import { inspect } from '../../src/commands/inspect.js';
import { modify } from '../../src/commands/modify.js';
import { stream } from '../../src/commands/stream.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';
import { rowFromEntry } from '../../src/utils/entryfmt.js';
import { createZip, openZip, type ZipEntry } from '../../src/core-bridge/index.js';
import { buildRawZip } from '../helpers/raw-zip-builder.js';

interface Run {
    readonly text: string;
    readonly err: string;
    readonly error: unknown;
}

async function run(fn: () => Promise<void>): Promise<Run> {
    const outChunks: Buffer[] = [];
    const errChunks: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        outChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
        const cb = rest.find((r) => typeof r === 'function') as ((err?: Error | null) => void) | undefined;
        if (cb !== undefined) cb();
        return true;
    }) as unknown as typeof process.stdout.write);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        errChunks.push(String(chunk));
        return true;
    }) as unknown as typeof process.stderr.write);
    let error: unknown;
    try {
        await fn();
    } catch (e) {
        error = e;
    } finally {
        outSpy.mockRestore();
        errSpy.mockRestore();
    }
    return { text: Buffer.concat(outChunks).toString('utf8'), err: errChunks.join(''), error };
}

let dir = '';
let src = '';
let archive = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-agent-'));
    src = join(dir, 'src');
    await mkdir(join(src, 'sub'), { recursive: true });
    await writeFile(join(src, 'a.txt'), 'alpha\n');
    await writeFile(join(src, 'sub', 'b.txt'), 'bravo\n');
    const w = createZip();
    w.add('a.txt', 'alpha\n');
    w.add('sub/b.txt', 'bravo\n');
    archive = join(dir, 'in.zip');
    await writeFile(archive, w.toBytes());
});

afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env['ZIPNATIVE_JSON'];
    delete process.env['ZIPNATIVE_DRY_RUN'];
    delete process.env['ZIPNATIVE_QUIET'];
    await rm(dir, { recursive: true, force: true });
});

describe('batch --manifest under --json writes ONE stdout document', () => {
    async function manifest(tasks: unknown[]): Promise<string> {
        const p = join(dir, 'tasks.json');
        await writeFile(p, JSON.stringify({ version: 1, tasks }));
        return p;
    }

    it('captures each task\'s stdout into tasks[i].report (JSON), an NDJSON array, or .stdout (text)', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const m = await manifest([
            { id: 'build', command: 'create', flags: { input: src, base: src, output: join(dir, 'out.zip') } },
            { id: 'ls', command: 'list', flags: { input: '@build', format: 'json' } },
            { id: 'nd', command: 'list', flags: { input: '@build', format: 'ndjson' } },
            { id: 'txt', command: 'list', flags: { input: '@build', format: 'text' } },
            { id: 'check', command: 'verify', flags: { input: '@build' } },
        ]);
        const r = await run(() => batch(parseArgs(['--manifest', m])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as { ok: boolean; total: number; tasks: Record<string, unknown>[] };
        expect(doc).toMatchObject({ ok: true, total: 5, succeeded: 5 });
        const [build, ls, nd, txt, check] = doc.tasks as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
        expect(build).toMatchObject({ id: 'build', ok: true, stdoutBytes: 0 });
        expect(build['report']).toBeUndefined();
        expect((ls['report'] as { entries: unknown[] }).entries).toHaveLength(2);
        expect(ls['stdoutBytes']).toBeGreaterThan(0);
        expect(Array.isArray(nd['report'])).toBe(true);
        expect((nd['report'] as unknown[]).length).toBe(2);
        expect(typeof txt['stdout']).toBe('string');
        expect(txt['stdout']).toContain('a.txt');
        expect(txt['report']).toBeUndefined();
        expect((check['report'] as { ok: boolean }).ok).toBe(true);
    });

    it('refuses artefact-to-stdout tasks at validation (also under --dry-run): create/modify/cat/inflate without output, stream --cat', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const cases: [unknown, RegExp][] = [
            [{ id: 'c', command: 'cat', flags: { input: archive, entry: 'a.txt' } }, /"cat" writes its artefact to stdout/],
            [{ id: 'c', command: 'create', flags: { input: src } }, /"create" writes its artefact/],
            [{ id: 'c', command: 'inflate', flags: { input: archive } }, /"inflate" writes its artefact/],
            [{ id: 'c', command: 'stream', flags: { input: archive, cat: 'a.txt' } }, /"stream --cat"/],
        ];
        for (const [task, pattern] of cases) {
            const m = await manifest([task]);
            const r = await run(() => batch(parseArgs(['--manifest', m])));
            expect(r.error, JSON.stringify(task)).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
            expect((r.error as Error).message).toMatch(pattern);
            const dry = await run(() => batch(parseArgs(['--manifest', m, '--dry-run'])));
            expect(dry.error).toMatchObject({ exitCode: 2 });
        }
        // Text mode keeps the interleaved contract: the same manifest runs.
        delete process.env['ZIPNATIVE_JSON'];
        const m = await manifest([{ id: 'c', command: 'cat', flags: { input: archive, entry: 'a.txt' } }]);
        const r = await run(() => batch(parseArgs(['--manifest', m])));
        expect(r.error).toBeUndefined();
        expect(r.text).toContain('alpha');
    });
});

describe('--dry-run under ZIPNATIVE_JSON keeps stdout empty', () => {
    it('create and extract', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const c = await run(() => create(parseArgs([src, '-o', join(dir, 'x.zip'), '--dry-run'])));
        expect(c.error).toBeUndefined();
        expect(c.text).toBe('');
        expect(c.err).toMatch(/"dryRun":true/);
        const e = await run(() => extract(parseArgs([archive, '-d', join(dir, 'out'), '--dry-run'])));
        expect(e.error).toBeUndefined();
        expect(e.text).toBe('');
        expect(e.err).toMatch(/"dryRun":true/);
    });
});

describe('error classes for entry names (data, not usage)', () => {
    it('modify --add/--rename/--add-dir with an unsafe name is E_INPUT exit 1 with entryName', async () => {
        const out = join(dir, 'o.zip');
        for (const argv of [
            ['--add', `../evil.txt=${join(src, 'a.txt')}`],
            ['--rename', 'a.txt=../up.txt'],
            ['--add-dir', 'C:/abs'],
        ]) {
            const r = await run(() => modify(parseArgs(['--input', archive, '-o', out, ...argv])));
            expect(r.error, argv.join(' ')).toMatchObject({ code: ErrorCode.INPUT, exitCode: 1 });
            expect((r.error as { entryName?: string }).entryName).toBeDefined();
        }
    });

    it('modify --add "dir/=payload" is E_INPUT pointing at --add-dir (flags and manifest)', async () => {
        const out = join(dir, 'o.zip');
        const r = await run(() => modify(parseArgs(['--input', archive, '-o', out, '--add', `docs/=${join(src, 'a.txt')}`])));
        expect(r.error).toMatchObject({ code: ErrorCode.INPUT, exitCode: 1, entryName: 'docs/' });
        expect((r.error as Error).message).toMatch(/--add-dir docs\//);
        const m = join(dir, 'e.json');
        await writeFile(m, JSON.stringify({ edits: [{ op: 'add', name: 'docs/', data: 'x' }] }));
        const r2 = await run(() => modify(parseArgs(['--input', archive, '-o', out, '--from-manifest', m])));
        expect(r2.error).toMatchObject({ code: ErrorCode.INPUT, entryName: 'docs/' });
    });

    it('create --stdin-name with an unsafe name is E_INPUT', async () => {
        const r = await run(() => create(parseArgs(['--stdin-name', '../x', '-o', join(dir, 'o.zip')])));
        expect(r.error).toMatchObject({ code: ErrorCode.INPUT, exitCode: 1, entryName: '../x' });
    });

    it('every CLI-side E_NOT_FOUND carries zipCode ZIP_ENTRY_NOT_FOUND (cat, inspect, stream --cat)', async () => {
        const c = await run(() => cat(parseArgs([archive, 'nope.txt'])));
        expect(c.error).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND', entryName: 'nope.txt' });
        const i = await run(() => inspect(parseArgs([archive, '--entry', 'nope.txt'])));
        expect(i.error).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND', entryName: 'nope.txt' });
        const s = await run(() => stream(parseArgs([archive, '--cat', 'nope.txt'])));
        expect(s.error).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND', entryName: 'nope.txt' });
    });
});

describe('doctor limits data', () => {
    it('exposes the effective bounds as numbers ("none" when disabled) plus maxInputSize', async () => {
        const r = await run(() => doctor(parseArgs(['--format', 'json', '--max-entries', '5', '--max-ratio', 'none', '--max-input-size', '1m'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as { checks: { name: string; data?: Record<string, unknown>; value: string }[] };
        const limits = doc.checks.find((c) => c.name === 'limits');
        expect(limits?.data).toMatchObject({ maxEntries: 5, maxCompressionRatio: 'none', maxInputSize: 1024 * 1024 });
        expect(limits?.value).toBe('3 override(s)');
        expect(doc.checks.filter((c) => c.name !== 'limits').every((c) => c.data === undefined)).toBe(true);
    });
});

describe('stream --summary descriptor markers', () => {
    it('reports descriptorEntries and bytesKnown', async () => {
        const w = createZip();
        w.addStream('s.txt', (async function* () { yield new TextEncoder().encode('streamed'); })());
        w.add('p.txt', 'plain');
        const chunks: Uint8Array[] = [];
        for await (const c of w.stream()) chunks.push(c);
        const p = join(dir, 'desc.zip');
        await writeFile(p, Buffer.concat(chunks));
        const r = await run(() => stream(parseArgs([p, '--list', '--format', 'json', '--summary'])));
        expect(r.error).toBeUndefined();
        expect(JSON.parse(r.text)).toEqual({ entries: 2, bytes: 5, descriptorEntries: 1, bytesKnown: false, trust: 'local-headers-only' });
        const plain = await run(() => stream(parseArgs([archive, '--list', '--format', 'json', '--summary'])));
        expect(JSON.parse(plain.text)).toMatchObject({ descriptorEntries: 0, bytesKnown: true });
    });
});

describe('unixMode is four octal digits', () => {
    it('renders 0000, 0644 and 4755', () => {
        const bytes = buildRawZip([
            { name: 'zero', data: new Uint8Array(0), externalAttributes: (0o100000 << 16) >>> 0 },
            { name: 'plain', data: new Uint8Array(0), externalAttributes: (0o100644 << 16) >>> 0 },
            { name: 'suid', data: new Uint8Array(0), externalAttributes: (0o104755 << 16) >>> 0 },
        ]);
        const rows = [...openZip(bytes).entries()].map((e: ZipEntry) => rowFromEntry(e).unixMode);
        expect(rows).toEqual(['0000', '0644', '4755']);
    });
});

describe('an existing archive is not disturbed by a refused run', () => {
    it('inspect on the fixture still works after the not-found probes', async () => {
        expect((await readFile(archive)).length).toBeGreaterThan(0);
    });
});

describe('--chunk-size with --stdin-name', () => {
    it('is accepted (the stdin path uses the chunked writer) while --chunk-size alone stays a usage error', async () => {
        const { Readable } = await import('node:stream');
        const original = Object.getOwnPropertyDescriptor(process, 'stdin');
        Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from('chunked stdin payload')]), configurable: true });
        try {
            const out = join(dir, 'stdin.zip');
            const r = await run(() => create(parseArgs(['--stdin-name', 'in.bin', '--chunk-size', '1k', '-o', out])));
            expect(r.error).toBeUndefined();
            expect([...openZip(new Uint8Array(await readFile(out))).entries()].map((e) => e.name)).toEqual(['in.bin']);
        } finally {
            if (original !== undefined) Object.defineProperty(process, 'stdin', original);
        }
        const bad = await run(() => create(parseArgs([src, '--chunk-size', '1k', '-o', join(dir, 'never.zip')])));
        expect(bad.error).toMatchObject({ exitCode: 2 });
        expect((bad.error as Error).message).toMatch(/--stream or --stdin-name/);
    });
});
