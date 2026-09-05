// `create --stream` (data-descriptor layout, constant memory, stdout) piped
// into `stream` (forward-only reader over an unseekable source). The archive
// never touches disk on the way: create's stdout chunks are captured and fed
// to the reader as a Readable — the "curl | zipnative stream" shape.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { create } from '../../src/commands/create.js';
import { stream } from '../../src/commands/stream.js';
import { list } from '../../src/commands/list.js';
import { parseArgs } from '../../src/utils/args.js';

interface Run {
    readonly out: Buffer;
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
    return { out: Buffer.concat(outChunks), err: errChunks.join(''), error };
}

function envelope(err: string): Record<string, unknown> {
    const lines = err.split('\n').filter((l) => l.startsWith('{'));
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

const originalStdin = process.stdin;
function setStdin(bytes: Uint8Array): void {
    // Several small chunks: the readers must cope with arbitrary chunking.
    const chunks: Buffer[] = [];
    for (let i = 0; i < bytes.length; i += 1000) chunks.push(Buffer.from(bytes.subarray(i, i + 1000)));
    Object.defineProperty(process, 'stdin', { value: Readable.from(chunks), configurable: true });
}

interface StreamReport {
    mode: string;
    trust: string;
    entries: { name: string; usesDataDescriptor: boolean; compressedSize: number; uncompressedSize: number; crc32: string }[];
}

interface ListReport {
    entries: { name: string; usesDataDescriptor: boolean; uncompressedSize: number; crc32: string }[];
}

const ONE = 'streamed file one '.repeat(300);
const TWO = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 7) & 0xff));
const STDIN_PAYLOAD = 'payload that arrived on stdin '.repeat(100);

describe('integration: create --stream → stream (forward read)', () => {
    let dir = '';
    let archive: Uint8Array = new Uint8Array(0);

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        const files = join(dir, 'files');
        await mkdir(files);
        await writeFile(join(files, 'one.txt'), ONE);
        await writeFile(join(files, 'two.bin'), TWO);
        setStdin(Buffer.from(STDIN_PAYLOAD));
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => create(parseArgs([files, '--stream', '--stdin-name', 'in.txt'])));
        delete process.env['ZIPNATIVE_JSON'];
        expect(r.error).toBeUndefined();
        expect(envelope(r.err)).toMatchObject({ ok: true, command: 'create', output: '-', stream: true, entries: 3, bytes: r.out.length });
        archive = new Uint8Array(r.out);
        expect(archive.length).toBeGreaterThan(0);
        expect(archive.subarray(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_QUIET'];
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });

    it('the streamed archive lists in canonical order with every entry in descriptor layout', async () => {
        setStdin(archive);
        const r = await run(() => stream(parseArgs(['--format', 'json'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.out.toString('utf8')) as StreamReport;
        expect(doc.mode).toBe('list');
        expect(doc.trust).toBe('local-headers-only');
        expect(doc.entries.map((e) => e.name)).toEqual(['files/one.txt', 'files/two.bin', 'in.txt']);
        expect(doc.entries.every((e) => e.usesDataDescriptor)).toBe(true);
        expect(r.err).toContain('warning: forward streaming trusts local headers only');
    });

    it('the central directory (random-access list) carries the real descriptor sizes and CRCs', async () => {
        const path = join(dir, 'streamed.zip');
        await writeFile(path, archive);
        const r = await run(() => list(parseArgs(['--input', path, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.out.toString('utf8')) as ListReport;
        const byName = new Map(doc.entries.map((e) => [e.name, e]));
        expect(byName.get('files/one.txt')?.uncompressedSize).toBe(ONE.length);
        expect(byName.get('files/two.bin')?.uncompressedSize).toBe(TWO.length);
        expect(byName.get('in.txt')?.uncompressedSize).toBe(STDIN_PAYLOAD.length);
        expect(doc.entries.every((e) => e.usesDataDescriptor)).toBe(true);
        expect(doc.entries.every((e) => /^[0-9a-f]{8}$/.test(e.crc32) && e.crc32 !== '00000000')).toBe(true);
    });

    it('stream --cat returns the original bytes of a descriptor entry (stdin-sourced and file-sourced)', async () => {
        setStdin(archive);
        process.env['ZIPNATIVE_JSON'] = '1';
        const fromStdin = await run(() => stream(parseArgs(['--cat', 'in.txt'])));
        expect(fromStdin.error).toBeUndefined();
        expect(fromStdin.out.toString('utf8')).toBe(STDIN_PAYLOAD);
        expect(envelope(fromStdin.err)).toMatchObject({ mode: 'cat', bytes: STDIN_PAYLOAD.length, stoppedAt: 'central-directory' });

        setStdin(archive);
        const binary = await run(() => stream(parseArgs(['--cat', 'files/two.bin'])));
        expect(binary.error).toBeUndefined();
        expect(binary.out.equals(TWO)).toBe(true);

        setStdin(archive);
        const both = await run(() => stream(parseArgs(['--cat', 'files/one.txt', '--cat', 'in.txt'])));
        expect(both.error).toBeUndefined();
        expect(both.out.toString('utf8')).toBe(ONE + STDIN_PAYLOAD);
    });

    it('stream --output-dir extracts the forward-read archive byte-for-byte', async () => {
        setStdin(archive);
        process.env['ZIPNATIVE_JSON'] = '1';
        const out = join(dir, 'unpacked');
        const r = await run(() => stream(parseArgs(['--output-dir', out])));
        expect(r.error).toBeUndefined();
        expect(await readFile(join(out, 'files', 'one.txt'), 'utf8')).toBe(ONE);
        expect((await readFile(join(out, 'files', 'two.bin'))).equals(TWO)).toBe(true);
        expect(await readFile(join(out, 'in.txt'), 'utf8')).toBe(STDIN_PAYLOAD);
        expect(envelope(r.err)).toMatchObject({
            mode: 'extract',
            entries: 3,
            bytes: ONE.length + TWO.length + STDIN_PAYLOAD.length,
            skipped: [],
            stoppedAt: 'central-directory',
        });
    });
});
