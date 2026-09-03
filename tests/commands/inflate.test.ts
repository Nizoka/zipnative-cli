import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { inflate } from '../../src/commands/inflate.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';

// ── Local capture helper (stdout as bytes) ────────────────────────────

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
function setStdin(buf: Uint8Array): void {
    Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from(buf)]), configurable: true });
}

// The foreign reference encoder: node:zlib raw deflate (RFC 1951).
const SMALL = Buffer.from('hello inflate '.repeat(50));
const SMALL_DEFLATED = deflateRawSync(SMALL);

const CODEC_MODULE = `
export const codecs = [
    { method: 98, name: 'xor', decompressSync(d) { return d.map((b) => b ^ 1); } },
    { method: 97, name: 'xstream', async *decompressStream(d) { yield d.subarray(0, 2); yield d.subarray(2); } },
    { method: 96, name: 'writeonly', compressSync(d) { return d; } },
];
`;

describe('inflate', () => {
    let dir = '';
    let small = '';

    afterEach(async () => {
        vi.restoreAllMocks();
        Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_DRY_RUN'];
        delete process.env['ZIPNATIVE_QUIET'];
        if (dir !== '') await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        dir = '';
    });

    async function setup(): Promise<void> {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        small = join(dir, 'small.deflate');
        await writeFile(small, SMALL_DEFLATED);
    }

    async function write(name: string, bytes: Uint8Array): Promise<string> {
        const p = join(dir, name);
        await writeFile(p, bytes);
        return p;
    }

    it('inflates a raw deflate stream to stdout (streaming path) with a status envelope', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => inflate(parseArgs(['--input', small])));
        expect(r.error).toBeUndefined();
        expect(r.out.equals(SMALL)).toBe(true);
        expect(envelope(r.err)).toMatchObject({
            ok: true,
            command: 'inflate',
            dryRun: false,
            output: '-',
            method: 8,
            methodName: 'deflate',
            bytesIn: SMALL_DEFLATED.length,
            bytesOut: SMALL.length,
            leftover: 0,
            sync: false,
            tier: 'node-zlib',
        });
        expect(envelope(r.err)['maxOutput']).toBe(1024 * 1024 * 1024);
    });

    it('writes to --output and accepts a positional input', async () => {
        await setup();
        const out = join(dir, 'out.bin');
        const r = await run(() => inflate(parseArgs([small, '-o', out])));
        expect(r.error).toBeUndefined();
        expect(r.out.length).toBe(0);
        expect((await readFile(out)).equals(SMALL)).toBe(true);
    });

    it('reads compressed bytes from stdin', async () => {
        setStdin(SMALL_DEFLATED);
        const r = await run(() => inflate(parseArgs([])));
        expect(r.error).toBeUndefined();
        expect(r.out.equals(SMALL)).toBe(true);
    });

    it('handles a multi-chunk input (300 KB incompressible payload)', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const big = randomBytes(300 * 1024);
        const compressed = deflateRawSync(big);
        expect(compressed.length).toBeGreaterThan(2 * 65536);
        const p = await write('big.deflate', compressed);
        const r = await run(() => inflate(parseArgs(['--input', p])));
        expect(r.error).toBeUndefined();
        expect(r.out.equals(big)).toBe(true);
        expect(envelope(r.err)).toMatchObject({ bytesIn: compressed.length, bytesOut: big.length, leftover: 0 });
    });

    it('--sync buffers the input and uses the registered codec', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => inflate(parseArgs(['--input', small, '--sync'])));
        expect(r.error).toBeUndefined();
        expect(r.out.equals(SMALL)).toBe(true);
        expect(envelope(r.err)).toMatchObject({ sync: true, bytesIn: SMALL_DEFLATED.length, bytesOut: SMALL.length });
    });

    it('--method store passes bytes through, bounded by --max-output', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const p = await write('raw.bin', Buffer.from('stored-bytes'));
        const r = await run(() => inflate(parseArgs(['--input', p, '--method', 'store'])));
        expect(r.error).toBeUndefined();
        expect(r.out.toString()).toBe('stored-bytes');
        expect(envelope(r.err)).toMatchObject({ method: 0, methodName: 'store', sync: true, bytesOut: 12 });
        const bounded = await run(() => inflate(parseArgs(['--input', p, '--method', 'store', '--max-output', '3'])));
        expect(bounded.error).toMatchObject({ code: ErrorCode.DATA, exitCode: 1 });
    });

    it('--max-output smaller than the payload is E_DATA / ZIP_INFLATE_OUTPUT_OVERFLOW', async () => {
        await setup();
        const r = await run(() => inflate(parseArgs(['--input', small, '--max-output', '10'])));
        expect(r.error).toMatchObject({ code: ErrorCode.DATA, zipCode: 'ZIP_INFLATE_OUTPUT_OVERFLOW', exitCode: 1 });
        const sync = await run(() => inflate(parseArgs(['--input', small, '--max-output', '10', '--sync'])));
        expect(sync.error).toMatchObject({ code: ErrorCode.DATA });
    });

    it('--max-entry-size is the default bound when --max-output is absent', async () => {
        await setup();
        const r = await run(() => inflate(parseArgs(['--input', small, '--max-entry-size', '16'])));
        expect(r.error).toMatchObject({ code: ErrorCode.DATA, zipCode: 'ZIP_INFLATE_OUTPUT_OVERFLOW' });
    });

    it('a corrupt stream is E_PARSE / ZIP_DEFLATE_CORRUPT and the partial --output is removed', async () => {
        await setup();
        const corrupt = Buffer.from(SMALL_DEFLATED);
        corrupt[0] = 0xff;
        corrupt[1] = 0xff;
        corrupt[2] = 0xff;
        const p = await write('corrupt.deflate', corrupt);
        const out = join(dir, 'partial.bin');
        const r = await run(() => inflate(parseArgs(['--input', p, '--output', out])));
        expect(r.error).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_DEFLATE_CORRUPT', exitCode: 1 });
        expect(existsSync(out)).toBe(false);
    });

    it('a truncated stream is E_PARSE / ZIP_DEFLATE_TRUNCATED', async () => {
        await setup();
        const p = await write('cut.deflate', SMALL_DEFLATED.subarray(0, 5));
        const r = await run(() => inflate(parseArgs(['--input', p])));
        expect(r.error).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_DEFLATE_TRUNCATED' });
    });

    it('trailing bytes are reported as leftover with a warning unless --allow-trailing', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const p = await write('trailing.deflate', Buffer.concat([SMALL_DEFLATED, Buffer.from([1, 2, 3])]));
        const r = await run(() => inflate(parseArgs(['--input', p])));
        expect(r.error).toBeUndefined();
        expect(r.out.equals(SMALL)).toBe(true);
        expect(envelope(r.err)).toMatchObject({ leftover: 3, bytesIn: SMALL_DEFLATED.length + 3, bytesOut: SMALL.length });
        expect(r.err).toContain('warning: 3 trailing byte(s)');
        const quiet = await run(() => inflate(parseArgs(['--input', p, '--allow-trailing'])));
        expect(quiet.error).toBeUndefined();
        expect(quiet.err).not.toContain('trailing byte');
        expect(envelope(quiet.err)['leftover']).toBe(3);
    });

    it('trailing bytes split across chunks are all counted as leftover', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const tail = Buffer.alloc(70 * 1024, 7);
        const p = await write('long-tail.deflate', Buffer.concat([SMALL_DEFLATED, tail]));
        const r = await run(() => inflate(parseArgs(['--input', p, '--allow-trailing'])));
        expect(r.error).toBeUndefined();
        expect(r.out.equals(SMALL)).toBe(true);
        expect(envelope(r.err)['leftover']).toBe(tail.length);
    });

    it('--method 99 without a registered codec is E_UNSUPPORTED / ZIP_UNSUPPORTED_METHOD', async () => {
        await setup();
        const r = await run(() => inflate(parseArgs(['--input', small, '--method', '99'])));
        expect(r.error).toMatchObject({
            code: ErrorCode.UNSUPPORTED,
            zipCode: 'ZIP_UNSUPPORTED_METHOD',
            exitCode: 1,
            detail: { feature: 'method:99' },
        });
    });

    it('--codec loads a module and --method selects its codec (sync, stream and write-only)', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const mod = join(dir, 'xor-codec.mjs');
        await writeFile(mod, CODEC_MODULE);
        const p = await write('xor.bin', Buffer.from([0x00, 0x01, 0x10, 0xff]));
        const r = await run(() => inflate(parseArgs(['--input', p, '--codec', mod, '--method', '98'])));
        expect(r.error).toBeUndefined();
        expect([...r.out]).toEqual([0x01, 0x00, 0x11, 0xfe]);
        expect(envelope(r.err)).toMatchObject({ method: 98, methodName: 'xor', sync: true, bytesOut: 4 });

        const streamed = await run(() => inflate(parseArgs(['--input', p, '--codec', mod, '--method', '97'])));
        expect(streamed.error).toBeUndefined();
        expect([...streamed.out]).toEqual([0x00, 0x01, 0x10, 0xff]);
        expect(envelope(streamed.err)['methodName']).toBe('xstream');

        const writeOnly = await run(() => inflate(parseArgs(['--input', p, '--codec', mod, '--method', '96'])));
        expect(writeOnly.error).toMatchObject({ code: ErrorCode.UNSUPPORTED, zipCode: 'ZIP_UNSUPPORTED_CODEC_MODE' });
    });

    it('a codec module that does not honour the contract is E_INPUT', async () => {
        await setup();
        const mod = join(dir, 'bad-codec.mjs');
        await writeFile(mod, 'export const codecs = [{ method: 5, name: "" }];');
        const r = await run(() => inflate(parseArgs(['--input', small, '--codec', mod])));
        expect(r.error).toMatchObject({ code: ErrorCode.INPUT });
        const missing = await run(() => inflate(parseArgs(['--input', small, '--codec', join(dir, 'absent.mjs')])));
        expect(missing.error).toMatchObject({ code: ErrorCode.INPUT });
    });

    it.each([
        ['--method', 'x'],
        ['--method', 'lzma'],
        ['--max-output', '0'],
        ['--max-output', 'lots'],
    ])('%s %s is a usage error (exit 2)', async (flag, value) => {
        await setup();
        const r = await run(() => inflate(parseArgs(['--input', small, flag, value])));
        expect(r.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });

    it('--max-output none lifts the bound to MAX_SAFE_INTEGER', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => inflate(parseArgs(['--input', small, '--max-output', 'none'])));
        expect(r.error).toBeUndefined();
        expect(envelope(r.err)['maxOutput']).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('--dry-run reports the plan and decompresses nothing', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const out = join(dir, 'never.bin');
        const r = await run(() => inflate(parseArgs(['--input', small, '--output', out, '--max-output', '1m', '--dry-run'])));
        expect(r.error).toBeUndefined();
        expect(r.out.length).toBe(0);
        expect(existsSync(out)).toBe(false);
        expect(envelope(r.err)).toEqual({
            ok: true,
            command: 'inflate',
            dryRun: true,
            method: 8,
            methodName: 'deflate',
            maxOutput: 1024 * 1024,
            sync: false,
            output: out,
        });
    });

    it('a missing input file is E_IO and a traversal --output is E_INPUT', async () => {
        await setup();
        const r = await run(() => inflate(parseArgs(['--input', join(dir, 'absent.deflate')])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO });
        const r2 = await run(() => inflate(parseArgs(['--input', small, '--output', '../escape.bin'])));
        expect(r2.error).toMatchObject({ code: ErrorCode.INPUT });
    });
});
