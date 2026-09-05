import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { list } from '../../src/commands/list.js';
import { parseArgs } from '../../src/utils/args.js';
import { createZip } from '../../src/core-bridge/index.js';
import type { EntryRow } from '../../src/utils/entryfmt.js';

// ── Local helpers ────────────────────────────────────────────────────

const ENV_KEYS = ['ZIPNATIVE_JSON', 'ZIPNATIVE_DRY_RUN', 'ZIPNATIVE_QUIET', 'ZIPNATIVE_STRICT'] as const;
const savedEnv: Record<string, string | undefined> = {};

interface Capture {
    readonly chunks: Buffer[];
    text(): string;
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
    return { chunks, text: () => Buffer.concat(chunks).toString('utf8') };
}

const captureStdout = (): Capture => mockWrite(process.stdout);
const captureStderr = (): Capture => mockWrite(process.stderr);

interface ListJson {
    archive: { bytes: number; entryCount: number; isZip64: boolean; comment: string; commentBytes: number };
    entries: EntryRow[];
    diagnostics: unknown[];
}

let tmp: string;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'interop');

async function fixture(name = 'fixture.zip'): Promise<string> {
    const w = createZip({ comment: 'list me' });
    w.add('a.txt', 'alpha alpha alpha alpha alpha alpha\n');
    w.add('dir/b.txt', 'beta\n', { comment: 'entry comment' });
    w.add('dir/c.bin', new Uint8Array([1, 2, 3, 4]), { compression: { method: 'store' } });
    w.addDirectory('empty');
    const path = join(tmp, name);
    await writeFile(path, w.toBytes());
    return path;
}

async function runText(argv: string[]): Promise<string> {
    const out = captureStdout();
    await list(parseArgs(argv));
    return out.text();
}

async function runJson(argv: string[]): Promise<ListJson> {
    return JSON.parse(await runText(argv)) as ListJson;
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

describe('list', () => {
    it('renders a text table with names and a totals line', async () => {
        const zip = await fixture();
        const text = await runText(['--input', zip]);
        expect(text).toContain('Length');
        expect(text).toContain('a.txt');
        expect(text).toContain('dir/b.txt');
        expect(text).toContain('empty/');
        expect(text).toContain('4 entries');
        expect(text).toContain('1980-01-01 00:00');
        expect(text).not.toContain('Mode');
    });

    it('--long adds the mode and flag columns', async () => {
        const zip = await fixture();
        const text = await runText(['--input', zip, '--long']);
        expect(text).toContain('Mode');
        expect(text).toContain('Flags');
        expect(text).toContain('0644');
        expect(text).toContain('U---');
    });

    it('accepts a positional archive path', async () => {
        const zip = await fixture();
        const text = await runText([zip]);
        expect(text).toContain('a.txt');
    });

    it('--format json has the { archive, entries, diagnostics } shape', async () => {
        const zip = await fixture();
        const doc = await runJson(['--input', zip, '--format', 'json']);
        const size = (await readFile(zip)).length;
        expect(doc.archive).toEqual({ bytes: size, entryCount: 4, isZip64: false, comment: 'list me', commentBytes: 7, commentHex: Buffer.from('list me').toString('hex') });
        expect(doc.diagnostics).toEqual([]);
        expect(doc.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.txt', 'dir/c.bin', 'empty/']);
        const a = doc.entries[0] as EntryRow;
        expect(a).toMatchObject({
            name: 'a.txt',
            nameEncoding: 'utf-8',
            isDirectory: false,
            isSymlink: false,
            method: 8,
            methodName: 'deflate',
            uncompressedSize: 36,
            isEncrypted: false,
            usesZip64: false,
            usesDataDescriptor: false,
            unixMode: '0644',
        });
        expect(a.crc32).toMatch(/^[0-9a-f]{8}$/);
        expect(a.ratio).toMatch(/^\d+%$/);
        expect(new Date(a.lastModified).toISOString()).toBe(a.lastModified);
        expect(a.flags).toBeUndefined();
        const b = doc.entries[1] as EntryRow;
        expect(b.comment).toBe('entry comment');
        const c = doc.entries[2] as EntryRow;
        expect(c.methodName).toBe('store');
        expect(c.compressedSize).toBe(4);
        const d = doc.entries[3] as EntryRow;
        expect(d.isDirectory).toBe(true);
        expect(d.unixMode).toBe('0755');
    });

    it('--format json --long adds flags, versions, offsets and extra fields', async () => {
        const zip = await fixture();
        const doc = await runJson(['--input', zip, '--format', 'json', '--long']);
        const a = doc.entries[0] as EntryRow;
        expect(a.flags).toEqual({ raw: 0x800, encrypted: false, dataDescriptor: false, strongEncryption: false, utf8: true });
        expect(typeof a.versionMadeBy).toBe('number');
        expect(typeof a.versionNeeded).toBe('number');
        expect(a.localHeaderOffset).toBe(0);
        expect(a.dosDate).toBe(0x21);
        expect(a.dosTime).toBe(0);
        expect(Array.isArray(a.extraFields)).toBe(true);
    });

    it('--format ndjson emits one JSON row per line', async () => {
        const zip = await fixture();
        const text = await runText(['--input', zip, '--format', 'ndjson']);
        const lines = text.trimEnd().split('\n');
        expect(lines).toHaveLength(4);
        const rows = lines.map((l) => JSON.parse(l) as EntryRow);
        expect(rows.map((r) => r.name)).toEqual(['a.txt', 'dir/b.txt', 'dir/c.bin', 'empty/']);
        expect(lines.every((l) => !l.includes('\n  '))).toBe(true);
    });

    it('--format ndjson under --json surfaces diagnostics as stderr text', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const zip = await fixture();
        const prefixed = join(tmp, 'prefixed.zip');
        await writeFile(prefixed, Buffer.concat([Buffer.from('JUNKJUNKJUNK'), await readFile(zip)]));
        const err = captureStderr();
        const text = await runText(['--input', prefixed, '--format', 'ndjson']);
        expect(text.trimEnd().split('\n')).toHaveLength(4);
        expect(err.text()).toContain('[ZIP_PREPENDED_DATA]');
    });

    it('text mode writes diagnostics to stderr, --quiet suppresses them', async () => {
        const zip = await fixture();
        const prefixed = join(tmp, 'prefixed.zip');
        await writeFile(prefixed, Buffer.concat([Buffer.from('JUNKJUNKJUNK'), await readFile(zip)]));
        const err = captureStderr();
        await runText(['--input', prefixed]);
        expect(err.text()).toContain('info: [ZIP_PREPENDED_DATA]');

        process.env['ZIPNATIVE_QUIET'] = '1';
        const err2 = captureStderr();
        await runText(['--input', prefixed]);
        expect(err2.text()).toBe('');
    });

    it('json report carries diagnostics in the diagnostics array', async () => {
        const zip = await fixture();
        const prefixed = join(tmp, 'prefixed.zip');
        await writeFile(prefixed, Buffer.concat([Buffer.from('JUNKJUNKJUNK'), await readFile(zip)]));
        const doc = await runJson(['--input', prefixed, '--format', 'json']);
        expect((doc.diagnostics as Array<{ code: string }>).map((d) => d.code)).toEqual(['ZIP_PREPENDED_DATA']);
    });

    it('--summary emits the canonical minimal verdict', async () => {
        const zip = await fixture();
        const doc = JSON.parse(await runText(['--input', zip, '--format', 'json', '--summary'])) as Record<string, unknown>;
        expect(doc).toEqual({
            entries: 4,
            files: 3,
            directories: 1,
            compressedSize: expect.any(Number),
            uncompressedSize: 36 + 5 + 4,
            zip64: false,
            encrypted: 0,
        });
    });

    it('--fields projects dot-paths (arrays map over elements)', async () => {
        const zip = await fixture();
        const doc = JSON.parse(await runText(['--input', zip, '--format', 'json', '--fields', 'entries.name,entries.compressedSize,archive.entryCount'])) as Record<string, unknown>;
        expect(Object.keys(doc).sort()).toEqual(['archive', 'entries']);
        expect(doc['archive']).toEqual({ entryCount: 4 });
        const entries = doc['entries'] as Array<Record<string, unknown>>;
        expect(entries).toHaveLength(4);
        expect(Object.keys(entries[0] as object).sort()).toEqual(['compressedSize', 'name']);
    });

    it('--fields with unknown paths yields an empty object', async () => {
        const zip = await fixture();
        const doc = JSON.parse(await runText(['--input', zip, '--format', 'json', '--fields', 'name,compressedSize'])) as Record<string, unknown>;
        expect(doc).toEqual({});
    });

    it('--include / --exclude filter rows', async () => {
        const zip = await fixture();
        const inc = await runJson(['--input', zip, '--format', 'json', '--include', '*.txt']);
        expect(inc.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.txt']);
        const exc = await runJson(['--input', zip, '--format', 'json', '--exclude', 'dir/']);
        expect(exc.entries.map((e) => e.name)).toEqual(['a.txt', 'empty/']);
        // archive.entryCount is the central-directory count, not the filtered count
        expect(exc.archive.entryCount).toBe(4);
        const text = await runText(['--input', zip, '--include', 'dir/c.bin']);
        expect(text).toContain('1 entry');
    });

    it('--validate eager succeeds; --validate bogus is a usage error', async () => {
        const zip = await fixture();
        const doc = await runJson(['--input', zip, '--format', 'json', '--validate', 'eager']);
        expect(doc.entries).toHaveLength(4);
        await expect(list(parseArgs(['--input', zip, '--validate', 'bogus']))).rejects.toMatchObject({ exitCode: 2 });
    });

    it('--format bogus is a usage error', async () => {
        const zip = await fixture();
        await expect(list(parseArgs(['--input', zip, '--format', 'xml']))).rejects.toMatchObject({ exitCode: 2, code: 'E_USAGE' });
    });

    it('defaults to compact json under ZIPNATIVE_JSON, --pretty restores indentation', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const zip = await fixture();
        const text = await runText(['--input', zip]);
        expect(text.endsWith('\n')).toBe(true);
        expect(text.trimEnd()).not.toContain('\n');
        const doc = JSON.parse(text) as ListJson;
        expect(doc.archive.entryCount).toBe(4);
        const pretty = await runText(['--input', zip, '--pretty']);
        expect(pretty).toContain('\n  ');
    });

    it('a non-zip file is E_PARSE with zipCode ZIP_EOCD_NOT_FOUND', async () => {
        const bad = join(tmp, 'bad.zip');
        await writeFile(bad, 'this is definitely not a zip archive at all');
        await expect(list(parseArgs(['--input', bad])))
            .rejects.toMatchObject({ code: 'E_PARSE', exitCode: 1, zipCode: 'ZIP_EOCD_NOT_FOUND' });
    });

    it('a missing archive is E_IO', async () => {
        await expect(list(parseArgs(['--input', join(tmp, 'missing.zip')])))
            .rejects.toMatchObject({ code: 'E_IO', exitCode: 1 });
    });

    it('--strict escalates a diagnostic to E_CHECK_FAILED', async () => {
        const zip = await fixture();
        const prefixed = join(tmp, 'prefixed.zip');
        await writeFile(prefixed, Buffer.concat([Buffer.from('JUNKJUNKJUNK'), await readFile(zip)]));
        await expect(list(parseArgs(['--input', prefixed, '--strict', '--validate', 'eager'])))
            .rejects.toMatchObject({ code: 'E_CHECK_FAILED', zipCode: 'ZIP_STRICT_DIAGNOSTIC' });
    });

    it('a --max-* limit flag is forwarded to the reader', async () => {
        const zip = await fixture();
        await expect(list(parseArgs(['--input', zip, '--max-entries', '1', '--format', 'json'])))
            .rejects.toMatchObject({ code: 'E_LIMIT', zipCode: 'ZIP_LIMIT_EXCEEDED' });
        await expect(list(parseArgs(['--input', zip, '--max-entries', '0'])))
            .rejects.toMatchObject({ exitCode: 2 });
    });

    describe('foreign fixtures', () => {
        const present = existsSync(FIXTURES);
        it.skipIf(!present)('every tests/fixtures/interop/*.zip lists without error', async () => {
            const names = (await readdir(FIXTURES)).filter((n) => n.endsWith('.zip'));
            for (const n of names) {
                const doc = await runJson(['--input', join(FIXTURES, n), '--format', 'json']);
                expect(doc.entries.length).toBe(doc.archive.entryCount);
            }
        });
    });
});
