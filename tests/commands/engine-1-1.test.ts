// zipnative 1.1 parity: every engine capability the CLI 1.1.0 surfaces, end
// to end through the commands (in-process). One file because the codec it
// registers (method 97) is process-global and vitest isolates module state
// per file. Archives with foreign shapes come from the raw builder (never a
// committed fixture).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { cat } from '../../src/commands/cat.js';
import { create } from '../../src/commands/create.js';
import { inspect } from '../../src/commands/inspect.js';
import { list, type ListReport } from '../../src/commands/list.js';
import { modify } from '../../src/commands/modify.js';
import { stream } from '../../src/commands/stream.js';
import { verify, type VerifyReport } from '../../src/commands/verify.js';
import { createZip, openZip } from '../../src/core-bridge/index.js';
import { parseArgs } from '../../src/utils/args.js';
import { _resetControl, armTimeout, parseDuration } from '../../src/utils/control.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { buildExtraField, buildRawZip } from '../helpers/raw-zip-builder.js';

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
    const lines = err.split('\n').filter((l) => l.startsWith('{') && !l.includes('"type":"progress"'));
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

const enc = new TextEncoder();
const crcOf = (data: Uint8Array): number => zlibCrc32(data) >>> 0;
let dir = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-11-'));
});

afterEach(async () => {
    vi.restoreAllMocks();
    _resetControl();
    for (const k of ['ZIPNATIVE_JSON', 'ZIPNATIVE_QUIET', 'ZIPNATIVE_STRICT', 'ZIPNATIVE_PROGRESS']) delete process.env[k];
    await rm(dir, { recursive: true, force: true });
});

describe('--name-encoding (nameDecoder)', () => {
    // "日本.txt" in Shift_JIS, stored WITHOUT the UTF-8 flag (a Japanese Windows producer).
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x2e, 0x74, 0x78, 0x74]);
    let archive = '';

    beforeEach(async () => {
        archive = join(dir, 'sjis.zip');
        await writeFile(archive, buildRawZip([{ name: sjis, data: enc.encode('hello') }]));
    });

    it('decodes non-UTF-8 names with the requested label; the default stays CP437', async () => {
        const plain = JSON.parse((await run(() => list(parseArgs([archive, '--format', 'json'])))).text) as ListReport;
        expect(plain.entries[0]?.nameEncoding).toBe('cp437');
        expect(plain.entries[0]?.name).not.toBe('日本.txt');

        const r = await run(() => list(parseArgs([archive, '--format', 'json', '--long', '--name-encoding', 'shift_jis'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as ListReport;
        expect(doc.entries[0]?.name).toBe('日本.txt');
        expect(doc.entries[0]?.nameEncoding).toBe('custom');
        expect(doc.entries[0]?.rawNameHex).toBe(Buffer.from(sjis).toString('hex'));
    });

    it('cat --entry matches the decoded name; cp437 is the explicit default', async () => {
        const r = await run(() => cat(parseArgs([archive, '--entry', '日本.txt', '--name-encoding', 'shift_jis'])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe('hello');
        const d = await run(() => list(parseArgs([archive, '--format', 'json', '--name-encoding', 'CP437'])));
        expect((JSON.parse(d.text) as ListReport).entries[0]?.nameEncoding).toBe('cp437');
    });

    it('an encoding the runtime cannot decode is a usage error (exit 2) before any read', async () => {
        const r = await run(() => list(parseArgs([archive, '--name-encoding', 'klingon'])));
        expect(r.error).toBeInstanceOf(CliError);
        expect(r.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });
});

describe('--long timestamps / unixIds (getExtendedTimestamps, getUnixIds)', () => {
    it('reports the UT extra and the Info-ZIP uid/gid when present, the DOS fields otherwise', async () => {
        const mtime = Date.UTC(2021, 5, 1, 12, 0, 0) / 1000;
        const ut = new Uint8Array(5);
        ut[0] = 0x01; // mtime present
        new DataView(ut.buffer).setUint32(1, mtime, true);
        // 0x7875 v1: version 1, uid size 4, uid, gid size 4, gid
        const ux = new Uint8Array([1, 4, 0xe8, 0x03, 0, 0, 4, 0xe9, 0x03, 0, 0]);
        const extra = buildExtraField([{ id: 0x5455, data: ut }, { id: 0x7875, data: ux }]);
        const archive = join(dir, 'ux.zip');
        await writeFile(archive, buildRawZip([
            { name: 'owned.txt', data: enc.encode('x'), extraLocal: extra, extraCentral: extra, versionMadeBy: 0x031e },
            { name: 'plain.txt', data: enc.encode('y') },
        ]));
        const doc = JSON.parse((await run(() => list(parseArgs([archive, '--format', 'json', '--long'])))).text) as ListReport;
        const owned = doc.entries.find((e) => e.name === 'owned.txt');
        expect(owned?.timestamps).toEqual({ mtime: '2021-06-01T12:00:00.000Z', atime: null, ctime: null, source: 'ut' });
        expect(owned?.unixIds).toEqual({ uid: 1000, gid: 1001 });
        const plain = doc.entries.find((e) => e.name === 'plain.txt');
        expect(plain?.timestamps?.source).toBe('dos');
        expect(plain?.unixIds).toBeNull();
        // Not under the short form.
        const short = JSON.parse((await run(() => list(parseArgs([archive, '--format', 'json'])))).text) as ListReport;
        expect(short.entries[0]?.timestamps).toBeUndefined();
    });
});

describe('create --zip64 (AddEntryOptions.zip64 on addStream)', () => {
    it('writes a Zip64 streamed entry that every reader accepts', async () => {
        const src = join(dir, 'big.txt');
        await writeFile(src, 'zip64 streamed entry\n'.repeat(100));
        const out = join(dir, 'z64.zip');
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => create(parseArgs([src, '-o', out, '--stream', '--zip64'])));
        expect(r.error).toBeUndefined();
        expect(envelope(r.err)).toMatchObject({ ok: true, stream: true, zip64: true, layout: 'data-descriptor' });
        const bytes = new Uint8Array(await readFile(out));
        const entry = [...openZip(bytes).entries()][0];
        expect(entry?.usesZip64).toBe(true);
        expect(entry?.usesDataDescriptor).toBe(true);
        delete process.env['ZIPNATIVE_JSON'];
        const v = await run(() => verify(parseArgs([out, '--format', 'json'])));
        expect(v.error).toBeUndefined();
        expect((JSON.parse(v.text) as VerifyReport).ok).toBe(true);
    });

    it('is refused without a streamed input (exit 2): buffered entries are Zip64 already', async () => {
        const src = join(dir, 'a.txt');
        await writeFile(src, 'a');
        const r = await run(() => create(parseArgs([src, '-o', join(dir, 'x.zip'), '--zip64'])));
        expect(r.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });
});

describe('--timeout (signal)', () => {
    it('parses durations and refuses junk / out-of-range values', () => {
        expect(parseDuration('500', 'timeout')).toBe(500);
        expect(parseDuration('500ms', 'timeout')).toBe(500);
        expect(parseDuration('30s', 'timeout')).toBe(30_000);
        expect(parseDuration('5m', 'timeout')).toBe(300_000);
        expect(parseDuration('1h', 'timeout')).toBe(3_600_000);
        for (const bad of ['0', '-1', '1.5s', 'soon', '25d', String(2 ** 31)]) {
            expect(() => parseDuration(bad, 'timeout'), bad).toThrow(CliError);
        }
    });

    it('an expired deadline stops the run with E_LIMIT detail.limit "timeout" and removes the output', async () => {
        const src = join(dir, 'a.txt');
        await writeFile(src, 'timeout me\n'.repeat(1000));
        armTimeout(parseArgs(['--timeout', '1ms']));
        await new Promise((r) => setTimeout(r, 20));
        const out = join(dir, 't.zip');
        const r = await run(() => create(parseArgs([src, '-o', out, '--stream'])));
        expect(r.error).toBeInstanceOf(CliError);
        expect(r.error).toMatchObject({ code: ErrorCode.LIMIT, exitCode: 1, detail: { limit: 'timeout', configured: 1 } });
        await expect(readFile(out)).rejects.toThrow();
    });

    it('a generous deadline changes nothing', async () => {
        const src = join(dir, 'a.txt');
        await writeFile(src, 'fine');
        const r = await run(() => create(parseArgs([src, '-o', join(dir, 'ok.zip'), '--timeout', '1h'])));
        expect(r.error).toBeUndefined();
    });
});

describe('--progress (onProgress)', () => {
    it('prints progress lines on stderr, NDJSON under --json, nothing under --quiet; stdout untouched', async () => {
        const src = join(dir, 'a.txt');
        await writeFile(src, 'p');
        // The engine measures the chunked writer (stream()), not the buffered toBytes().
        const text = await run(() => create(parseArgs([src, '-o', join(dir, 'p1.zip'), '--stream', '--progress'])));
        expect(text.error).toBeUndefined();
        expect(text.err).toMatch(/progress: 1\/1 entries/);
        expect(text.out.length).toBe(0);

        process.env['ZIPNATIVE_JSON'] = '1';
        const json = await run(() => create(parseArgs([src, '-o', join(dir, 'p2.zip'), '--stream', '--progress'])));
        const events = json.err.split('\n').filter((l) => l.includes('"type":"progress"')).map((l) => JSON.parse(l) as Record<string, unknown>);
        expect(events.length).toBeGreaterThan(0);
        expect(events[events.length - 1]).toMatchObject({ type: 'progress', command: 'create', entriesDone: 1, entriesTotal: 1 });
        expect(envelope(json.err)).toMatchObject({ ok: true, command: 'create' });
        delete process.env['ZIPNATIVE_JSON'];

        process.env['ZIPNATIVE_QUIET'] = '1';
        const quiet = await run(() => create(parseArgs([src, '-o', join(dir, 'p3.zip'), '--stream', '--progress'])));
        expect(quiet.err).not.toContain('progress');
    });
});

describe('ZIP_TIMESTAMP_CLAMPED (DOS date clamping, issue #9)', () => {
    it('an out-of-range --date is clamped and reported; --strict refuses it', async () => {
        const src = join(dir, 'a.txt');
        await writeFile(src, 'old');
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => create(parseArgs([src, '-o', join(dir, 'old.zip'), '--date', '1975-07-15'])));
        expect(r.error).toBeUndefined();
        const env = envelope(r.err) as { diagnostics: { code: string }[] };
        expect(env.diagnostics.map((d) => d.code)).toContain('ZIP_TIMESTAMP_CLAMPED');
        const entry = [...openZip(new Uint8Array(await readFile(join(dir, 'old.zip')))).entries()][0];
        expect(entry?.dosDate).toBe(0x0021); // 1980-01-01: the epoch, never a fictitious 1980-07-15
        const strict = await run(() => create(parseArgs([src, '-o', join(dir, 'old2.zip'), '--date', '1975-07-15', '--strict'])));
        expect(strict.error).toMatchObject({ code: ErrorCode.CHECK_FAILED, zipCode: 'ZIP_STRICT_DIAGNOSTIC' });
    });
});

describe('custom codecs in the forward reader (createDecompressor, issue #11)', () => {
    const XOR = 7;
    const plain = enc.encode('decoded by a streaming custom codec');
    let archive = '';

    beforeEach(async () => {
        archive = join(dir, 'm97.zip');
        await writeFile(archive, buildRawZip([{ name: 'x.txt', data: plain.map((b) => b ^ XOR), method: 97, crcOverride: crcOf(plain) }]));
    });

    it('stream --cat decodes a method whose codec exposes createDecompressor', async () => {
        const mod = join(dir, 'xor-inc.mjs');
        await writeFile(mod, `export const codecs = [{ method: 97, name: 'xor97', createDecompressor() { return { push: (c) => [c.map((b) => b ^ ${XOR})], end: () => [] }; } }];\n`);
        const r = await run(() => stream(parseArgs(['--input', archive, '--cat', 'x.txt', '--codec', mod, '--quiet'])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe('decoded by a streaming custom codec');
    });

    it('a codec without createDecompressor is refused before the first byte; --skip-unsupported skips it', async () => {
        const mod = join(dir, 'xor-sync.mjs');
        await writeFile(mod, `export const codecs = [{ method: 97, name: 'xor97s', decompressSync(d) { return d.map((b) => b ^ ${XOR}); } }];\n`);
        const r = await run(() => stream(parseArgs(['--input', archive, '--cat', 'x.txt', '--codec', mod, '--quiet'])));
        expect(r.error).toMatchObject({ code: ErrorCode.UNSUPPORTED, zipCode: 'ZIP_UNSUPPORTED_CODEC_MODE' });
        expect(r.out.length).toBe(0);
        const out = join(dir, 'out');
        const s = await run(() => stream(parseArgs(['--input', archive, '--output-dir', out, '--codec', mod, '--skip-unsupported', '--quiet'])));
        expect(s.error).toBeUndefined();
        await expect(readFile(join(out, 'x.txt'))).rejects.toThrow();
    });
});

describe('verify / modify read the engine\'s skipped classification (issue #12)', () => {
    let archive = '';

    beforeEach(async () => {
        // Method 96: no codec registered anywhere in this file.
        archive = join(dir, 'm96.zip');
        await writeFile(archive, buildRawZip([
            { name: 'ok.txt', data: enc.encode('fine') },
            { name: 'odd.bin', data: enc.encode('opaque'), method: 96 },
        ]));
    });

    it('verify: an unregistered method is skipped "unsupported-method" and FAILS the archive', async () => {
        const r = await run(() => verify(parseArgs([archive, '--format', 'json'])));
        expect(r.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED });
        const doc = JSON.parse(r.text) as VerifyReport;
        expect(doc.ok).toBe(false);
        expect(doc.entries.find((e) => e.name === 'odd.bin')).toMatchObject({ ok: false, skipped: 'unsupported-method', localHeaderMatch: true });
        expect(doc.failed).toBe(1);
        expect(doc.skipped).toBe(0);
        const sel = await run(() => verify(parseArgs([archive, '--entry', 'odd.bin', '--format', 'json'])));
        expect((JSON.parse(sel.text) as VerifyReport).failed).toBe(1);
    });

    it('verify: an encrypted entry with a matching local header passes as a design-time skip', async () => {
        const enc1 = join(dir, 'enc.zip');
        await writeFile(enc1, buildRawZip([{ name: 'secret.bin', data: enc.encode('ciphertext'), flags: 0x0001 }]));
        const r = await run(() => verify(parseArgs([enc1, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as VerifyReport;
        expect(doc).toMatchObject({ ok: true, skipped: 1, failed: 0 });
        expect(doc.entries[0]).toMatchObject({ ok: false, skipped: 'encrypted', localHeaderMatch: true });
    });

    it('modify refuses to re-emit an entry whose method has no codec (E_UNSUPPORTED / ZIP_UNSUPPORTED_METHOD)', async () => {
        const r = await run(() => modify(parseArgs(['--input', archive, '-o', join(dir, 'm.zip'), '--remove', 'ok.txt'])));
        expect(r.error).toMatchObject({ code: ErrorCode.UNSUPPORTED, zipCode: 'ZIP_UNSUPPORTED_METHOD', entryName: 'odd.bin' });
    });

    it('modify refuses an encrypted survivor whose local header contradicts the central directory', async () => {
        const bad = join(dir, 'enc-bad.zip');
        await writeFile(bad, buildRawZip([
            { name: 'keep.txt', data: enc.encode('k') },
            { name: 'secret.bin', data: enc.encode('ciphertext'), flags: 0x0001, lfhCrcOverride: 0xdeadbeef },
        ]));
        const r = await run(() => modify(parseArgs(['--input', bad, '-o', join(dir, 'm2.zip'), '--remove', 'keep.txt'])));
        expect(r.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_CD_LFH_MISMATCH', entryName: 'secret.bin' });
    });
});

describe('inspect --name-encoding reaches analyzeDeterminism', () => {
    it('reports the decoded name in offenders', async () => {
        const sjis = new Uint8Array([0x93, 0xfa, 0x2e, 0x74]);
        const archive = join(dir, 'det.zip');
        await writeFile(archive, buildRawZip([{ name: sjis, data: enc.encode('x') }]));
        const r = await run(() => inspect(parseArgs([archive, '--format', 'json', '--name-encoding', 'shift_jis'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as { determinism: { utf8Flags: boolean; offenders: { name: string; concern: string }[] } };
        expect(doc.determinism.utf8Flags).toBe(false);
        expect(doc.determinism.offenders).toContainEqual({ name: '日.t', concern: 'utf8-flag' });
    });
});

describe('the engine still writes what 1.0 wrote', () => {
    it('a pinned --date stores the UTC wall-clock fields, independent of the host zone', async () => {
        const src = join(dir, 'a.txt');
        await writeFile(src, 'x');
        const out = join(dir, 'd.zip');
        const r = await run(() => create(parseArgs([src, '-o', out, '--date', '2020-06-01T12:34:56Z'])));
        expect(r.error).toBeUndefined();
        const e = [...openZip(new Uint8Array(await readFile(out))).entries()][0];
        // DOS date: (2020-1980)<<9 | 6<<5 | 1 ; time: 12<<11 | 34<<5 | 56>>1
        expect(e?.dosDate).toBe(((2020 - 1980) << 9) | (6 << 5) | 1);
        expect(e?.dosTime).toBe((12 << 11) | (34 << 5) | 28);
        // The buffered writer agrees with the engine fed the same instant in 'utc' mode.
        const w = createZip({ defaultDate: new Date(Date.UTC(2020, 5, 1, 12, 34, 56)), dosTimeMode: 'utc' });
        w.add('a.txt', 'x');
        const ref = [...openZip(await w.toBytes()).entries()][0];
        expect(e?.dosDate).toBe(ref?.dosDate);
        expect(e?.dosTime).toBe(ref?.dosTime);
    });
});
