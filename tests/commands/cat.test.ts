import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { cat } from '../../src/commands/cat.js';
import { parseArgs } from '../../src/utils/args.js';
import { createZip, openZip, type ZipEntry } from '../../src/core-bridge/index.js';

// ── Local helpers ────────────────────────────────────────────────────

const ENV_KEYS = ['ZIPNATIVE_JSON', 'ZIPNATIVE_DRY_RUN', 'ZIPNATIVE_QUIET', 'ZIPNATIVE_STRICT'] as const;
const savedEnv: Record<string, string | undefined> = {};

interface Capture {
    readonly chunks: Buffer[];
    text(): string;
    buffer(): Buffer;
}

function mockWrite(stream: NodeJS.WriteStream): Capture {
    const chunks: Buffer[] = [];
    const impl = (chunk: unknown, enc?: unknown, cb?: unknown): boolean => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
        const done = typeof enc === 'function' ? enc : cb;
        if (typeof done === 'function') (done as () => void)();
        return true;
    };
    vi.spyOn(stream, 'write').mockImplementation(impl as typeof stream.write);
    return { chunks, text: () => Buffer.concat(chunks).toString('utf8'), buffer: () => Buffer.concat(chunks) };
}

const captureStdout = (): Capture => mockWrite(process.stdout);
const captureStderr = (): Capture => mockWrite(process.stderr);

function lastEnvelope(err: Capture): Record<string, unknown> {
    const lines = err.text().split('\n').filter((l) => l.startsWith('{'));
    const last = lines[lines.length - 1];
    if (last === undefined) throw new Error(`no envelope on stderr:\n${err.text()}`);
    return JSON.parse(last) as Record<string, unknown>;
}

let tmp: string;

const BIN = Buffer.alloc(3000);
for (let i = 0; i < BIN.length; i++) BIN[i] = i & 0xff; // every byte value, NULs included

const ALPHA = 'alpha line\n'.repeat(50);
const BETA = 'beta\n';

async function fixture(): Promise<{ path: string; bytes: Uint8Array }> {
    const w = createZip();
    w.add('a.txt', ALPHA);
    w.add('b.txt', BETA);
    w.add('bin.bin', new Uint8Array(BIN));
    w.addDirectory('dir');
    const bytes = w.toBytes();
    const path = join(tmp, 'fixture.zip');
    await writeFile(path, bytes);
    return { path, bytes };
}

/** STORE archive whose `a.txt` payload has one flipped byte. */
async function corruptFixture(): Promise<string> {
    const w = createZip({ compression: { method: 'store' } });
    w.add('a.txt', 'hello world, stored verbatim\n');
    const bytes = w.toBytes();
    const entry = openZip(bytes).getEntry('a.txt') as ZipEntry;
    const dataOffset = entry.localHeaderOffset + 30 + entry.rawName.length;
    const copy = new Uint8Array(bytes);
    copy[dataOffset] = (bytes[dataOffset] as number) ^ 0xff;
    const path = join(tmp, 'corrupt.zip');
    await writeFile(path, copy);
    return path;
}

async function run(argv: string[]): Promise<Buffer> {
    const out = captureStdout();
    await cat(parseArgs(argv));
    return out.buffer();
}

beforeEach(async () => {
    for (const k of ENV_KEYS) {
        savedEnv[k] = process.env[k];
        delete process.env[k];
    }
    tmp = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
});

afterEach(async () => {
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
    await rm(tmp, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────

describe('cat', () => {
    it('writes the entry bytes to stdout (binary-safe)', async () => {
        const { path } = await fixture();
        const out = await run(['--input', path, '--entry', 'bin.bin']);
        expect(out.equals(BIN)).toBe(true);
        const text = await run(['--input', path, '-e', 'b.txt']);
        expect(text.toString('utf8')).toBe(BETA);
    });

    it('accepts the positional form: cat a.zip name', async () => {
        const { path } = await fixture();
        const out = await run([path, 'b.txt']);
        expect(out.toString('utf8')).toBe(BETA);
    });

    it('accepts --input with positional entry names', async () => {
        const { path } = await fixture();
        const out = await run(['--input', path, 'b.txt', 'a.txt']);
        expect(out.toString('utf8')).toBe(BETA + ALPHA);
    });

    it('--entry repeated concatenates in the given order', async () => {
        const { path } = await fixture();
        const out = await run(['--input', path, '--entry', 'b.txt', '--entry', 'a.txt', '--entry', 'b.txt']);
        expect(out.toString('utf8')).toBe(BETA + ALPHA + BETA);
        const mixed = await run([path, 'b.txt', '--entry', 'a.txt']);
        // --entry values come first, then positionals after the archive
        expect(mixed.toString('utf8')).toBe(ALPHA + BETA);
    });

    it('--output writes to a file and reports bytes in the envelope', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const { path } = await fixture();
        const target = join(tmp, 'out.bin');
        const stdout = captureStdout();
        const stderr = captureStderr();
        await cat(parseArgs(['--input', path, '--entry', 'bin.bin', '--output', target]));
        expect(stdout.buffer().length).toBe(0);
        expect((await readFile(target)).equals(BIN)).toBe(true);
        expect(lastEnvelope(stderr)).toEqual({
            ok: true,
            command: 'cat',
            dryRun: false,
            output: target,
            entries: ['bin.bin'],
            bytes: BIN.length,
            raw: false,
            verifyCrc: true,
            diagnostics: [],
        });
    });

    it('--raw yields the compressed payload verbatim', async () => {
        const { path, bytes } = await fixture();
        const reader = openZip(bytes);
        const entry = reader.getEntry('a.txt') as ZipEntry;
        const raw = Buffer.from(reader.readEntryRaw(entry));
        const out = await run(['--input', path, '--entry', 'a.txt', '--raw']);
        expect(out.equals(raw)).toBe(true);
        expect(out.length).toBe(entry.compressedSize);
        expect(out.length).toBeLessThan(ALPHA.length);
    });

    it('--no-verify-crc still produces the bytes (and skips the CRC check on a corrupted entry)', async () => {
        const { path } = await fixture();
        const out = await run(['--input', path, '--entry', 'a.txt', '--no-verify-crc']);
        expect(out.toString('utf8')).toBe(ALPHA);
        const corrupt = await corruptFixture();
        const damaged = await run(['--input', corrupt, '--entry', 'a.txt', '--no-verify-crc']);
        expect(damaged.length).toBe('hello world, stored verbatim\n'.length);
        expect(damaged.toString('utf8')).not.toBe('hello world, stored verbatim\n');
    });

    it('a missing entry is E_NOT_FOUND carrying entryName', async () => {
        const { path } = await fixture();
        await expect(cat(parseArgs(['--input', path, '--entry', 'nope.txt'])))
            .rejects.toMatchObject({ code: 'E_NOT_FOUND', exitCode: 1, entryName: 'nope.txt' });
    });

    it('a directory entry is E_INPUT', async () => {
        const { path } = await fixture();
        await expect(cat(parseArgs(['--input', path, '--entry', 'dir/'])))
            .rejects.toMatchObject({ code: 'E_INPUT', exitCode: 1, entryName: 'dir/' });
    });

    it('missing archive or entry name is a usage error', async () => {
        const { path } = await fixture();
        await expect(cat(parseArgs([]))).rejects.toMatchObject({ exitCode: 2, code: 'E_USAGE' });
        await expect(cat(parseArgs(['--entry', 'a.txt']))).rejects.toMatchObject({ exitCode: 2 });
        await expect(cat(parseArgs(['--input', path]))).rejects.toMatchObject({ exitCode: 2 });
        await expect(cat(parseArgs([path]))).rejects.toMatchObject({ exitCode: 2 });
    });

    it('a non-zip archive is E_PARSE and a missing file is E_IO', async () => {
        const bad = join(tmp, 'bad.zip');
        await writeFile(bad, 'not a zip archive by any stretch of the imagination');
        await expect(cat(parseArgs([bad, 'a.txt']))).rejects.toMatchObject({ code: 'E_PARSE', zipCode: 'ZIP_EOCD_NOT_FOUND' });
        await expect(cat(parseArgs([join(tmp, 'missing.zip'), 'a.txt']))).rejects.toMatchObject({ code: 'E_IO' });
    });

    it('--dry-run outputs nothing and the json envelope lists entries and bytes', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const { path, bytes } = await fixture();
        const stdout = captureStdout();
        const stderr = captureStderr();
        await cat(parseArgs(['--input', path, '--entry', 'a.txt', '--entry', 'bin.bin', '--dry-run']));
        expect(stdout.buffer().length).toBe(0);
        expect(lastEnvelope(stderr)).toEqual({
            ok: true,
            command: 'cat',
            dryRun: true,
            entries: ['a.txt', 'bin.bin'],
            bytes: ALPHA.length + BIN.length,
            raw: false,
            verifyCrc: true,
            diagnostics: [],
        });
        // --raw counts compressed sizes
        const stderr2 = captureStderr();
        await cat(parseArgs(['--input', path, '--entry', 'a.txt', '--dry-run', '--raw']));
        const compressed = (openZip(bytes).getEntry('a.txt') as ZipEntry).compressedSize;
        expect(lastEnvelope(stderr2)).toMatchObject({ dryRun: true, raw: true, bytes: compressed });
    });

    it('--dry-run via ZIPNATIVE_DRY_RUN still validates entry names', async () => {
        process.env['ZIPNATIVE_DRY_RUN'] = '1';
        const { path } = await fixture();
        const out = await run(['--input', path, '--entry', 'a.txt']);
        expect(out.length).toBe(0);
        await expect(cat(parseArgs(['--input', path, '--entry', 'missing.txt'])))
            .rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    });

    it('a CRC mismatch is E_DATA / ZIP_CRC_MISMATCH and removes a partial --output file', async () => {
        const corrupt = await corruptFixture();
        const target = join(tmp, 'partial.txt');
        await expect(cat(parseArgs(['--input', corrupt, '--entry', 'a.txt', '--output', target])))
            .rejects.toMatchObject({
                code: 'E_DATA',
                exitCode: 1,
                zipCode: 'ZIP_CRC_MISMATCH',
                entryName: 'a.txt',
                detail: { expectedCrc: expect.any(Number), actualCrc: expect.any(Number) },
            });
        await expect(stat(target)).rejects.toThrow();

        // to stdout: bytes may already have been written (unzip -p semantics), the error still fires
        const stdout = captureStdout();
        await expect(cat(parseArgs(['--input', corrupt, '--entry', 'a.txt'])))
            .rejects.toMatchObject({ code: 'E_DATA', zipCode: 'ZIP_CRC_MISMATCH' });
        expect(stdout.buffer().length).toBeGreaterThan(0);
    });

    it('--strict escalates a diagnostic before any entry is read', async () => {
        const { bytes } = await fixture();
        const prefixed = join(tmp, 'prefixed.zip');
        await writeFile(prefixed, Buffer.concat([Buffer.from('JUNKJUNKJUNK'), Buffer.from(bytes)]));
        const stdout = captureStdout();
        await expect(cat(parseArgs(['--input', prefixed, '--entry', 'b.txt', '--strict'])))
            .rejects.toMatchObject({ code: 'E_CHECK_FAILED', zipCode: 'ZIP_STRICT_DIAGNOSTIC' });
        expect(stdout.buffer().length).toBe(0);
        // without --strict the entry streams fine and the diagnostic rides in the envelope
        process.env['ZIPNATIVE_JSON'] = '1';
        const stderr = captureStderr();
        const out = await run(['--input', prefixed, '--entry', 'b.txt']);
        expect(out.toString('utf8')).toBe(BETA);
        const diags = lastEnvelope(stderr)['diagnostics'] as Array<{ code: string }>;
        expect(diags.map((d) => d.code)).toEqual(['ZIP_PREPENDED_DATA']);
    });
});
