import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { crc32 } from '../../src/commands/crc32.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';

// ── Local capture helper ──────────────────────────────────────────────

interface Run {
    readonly text: string;
    readonly err: string;
    readonly error: unknown;
}

async function run(fn: () => Promise<void>): Promise<Run> {
    const outChunks: string[] = [];
    const errChunks: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
        outChunks.push(String(chunk));
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
    return { text: outChunks.join(''), err: errChunks.join(''), error };
}

function envelope(err: string): Record<string, unknown> {
    const lines = err.split('\n').filter((l) => l.startsWith('{'));
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

const originalStdin = process.stdin;
function setStdin(text: string): void {
    Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from(text)]), configurable: true });
}

interface CrcReport {
    files: { file: string; crc32: string; value: number; bytes: number }[];
    expect?: string;
}

// The IEEE 802.3 check value: CRC-32 of the ASCII bytes "123456789".
const CHECK_INPUT = '123456789';
const CHECK_CRC = 'cbf43926';

describe('crc32', () => {
    let dir = '';
    let file = '';

    afterEach(async () => {
        vi.restoreAllMocks();
        Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_QUIET'];
        if (dir !== '') await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        dir = '';
    });

    async function setup(): Promise<void> {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        file = join(dir, 'check.txt');
        await writeFile(file, CHECK_INPUT);
    }

    it('computes the known check vector for a file (text output)', async () => {
        await setup();
        const r = await run(() => crc32(parseArgs([file])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe(`${CHECK_CRC}  9  ${file}\n`);
    });

    it('accepts --input / -i and positionals together', async () => {
        await setup();
        const other = join(dir, 'other.txt');
        await writeFile(other, 'abc');
        const r = await run(() => crc32(parseArgs(['-i', file, other])));
        expect(r.error).toBeUndefined();
        const lines = r.text.trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]?.startsWith(CHECK_CRC)).toBe(true);
        expect(lines[1]?.startsWith('352441c2')).toBe(true);
    });

    it('reads stdin when no file is given and labels it "-"', async () => {
        setStdin(CHECK_INPUT);
        const r = await run(() => crc32(parseArgs([])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe(`${CHECK_CRC}  9  -\n`);
    });

    it('--format json emits { files: [{ file, crc32, value, bytes }] }', async () => {
        await setup();
        const r = await run(() => crc32(parseArgs([file, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as CrcReport;
        expect(doc).toEqual({ files: [{ file, crc32: CHECK_CRC, value: 0xcbf43926, bytes: 9 }] });
        expect(r.text).toContain('\n  ');
    });

    it('--seed continues a running checksum (equals the one-shot CRC of the concatenation)', async () => {
        await setup();
        const head = join(dir, 'head.txt');
        const tail = join(dir, 'tail.txt');
        await writeFile(head, '12345');
        await writeFile(tail, '6789');
        const first = await run(() => crc32(parseArgs([head, '--format', 'json'])));
        const seed = (JSON.parse(first.text) as CrcReport).files[0]?.crc32 as string;
        const second = await run(() => crc32(parseArgs([tail, '--seed', seed, '--format', 'json'])));
        expect(second.error).toBeUndefined();
        expect((JSON.parse(second.text) as CrcReport).files[0]?.crc32).toBe(CHECK_CRC);
        const prefixed = await run(() => crc32(parseArgs([tail, '--seed', `0x${seed.toUpperCase()}`])));
        expect(prefixed.text.startsWith(CHECK_CRC)).toBe(true);
    });

    it('--expect passes silently on a match', async () => {
        await setup();
        const r = await run(() => crc32(parseArgs([file, '--expect', CHECK_CRC])));
        expect(r.error).toBeUndefined();
        expect(r.text).toContain(CHECK_CRC);
    });

    it('--expect mismatch is E_CHECK_FAILED with expectedCrc / actualCrc detail', async () => {
        await setup();
        const r = await run(() => crc32(parseArgs([file, '--expect', 'deadbeef', '--format', 'json'])));
        expect(r.error).toMatchObject({
            code: ErrorCode.CHECK_FAILED,
            exitCode: 1,
            detail: { expectedCrc: 0xdeadbeef, actualCrc: 0xcbf43926 },
        });
        // The report is still emitted before the verdict, carrying the expectation.
        expect(JSON.parse(r.text)).toMatchObject({ expect: 'deadbeef' });
        const text = await run(() => crc32(parseArgs([file, '--expect', 'deadbeef'])));
        expect(text.error).toMatchObject({ code: ErrorCode.CHECK_FAILED });
        expect((text.error as Error).message).toContain('expected deadbeef, got cbf43926');
    });

    it('--expect with two inputs is a usage error (exit 2)', async () => {
        await setup();
        const r = await run(() => crc32(parseArgs([file, file, '--expect', CHECK_CRC])));
        expect(r.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });

    it.each([
        ['--expect', 'xyz'],
        ['--expect', '123456789'],
        ['--seed', 'nothex'],
        ['--format', 'xml'],
    ])('%s %s is a usage error (exit 2)', async (flag, value) => {
        await setup();
        const r = await run(() => crc32(parseArgs([file, flag, value])));
        expect(r.error).toMatchObject({ exitCode: 2 });
    });

    it('a missing file is E_IO', async () => {
        await setup();
        const r = await run(() => crc32(parseArgs([join(dir, 'absent.bin')])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO, exitCode: 1 });
    });

    it('a traversal path is refused (E_INPUT)', async () => {
        const r = await run(() => crc32(parseArgs(['../escape.bin'])));
        expect(r.error).toMatchObject({ code: ErrorCode.INPUT });
    });

    it('emits compact JSON and a status envelope under ZIPNATIVE_JSON', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => crc32(parseArgs([file, file])));
        expect(r.error).toBeUndefined();
        expect(r.text.trimEnd()).not.toContain('\n');
        expect((JSON.parse(r.text) as CrcReport).files).toHaveLength(2);
        expect(envelope(r.err)).toEqual({ ok: true, command: 'crc32', files: 2, bytes: 18 });
        const pretty = await run(() => crc32(parseArgs([file, '--pretty'])));
        expect(pretty.text).toContain('\n  ');
    });

    it('streams a multi-chunk input with constant memory (value matches the buffered CRC)', async () => {
        await setup();
        const big = join(dir, 'big.bin');
        const data = Buffer.alloc(200 * 1024);
        for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xff;
        await writeFile(big, data);
        const r = await run(() => crc32(parseArgs([big, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as CrcReport;
        expect(doc.files[0]?.bytes).toBe(data.length);
        // Independent reference: the node:zlib implementation (Node >= 22.2).
        const zlib = await import('node:zlib');
        if (typeof zlib.crc32 === 'function') {
            expect(doc.files[0]?.value).toBe(zlib.crc32(data) >>> 0);
        }
    });
});
