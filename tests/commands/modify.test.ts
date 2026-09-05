import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { modify } from '../../src/commands/modify.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';
import { createZip, openZip, type ZipEntry } from '../../src/core-bridge/index.js';
import { buildRawZip } from '../helpers/raw-zip-builder.js';

// ── Local capture helper ──────────────────────────────────────────────

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

const originalStdin = process.stdin;
function setStdin(text: string): void {
    Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from(text)]), configurable: true });
}

// ── Fixtures ──────────────────────────────────────────────────────────

const ALPHA = 'alpha-payload-AAAA';
const BRAVO = 'bravo-payload-BBBB';
// Long enough to be compressible: the writer stores a payload deflate cannot shrink.
const NEW_PAYLOAD = 'fresh-payload-NNNN '.repeat(8);

function baseArchive(comment?: string): Uint8Array {
    // Stored payloads so the remanence assertions can grep the raw bytes.
    const w = createZip({ compression: { method: 'store' } });
    w.add('a.txt', ALPHA);
    w.add('b.txt', BRAVO);
    w.add('c.txt', 'charlie');
    if (comment !== undefined) w.setComment(comment);
    return w.toBytes();
}

interface Snapshot {
    readonly names: string[];
    readonly entries: Map<string, ZipEntry>;
    readonly content: (name: string) => string;
    readonly comment: string;
}

function snapshot(bytes: Uint8Array): Snapshot {
    const reader = openZip(bytes, { onDiagnostic: () => undefined });
    const entries = new Map<string, ZipEntry>();
    for (const e of reader.entries()) entries.set(e.name, e);
    return {
        names: [...entries.keys()],
        entries,
        content: (name) => Buffer.from(reader.readEntry(entries.get(name) as ZipEntry)).toString('utf8'),
        comment: Buffer.from(reader.comment).toString('utf8'),
    };
}

function hasBytes(haystack: Uint8Array, needle: string): boolean {
    return Buffer.from(haystack).includes(Buffer.from(needle));
}

describe('modify', () => {
    let dir = '';
    let input = '';
    let payload = '';
    let output = '';

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

    async function setup(comment?: string): Promise<void> {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        input = join(dir, 'in.zip');
        payload = join(dir, 'new.txt');
        output = join(dir, 'out.zip');
        await writeFile(input, baseArchive(comment));
        await writeFile(payload, NEW_PAYLOAD);
    }

    async function result(): Promise<Uint8Array> {
        const buf = await readFile(output);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }

    // ── Single edits ────────────────────────────────────────────────

    it('--add name=path appends a new entry (append-only prefix intact, envelope reported)', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add', `new.txt=${payload}`])));
        expect(r.error).toBeUndefined();
        const out = await result();
        const original = baseArchive();
        expect(Buffer.from(out.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
        const snap = snapshot(out);
        expect(snap.names).toEqual(['a.txt', 'b.txt', 'c.txt', 'new.txt']);
        expect(snap.content('new.txt')).toBe(NEW_PAYLOAD);
        expect(envelope(r.err)).toMatchObject({
            ok: true,
            command: 'modify',
            dryRun: false,
            output,
            bytes: out.length,
            edits: [{ op: 'add', name: 'new.txt' }],
            layout: 'append-only',
            changed: true,
            diagnostics: [],
        });
        // An add is not destructive: no remanence notice.
        expect(r.err).not.toContain('info: append-only');
    });

    it('a bare --add path uses the file basename as the entry name', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '-o', output, '--add', payload])));
        expect(r.error).toBeUndefined();
        expect(snapshot(await result()).names).toContain('new.txt');
    });

    it('--replace swaps the content and leaves the old payload recoverable in append-only mode', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--replace', `a.txt=${payload}`])));
        expect(r.error).toBeUndefined();
        const out = await result();
        expect(snapshot(out).content('a.txt')).toBe(NEW_PAYLOAD);
        expect(hasBytes(out, ALPHA)).toBe(true);
        expect(r.err).toContain('info: append-only save keeps removed/replaced bytes recoverable');
    });

    it('--remove drops the entry from the directory but its bytes remain', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--remove', 'a.txt'])));
        expect(r.error).toBeUndefined();
        const out = await result();
        expect(snapshot(out).names).toEqual(['b.txt', 'c.txt']);
        expect(hasBytes(out, ALPHA)).toBe(true);
    });

    it('--rename from=to renames an entry', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--rename', 'a.txt=z/a.txt'])));
        expect(r.error).toBeUndefined();
        const snap = snapshot(await result());
        expect(snap.names).toEqual(['b.txt', 'c.txt', 'z/a.txt']);
        expect(snap.content('z/a.txt')).toBe(ALPHA);
        expect(envelope(r.err)['edits']).toEqual([{ op: 'rename', name: 'a.txt', to: 'z/a.txt' }]);
    });

    it('--add-dir adds an explicit directory entry', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add-dir', 'sub'])));
        expect(r.error).toBeUndefined();
        const snap = snapshot(await result());
        expect(snap.names).toContain('sub/');
        expect(snap.entries.get('sub/')?.isDirectory).toBe(true);
    });

    it('--comment sets the archive comment and --comment= clears it', async () => {
        await setup('old comment');
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--comment', 'hello world'])));
        expect(r.error).toBeUndefined();
        expect(snapshot(await result()).comment).toBe('hello world');
        const cleared = join(dir, 'cleared.zip');
        const r2 = await run(() => modify(parseArgs(['--input', input, '--output', cleared, '--comment='])));
        expect(r2.error).toBeUndefined();
        const buf = await readFile(cleared);
        expect(snapshot(new Uint8Array(buf)).comment).toBe('');
    });

    it('reports changed:false when the only edit leaves the archive as it was', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--comment='])));
        expect(r.error).toBeUndefined();
        expect(envelope(r.err)).toMatchObject({ changed: false, edits: [{ op: 'comment', name: '' }] });
        const original = baseArchive();
        expect(Buffer.from(await result()).equals(Buffer.from(original))).toBe(true);
    });

    // ── Combinations and ordering ───────────────────────────────────

    it('applies edits in the fixed order: remove X then add X works regardless of argv order', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add', `a.txt=${payload}`, '--remove', 'a.txt'])));
        expect(r.error).toBeUndefined();
        const snap = snapshot(await result());
        expect(snap.content('a.txt')).toBe(NEW_PAYLOAD);
        const edits = envelope(r.err)['edits'] as { op: string }[];
        expect(edits.map((e) => e.op)).toEqual(['remove', 'add']);
    });

    it('combines every edit kind in one run', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => modify(parseArgs([
            '--input', input, '--output', output,
            '--add', `new.txt=${payload}`, '--add-dir', 'd/', '--replace', `b.txt=${payload}`,
            '--remove', 'c.txt', '--rename', 'a.txt=first.txt', '--comment', 'combo',
        ])));
        expect(r.error).toBeUndefined();
        const snap = snapshot(await result());
        expect(snap.names.sort()).toEqual(['b.txt', 'd/', 'first.txt', 'new.txt']);
        expect(snap.content('b.txt')).toBe(NEW_PAYLOAD);
        expect(snap.comment).toBe('combo');
        const edits = envelope(r.err)['edits'] as { op: string }[];
        expect(edits.map((e) => e.op)).toEqual(['remove', 'rename', 'replace', 'add', 'add-dir', 'comment']);
    });

    it('--compact rewrites canonically: removed payload gone, layout compact, no remanence notice', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--remove', 'a.txt', '--compact'])));
        expect(r.error).toBeUndefined();
        const out = await result();
        expect(snapshot(out).names).toEqual(['b.txt', 'c.txt']);
        expect(hasBytes(out, ALPHA)).toBe(false);
        expect(hasBytes(out, BRAVO)).toBe(true);
        expect(envelope(r.err)).toMatchObject({ layout: 'compact', changed: true });
        expect(r.err).not.toContain('info: append-only');
    });

    it('--method store / --level / --date govern NEW payloads only', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add', `new.txt=${payload}`, '--method', 'store', '--date', '2021-05-06T07:08:09Z'])));
        expect(r.error).toBeUndefined();
        const snap = snapshot(await result());
        expect(snap.entries.get('new.txt')?.compressionMethod).toBe(0);
        expect(snap.entries.get('new.txt')?.lastModified.getFullYear()).toBe(2021);
        expect(snap.entries.get('a.txt')?.lastModified.getFullYear()).toBe(1980);
        const deflated = join(dir, 'deflated.zip');
        const r2 = await run(() => modify(parseArgs(['--input', input, '--output', deflated, '--add', `new.txt=${payload}`, '--method', 'deflate', '--level', '9'])));
        expect(r2.error).toBeUndefined();
        expect(snapshot(new Uint8Array(await readFile(deflated))).entries.get('new.txt')?.compressionMethod).toBe(8);
    });

    it('writes to stdout when --output is omitted', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--remove', 'c.txt'])));
        expect(r.error).toBeUndefined();
        expect(snapshot(new Uint8Array(r.out)).names).toEqual(['a.txt', 'b.txt']);
    });

    it('reads the archive from stdin with --input=-', async () => {
        await setup();
        Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from(baseArchive())]), configurable: true });
        const r = await run(() => modify(parseArgs(['--input=-', '--output', output, '--remove', 'c.txt'])));
        expect(r.error).toBeUndefined();
        expect(snapshot(await result()).names).toEqual(['a.txt', 'b.txt']);
    });

    it('reads a payload from stdin with <name>=-', async () => {
        await setup();
        setStdin('from-stdin');
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add', 'stdin.txt=-'])));
        expect(r.error).toBeUndefined();
        expect(snapshot(await result()).content('stdin.txt')).toBe('from-stdin');
    });

    it('refuses to consume stdin twice (exit 2)', async () => {
        await setup();
        setStdin('x');
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add', 'one.txt=-', '--add', 'two.txt=-'])));
        expect(r.error).toMatchObject({ exitCode: 2 });
    });

    // ── --in-place ──────────────────────────────────────────────────

    it('--in-place rewrites the input path atomically', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--in-place', '--remove', 'c.txt'])));
        expect(r.error).toBeUndefined();
        expect(snapshot(new Uint8Array(await readFile(input))).names).toEqual(['a.txt', 'b.txt']);
        const leftovers = (await readdir(dir)).filter((n) => n.startsWith('in.zip.tmp-'));
        expect(leftovers).toEqual([]);
    });

    it('--in-place is refused together with --output and with stdin input (exit 2)', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--in-place', '--output', output, '--remove', 'c.txt'])));
        expect(r.error).toMatchObject({ exitCode: 2 });
        const r2 = await run(() => modify(parseArgs(['--input=-', '--in-place', '--remove', 'c.txt'])));
        expect(r2.error).toMatchObject({ exitCode: 2 });
        expect((r2.error as Error).message).toContain('requires a file input');
    });

    // ── --dry-run ───────────────────────────────────────────────────

    it('--dry-run validates and reports the plan without writing', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--remove', 'a.txt', '--add', `new.txt=${payload}`, '--dry-run'])));
        expect(r.error).toBeUndefined();
        expect(existsSync(output)).toBe(false);
        expect(envelope(r.err)).toMatchObject({
            ok: true,
            command: 'modify',
            dryRun: true,
            output,
            edits: [{ op: 'remove', name: 'a.txt' }, { op: 'add', name: 'new.txt' }],
            layout: 'append-only',
        });
        expect(r.err).not.toContain('info: append-only');
    });

    it('--dry-run still surfaces core refusals (missing entry)', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--remove', 'ghost.txt', '--dry-run'])));
        expect(r.error).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
        expect(existsSync(output)).toBe(false);
    });

    // ── --from-manifest ─────────────────────────────────────────────

    it('--from-manifest applies add/replace/remove/rename/add-dir with per-edit options', async () => {
        await setup();
        process.env['ZIPNATIVE_JSON'] = '1';
        const manifestDir = join(dir, 'm');
        await mkdir(manifestDir);
        await writeFile(join(manifestDir, 'payload.txt'), 'manifest-file-payload');
        const manifestPath = join(manifestDir, 'edits.json');
        await writeFile(manifestPath, JSON.stringify({
            version: 1,
            comment: 'from-manifest',
            edits: [
                { op: 'remove', name: 'c.txt' },
                { op: 'rename', name: 'b.txt', to: 'renamed/b.txt' },
                { op: 'replace', name: 'a.txt', data: 'replaced-alpha '.repeat(8), method: 'deflate', level: 9, deterministic: true, comment: 'entry-comment', date: '2020-06-15T12:00:00Z' },
                { op: 'add', name: 'inline.txt', dataBase64: Buffer.from('inline!').toString('base64') },
                { op: 'add', name: 'from-file.txt', path: 'payload.txt', method: 'store' },
                { op: 'add-dir', name: 'newdir' },
            ],
        }));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--from-manifest', manifestPath])));
        expect(r.error).toBeUndefined();
        const snap = snapshot(await result());
        expect(snap.names.sort()).toEqual(['a.txt', 'from-file.txt', 'inline.txt', 'newdir/', 'renamed/b.txt']);
        expect(snap.content('a.txt')).toBe('replaced-alpha '.repeat(8));
        expect(snap.content('inline.txt')).toBe('inline!');
        expect(snap.content('from-file.txt')).toBe('manifest-file-payload');
        expect(snap.content('renamed/b.txt')).toBe(BRAVO);
        expect(snap.comment).toBe('from-manifest');
        const a = snap.entries.get('a.txt') as ZipEntry;
        expect(a.compressionMethod).toBe(8);
        expect(Buffer.from(a.comment).toString('utf8')).toBe('entry-comment');
        expect(a.lastModified.getFullYear()).toBe(2020);
        expect(snap.entries.get('from-file.txt')?.compressionMethod).toBe(0);
        const edits = envelope(r.err)['edits'] as { op: string; name: string; to?: string }[];
        expect(edits.map((e) => e.op)).toEqual(['remove', 'rename', 'replace', 'add', 'add', 'add-dir', 'comment']);
        expect(edits[1]).toEqual({ op: 'rename', name: 'b.txt', to: 'renamed/b.txt' });
    });

    it('--from-manifest=- reads the manifest from stdin', async () => {
        await setup();
        setStdin(JSON.stringify({ edits: [{ op: 'remove', name: 'a.txt' }] }));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--from-manifest=-'])));
        expect(r.error).toBeUndefined();
        expect(snapshot(await result()).names).toEqual(['b.txt', 'c.txt']);
    });

    it('--from-manifest is mutually exclusive with flag edits and --comment (exit 2)', async () => {
        await setup();
        const manifestPath = join(dir, 'edits.json');
        await writeFile(manifestPath, JSON.stringify({ edits: [] }));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--from-manifest', manifestPath, '--remove', 'a.txt'])));
        expect(r.error).toMatchObject({ exitCode: 2 });
        const r2 = await run(() => modify(parseArgs(['--input', input, '--output', output, '--from-manifest', manifestPath, '--comment', 'x'])));
        expect(r2.error).toMatchObject({ exitCode: 2 });
    });

    it.each<[string, unknown]>([
        ['not an object', [1, 2]],
        ['unknown top-level key', { edits: [], bogus: 1 }],
        ['unsupported version', { version: 2, edits: [] }],
        ['edits not an array', { edits: 'nope' }],
        ['comment not a string', { comment: 5, edits: [] }],
        ['edit not an object', { edits: [5] }],
        ['unknown edit key', { edits: [{ op: 'add', name: 'x', data: 'y', bogus: 1 }] }],
        ['unknown op', { edits: [{ op: 'zap', name: 'x' }] }],
        ['missing name', { edits: [{ op: 'remove' }] }],
        ['rename without to', { edits: [{ op: 'rename', name: 'a.txt' }] }],
        ['unsafe add name', { edits: [{ op: 'add', name: '../x', data: 'y' }] }],
        ['unsafe rename target', { edits: [{ op: 'rename', name: 'a.txt', to: '../x' }] }],
        ['bad method', { edits: [{ op: 'add', name: 'x', data: 'y', method: 'lzma' }] }],
        ['bad level', { edits: [{ op: 'add', name: 'x', data: 'y', level: 12 }] }],
        ['bad deterministic', { edits: [{ op: 'add', name: 'x', data: 'y', deterministic: 'yes' }] }],
        ['bad date', { edits: [{ op: 'add', name: 'x', data: 'y', date: 'not-a-date' }] }],
        ['bad comment', { edits: [{ op: 'add', name: 'x', data: 'y', comment: 3 }] }],
        ['no payload source', { edits: [{ op: 'add', name: 'x' }] }],
        ['two payload sources', { edits: [{ op: 'add', name: 'x', data: 'y', path: 'z' }] }],
        ['non-string payload', { edits: [{ op: 'add', name: 'x', data: 7 }] }],
    ])('rejects a manifest with %s as E_INPUT', async (_label, doc) => {
        await setup();
        const manifestPath = join(dir, 'bad.json');
        await writeFile(manifestPath, JSON.stringify(doc));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--from-manifest', manifestPath])));
        expect(r.error).toMatchObject({ code: ErrorCode.INPUT, exitCode: 1 });
        expect(existsSync(output)).toBe(false);
    });

    it('a manifest payload path that does not exist is E_IO and invalid JSON is E_PARSE', async () => {
        await setup();
        const manifestPath = join(dir, 'io.json');
        await writeFile(manifestPath, JSON.stringify({ edits: [{ op: 'add', name: 'x', path: 'missing.txt' }] }));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--from-manifest', manifestPath])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO });
        const badJson = join(dir, 'bad.json');
        await writeFile(badJson, '{not json');
        const r2 = await run(() => modify(parseArgs(['--input', input, '--output', output, '--from-manifest', badJson])));
        expect(r2.error).toMatchObject({ code: ErrorCode.PARSE });
    });

    // ── Core refusals ───────────────────────────────────────────────

    it('adding an existing name is E_INPUT / ZIP_ENTRY_EXISTS', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add', `a.txt=${payload}`])));
        expect(r.error).toMatchObject({ code: ErrorCode.INPUT, zipCode: 'ZIP_ENTRY_EXISTS', entryName: 'a.txt', exitCode: 1 });
        expect(existsSync(output)).toBe(false);
    });

    it.each([
        ['--replace', 'ghost.txt=PAYLOAD'],
        ['--remove', 'ghost.txt'],
        ['--rename', 'ghost.txt=other.txt'],
    ])('%s on a missing entry is E_NOT_FOUND / ZIP_ENTRY_NOT_FOUND', async (flag, value) => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, flag, value.replace('PAYLOAD', payload)])));
        expect(r.error).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND', entryName: 'ghost.txt' });
    });

    it('renaming onto an existing name is refused by the core', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--rename', 'a.txt=b.txt'])));
        expect(r.error).toMatchObject({ code: ErrorCode.INPUT, zipCode: 'ZIP_ENTRY_EXISTS' });
    });

    // ── Usage errors ────────────────────────────────────────────────

    it.each([
        ['--add', '../x=PAYLOAD'],
        ['--add', 'aux.txt=PAYLOAD'],
        ['--rename', 'a.txt=../x'],
        ['--add-dir', '../x'],
        ['--add-dir', '/'],
    ])('%s with an unsafe entry name is a usage error (exit 2)', async (flag, value) => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, flag, value.replace('PAYLOAD', payload)])));
        expect(r.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });

    it.each([
        [['--rename', 'noequals']],
        [['--rename', '=b']],
        [['--add', '=x']],
        [['--add', 'x=']],
        [['--add', '-']],
        [['--method', 'lzma', '--add-dir', 'd']],
        [['--level', '11', '--add-dir', 'd']],
        [['--date', 'yesterday-ish', '--add-dir', 'd']],
    ])('malformed flags %j are usage errors (exit 2)', async (extra) => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, ...extra])));
        expect(r.error).toMatchObject({ exitCode: 2 });
    });

    it('requires at least one edit and an input (exit 2)', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output])));
        expect(r.error).toMatchObject({ exitCode: 2 });
        const r2 = await run(() => modify(parseArgs(['--output', output, '--remove', 'a.txt'])));
        expect(r2.error).toMatchObject({ exitCode: 2 });
    });

    it('a missing payload file is E_IO and a directory payload is E_INPUT', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add', `x.txt=${join(dir, 'absent.txt')}`])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO });
        const sub = join(dir, 'subdir');
        await mkdir(sub);
        const r2 = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add', `x.txt=${sub}`])));
        expect(r2.error).toMatchObject({ code: ErrorCode.INPUT });
    });

    it('a missing archive is E_IO and a non-archive is E_PARSE', async () => {
        await setup();
        const r = await run(() => modify(parseArgs(['--input', join(dir, 'absent.zip'), '--output', output, '--remove', 'a.txt'])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO });
        const junk = join(dir, 'junk.zip');
        await writeFile(junk, 'this is not a zip archive at all');
        const r2 = await run(() => modify(parseArgs(['--input', junk, '--output', output, '--remove', 'a.txt'])));
        expect(r2.error).toMatchObject({ code: ErrorCode.PARSE });
    });

    it('refuses an existing --output without --overwrite (E_IO, file intact) and replaces it with --overwrite', async () => {
        await setup();
        await writeFile(output, 'not an archive, but mine');
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--remove', 'a.txt'])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO, exitCode: 1 });
        expect((r.error as Error).message).toBe(`Refusing to overwrite existing file ${output} (pass --overwrite).`);
        expect((await readFile(output)).toString()).toBe('not an archive, but mine');
        const r2 = await run(() => modify(parseArgs(['--input', input, '--output', output, '--remove', 'a.txt', '--overwrite'])));
        expect(r2.error).toBeUndefined();
        expect(snapshot(await result()).names).toEqual(['b.txt', 'c.txt']);
    });

    it('--in-place refuses a planted temp path instead of following it (unpredictable exclusive temp name)', async () => {
        await setup();
        // The temp name carries the pid and 12 random hex digits; a planted
        // file at the *predictable* legacy name must not matter either way.
        await writeFile(`${input}.tmp-${process.pid}`, 'planted');
        const r = await run(() => modify(parseArgs(['--input', input, '--in-place', '--remove', 'c.txt'])));
        expect(r.error).toBeUndefined();
        expect(snapshot(new Uint8Array(await readFile(input))).names).toEqual(['a.txt', 'b.txt']);
        const leftovers = (await readdir(dir)).filter((n) => n.startsWith('in.zip.tmp-') && n !== `in.zip.tmp-${process.pid}`);
        expect(leftovers).toEqual([]);
    });
});

// ── Survivor verification (audit B-03) ──────────────────────────────
// Untouched records are re-emitted verbatim, so every one of them is
// cross-checked (CRC, sizes, local header) before the save — a lying record
// must never be laundered into a clean-looking archive.

describe('modify verifies what it re-emits', () => {
    let dir = '';
    const enc = new TextEncoder();

    afterEach(async () => {
        vi.restoreAllMocks();
        delete process.env['ZIPNATIVE_JSON'];
        if (dir !== '') await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        dir = '';
    });

    async function archive(bytes: Uint8Array): Promise<{ input: string; output: string }> {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        const input = join(dir, 'hostile.zip');
        await writeFile(input, bytes);
        return { input, output: join(dir, 'out.zip') };
    }

    it('a CRC lie on an untouched entry is E_DATA / ZIP_CRC_MISMATCH naming the entry, nothing written — also under --dry-run', async () => {
        const { input, output } = await archive(buildRawZip([
            { name: 'a.txt', data: enc.encode('AAAA-alpha'), crcOverride: 0xdeadbeef },
            { name: 'b.txt', data: enc.encode('BBBB-bravo') },
        ]));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--remove', 'b.txt'])));
        expect(r.error).toMatchObject({ code: ErrorCode.DATA, exitCode: 1, zipCode: 'ZIP_CRC_MISMATCH', entryName: 'a.txt' });
        expect((r.error as Error).message).toMatch(/re-emitted verbatim/);
        expect(existsSync(output)).toBe(false);
        const dry = await run(() => modify(parseArgs(['--input', input, '--output', output, '--remove', 'b.txt', '--dry-run'])));
        expect(dry.error).toMatchObject({ code: ErrorCode.DATA, zipCode: 'ZIP_CRC_MISMATCH' });
    });

    it('removing or replacing the lying entry makes the edit acceptable; the envelope counts the verified survivors', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const { input, output } = await archive(buildRawZip([
            { name: 'a.txt', data: enc.encode('AAAA-alpha'), crcOverride: 0xdeadbeef },
            { name: 'b.txt', data: enc.encode('BBBB-bravo') },
            { name: 'c.txt', data: enc.encode('CCCC-charlie'), method: 8 },
        ]));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--remove', 'a.txt'])));
        expect(r.error).toBeUndefined();
        expect(envelope(r.err)).toMatchObject({ ok: true, command: 'modify', verified: 2, verifySkipped: 0, tier: expect.stringMatching(/^(node-zlib|pure|injected|pure-pinned)$/) as string });
        expect(snapshot(new Uint8Array(await readFile(output))).names).toEqual(['b.txt', 'c.txt']);
        const rep = await run(() => modify(parseArgs(['--input', input, '--output', join(dir, 'rep.zip'), '--replace', `a.txt=${join(dir, 'hostile.zip')}`])));
        expect(rep.error).toBeUndefined();
        expect(envelope(rep.err)).toMatchObject({ verified: 2 });
    });

    it('a local header that disagrees with the central directory is E_SECURITY / ZIP_CD_LFH_MISMATCH', async () => {
        const { input, output } = await archive(buildRawZip([
            { name: 'a.txt', data: enc.encode('AAAA-alpha'), lfhMethodOverride: 8 },
            { name: 'b.txt', data: enc.encode('BBBB-bravo') },
        ]));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add-dir', 'new'])));
        expect(r.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_CD_LFH_MISMATCH', entryName: 'a.txt' });
        expect(existsSync(output)).toBe(false);
    });

    it('overlapping entry ranges are refused at open (eager validation) with ZIP_ENTRY_OVERLAP', async () => {
        const { input, output } = await archive(buildRawZip([
            { name: 'a.txt', data: enc.encode('AAAA-alpha-AAAA-alpha') },
            { name: 'b.txt', data: enc.encode('BB'), localHeaderOffsetOverride: 10 },
        ]));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add-dir', 'new'])));
        expect(r.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_ENTRY_OVERLAP' });
        expect(existsSync(output)).toBe(false);
    });

    it('an encrypted untouched entry cannot be verified: copied as-is and counted in verifySkipped', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const { input, output } = await archive(buildRawZip([
            { name: 'secret.bin', data: enc.encode('opaque-ciphertext-bytes'), flags: 0x0001 },
            { name: 'plain.txt', data: enc.encode('plain') },
        ]));
        const r = await run(() => modify(parseArgs(['--input', input, '--output', output, '--add-dir', 'new'])));
        expect(r.error).toBeUndefined();
        expect(envelope(r.err)).toMatchObject({ verified: 1, verifySkipped: 1 });
        const names = snapshot(new Uint8Array(await readFile(output))).names;
        expect(names).toEqual(expect.arrayContaining(['secret.bin', 'plain.txt', 'new/']));
    });
});
