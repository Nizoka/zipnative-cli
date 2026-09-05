import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { create } from '../../src/commands/create.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError } from '../../src/utils/error.js';
import {
    FLAG_DATA_DESCRIPTOR,
    METHOD_DEFLATE,
    METHOD_STORE,
    getUnixMode,
    openZip,
    type ZipEntry,
} from '../../src/core-bridge/index.js';

// ── Local helpers ────────────────────────────────────────────────────

const ENV_KEYS = ['ZIPNATIVE_JSON', 'ZIPNATIVE_DRY_RUN', 'ZIPNATIVE_QUIET', 'ZIPNATIVE_STRICT', 'ZIPNATIVE_PURE_CODECS'] as const;
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
    return {
        chunks,
        text: () => Buffer.concat(chunks).toString('utf8'),
        buffer: () => Buffer.concat(chunks),
    };
}

const captureStdout = (): Capture => mockWrite(process.stdout);
const captureStderr = (): Capture => mockWrite(process.stderr);

/** Last JSON envelope on stderr (the success status or the diagnostics carrier). */
function lastEnvelope(err: Capture): Record<string, unknown> {
    const lines = err.text().split('\n').filter((l) => l.startsWith('{'));
    const last = lines[lines.length - 1];
    if (last === undefined) throw new Error(`no envelope on stderr:\n${err.text()}`);
    return JSON.parse(last) as Record<string, unknown>;
}

let tmp: string;

const TEXT = 'The quick brown fox jumps over the lazy dog.\n'.repeat(200);
const PATTERN = Buffer.alloc(4096);
for (let i = 0; i < PATTERN.length; i++) PATTERN[i] = (i * 7) & 0xff;

async function makeTree(): Promise<string> {
    const src = join(tmp, 'src');
    await mkdir(join(src, 'nested'), { recursive: true });
    await writeFile(join(src, 'a.txt'), TEXT);
    await writeFile(join(src, 'bin.bin'), PATTERN);
    await writeFile(join(src, 'nested', 'deep.txt'), 'deep\n');
    await writeFile(join(src, 'café.txt'), 'unicode\n');
    return src;
}

async function readZip(path: string): Promise<{ bytes: Uint8Array; entries: ZipEntry[]; names: string[] }> {
    const buf = await readFile(path);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const entries = [...openZip(bytes).entries()];
    return { bytes, entries, names: entries.map((e) => e.name) };
}

async function run(argv: string[]): Promise<void> {
    await create(parseArgs(argv));
}

function withStdin<T>(data: Buffer, fn: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', { value: Readable.from([data]), configurable: true });
    return fn().finally(() => {
        if (original !== undefined) Object.defineProperty(process, 'stdin', original);
    });
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

describe('create', () => {
    describe('filesystem inputs', () => {
        it('archives a tree with names relative to the input parent', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run(['--input', src, '--output', out]);
            const { entries, names } = await readZip(out);
            expect(names).toEqual(['src/a.txt', 'src/bin.bin', 'src/café.txt', 'src/nested/deep.txt']);
            const reader = openZip((await readZip(out)).bytes);
            expect(Buffer.from(reader.readEntry('src/bin.bin')).equals(PATTERN)).toBe(true);
            expect(Buffer.from(reader.readEntry('src/a.txt')).toString('utf8')).toBe(TEXT);
            expect(entries.every((e) => e.nameEncoding === 'utf-8')).toBe(true);
            // Compressible content deflates; the core may STORE entries that would not shrink.
            expect(reader.getEntry('src/a.txt')?.compressionMethod).toBe(METHOD_DEFLATE);
            expect(entries.every((e) => e.compressionMethod === METHOD_DEFLATE || e.compressionMethod === METHOD_STORE)).toBe(true);
        });

        it('accepts positional inputs and -o', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([join(src, 'a.txt'), '-o', out]);
            expect((await readZip(out)).names).toEqual(['a.txt']);
        });

        it('--base rebases entry names', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([src, '--base', src, '-o', out]);
            expect((await readZip(out)).names).toEqual(['a.txt', 'bin.bin', 'café.txt', 'nested/deep.txt']);
        });

        it('rejects an input outside --base with exit 2', async () => {
            const src = await makeTree();
            const other = join(tmp, 'other');
            await mkdir(other);
            await expect(run([src, '--base', other, '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
        });

        it('--prefix prepends a directory', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([src, '--base', src, '--prefix', 'pkg', '-o', out]);
            const { names } = await readZip(out);
            expect(names[0]).toBe('pkg/a.txt');
            expect(names.every((n) => n.startsWith('pkg/'))).toBe(true);
        });

        it('--method store writes every entry with method 0', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([src, '--method', 'store', '-o', out]);
            const { entries } = await readZip(out);
            expect(entries.every((e) => e.compressionMethod === METHOD_STORE)).toBe(true);
            expect(entries.every((e) => e.compressedSize === e.uncompressedSize)).toBe(true);
        });

        it('--method bogus and --level x are usage errors', async () => {
            const src = await makeTree();
            await expect(run([src, '--method', 'lzma', '-o', join(tmp, 'o.zip')])).rejects.toMatchObject({ exitCode: 2 });
            await expect(run([src, '--level', 'x', '-o', join(tmp, 'o.zip')])).rejects.toMatchObject({ exitCode: 2 });
            await expect(run([src, '--order', 'random', '-o', join(tmp, 'o.zip')])).rejects.toMatchObject({ exitCode: 2 });
            await expect(run([src, '--date', 'yesterday', '-o', join(tmp, 'o.zip')])).rejects.toMatchObject({ exitCode: 2 });
        });

        it('--level 9 is no larger than --level 1 on repetitive text', async () => {
            const src = await makeTree();
            const a = join(tmp, 'l1.zip');
            const b = join(tmp, 'l9.zip');
            await run([join(src, 'a.txt'), '--level', '1', '-o', a]);
            await run([join(src, 'a.txt'), '--level', '9', '-o', b]);
            expect((await stat(b)).size).toBeLessThanOrEqual((await stat(a)).size);
        });

        it('--deterministic produces byte-identical archives on repeated runs', async () => {
            const src = await makeTree();
            const a = join(tmp, 'a.zip');
            const b = join(tmp, 'b.zip');
            await run([src, '--deterministic', '-o', a]);
            await run([src, '--deterministic', '-o', b]);
            expect((await readFile(a)).equals(await readFile(b))).toBe(true);
        });

        it('--comment sets the archive comment', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([src, '--comment', 'hello archive', '-o', out]);
            const reader = openZip((await readZip(out)).bytes);
            expect(new TextDecoder().decode(reader.comment)).toBe('hello archive');
        });

        it('--entry-comment name=text sets a per-entry comment', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([src, '--entry-comment', 'src/a.txt=note here', '-o', out]);
            const reader = openZip((await readZip(out)).bytes);
            expect(new TextDecoder().decode(reader.getEntry('src/a.txt')?.comment)).toBe('note here');
            expect(reader.getEntry('src/bin.bin')?.comment.length).toBe(0);
        });

        it('--entry-comment for an unknown entry or without "=" is a usage error', async () => {
            const src = await makeTree();
            await expect(run([src, '--entry-comment', 'nope.txt=x', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
            await expect(run([src, '--entry-comment', 'novalue', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
        });

        it('--date now emits ZIP_TIMESTAMP_NOT_PINNED in the json envelope', async () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            const err = captureStderr();
            await run([src, '--date', 'now', '-o', out, '--json']);
            const env = lastEnvelope(err);
            expect(env['ok']).toBe(true);
            const diags = env['diagnostics'] as Array<{ code: string }>;
            expect(diags.map((d) => d.code)).toContain('ZIP_TIMESTAMP_NOT_PINNED');
            const { entries } = await readZip(out);
            expect(entries[0]?.dosDate).not.toBe(0x21);
        });

        it('--date <ISO> pins every entry to that timestamp', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([src, '--date', '2020-01-02T03:04:05Z', '-o', out]);
            const { entries } = await readZip(out);
            for (const e of entries) {
                // The UTC wall-clock is stored in the DOS fields (2-second
                // resolution, seconds floored) and read back as local fields.
                const d = e.lastModified;
                expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()])
                    .toEqual([2020, 0, 2, 3, 4, 4]);
            }
        });

        it('--date epoch keeps the DOS epoch default', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([src, '--date', 'epoch', '-o', out]);
            const { entries } = await readZip(out);
            expect(entries.every((e) => e.dosDate === 0x21 && e.dosTime === 0)).toBe(true);
        });

        it('--mtime uses each file\'s modification time', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([join(src, 'a.txt'), '--mtime', '-o', out]);
            const { entries } = await readZip(out);
            const st = await stat(join(src, 'a.txt'));
            expect(Math.abs((entries[0] as ZipEntry).lastModified.getTime() - st.mtime.getTime())).toBeLessThanOrEqual(2000);
        });

        it('--include / --exclude filter the walk and report skipped paths', async () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            const err = captureStderr();
            await run([src, '--include', '**/*.txt', '--exclude', '*deep*', '-o', out, '--json']);
            expect((await readZip(out)).names).toEqual(['src/a.txt', 'src/café.txt']);
            const env = lastEnvelope(err);
            const skipped = env['skipped'] as Array<{ name: string; reason: string }>;
            expect(skipped.map((s) => s.name).sort()).toEqual(['src/bin.bin', 'src/nested/deep.txt']);
            expect(skipped.every((s) => s.reason === 'filtered')).toBe(true);
        });

        it('--dir-entries adds explicit directory entries', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([src, '--dir-entries', '-o', out]);
            const { entries, names } = await readZip(out);
            expect(names).toContain('src/');
            expect(names).toContain('src/nested/');
            expect(entries.find((e) => e.name === 'src/')?.isDirectory).toBe(true);
        });

        it('--store-ext stores matching extensions only', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await run([src, '--store-ext', '.BIN', '-o', out]);
            const reader = openZip((await readZip(out)).bytes);
            expect(reader.getEntry('src/bin.bin')?.compressionMethod).toBe(METHOD_STORE);
            expect(reader.getEntry('src/a.txt')?.compressionMethod).toBe(METHOD_DEFLATE);
        });

        it.skipIf(process.platform === 'win32')('--preserve-mode records POSIX permission bits', async () => {
            const src = await makeTree();
            await chmod(join(src, 'a.txt'), 0o755);
            await chmod(join(src, 'bin.bin'), 0o600);
            const out = join(tmp, 'out.zip');
            await run([src, '--preserve-mode', '-o', out]);
            const reader = openZip((await readZip(out)).bytes);
            expect(getUnixMode(reader.getEntry('src/a.txt') as ZipEntry)).toBe(0o100755);
            expect(getUnixMode(reader.getEntry('src/bin.bin') as ZipEntry)).toBe(0o100600);
        });

        it.skipIf(process.platform !== 'win32')('--preserve-mode warns on Windows and still writes', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            const err = captureStderr();
            await run([src, '--preserve-mode', '-o', out]);
            expect(err.text()).toContain('--preserve-mode has no effect on Windows');
            expect((await readZip(out)).names.length).toBe(4);
        });

        it.skipIf(process.platform === 'win32')('symlinks are skipped by default and followed with --follow-symlinks', async () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const src = await makeTree();
            await symlink(join(src, 'a.txt'), join(src, 'link.txt'));
            const out = join(tmp, 'out.zip');
            const err = captureStderr();
            await run([src, '-o', out, '--json']);
            expect((await readZip(out)).names).not.toContain('src/link.txt');
            const skipped = lastEnvelope(err)['skipped'] as Array<{ name: string; reason: string }>;
            expect(skipped).toEqual([{ name: 'src/link.txt', path: join(src, 'link.txt'), reason: 'symlink' }]);

            const out2 = join(tmp, 'out2.zip');
            await run([src, '--follow-symlinks', '-o', out2]);
            expect((await readZip(out2)).names).toContain('src/link.txt');
        });

        it('overlapping inputs producing the same entry name are E_INPUT', async () => {
            const src = await makeTree();
            await expect(run([src, join(src, 'a.txt'), '--base', tmp, '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ code: 'E_INPUT', entryName: 'src/a.txt' });
        });

        it('a missing input path is E_IO', async () => {
            await expect(run([join(tmp, 'nope'), '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ code: 'E_IO', exitCode: 1 });
        });

        it('without inputs it is a usage error', async () => {
            await expect(run(['-o', join(tmp, 'o.zip')])).rejects.toMatchObject({ exitCode: 2, code: 'E_USAGE' });
        });

        it('writes the archive to stdout when -o is omitted', async () => {
            const src = await makeTree();
            const out = captureStdout();
            await run([join(src, 'a.txt')]);
            const buf = out.buffer();
            expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
            const reader = openZip(new Uint8Array(buf));
            expect(reader.entryCount).toBe(1);
        });
    });

    describe('--dry-run', () => {
        it('prints plan lines and writes nothing', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            const stdout = captureStdout();
            await run([src, '-o', out, '--dry-run']);
            await expect(stat(out)).rejects.toThrow();
            const text = stdout.text();
            expect(text).toContain(`plan  src/a.txt  ${TEXT.length}  deflate`);
            expect(text).toContain('plan  src/bin.bin  4096  deflate');
        });

        it('via ZIPNATIVE_DRY_RUN and --json emits an envelope with dryRun: true', async () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            process.env['ZIPNATIVE_DRY_RUN'] = '1';
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            const stdout = captureStdout();
            const stderr = captureStderr();
            await run([src, '-o', out, '--json', '--dir-entries']);
            await expect(stat(out)).rejects.toThrow();
            expect(stdout.text()).toBe('');
            const env = lastEnvelope(stderr);
            expect(env).toMatchObject({ ok: true, command: 'create', dryRun: true, entries: 6, files: 4, directories: 2, output: out });
            expect(env['bytes']).toBeUndefined();
        });
    });

    describe('--json envelope', () => {
        it('carries entries, bytes, tier, method and deterministic', async () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            const stderr = captureStderr();
            await run([src, '-o', out, '--deterministic', '--json']);
            const env = lastEnvelope(stderr);
            expect(env).toMatchObject({
                ok: true,
                command: 'create',
                dryRun: false,
                entries: 4,
                files: 4,
                directories: 0,
                method: 'deflate',
                level: 6,
                deterministic: true,
                order: 'canonical',
                stream: false,
                layout: 'buffered',
                parallel: false,
                tier: 'pure-pinned',
                diagnostics: [],
            });
            expect(env['bytes']).toBe((await stat(out)).size);
            expect(env['bytesIn']).toBe(TEXT.length + 4096 + 5 + 8);
        });

        it('--stream reports the data-descriptor layout in the envelope', async () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const src = await makeTree();
            const out = join(tmp, 'streamed.zip');
            const stderr = captureStderr();
            await run([src, '-o', out, '--stream', '--json']);
            expect(lastEnvelope(stderr)).toMatchObject({ stream: true, layout: 'data-descriptor' });
        });
    });

    describe('--from-manifest', () => {
        it('builds entries from path, data, dataBase64, directory, mode and comment', async () => {
            const src = await makeTree();
            const manifestPath = join(tmp, 'manifest.json');
            const b64 = Buffer.from([0, 1, 2, 255]).toString('base64');
            await writeFile(manifestPath, JSON.stringify({
                version: 1,
                comment: 'from manifest',
                entries: [
                    { name: 'from-path.txt', path: 'src/a.txt' },
                    { name: 'inline.txt', data: 'inline data', comment: 'per-entry' },
                    { name: 'b64.bin', dataBase64: b64, method: 'store' },
                    { name: 'sub', directory: true },
                    { name: 'run.sh', data: '#!/bin/sh\n', mode: '0755', level: 9, deterministic: true, date: '2021-05-06T07:08:09Z' },
                ],
            }));
            const out = join(tmp, 'out.zip');
            await run(['--from-manifest', manifestPath, '-o', out]);
            const { bytes, names } = await readZip(out);
            const reader = openZip(bytes);
            expect(names).toEqual(['b64.bin', 'from-path.txt', 'inline.txt', 'run.sh', 'sub/']);
            expect(Buffer.from(reader.readEntry('from-path.txt')).toString('utf8')).toBe(TEXT);
            expect(Buffer.from(reader.readEntry('inline.txt')).toString('utf8')).toBe('inline data');
            expect(Buffer.from(reader.readEntry('b64.bin')).equals(Buffer.from([0, 1, 2, 255]))).toBe(true);
            expect(reader.getEntry('b64.bin')?.compressionMethod).toBe(METHOD_STORE);
            expect(reader.getEntry('sub/')?.isDirectory).toBe(true);
            const sh = reader.getEntry('run.sh') as ZipEntry;
            expect(getUnixMode(sh)).toBe(0o100755);
            expect((getUnixMode(sh) as number) & 0o777).toBe(0o755);
            // UTC wall-clock stored in the DOS fields (odd second floored), read back as local fields.
            const d = sh.lastModified;
            expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()])
                .toEqual([2021, 4, 6, 7, 8, 8]);
            expect(new TextDecoder().decode(reader.getEntry('inline.txt')?.comment)).toBe('per-entry');
            expect(new TextDecoder().decode(reader.comment)).toBe('from manifest');
        });

        it('honours manifest-level order, date and compression', async () => {
            const manifestPath = join(tmp, 'manifest.json');
            await writeFile(manifestPath, JSON.stringify({
                order: 'insertion',
                date: 'now',
                compression: { method: 'store' },
                entries: [
                    { name: 'z.txt', data: 'z' },
                    { name: 'a.txt', data: 'a' },
                ],
            }));
            const out = join(tmp, 'out.zip');
            await run(['--from-manifest', manifestPath, '-o', out]);
            const { entries, names } = await readZip(out);
            expect(names).toEqual(['z.txt', 'a.txt']);
            expect(entries.every((e) => e.compressionMethod === METHOD_STORE)).toBe(true);
            expect(entries.every((e) => e.dosDate !== 0x21)).toBe(true);
        });

        it('--order insertion on the CLI overrides the manifest order', async () => {
            const manifestPath = join(tmp, 'manifest.json');
            await writeFile(manifestPath, JSON.stringify({
                order: 'canonical',
                entries: [{ name: 'z.txt', data: 'z' }, { name: 'a.txt', data: 'a' }],
            }));
            const out = join(tmp, 'out.zip');
            await run(['--from-manifest', manifestPath, '--order', 'insertion', '-o', out]);
            expect((await readZip(out)).names).toEqual(['z.txt', 'a.txt']);
            const out2 = join(tmp, 'out2.zip');
            await run(['--from-manifest', manifestPath, '-o', out2]);
            expect((await readZip(out2)).names).toEqual(['a.txt', 'z.txt']);
        });

        it('--store-ext applies to manifest entries without an explicit method', async () => {
            const manifestPath = join(tmp, 'manifest.json');
            await writeFile(manifestPath, JSON.stringify({
                entries: [{ name: 'x.bin', data: 'bin '.repeat(100) }, { name: 'y.txt', data: 'txt '.repeat(100) }],
            }));
            const out = join(tmp, 'out.zip');
            await run(['--from-manifest', manifestPath, '--store-ext', 'bin', '-o', out]);
            const reader = openZip((await readZip(out)).bytes);
            expect(reader.getEntry('x.bin')?.compressionMethod).toBe(METHOD_STORE);
            expect(reader.getEntry('y.txt')?.compressionMethod).toBe(METHOD_DEFLATE);
        });

        const badManifests: Array<[string, unknown, string]> = [
            ['unknown top-level key', { entries: [], bogus: 1 }, 'Unknown key "bogus"'],
            ['unsupported version', { version: 2, entries: [] }, 'Unsupported manifest version'],
            ['entries not an array', { entries: {} }, '"entries" must be an array'],
            ['bad order', { order: 'random', entries: [] }, '"order"'],
            ['non-string comment', { comment: 5, entries: [] }, '"comment" must be a string'],
            ['non-object entry', { entries: ['x'] }, 'must be an object'],
            ['unknown entry key', { entries: [{ name: 'a', data: 'x', nope: 1 }] }, 'unknown key "nope"'],
            ['missing name', { entries: [{ data: 'x' }] }, '"name" is required'],
            ['unsafe name', { entries: [{ name: '../x', data: 'x' }] }, 'would not be extractable safely'],
            ['duplicate name', { entries: [{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }] }, 'duplicate entry name'],
            ['both path and data', { entries: [{ name: 'a', path: 'x', data: 'y' }] }, 'exactly one of'],
            ['neither path nor data', { entries: [{ name: 'a' }] }, 'exactly one of'],
            ['directory with data', { entries: [{ name: 'd', directory: true, data: 'x' }] }, 'directory entry cannot carry'],
            ['bad mode', { entries: [{ name: 'a', data: 'x', mode: 'abc' }] }, '"mode" must be an octal string'],
            ['bad method', { entries: [{ name: 'a', data: 'x', method: 'lzma' }] }, '"method" must be'],
            ['bad level', { entries: [{ name: 'a', data: 'x', level: 42 }] }, '"level" must be'],
            ['bad deterministic', { entries: [{ name: 'a', data: 'x', deterministic: 'yes' }] }, '"deterministic" must be a boolean'],
            ['bad date', { entries: [{ name: 'a', data: 'x', date: 'not-a-date' }] }, '"date" must be'],
            ['bad comment', { entries: [{ name: 'a', data: 'x', comment: 3 }] }, '"comment" must be a string'],
            ['bad top-level compression', { compression: 'fast', entries: [] }, '"compression" must be an object'],
            ['bad top-level level', { compression: { level: 12 }, entries: [] }, '"level" must be'],
            ['non-object manifest', [1, 2], 'must be a JSON object'],
        ];
        for (const [label, doc, fragment] of badManifests) {
            it(`rejects a manifest with ${label} (E_INPUT)`, async () => {
                const manifestPath = join(tmp, 'manifest.json');
                await writeFile(manifestPath, JSON.stringify(doc));
                const err = await run(['--from-manifest', manifestPath, '-o', join(tmp, 'o.zip')]).catch((e: unknown) => e);
                expect(err).toBeInstanceOf(CliError);
                expect((err as CliError).code).toBe('E_INPUT');
                expect((err as CliError).message).toContain(fragment);
            });
        }

        it('a manifest path that does not exist is E_IO', async () => {
            const manifestPath = join(tmp, 'manifest.json');
            await writeFile(manifestPath, JSON.stringify({ entries: [{ name: 'a', path: 'missing.txt' }] }));
            await expect(run(['--from-manifest', manifestPath, '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ code: 'E_IO' });
        });

        it('a manifest path naming a directory is E_INPUT', async () => {
            const src = await makeTree();
            const manifestPath = join(tmp, 'manifest.json');
            await writeFile(manifestPath, JSON.stringify({ entries: [{ name: 'a', path: 'src' }] }));
            await expect(run(['--from-manifest', manifestPath, '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ code: 'E_INPUT' });
            expect(src).toBeTruthy();
        });

        it('invalid JSON is E_PARSE', async () => {
            const manifestPath = join(tmp, 'manifest.json');
            await writeFile(manifestPath, '{ not json');
            await expect(run(['--from-manifest', manifestPath, '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ code: 'E_PARSE' });
        });

        it('is mutually exclusive with positional inputs and --stdin-name (exit 2)', async () => {
            const src = await makeTree();
            const manifestPath = join(tmp, 'manifest.json');
            await writeFile(manifestPath, JSON.stringify({ entries: [] }));
            await expect(run(['--from-manifest', manifestPath, src, '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
            await expect(run(['--from-manifest', manifestPath, '--stdin-name', 'x', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
        });
    });

    describe('stdin', () => {
        it('--stdin-name buffers stdin into a named entry', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await withStdin(Buffer.from('from stdin\n'), () => run([join(src, 'a.txt'), '--stdin-name', 'in/stdin.txt', '-o', out]));
            const { bytes, names } = await readZip(out);
            expect(names).toEqual(['a.txt', 'in/stdin.txt']);
            expect(Buffer.from(openZip(bytes).readEntry('in/stdin.txt')).toString()).toBe('from stdin\n');
        });

        it('--stdin-name alone (no other inputs) works', async () => {
            const out = join(tmp, 'out.zip');
            await withStdin(Buffer.from('solo'), () => run(['--stdin-name', 'solo.txt', '-o', out]));
            expect((await readZip(out)).names).toEqual(['solo.txt']);
        });

        it('--stream --stdin-name uses the data-descriptor layout for the stdin entry', async () => {
            const src = await makeTree();
            const out = join(tmp, 'out.zip');
            await withStdin(Buffer.from('streamed stdin'), () => run([join(src, 'a.txt'), '--stdin-name', 'stdin.txt', '--stream', '-o', out]));
            const reader = openZip((await readZip(out)).bytes);
            const e = reader.getEntry('stdin.txt') as ZipEntry;
            expect(e.flags & FLAG_DATA_DESCRIPTOR).toBe(FLAG_DATA_DESCRIPTOR);
            expect(e.usesDataDescriptor).toBe(true);
            expect(Buffer.from(reader.readEntry(e)).toString()).toBe('streamed stdin');
        });

        it('rejects unsafe (E_INPUT), colliding and double-consumed (exit 2) stdin names', async () => {
            const src = await makeTree();
            await expect(run([join(src, 'a.txt'), '--stdin-name', '../x', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 1, code: 'E_INPUT', entryName: '../x' });
            await expect(run([join(src, 'a.txt'), '--stdin-name', 'dir/', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 1, code: 'E_INPUT' });
            await expect(run([join(src, 'a.txt'), '--stdin-name', 'a.txt', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
            await expect(run(['-', '--stdin-name', 'x.txt', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
        });
    });

    describe('--stream', () => {
        it('produces an archive with the same content (data-descriptor layout)', async () => {
            const src = await makeTree();
            const buffered = join(tmp, 'b.zip');
            const streamed = join(tmp, 's.zip');
            await run([src, '-o', buffered]);
            await run([src, '--stream', '--chunk-size', '4k', '-o', streamed]);
            const b = await readZip(buffered);
            const s = await readZip(streamed);
            expect(s.names).toEqual(b.names);
            const rb = openZip(b.bytes);
            const rs = openZip(s.bytes);
            for (const name of b.names) {
                expect(Buffer.from(rs.readEntry(name)).equals(Buffer.from(rb.readEntry(name)))).toBe(true);
                expect(rs.getEntry(name)?.usesDataDescriptor).toBe(true);
                expect(rb.getEntry(name)?.usesDataDescriptor).toBe(false);
            }
        });

        it('--stream to stdout streams archive bytes', async () => {
            const src = await makeTree();
            const stdout = captureStdout();
            await run([join(src, 'a.txt'), '--stream']);
            const buf = stdout.buffer();
            expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
            expect(openZip(new Uint8Array(buf)).entryCount).toBe(1);
        });

        it('--chunk-size without --stream is a usage error', async () => {
            const src = await makeTree();
            await expect(run([src, '--chunk-size', '1k', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
            await expect(run([src, '--stream', '--chunk-size', 'lots', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
        });
    });

    describe('--parallel', () => {
        it('with --deterministic is byte-identical to the sequential deterministic archive', async () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const src = await makeTree();
            const seq = join(tmp, 'seq.zip');
            const par = join(tmp, 'par.zip');
            await run([src, '--deterministic', '-o', seq]);
            const stderr = captureStderr();
            await run([src, '--parallel', '--workers', '2', '--min-job-size', '1', '--deterministic', '-o', par, '--json']);
            expect((await readFile(par)).equals(await readFile(seq))).toBe(true);
            expect(lastEnvelope(stderr)['parallel']).toEqual({ workers: 2 });
        });

        it('--parallel --pure-codecs without --deterministic is a usage error', async () => {
            process.env['ZIPNATIVE_PURE_CODECS'] = '1';
            const src = await makeTree();
            await expect(run([src, '--parallel', '-o', join(tmp, 'o.zip')]))
                .rejects.toMatchObject({ exitCode: 2 });
        });

        it('--workers / --min-job-size / --job-timeout require --parallel', async () => {
            const src = await makeTree();
            await expect(run([src, '--workers', '2', '-o', join(tmp, 'o.zip')])).rejects.toMatchObject({ exitCode: 2 });
            await expect(run([src, '--min-job-size', '1k', '-o', join(tmp, 'o.zip')])).rejects.toMatchObject({ exitCode: 2 });
            await expect(run([src, '--job-timeout', '5', '-o', join(tmp, 'o.zip')])).rejects.toMatchObject({ exitCode: 2 });
            await expect(run([src, '--parallel', '--workers', 'many', '-o', join(tmp, 'o.zip')])).rejects.toMatchObject({ exitCode: 2 });
        });
    });
});
