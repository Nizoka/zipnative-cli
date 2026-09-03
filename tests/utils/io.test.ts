import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import {
    validatePath,
    readStdin,
    readFileOrStdin,
    readBinaryFile,
    openInputStream,
    assertJsonSizeLimit,
    writeOutput,
    writeStreamingOutput,
    writeFileStream,
    ensureDir,
    unlinkQuiet,
    safeJoin,
    parentDir,
    readJsonInput,
    readableToByteSource,
} from '../../src/utils/io.js';
import { CliError } from '../../src/utils/error.js';
import { captureStdout } from '../helpers/capture.js';

let dir = '';
const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');

function fakeStdin(chunks: readonly (Buffer | string)[]): void {
    Object.defineProperty(process, 'stdin', { value: Readable.from(chunks), configurable: true });
}

function restoreStdin(): void {
    if (stdinDescriptor !== undefined) Object.defineProperty(process, 'stdin', stdinDescriptor);
}

async function* chunksOf(...parts: readonly Uint8Array[]): AsyncGenerator<Uint8Array, void, undefined> {
    for (const p of parts) yield p;
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
});

afterEach(async () => {
    restoreStdin();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

describe('validatePath', () => {
    it('throws E_INPUT for path traversal with forward slashes', () => {
        expect(() => validatePath('../etc/passwd')).toThrow(CliError);
        try {
            validatePath('a/../b');
        } catch (e) {
            expect(e).toMatchObject({ code: 'E_INPUT', exitCode: 1 });
        }
    });

    it('throws for path traversal with backslashes', () => {
        expect(() => validatePath('..\\windows\\system32')).toThrow(CliError);
        expect(() => validatePath('x\\..\\y')).toThrow(CliError);
    });

    it('throws for bare ..', () => {
        expect(() => validatePath('..')).toThrow(CliError);
    });

    it('allows safe paths, including names that merely contain dots', () => {
        expect(() => validatePath('/tmp/safe-file.zip')).not.toThrow();
        expect(() => validatePath('documents/input.json')).not.toThrow();
        expect(() => validatePath('./file.txt')).not.toThrow();
        expect(() => validatePath('..hidden/file')).not.toThrow();
        expect(() => validatePath('a..b/c')).not.toThrow();
        expect(() => validatePath('C:\\work\\out.zip')).not.toThrow();
    });
});

describe('readStdin / readFileOrStdin', () => {
    it('reads a file when a path is given', async () => {
        const file = join(dir, 'in.bin');
        await writeFile(file, Buffer.from([1, 2, 3]));
        const buf = await readFileOrStdin(file);
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect([...buf]).toEqual([1, 2, 3]);
    });

    it('rejects a traversal path before touching the filesystem', async () => {
        await expect(readFileOrStdin('../secret')).rejects.toMatchObject({ code: 'E_INPUT', exitCode: 1 });
    });

    it('reads stdin for "-" and for undefined', async () => {
        fakeStdin([Buffer.from('ab'), Buffer.from('cd')]);
        expect((await readFileOrStdin('-')).toString()).toBe('abcd');
        fakeStdin([Buffer.from('xyz')]);
        expect((await readFileOrStdin(undefined)).toString()).toBe('xyz');
    });

    it('readStdin concatenates every chunk and resolves on end', async () => {
        fakeStdin([Buffer.from('1'), Buffer.from('2'), Buffer.from('3')]);
        expect((await readStdin()).toString()).toBe('123');
    });

    it('readStdin rejects when stdin errors', async () => {
        const failing = new Readable({
            read(): void {
                this.destroy(new Error('stdin broke'));
            },
        });
        Object.defineProperty(process, 'stdin', { value: failing, configurable: true });
        await expect(readStdin()).rejects.toThrow('stdin broke');
    });
});

describe('readBinaryFile', () => {
    it('returns a Uint8Array view of the file bytes', async () => {
        const file = join(dir, 'b.bin');
        await writeFile(file, Buffer.from([9, 8, 7]));
        const out = await readBinaryFile(file);
        expect(out).toBeInstanceOf(Uint8Array);
        expect(Array.from(out)).toEqual([9, 8, 7]);
    });

    it('rejects traversal', async () => {
        await expect(readBinaryFile('../x')).rejects.toMatchObject({ code: 'E_INPUT' });
    });
});

describe('openInputStream', () => {
    it('returns process.stdin for undefined and "-"', () => {
        expect(openInputStream(undefined)).toBe(process.stdin);
        expect(openInputStream('-')).toBe(process.stdin);
    });

    it('returns a readable file stream for a path', async () => {
        const file = join(dir, 's.txt');
        await writeFile(file, 'stream me');
        const chunks: Uint8Array[] = [];
        for await (const c of readableToByteSource(openInputStream(file))) chunks.push(c);
        expect(Buffer.concat(chunks).toString()).toBe('stream me');
    });

    it('rejects traversal synchronously', () => {
        expect(() => openInputStream('../x')).toThrow(CliError);
    });
});

describe('assertJsonSizeLimit', () => {
    it('passes for buffers up to and including 50 MB', () => {
        expect(() => assertJsonSizeLimit(new Uint8Array(10))).not.toThrow();
        expect(() => assertJsonSizeLimit(new Uint8Array(50 * 1024 * 1024))).not.toThrow();
    });

    it('throws E_INPUT for a buffer exceeding 50 MB', () => {
        const big = new Uint8Array(50 * 1024 * 1024 + 1);
        expect(() => assertJsonSizeLimit(big)).toThrow(/exceeds the 50 MB limit/);
        try {
            assertJsonSizeLimit(big);
        } catch (e) {
            expect(e).toMatchObject({ code: 'E_INPUT', exitCode: 1 });
        }
    });
});

describe('writeOutput', () => {
    it('writes bytes to a file path', async () => {
        const file = join(dir, 'out.bin');
        await writeOutput(new Uint8Array([1, 2, 3, 4]), file);
        expect([...(await readFile(file))]).toEqual([1, 2, 3, 4]);
    });

    it('rejects traversal', async () => {
        await expect(writeOutput(new Uint8Array([1]), '../out')).rejects.toMatchObject({ code: 'E_INPUT' });
    });

    it('writes to stdout for undefined and "-"', async () => {
        const out = captureStdout();
        await writeOutput(new Uint8Array([5, 6, 7]), undefined);
        await writeOutput(new Uint8Array([8]), '-');
        expect([...out.bytes()]).toEqual([5, 6, 7, 8]);
        expect(out.calls).toBe(2);
    });

    it('propagates a stdout write error', async () => {
        vi.spyOn(process.stdout, 'write').mockImplementation(
            (_chunk: Uint8Array | string, encoding?: unknown, cb?: unknown): boolean => {
                const done = typeof encoding === 'function' ? encoding : cb;
                (done as (e: Error) => void)(new Error('Write failed'));
                return true;
            },
        );
        await expect(writeOutput(new Uint8Array([1]), undefined)).rejects.toThrow('Write failed');
    });
});

describe('writeStreamingOutput', () => {
    it('returns the byte count and writes every chunk to stdout', async () => {
        const out = captureStdout();
        const n = await writeStreamingOutput(chunksOf(new Uint8Array([1, 2]), new Uint8Array([3])), undefined);
        expect(n).toBe(3);
        expect([...out.bytes()]).toEqual([1, 2, 3]);
    });

    it('returns the byte count and writes every chunk to a file', async () => {
        const file = join(dir, 'stream.bin');
        const n = await writeStreamingOutput(chunksOf(new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])), file);
        expect(n).toBe(5);
        expect([...(await readFile(file))]).toEqual([1, 2, 3, 4, 5]);
    });

    it('returns 0 for an empty stream', async () => {
        const file = join(dir, 'empty.bin');
        expect(await writeStreamingOutput(chunksOf(), file)).toBe(0);
        expect((await stat(file)).size).toBe(0);
    });

    it('rejects traversal', async () => {
        await expect(writeStreamingOutput(chunksOf(), '../x')).rejects.toMatchObject({ code: 'E_INPUT' });
    });

    it('propagates a stdout write error', async () => {
        vi.spyOn(process.stdout, 'write').mockImplementation(
            (_chunk: Uint8Array | string, encoding?: unknown, cb?: unknown): boolean => {
                const done = typeof encoding === 'function' ? encoding : cb;
                (done as (e: Error) => void)(new Error('EPIPE-ish'));
                return true;
            },
        );
        await expect(writeStreamingOutput(chunksOf(new Uint8Array([1])), undefined)).rejects.toThrow('EPIPE-ish');
    });
});

describe('writeFileStream', () => {
    it('handles backpressure with chunks far larger than the stream high-water mark', async () => {
        const file = join(dir, 'big.bin');
        const chunk = new Uint8Array(1024 * 1024).fill(0xab);
        const seen: number[] = [];
        await writeFileStream(file, chunksOf(chunk, chunk, chunk, chunk), (n) => seen.push(n));
        expect(seen).toEqual([chunk.length, chunk.length, chunk.length, chunk.length]);
        const written = await readFile(file);
        expect(written.length).toBe(4 * 1024 * 1024);
        expect(written[0]).toBe(0xab);
        expect(written[written.length - 1]).toBe(0xab);
    });

    it('rejects and stops when the chunk source throws', async () => {
        const file = join(dir, 'partial.bin');
        async function* broken(): AsyncGenerator<Uint8Array, void, undefined> {
            yield new Uint8Array([1]);
            throw new Error('source exploded');
        }
        await expect(writeFileStream(file, broken())).rejects.toThrow('source exploded');
    });

    it('rejects when the file cannot be created (missing parent)', async () => {
        const file = join(dir, 'no', 'such', 'dir', 'x.bin');
        await expect(writeFileStream(file, chunksOf(new Uint8Array([1])))).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

describe('ensureDir / unlinkQuiet / parentDir', () => {
    it('ensureDir creates nested directories and is idempotent', async () => {
        const nested = join(dir, 'a', 'b', 'c');
        await ensureDir(nested);
        await ensureDir(nested);
        expect((await stat(nested)).isDirectory()).toBe(true);
    });

    it('unlinkQuiet removes an existing file and never throws for a missing one', async () => {
        const file = join(dir, 'tmp.bin');
        await writeFile(file, 'x');
        await unlinkQuiet(file);
        await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(unlinkQuiet(join(dir, 'missing', 'deep', 'file'))).resolves.toBeUndefined();
        await expect(unlinkQuiet('')).resolves.toBeUndefined();
    });

    it('parentDir returns the dirname', () => {
        expect(parentDir(join('a', 'b', 'c.zip'))).toBe(join('a', 'b'));
    });
});

describe('safeJoin', () => {
    const root = join('out', 'root');

    it('joins a relative path inside the root', () => {
        expect(safeJoin(root, 'a/b.txt')).toBe(resolve(root, 'a', 'b.txt'));
        expect(safeJoin(root, 'deep/er/file')).toBe(resolve(root, 'deep', 'er', 'file'));
    });

    it('refuses an escape via .. with E_SECURITY carrying the entry name', () => {
        expect(() => safeJoin(root, '../evil.txt')).toThrow(CliError);
        try {
            safeJoin(root, 'a/../../evil.txt');
        } catch (e) {
            expect(e).toMatchObject({ code: 'E_SECURITY', exitCode: 1, entryName: 'a/../../evil.txt' });
        }
    });

    it('refuses an absolute path that lands outside the root', () => {
        const outside = resolve(root, '..', 'elsewhere', 'x.txt');
        expect(() => safeJoin(root, outside)).toThrow(CliError);
    });

    it('refuses the root itself (empty relative)', () => {
        expect(() => safeJoin(root, '.')).toThrow(CliError);
        expect(() => safeJoin(root, '')).toThrow(CliError);
    });

    it('accepts an absolute path that is inside the root', () => {
        const inside = resolve(root, 'inner', 'x.txt');
        expect(safeJoin(root, inside)).toBe(inside);
    });

    it('does not confuse a sibling directory sharing the root prefix', () => {
        const sibling = resolve(root) + '-sibling' + sep + 'x.txt';
        expect(() => safeJoin(root, sibling)).toThrow(CliError);
    });
});

describe('readJsonInput', () => {
    it('parses a JSON file', async () => {
        const file = join(dir, 'm.json');
        await writeFile(file, '{"version":1,"tasks":[]}');
        expect(await readJsonInput(file, 'manifest')).toEqual({ version: 1, tasks: [] });
    });

    it('reads JSON from stdin with "-"', async () => {
        fakeStdin([Buffer.from('[1,'), Buffer.from('2]')]);
        expect(await readJsonInput('-', 'manifest')).toEqual([1, 2]);
    });

    it('throws E_PARSE on invalid JSON naming the input', async () => {
        const file = join(dir, 'bad.json');
        await writeFile(file, '{not json');
        await expect(readJsonInput(file, 'manifest')).rejects.toMatchObject({ code: 'E_PARSE', exitCode: 1 });
        await expect(readJsonInput(file, 'manifest')).rejects.toThrow(/Failed to parse manifest/);
    });

    it('throws E_IO on a missing file', async () => {
        const file = join(dir, 'missing.json');
        await expect(readJsonInput(file, 'manifest')).rejects.toMatchObject({ code: 'E_IO', exitCode: 1 });
        await expect(readJsonInput(file, 'manifest')).rejects.toThrow(/Cannot read manifest/);
    });

    it('re-throws a CliError from path validation unchanged', async () => {
        await expect(readJsonInput('../x.json', 'manifest')).rejects.toMatchObject({ code: 'E_INPUT' });
    });

    it('decodes invalid UTF-8 leniently instead of throwing E_IO', async () => {
        const file = join(dir, 'latin.json');
        await writeFile(file, Buffer.concat([Buffer.from('"'), Buffer.from([0xff]), Buffer.from('"')]));
        expect(await readJsonInput(file, 'doc')).toBe('\uFFFD');
    });
});

describe('readableToByteSource', () => {
    it('passes Buffer chunks through as Uint8Arrays', async () => {
        const out: Uint8Array[] = [];
        for await (const c of readableToByteSource(Readable.from([Buffer.from([1, 2]), Buffer.from([3])]))) {
            expect(c).toBeInstanceOf(Uint8Array);
            out.push(c);
        }
        expect([...Buffer.concat(out)]).toEqual([1, 2, 3]);
    });

    it('encodes string chunks as UTF-8', async () => {
        const out: Uint8Array[] = [];
        for await (const c of readableToByteSource(Readable.from(['hé', 'llo']))) out.push(c);
        expect(Buffer.concat(out).toString('utf8')).toBe('héllo');
        expect(Buffer.concat(out).length).toBe(6);
    });
});
