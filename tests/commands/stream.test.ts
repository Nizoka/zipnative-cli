import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { stream } from '../../src/commands/stream.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';
import { createZip } from '../../src/core-bridge/index.js';

// ── Local capture helper (stdout as bytes, stderr as text) ────────────

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

/** Last JSON line written to stderr (the --json status envelope). */
function envelope(err: string): Record<string, unknown> {
    const lines = err.split('\n').filter((l) => l.startsWith('{'));
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

const originalStdin = process.stdin;
function setStdin(buf: Uint8Array): void {
    Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from(buf)]), configurable: true });
}

// ── Minimal raw LFH/CD/EOCD builder for shapes the writer refuses ─────

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
}
function crcOf(data: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of data) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

interface RawEntry {
    readonly name: string;
    readonly data: Uint8Array;
    readonly flags?: number;
    readonly method?: number;
}

function rawZip(entries: readonly RawEntry[]): Uint8Array {
    const enc = new TextEncoder();
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const e of entries) {
        const name = Buffer.from(enc.encode(e.name));
        const crc = crcOf(e.data);
        const flags = e.flags ?? 0x800;
        const method = e.method ?? 0;
        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0);
        lfh.writeUInt16LE(20, 4);
        lfh.writeUInt16LE(flags, 6);
        lfh.writeUInt16LE(method, 8);
        lfh.writeUInt16LE(0, 10);
        lfh.writeUInt16LE(0x21, 12);
        lfh.writeUInt32LE(crc, 14);
        lfh.writeUInt32LE(e.data.length, 18);
        lfh.writeUInt32LE(e.data.length, 22);
        lfh.writeUInt16LE(name.length, 26);
        lfh.writeUInt16LE(0, 28);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(0x031e, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(flags, 8);
        cd.writeUInt16LE(method, 10);
        cd.writeUInt16LE(0, 12);
        cd.writeUInt16LE(0x21, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(e.data.length, 20);
        cd.writeUInt32LE(e.data.length, 24);
        cd.writeUInt16LE(name.length, 28);
        cd.writeUInt16LE(0, 30);
        cd.writeUInt16LE(0, 32);
        cd.writeUInt16LE(0, 34);
        cd.writeUInt16LE(0, 36);
        cd.writeUInt32LE(0x81a40000, 38);
        cd.writeUInt32LE(offset, 42);
        locals.push(lfh, name, Buffer.from(e.data));
        centrals.push(cd, name);
        offset += lfh.length + name.length + e.data.length;
    }
    const cdSize = centrals.reduce((n, b) => n + b.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return new Uint8Array(Buffer.concat([...locals, ...centrals, eocd]));
}

// ── Fixtures ──────────────────────────────────────────────────────────

const enc = new TextEncoder();

function normalArchive(): Uint8Array {
    const w = createZip();
    w.addDirectory('dir');
    w.add('a.txt', 'hello');
    w.add('dir/b.txt', 'world!');
    return w.toBytes();
}

async function descriptorArchive(): Promise<Uint8Array> {
    const w = createZip();
    w.addStream('s.txt', (async function* () {
        yield enc.encode('chunk1-');
        yield enc.encode('chunk2');
    })());
    w.add('p.txt', 'plain');
    const chunks: Uint8Array[] = [];
    for await (const c of w.stream()) chunks.push(c);
    return new Uint8Array(Buffer.concat(chunks));
}

function truncatedArchive(): Uint8Array {
    const w = createZip({ compression: { method: 'store' } });
    w.add('a.txt', 'A'.repeat(200));
    w.add('b.txt', 'B'.repeat(200));
    const full = w.toBytes();
    // 30-byte LFH + 5-byte name + 100 of the 200 payload bytes.
    return full.subarray(0, 30 + 5 + 100);
}

describe('stream', () => {
    let dir = '';
    let normalPath = '';

    afterEach(async () => {
        vi.restoreAllMocks();
        Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_DRY_RUN'];
        delete process.env['ZIPNATIVE_QUIET'];
        delete process.env['ZIPNATIVE_STRICT'];
        if (dir !== '') await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        dir = '';
    });

    async function setup(): Promise<void> {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        normalPath = join(dir, 'normal.zip');
        await writeFile(normalPath, normalArchive());
    }

    async function writeArchive(name: string, bytes: Uint8Array): Promise<string> {
        const p = join(dir, name);
        await writeFile(p, bytes);
        return p;
    }

    // ── Listing ─────────────────────────────────────────────────────

    it('lists a normal archive as a text table from --input', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath])));
        expect(r.error).toBeUndefined();
        expect(r.text).toContain('a.txt');
        expect(r.text).toContain('dir/b.txt');
        expect(r.text).toContain('3 entries');
        expect(r.err).toContain('warning: forward streaming trusts local headers only');
    });

    it('accepts the archive as a positional and honours --long', async () => {
        await setup();
        const r = await run(() => stream(parseArgs([normalPath, '--long'])));
        expect(r.error).toBeUndefined();
        expect(r.text).toContain('Mode');
        expect(r.text).toContain('Flags');
    });

    it('--format json emits { mode, trust, entries, diagnostics }', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as { mode: string; trust: string; entries: { name: string; isSymlink: unknown; usesZip64: unknown; uncompressedSize: number }[]; diagnostics: unknown[] };
        expect(doc.mode).toBe('list');
        expect(doc.trust).toBe('local-headers-only');
        expect(doc.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/', 'dir/b.txt']);
        expect(doc.entries[0]?.uncompressedSize).toBe(5);
        expect(doc.entries[0]?.isSymlink).toBeNull();
        expect(doc.entries[0]?.usesZip64).toBeNull();
        expect(doc.diagnostics).toEqual([]);
    });

    it('defaults to ndjson under ZIPNATIVE_JSON (one row per line)', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => stream(parseArgs(['--input', normalPath])));
        expect(r.error).toBeUndefined();
        const lines = r.text.trim().split('\n');
        expect(lines).toHaveLength(3);
        const rows = lines.map((l) => JSON.parse(l) as { name: string });
        expect(rows.map((x) => x.name)).toEqual(['a.txt', 'dir/', 'dir/b.txt']);
        expect(r.text).not.toContain('  ');
    });

    it('--summary reduces the json report to { entries, bytes, descriptorEntries, bytesKnown, trust }', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--format', 'json', '--summary'])));
        expect(r.error).toBeUndefined();
        expect(JSON.parse(r.text)).toEqual({ entries: 3, bytes: 11, descriptorEntries: 0, bytesKnown: true, trust: 'local-headers-only' });
    });

    it('--fields projects the json report', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--format', 'json', '--fields', 'mode,entries.name'])));
        expect(r.error).toBeUndefined();
        expect(JSON.parse(r.text)).toEqual({ mode: 'list', entries: [{ name: 'a.txt' }, { name: 'dir/' }, { name: 'dir/b.txt' }] });
    });

    it('reads the archive from stdin when no input is given', async () => {
        setStdin(normalArchive());
        const r = await run(() => stream(parseArgs(['--format', 'json'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as { entries: { name: string }[] };
        expect(doc.entries).toHaveLength(3);
    });

    it('lists a data-descriptor archive and flags the descriptor entry', async () => {
        await setup();
        const p = await writeArchive('dd.zip', await descriptorArchive());
        const r = await run(() => stream(parseArgs(['--input', p, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as { entries: { name: string; usesDataDescriptor: boolean; uncompressedSize: number }[] };
        const byName = new Map(doc.entries.map((e) => [e.name, e]));
        expect(byName.get('s.txt')?.usesDataDescriptor).toBe(true);
        expect(byName.get('p.txt')?.usesDataDescriptor).toBe(false);
        expect(byName.get('p.txt')?.uncompressedSize).toBe(5);
    });

    it('--cat on a data-descriptor entry returns the full payload', async () => {
        await setup();
        const p = await writeArchive('dd.zip', await descriptorArchive());
        const r = await run(() => stream(parseArgs(['--input', p, '--cat', 's.txt'])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe('chunk1-chunk2');
    });

    it('--include / --exclude filter the listing and report skipped rows', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--format', 'json', '--exclude', 'dir/**'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as { entries: { name: string }[] };
        expect(doc.entries.map((e) => e.name)).toEqual(['a.txt']);
        expect(r.err).toContain('skipped dir/b.txt (filtered)');
    });

    it('--dry-run in list mode emits a status envelope with stoppedAt', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--dry-run'])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe('');
        expect(envelope(r.err)).toMatchObject({ ok: true, command: 'stream', mode: 'list', dryRun: true, entries: 3, stoppedAt: 'central-directory', trust: 'local-headers-only' });
    });

    // ── cat ─────────────────────────────────────────────────────────

    it('--cat writes the entry bytes to stdout and reports the envelope', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--cat', 'a.txt'])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe('hello');
        expect(envelope(r.err)).toMatchObject({ ok: true, command: 'stream', mode: 'cat', bytes: 5, entries: 1, stoppedAt: 'central-directory', skipped: [] });
    });

    it('--cat concatenates several entries in stream order', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--cat', 'dir/b.txt', '--cat', 'a.txt'])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe('helloworld!');
    });

    it('--cat of a missing entry is E_NOT_FOUND', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--cat', 'missing.txt'])));
        expect(r.error).toMatchObject({ code: ErrorCode.NOT_FOUND, exitCode: 1, entryName: 'missing.txt' });
    });

    it('--cat --dry-run resolves the entry but writes nothing', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--cat', 'a.txt', '--dry-run'])));
        expect(r.error).toBeUndefined();
        expect(r.out.length).toBe(0);
        expect(envelope(r.err)).toMatchObject({ mode: 'cat', dryRun: true, entries: 1, bytes: 0 });
    });

    // ── extract ─────────────────────────────────────────────────────

    it('--output-dir extracts files and directories', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const out = join(dir, 'out');
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', out])));
        expect(r.error).toBeUndefined();
        expect(await readFile(join(out, 'a.txt'), 'utf8')).toBe('hello');
        expect(await readFile(join(out, 'dir', 'b.txt'), 'utf8')).toBe('world!');
        expect((await stat(join(out, 'dir'))).isDirectory()).toBe(true);
        expect(envelope(r.err)).toMatchObject({ ok: true, command: 'stream', mode: 'extract', dryRun: false, entries: 3, bytes: 11, skipped: [], stoppedAt: 'central-directory', trust: 'local-headers-only' });
    });

    it('refuses to overwrite an existing file without --overwrite, then overwrites with it', async () => {
        await setup();
        const out = join(dir, 'out');
        await mkdir(out, { recursive: true });
        await writeFile(join(out, 'a.txt'), 'old');
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', out])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO, entryName: 'a.txt' });
        expect(await readFile(join(out, 'a.txt'), 'utf8')).toBe('old');
        const r2 = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', out, '--overwrite'])));
        expect(r2.error).toBeUndefined();
        expect(await readFile(join(out, 'a.txt'), 'utf8')).toBe('hello');
    });

    it('--flat drops directories and writes basenames', async () => {
        await setup();
        const out = join(dir, 'flat');
        const r = await run(() => stream(parseArgs(['--input', normalPath, '-d', out, '--flat'])));
        expect(r.error).toBeUndefined();
        expect(await readFile(join(out, 'b.txt'), 'utf8')).toBe('world!');
        expect(existsSync(join(out, 'dir'))).toBe(false);
    });

    it('--preserve-mtime applies the DOS-epoch timestamp', async () => {
        await setup();
        const out = join(dir, 'mtime');
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', out, '--preserve-mtime'])));
        expect(r.error).toBeUndefined();
        expect((await stat(join(out, 'a.txt'))).mtime.getFullYear()).toBe(1980);
    });

    it('--include restricts extraction and lists the filtered names in skipped', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const out = join(dir, 'inc');
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', out, '--include', 'dir/**'])));
        expect(r.error).toBeUndefined();
        expect(existsSync(join(out, 'a.txt'))).toBe(false);
        expect(await readFile(join(out, 'dir', 'b.txt'), 'utf8')).toBe('world!');
        const env = envelope(r.err);
        expect(env['skipped']).toEqual([{ name: 'a.txt', reason: 'filtered' }]);
    });

    it('--dry-run with --output-dir writes nothing', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const out = join(dir, 'dry');
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', out, '--dry-run'])));
        expect(r.error).toBeUndefined();
        expect(existsSync(out)).toBe(false);
        expect(envelope(r.err)).toMatchObject({ mode: 'extract', dryRun: true, entries: 3, bytes: 0 });
    });

    it('ZIPNATIVE_DRY_RUN env is honoured like --dry-run', async () => {
        await setup();
        process.env['ZIPNATIVE_DRY_RUN'] = '1';
        const out = join(dir, 'dry-env');
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', out])));
        expect(r.error).toBeUndefined();
        expect(existsSync(out)).toBe(false);
    });

    // ── Security posture ────────────────────────────────────────────

    it('refuses an unsafe name with E_SECURITY / ZIP_PATH_TRAVERSAL and writes nothing', async () => {
        await setup();
        const p = await writeArchive('slip.zip', rawZip([{ name: '../evil.txt', data: enc.encode('evil') }]));
        const out = join(dir, 'root');
        const r = await run(() => stream(parseArgs(['--input', p, '--output-dir', out])));
        expect(r.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_PATH_TRAVERSAL', entryName: '../evil.txt', exitCode: 1 });
        expect(existsSync(join(dir, 'evil.txt'))).toBe(false);
        expect(existsSync(join(out, 'evil.txt'))).toBe(false);
    });

    it('still LISTS an unsafe name (the forward reader does not sanitise)', async () => {
        await setup();
        const p = await writeArchive('slip.zip', rawZip([{ name: '../evil.txt', data: enc.encode('evil') }]));
        const r = await run(() => stream(parseArgs(['--input', p, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        expect((JSON.parse(r.text) as { entries: { name: string }[] }).entries[0]?.name).toBe('../evil.txt');
    });

    it('--skip-unsafe skips the unsafe entry and reports it in the envelope', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const p = await writeArchive('slip.zip', rawZip([
            { name: '../evil.txt', data: enc.encode('evil') },
            { name: 'ok.txt', data: enc.encode('fine') },
        ]));
        const out = join(dir, 'root');
        const r = await run(() => stream(parseArgs(['--input', p, '--output-dir', out, '--skip-unsafe'])));
        expect(r.error).toBeUndefined();
        expect(await readFile(join(out, 'ok.txt'), 'utf8')).toBe('fine');
        expect(existsSync(join(dir, 'evil.txt'))).toBe(false);
        expect(envelope(r.err)['skipped']).toEqual([{ name: '../evil.txt', reason: 'unsafe-path' }]);
    });

    it('refuses an unsafe directory entry unless --skip-unsafe', async () => {
        await setup();
        const p = await writeArchive('slipdir.zip', rawZip([{ name: '../up/', data: new Uint8Array(0) }]));
        const out = join(dir, 'root');
        const r = await run(() => stream(parseArgs(['--input', p, '--output-dir', out])));
        expect(r.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_PATH_TRAVERSAL' });
        process.env['ZIPNATIVE_JSON'] = '1';
        const r2 = await run(() => stream(parseArgs(['--input', p, '--output-dir', out, '--skip-unsafe'])));
        expect(r2.error).toBeUndefined();
        expect(envelope(r2.err)['skipped']).toEqual([{ name: '../up/', reason: 'unsafe-path' }]);
    });

    it('duplicate paths are refused with ZIP_EXTRACT_DUPLICATE_PATH by default', async () => {
        await setup();
        const p = await writeArchive('dup.zip', rawZip([
            { name: 'same.txt', data: enc.encode('one') },
            { name: 'same.txt', data: enc.encode('two') },
        ]));
        const r = await run(() => stream(parseArgs(['--input', p, '--output-dir', join(dir, 'dup')])));
        expect(r.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_EXTRACT_DUPLICATE_PATH', entryName: 'same.txt' });
    });

    it('--on-duplicate first keeps the first payload, last keeps the last', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const p = await writeArchive('dup.zip', rawZip([
            { name: 'same.txt', data: enc.encode('one') },
            { name: 'same.txt', data: enc.encode('two') },
        ]));
        const first = join(dir, 'first');
        const r1 = await run(() => stream(parseArgs(['--input', p, '--output-dir', first, '--on-duplicate', 'first'])));
        expect(r1.error).toBeUndefined();
        expect(await readFile(join(first, 'same.txt'), 'utf8')).toBe('one');
        expect(envelope(r1.err)['skipped']).toEqual([{ name: 'same.txt', reason: 'duplicate' }]);
        const last = join(dir, 'last');
        const r2 = await run(() => stream(parseArgs(['--input', p, '--output-dir', last, '--on-duplicate', 'last'])));
        expect(r2.error).toBeUndefined();
        expect(await readFile(join(last, 'same.txt'), 'utf8')).toBe('two');
    });

    it('--on-duplicate with an unknown policy is a usage error', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', join(dir, 'x'), '--on-duplicate', 'maybe'])));
        expect(r.error).toMatchObject({ exitCode: 2 });
    });

    it('--skip-unsupported skips an entry the core cannot decode', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const p = await writeArchive('unsupported.zip', rawZip([
            { name: 'weird.bin', data: enc.encode('????'), method: 99 },
            { name: 'ok.txt', data: enc.encode('fine') },
        ]));
        const out = join(dir, 'unsup');
        const r = await run(() => stream(parseArgs(['--input', p, '--output-dir', out])));
        expect(r.error).toMatchObject({ code: ErrorCode.UNSUPPORTED, zipCode: 'ZIP_UNSUPPORTED_METHOD' });
        const r2 = await run(() => stream(parseArgs(['--input', p, '--output-dir', out, '--skip-unsupported', '--overwrite'])));
        expect(r2.error).toBeUndefined();
        expect(await readFile(join(out, 'ok.txt'), 'utf8')).toBe('fine');
        expect(envelope(r2.err)['skipped']).toEqual([{ name: 'weird.bin', reason: 'unsupported' }]);
    });

    // ── Usage refusals ──────────────────────────────────────────────

    it.each(['--preserve-mode', '--allow-symlinks', '--skip-symlinks'])('%s is refused in forward mode (exit 2)', async (flag) => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath, flag])));
        expect(r.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });

    it('--output-dir and --cat are mutually exclusive (exit 2)', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', join(dir, 'x'), '--cat', 'a.txt'])));
        expect(r.error).toMatchObject({ exitCode: 2 });
    });

    it('rejects an unknown --format (exit 2)', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--format', 'xml'])));
        expect(r.error).toMatchObject({ exitCode: 2 });
    });

    it('refuses a directory link planted inside --output-dir that points outside (E_SECURITY), writing nothing there', async () => {
        await setup();
        const out = join(dir, 'out');
        const outside = join(dir, 'outside');
        await mkdir(out, { recursive: true });
        await mkdir(outside, { recursive: true });
        await symlink(outside, join(out, 'dir'), process.platform === 'win32' ? 'junction' : 'dir');
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', out])));
        expect(r.error).toMatchObject({ code: ErrorCode.SECURITY, exitCode: 1, entryName: 'dir/' });
        expect((r.error as Error).message).toMatch(/leaves the output directory/);
        expect(await readdir(outside)).toEqual([]);
    });

    it('an --output-dir containing ".." is ordinary shell usage', async () => {
        await setup();
        const out = join(dir, 'sub', '..', 'out-dots');
        const r = await run(() => stream(parseArgs(['--input', normalPath, '--output-dir', out])));
        expect(r.error).toBeUndefined();
        expect(await readFile(join(dir, 'out-dots', 'a.txt'), 'utf8')).toBe('hello');
    });

    // ── Truncation and caveat ───────────────────────────────────────

    it('a stream cut inside an entry payload is E_PARSE / ZIP_STREAM_TRUNCATED', async () => {
        await setup();
        const p = await writeArchive('cut.zip', truncatedArchive());
        const r = await run(() => stream(parseArgs(['--input', p, '--format', 'json'])));
        expect(r.error).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_STREAM_TRUNCATED', exitCode: 1 });
        const r2 = await run(() => stream(parseArgs(['--input', p, '--cat', 'a.txt'])));
        expect(r2.error).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_STREAM_TRUNCATED' });
    });

    it('a truncated extraction removes the partial file', async () => {
        await setup();
        const p = await writeArchive('cut.zip', truncatedArchive());
        const out = join(dir, 'cut');
        const r = await run(() => stream(parseArgs(['--input', p, '--output-dir', out])));
        expect(r.error).toMatchObject({ zipCode: 'ZIP_STREAM_TRUNCATED', entryName: 'a.txt' });
        expect(existsSync(join(out, 'a.txt'))).toBe(false);
    });

    it('prints the trust caveat on stderr in text mode but not under ZIPNATIVE_QUIET', async () => {
        await setup();
        const loud = await run(() => stream(parseArgs(['--input', normalPath])));
        expect(loud.err).toMatch(/^warning: forward streaming trusts local headers only/m);
        process.env['ZIPNATIVE_QUIET'] = '1';
        const quiet = await run(() => stream(parseArgs(['--input', normalPath])));
        expect(quiet.err).toBe('');
        expect(quiet.text).toContain('a.txt');
    });

    it('a missing input file is E_IO', async () => {
        await setup();
        const r = await run(() => stream(parseArgs(['--input', join(dir, 'absent.zip')])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO });
    });
});
