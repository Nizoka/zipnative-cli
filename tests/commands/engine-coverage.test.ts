// Engine capabilities surfaced by audit B (batch B5): argv insertion order,
// manifest extra fields, binary archive comments, raw-name / comment hex,
// `verify --entry`, `extract --skip-unsupported`, `cat` on a sync-only codec
// and `inflate` bytesConsumed. One file: the codec it registers (method 99)
// is process-global and vitest isolates module state per file.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';
import { cat } from '../../src/commands/cat.js';
import { create } from '../../src/commands/create.js';
import { extract } from '../../src/commands/extract.js';
import { inflate } from '../../src/commands/inflate.js';
import { inspect, type InspectReport } from '../../src/commands/inspect.js';
import { list, type ListReport } from '../../src/commands/list.js';
import { modify } from '../../src/commands/modify.js';
import { verify, type VerifyReport } from '../../src/commands/verify.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';
import { walkPaths } from '../../src/utils/walk.js';
import { createZip, openZip } from '../../src/core-bridge/index.js';
import { buildRawZip } from '../helpers/raw-zip-builder.js';

interface Run {
    readonly out: Buffer;
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
    const out = Buffer.concat(outChunks);
    return { out, text: out.toString('utf8'), err: errChunks.join(''), error };
}

function envelope(err: string): Record<string, unknown> {
    const lines = err.split('\n').filter((l) => l.startsWith('{'));
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

async function listJson(argv: string[]): Promise<ListReport> {
    const r = await run(() => list(parseArgs([...argv, '--format', 'json'])));
    expect(r.error).toBeUndefined();
    return JSON.parse(r.text) as ListReport;
}

const enc = new TextEncoder();
let dir = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-cov-'));
});

afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env['ZIPNATIVE_JSON'];
    delete process.env['ZIPNATIVE_QUIET'];
    await rm(dir, { recursive: true, force: true });
});

async function epubTree(): Promise<string> {
    const src = join(dir, 'book');
    await mkdir(join(src, 'META-INF'), { recursive: true });
    await writeFile(join(src, 'mimetype'), 'application/epub+zip');
    await writeFile(join(src, 'META-INF', 'container.xml'), '<container/>');
    await writeFile(join(src, 'z.txt'), 'last');
    return src;
}

function namesOf(bytes: Uint8Array): string[] {
    return [...openZip(bytes).entries()].map((e) => e.name);
}

describe('create --order insertion honours the argv order', () => {
    it('mimetype first when listed first; reversed argv reverses; canonical stays sorted', async () => {
        const src = await epubTree();
        const a = join(dir, 'a.zip');
        const b = join(dir, 'b.zip');
        const c = join(dir, 'c.zip');
        await create(parseArgs([join(src, 'mimetype'), join(src, 'META-INF'), join(src, 'z.txt'), '--base', src, '--order', 'insertion', '-o', a]));
        expect(namesOf(await readFile(a))).toEqual(['mimetype', 'META-INF/container.xml', 'z.txt']);
        await create(parseArgs([join(src, 'z.txt'), join(src, 'META-INF'), join(src, 'mimetype'), '--base', src, '--order', 'insertion', '-o', b]));
        expect(namesOf(await readFile(b))).toEqual(['z.txt', 'META-INF/container.xml', 'mimetype']);
        await create(parseArgs([join(src, 'z.txt'), join(src, 'META-INF'), join(src, 'mimetype'), '--base', src, '-o', c]));
        expect(namesOf(await readFile(c))).toEqual(['META-INF/container.xml', 'mimetype', 'z.txt']);
    });

    it('walkPaths keeps the input order only with preserveInputOrder (directories still name-sorted)', async () => {
        const src = await epubTree();
        const inputs = [join(src, 'z.txt'), join(src, 'META-INF'), join(src, 'mimetype')];
        expect((await walkPaths(inputs, { base: src })).files.map((f) => f.name)).toEqual(['META-INF/container.xml', 'mimetype', 'z.txt']);
        expect((await walkPaths(inputs, { base: src, preserveInputOrder: true })).files.map((f) => f.name)).toEqual(['z.txt', 'META-INF/container.xml', 'mimetype']);
    });
});

describe('manifest extraFields and binary comments', () => {
    it('create manifest: extraFields { id, hex | base64 } round-trip through list --long and inspect --extra', async () => {
        const manifest = join(dir, 'm.json');
        await writeFile(manifest, JSON.stringify({
            entries: [
                { name: 'a.txt', data: 'alpha', extraFields: [{ id: '0x6a6a', hex: 'deadbeef' }, { id: 0x5a5a, base64: 'AQIDBA==' }] },
                { name: 'b.txt', data: 'bravo' },
            ],
        }));
        const out = join(dir, 'x.zip');
        await create(parseArgs(['--from-manifest', manifest, '-o', out]));
        const doc = await listJson([out, '--long']);
        const a = doc.entries.find((e) => e.name === 'a.txt');
        expect(a?.extraFields?.map((x) => [x.id, x.length])).toEqual([[0x6a6a, 4], [0x5a5a, 4]]);
        expect(a?.rawNameHex).toBe(Buffer.from('a.txt').toString('hex'));
        const r = await run(() => inspect(parseArgs([out, '--format', 'json', '--entries', '--extra'])));
        const report = JSON.parse(r.text) as InspectReport;
        const row = report.entries?.find((e) => e.name === 'a.txt');
        expect(row?.extraFields?.map((x) => x.hex)).toEqual(['deadbeef', '01020304']);
    });

    it('create manifest: malformed extraFields are E_INPUT', async () => {
        const cases: unknown[] = [
            [{ id: '0x6a6a', hex: 'abc' }],
            [{ id: 0x6a6a, hex: 'ab', base64: 'qw==' }],
            [{ id: 70000, hex: 'ab' }],
            [{ id: 1 }],
            [{ id: 1, hex: 'ab', bogus: 1 }],
            'nope',
        ];
        for (const extraFields of cases) {
            const manifest = join(dir, 'bad.json');
            await writeFile(manifest, JSON.stringify({ entries: [{ name: 'a.txt', data: 'x', extraFields }] }));
            const r = await run(() => create(parseArgs(['--from-manifest', manifest, '-o', join(dir, 'never.zip')])));
            expect(r.error, JSON.stringify(extraFields)).toMatchObject({ code: ErrorCode.INPUT, exitCode: 1 });
        }
    });

    it('--comment-file stores raw bytes (reported as commentHex); --comment and --comment-file are exclusive', async () => {
        const src = await epubTree();
        const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]); // "café" in Latin-1: not UTF-8
        const commentFile = join(dir, 'comment.bin');
        await writeFile(commentFile, latin1);
        const out = join(dir, 'c.zip');
        await create(parseArgs([src, '-o', out, '--comment-file', commentFile]));
        const doc = await listJson([out]);
        expect(doc.archive.commentBytes).toBe(4);
        expect(doc.archive.commentHex).toBe('636166e9');
        expect(doc.archive.comment).toBe('caf�');
        const both = await run(() => create(parseArgs([src, '-o', join(dir, 'never.zip'), '--comment', 'x', '--comment-file', commentFile])));
        expect(both.error).toMatchObject({ exitCode: 2 });
        const big = join(dir, 'big.bin');
        await writeFile(big, Buffer.alloc(65536));
        const tooBig = await run(() => create(parseArgs([src, '-o', join(dir, 'never.zip'), '--comment-file', big])));
        expect(tooBig.error).toMatchObject({ code: ErrorCode.INPUT });
        expect((tooBig.error as Error).message).toMatch(/65535-byte/);
    });

    it('manifest commentBase64 (create and modify) writes raw bytes; comment + commentBase64 is E_INPUT', async () => {
        const manifest = join(dir, 'm.json');
        await writeFile(manifest, JSON.stringify({ commentBase64: 'Y2Fm6Q==', entries: [{ name: 'a.txt', data: 'alpha' }] }));
        const out = join(dir, 'x.zip');
        await create(parseArgs(['--from-manifest', manifest, '-o', out]));
        expect((await listJson([out])).archive.commentHex).toBe('636166e9');

        const edits = join(dir, 'e.json');
        await writeFile(edits, JSON.stringify({ commentBase64: 'AAECAw==', edits: [{ op: 'add-dir', name: 'd' }] }));
        const out2 = join(dir, 'y.zip');
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => modify(parseArgs(['--input', out, '-o', out2, '--from-manifest', edits])));
        expect(r.error).toBeUndefined();
        expect(envelope(r.err)['edits']).toEqual([{ op: 'add-dir', name: 'd' }, { op: 'comment', name: '<4 bytes>' }]);
        expect((await listJson([out2])).archive.commentHex).toBe('00010203');

        await writeFile(manifest, JSON.stringify({ comment: 'x', commentBase64: 'AA==', entries: [] }));
        const bad = await run(() => create(parseArgs(['--from-manifest', manifest, '-o', join(dir, 'never.zip')])));
        expect(bad.error).toMatchObject({ code: ErrorCode.INPUT });
    });

    it('modify: --comment-file, manifest mode and extraFields on new entries', async () => {
        const base = join(dir, 'base.zip');
        const w = createZip();
        w.add('keep.txt', 'keep');
        await writeFile(base, w.toBytes());
        const commentFile = join(dir, 'c.bin');
        await writeFile(commentFile, Uint8Array.from([0xff, 0xfe]));
        const out = join(dir, 'out.zip');
        await modify(parseArgs(['--input', base, '-o', out, '--comment-file', commentFile]));
        expect((await listJson([out])).archive.commentHex).toBe('fffe');

        const edits = join(dir, 'e.json');
        await writeFile(edits, JSON.stringify({
            edits: [
                { op: 'add', name: 'bin/tool.sh', data: '#!/bin/sh\n', mode: '0755', extraFields: [{ id: '0x7777', hex: 'cafe' }] },
                { op: 'add-dir', name: 'bin/sub', mode: '0700' },
            ],
        }));
        const out2 = join(dir, 'out2.zip');
        await modify(parseArgs(['--input', base, '-o', out2, '--from-manifest', edits]));
        const doc = await listJson([out2, '--long']);
        const tool = doc.entries.find((e) => e.name === 'bin/tool.sh');
        expect(tool?.unixMode).toBe('0755');
        expect(tool?.extraFields?.map((x) => [x.id, x.length])).toEqual([[0x7777, 2]]);
        expect(doc.entries.find((e) => e.name === 'bin/sub/')?.unixMode).toBe('0700');
    });
});

describe('forensic hex fields', () => {
    it('list --long / inspect --entries expose rawNameHex and commentHex for a cp437 name with a comment', async () => {
        const name = Uint8Array.from([0x63, 0x61, 0x66, 0x82]); // "caf" + cp437 é
        const p = join(dir, 'cp437.zip');
        await writeFile(p, buildRawZip([{ name, data: enc.encode('x'), comment: Uint8Array.from([0xe9, 0x21]) }]));
        const doc = await listJson([p, '--long']);
        const row = doc.entries[0];
        expect(row?.nameEncoding).toBe('cp437');
        expect(row?.rawNameHex).toBe('63616682');
        expect(row?.commentHex).toBe('e921');
        const plain = await listJson([p]);
        expect(plain.entries[0]?.rawNameHex).toBeUndefined();
    });
});

describe('verify --entry', () => {
    async function fixture(): Promise<string> {
        const p = join(dir, 'v.zip');
        await writeFile(p, buildRawZip([
            { name: 'good.txt', data: enc.encode('good content'), method: 8 },
            { name: 'lie.txt', data: enc.encode('lying content'), crcOverride: 0x12345678 },
            { name: 'secret.bin', data: enc.encode('opaque'), flags: 0x0001 },
        ]));
        return p;
    }

    it('verifies only the named entries and lists them under selected', async () => {
        const p = await fixture();
        const r = await run(() => verify(parseArgs([p, '--entry', 'good.txt', '--format', 'json'])));
        expect(r.error).toBeUndefined();
        const report = JSON.parse(r.text) as VerifyReport;
        expect(report).toMatchObject({ ok: true, entryCount: 3, failed: 0, skipped: 0, selected: ['good.txt'] });
        expect(report.entries.map((e) => e.name)).toEqual(['good.txt']);
        const text = await run(() => verify(parseArgs([p, '-e', 'good.txt'])));
        expect(text.error).toBeUndefined();
        expect(text.text).toMatch(/1 selected of 3/);
        expect(text.text).toMatch(/OK: 1 entries/);
    });

    it('a CRC lie in a selected entry is E_VERIFY_FAILED with the entry marked, while unselected lies are not read', async () => {
        const p = await fixture();
        const r = await run(() => verify(parseArgs([p, '-e', 'lie.txt', '-e', 'good.txt', '--format', 'json'])));
        expect(r.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED, exitCode: 1 });
        const report = JSON.parse(r.text) as VerifyReport;
        expect(report.ok).toBe(false);
        expect(report.entries.find((e) => e.name === 'lie.txt')).toMatchObject({ ok: false, crcMatch: false });
        expect(report.failed).toBe(1);
        expect((r.error as Error).message).toMatch(/1 of 2 entries failed/);
        const only = await run(() => verify(parseArgs([p, '-e', 'good.txt', '--format', 'json'])));
        expect(only.error).toBeUndefined();
    });

    it('an unknown name is E_NOT_FOUND / ZIP_ENTRY_NOT_FOUND before any output; an encrypted one is skipped', async () => {
        const p = await fixture();
        const r = await run(() => verify(parseArgs([p, '-e', 'missing.txt', '--format', 'json'])));
        expect(r.error).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND', entryName: 'missing.txt' });
        expect(r.text).toBe('');
        const s = await run(() => verify(parseArgs([p, '-e', 'secret.bin', '--format', 'json', '--summary'])));
        expect(s.error).toBeUndefined();
        expect(JSON.parse(s.text)).toEqual({ ok: true, entries: 3, failed: 0, skipped: 1, diagnostics: 0, selected: 1 });
    });

    it('a structurally broken archive lands in report.error, like verifyZip', async () => {
        const p = join(dir, 'bad.zip');
        await writeFile(p, enc.encode('this is not a zip archive at all, not even close'));
        const r = await run(() => verify(parseArgs([p, '-e', 'x', '--format', 'json'])));
        expect(r.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED, zipCode: 'ZIP_EOCD_NOT_FOUND' });
        const report = JSON.parse(r.text) as VerifyReport;
        expect(report.error?.code).toBe('ZIP_EOCD_NOT_FOUND');
        expect(report.entries).toEqual([]);
    });
});

describe('extract --skip-unsupported', () => {
    it('skips encrypted entries and unregistered methods (reason "unsupported") instead of failing', async () => {
        const p = join(dir, 'mixed.zip');
        await writeFile(p, buildRawZip([
            { name: 'secret.bin', data: enc.encode('opaque'), flags: 0x0001 },
            { name: 'exotic.bin', data: enc.encode('who knows'), method: 42 },
            { name: 'plain.txt', data: enc.encode('plain') },
        ]));
        const out = join(dir, 'out');
        const refused = await run(() => extract(parseArgs([p, '-d', out])));
        expect(refused.error).toMatchObject({ code: ErrorCode.UNSUPPORTED });
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => extract(parseArgs([p, '-d', join(dir, 'out2'), '--skip-unsupported'])));
        expect(r.error).toBeUndefined();
        expect(await readFile(join(dir, 'out2', 'plain.txt'), 'utf8')).toBe('plain');
        expect(existsSync(join(dir, 'out2', 'secret.bin'))).toBe(false);
        expect(envelope(r.err)).toMatchObject({
            ok: true,
            entries: 1,
            skipped: [{ name: 'secret.bin', reason: 'unsupported' }, { name: 'exotic.bin', reason: 'unsupported' }],
        });
    });
});

describe('sync-only --codec modules', () => {
    const XOR = 1;
    let module = '';
    let archive = '';

    beforeEach(async () => {
        module = join(dir, 'xor.mjs');
        await writeFile(module, `export const codecs = [{ method: 99, name: 'xor', decompressSync(d) { return d.map((b) => b ^ ${XOR}); } }];\n`);
        const plain = enc.encode('decoded through a sync-only codec');
        archive = join(dir, 'xor.zip');
        await writeFile(archive, buildRawZip([{ name: 'x.txt', data: plain.map((b) => b ^ XOR), method: 99, crcOverride: crcOf(plain) }]));
    });

    function crcOf(data: Uint8Array): number {
        // node:zlib's crc32 — the foreign reference implementation.
        return zlibCrc32(data) >>> 0;
    }

    it('cat falls back to readEntry() when the codec has no decompressStream', async () => {
        const r = await run(() => cat(parseArgs([archive, 'x.txt', '--codec', module])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe('decoded through a sync-only codec');
    });

    it('verify --entry decodes through the codec too', async () => {
        const r = await run(() => verify(parseArgs([archive, '-e', 'x.txt', '--codec', module, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        expect((JSON.parse(r.text) as VerifyReport).entries[0]).toMatchObject({ name: 'x.txt', ok: true });
    });
});

describe('inflate bytesConsumed', () => {
    it('streaming: bytesConsumed = bytesIn - leftover; --sync: the whole buffer', async () => {
        const payload = Buffer.from('inflate me '.repeat(100));
        const stream = deflateRawSync(payload);
        const input = join(dir, 'in.deflate');
        await writeFile(input, Buffer.concat([stream, Buffer.from('TRAIL')]));
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => inflate(parseArgs(['--input', input, '--allow-trailing'])));
        expect(r.error).toBeUndefined();
        expect(r.out.equals(payload)).toBe(true);
        const env = envelope(r.err);
        expect(env).toMatchObject({ bytesIn: stream.length + 5, leftover: 5, bytesConsumed: stream.length, bytesOut: payload.length });
        const clean = join(dir, 'clean.deflate');
        await writeFile(clean, stream);
        const s = await run(() => inflate(parseArgs(['--input', clean, '--sync'])));
        expect(s.error).toBeUndefined();
        expect(envelope(s.err)).toMatchObject({ bytesIn: stream.length, bytesConsumed: stream.length, leftover: 0 });
    });
});
