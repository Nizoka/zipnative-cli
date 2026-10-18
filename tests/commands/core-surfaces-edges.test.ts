// Edge cases of the second-review surfaces (canonicalize, merge, --range, raw
// manifest entries): every refusal path is a CliError with the documented
// class, and nothing is written when a run is refused.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { canonicalize } from '../../src/commands/canonicalize.js';
import { merge } from '../../src/commands/merge.js';
import { verify } from '../../src/commands/verify.js';
import { createZip } from '../../src/core-bridge/index.js';
import { normalizeEnvSwitches } from '../../src/utils/agent.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { fileRangeSource } from '../../src/utils/io.js';
import { parseRawMeta, verifyRawPayload } from '../../src/utils/rawentry.js';
import { buildRawZip } from '../helpers/raw-zip-builder.js';

const enc = new TextEncoder();
const originalStdin = process.stdin;
let dir = '';
let out = '';
let err = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-edges-'));
    out = '';
    err = '';
    process.env['ZIPNATIVE_JSON'] = '1';
    vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown, ...rest: unknown[]) => {
        out += typeof c === 'string' ? c : Buffer.from(c as Uint8Array).toString('latin1');
        (rest.find((r) => typeof r === 'function') as (() => void) | undefined)?.();
        return true;
    }) as unknown as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { err += String(c); return true; }) as unknown as typeof process.stderr.write);
});

afterEach(async () => {
    vi.restoreAllMocks();
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    delete process.env['ZIPNATIVE_JSON'];
    await rm(dir, { recursive: true, force: true });
});

const envelope = (): Record<string, unknown> => JSON.parse(err.trim().split('\n').filter((l) => l.startsWith('{')).pop() as string) as Record<string, unknown>;

async function refusal(fn: () => unknown): Promise<CliError> {
    try { await fn(); } catch (e) { if (e instanceof CliError) return e; throw e; }
    throw new Error('expected a CliError');
}

async function zipOf(name: string, files: Record<string, string>, dirs: readonly string[] = []): Promise<string> {
    const w = createZip();
    for (const d of dirs) w.addDirectory(d);
    for (const [n, d] of Object.entries(files)) w.add(n, d);
    const path = join(dir, name);
    await writeFile(path, w.toBytes());
    return path;
}

describe('parseRawMeta / verifyRawPayload', () => {
    it('accepts hex and integer CRCs, refuses every malformed shape with E_INPUT', async () => {
        expect(parseRawMeta({ method: 0, crc32: 'ABCDEF01', uncompressedSize: 1 }, 'e')).toEqual({ method: 0, crc32: 0xabcdef01, uncompressedSize: 1 });
        expect(parseRawMeta({ method: 8, crc32: 7, uncompressedSize: 0 }, 'e').crc32).toBe(7);
        for (const bad of [null, [], 'x', { method: 0, crc32: '00', uncompressedSize: 1 }, { method: -1, crc32: 0, uncompressedSize: 1 },
            { method: 0, crc32: 0, uncompressedSize: -1 }, { method: 0, crc32: 0, uncompressedSize: 1, extra: 1 }, { method: 0, crc32: 2 ** 33, uncompressedSize: 1 }]) {
            expect((await refusal(() => { parseRawMeta(bad, 'e'); })).code, JSON.stringify(bad)).toBe(ErrorCode.INPUT);
        }
    });

    it('refuses a declared size above the entry bound (E_LIMIT) and a payload that does not decode (E_DATA)', async () => {
        expect((await refusal(() => { verifyRawPayload('r', new Uint8Array(1), { method: 0, crc32: 0, uncompressedSize: 10 }, 5); })).code).toBe(ErrorCode.LIMIT);
        expect((await refusal(() => { verifyRawPayload('r', Uint8Array.from([0xff, 0xff, 0xff]), { method: 8, crc32: 0, uncompressedSize: 3 }); })).code).toBe(ErrorCode.DATA);
    });
});

describe('merge edge cases', () => {
    it('refuses no input, no -o, stdin twice, a bad --order; --on-duplicate first keeps the first', async () => {
        const a = await zipOf('a.zip', { 'x.txt': 'first' }, ['d/']);
        const b = await zipOf('b.zip', { 'x.txt': 'second' }, ['d/']);
        expect((await refusal(() => merge(parseArgs(['-o', join(dir, 'o.zip')])))).exitCode).toBe(2);
        expect((await refusal(() => merge(parseArgs([a])))).exitCode).toBe(2);
        expect((await refusal(() => merge(parseArgs(['-', '-', '-o', join(dir, 'o.zip')])))).exitCode).toBe(2);
        expect((await refusal(() => merge(parseArgs([a, '-o', join(dir, 'o.zip'), '--order', 'random'])))).exitCode).toBe(2);
        expect((await refusal(() => merge(parseArgs(['-', '-o', join(dir, 'o.zip'), '--comment-file', '-'])))).exitCode).toBe(2);
        await merge(parseArgs([a, b, '-o', join(dir, 'f.zip'), '--on-duplicate', 'first', '--order', 'insertion', '--comment', 'merged']));
        expect(envelope()).toMatchObject({ entries: 2, directories: 1, order: 'insertion', skipped: [{ name: 'x.txt', reason: 'duplicate' }] });
    });

    it('refuses an encrypted entry (E_UNSUPPORTED) or skips it; --dry-run writes nothing; -o - streams to stdout', async () => {
        const enc1 = join(dir, 'enc.zip');
        await writeFile(enc1, buildRawZip([{ name: 'ok.txt', data: enc.encode('ok') }, { name: 's.bin', data: enc.encode('secret'), flags: 0x1 }]));
        expect(await refusal(() => merge(parseArgs([enc1, '-o', join(dir, 'o.zip')])))).toMatchObject({ code: ErrorCode.UNSUPPORTED, zipCode: 'ZIP_UNSUPPORTED_ENCRYPTION' });
        await merge(parseArgs([enc1, '-o', join(dir, 'o.zip'), '--skip-unsupported', '--dry-run']));
        expect(envelope()).toMatchObject({ dryRun: true, entries: 1 });
        expect(existsSync(join(dir, 'o.zip'))).toBe(false);
        await merge(parseArgs([enc1, '-o', '-', '--skip-unsupported']));
        expect(out.startsWith('PK')).toBe(true);
    });

    it('reads one source from stdin', async () => {
        const w = createZip();
        w.add('s.txt', 'from stdin');
        Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from(w.toBytes())]), configurable: true });
        await merge(parseArgs(['-', '-o', join(dir, 's.zip')]));
        expect(envelope()).toMatchObject({ inputs: 1, entries: 1 });
    });
});

describe('fileRangeSource', () => {
    it('refuses stdin and a directory (E_USAGE), a missing file (E_IO), and a read outside the file', async () => {
        expect((await refusal(() => fileRangeSource(undefined))).exitCode).toBe(2);
        expect((await refusal(() => fileRangeSource(dir))).exitCode).toBe(2);
        expect((await refusal(() => fileRangeSource(join(dir, 'missing.zip')))).code).toBe(ErrorCode.IO);
        await writeFile(join(dir, 'f.bin'), Buffer.from('0123456789'));
        const f = await fileRangeSource(join(dir, 'f.bin'));
        try {
            expect(f.source.size).toBe(10);
            expect(Buffer.from(await f.source.read(2, 3)).toString()).toBe('234');
            expect((await refusal(() => f.source.read(8, 5))).code).toBe(ErrorCode.IO);
            expect((await refusal(() => f.source.read(-1, 1))).code).toBe(ErrorCode.IO);
        } finally {
            await f.close();
        }
    });
});

describe('verify --range edge cases', () => {
    it('a non-archive is a report error (E_VERIFY_FAILED with zipCode); --entry selects; a missing --entry is E_NOT_FOUND', async () => {
        await writeFile(join(dir, 'not.zip'), 'not a zip at all, definitely not');
        expect(await refusal(() => verify(parseArgs([join(dir, 'not.zip'), '--range'])))).toMatchObject({ code: ErrorCode.VERIFY_FAILED, zipCode: 'ZIP_EOCD_NOT_FOUND' });
        const z = await zipOf('z.zip', { 'a.txt': 'a', 'b.txt': 'b' });
        out = '';
        await verify(parseArgs([z, '--range', '--entry', 'b.txt']));
        expect(JSON.parse(out)).toMatchObject({ ok: true, selected: ['b.txt'] });
        expect((await refusal(() => verify(parseArgs([z, '--range', '--entry', 'nope'])))).code).toBe(ErrorCode.NOT_FOUND);
    });
});

describe('canonicalize edge cases', () => {
    it('honours an ISO --date and --keep-comments / --normalize-modes; refuses an existing -o without --overwrite', async () => {
        const src = await zipOf('src.zip', { 'a.txt': 'a' });
        await canonicalize(parseArgs([src, '-o', join(dir, 'c.zip'), '--date', '2020-06-01T12:00:00Z', '--keep-comments', '--normalize-modes']));
        expect(envelope()).toMatchObject({ canonicalForm: true });
        expect((await refusal(() => canonicalize(parseArgs([src, '-o', join(dir, 'c.zip')])))).code).toBe(ErrorCode.IO);
        await mkdir(join(dir, 'sub'));
        await canonicalize(parseArgs([src, '-o', join(dir, 'c.zip'), '--overwrite']));
        expect(envelope()).toMatchObject({ ok: true });
    });
});

describe('counter-verification findings', () => {
    it('a raw DEFLATE payload with trailing bytes, or a stored one of the wrong length, is refused', async () => {
        const { deflateRawSync, crc32 } = await import('node:zlib');
        const data = Buffer.from('hidden-free payload');
        const meta = { method: 8, crc32: crc32(data), uncompressedSize: data.length };
        const clean = deflateRawSync(data);
        expect(() => { verifyRawPayload('r', clean, meta); }).not.toThrow();
        const trailing = Buffer.concat([clean, Buffer.from('SECRET')]);
        expect(await refusal(() => { verifyRawPayload('r', trailing, meta); })).toMatchObject({ code: ErrorCode.DATA, zipCode: 'ZIP_SIZE_MISMATCH' });
        expect(await refusal(() => { verifyRawPayload('s', Buffer.concat([data, Buffer.from('X')]), { method: 0, crc32: crc32(data), uncompressedSize: data.length }); })).toMatchObject({ zipCode: 'ZIP_SIZE_MISMATCH' });
    });

    it('canonicalize counts hostile names it carries over, and warns', async () => {
        const slip = join(dir, 'slip.zip');
        await writeFile(slip, buildRawZip([{ name: 'ok.txt', data: enc.encode('ok') }, { name: '../evil.txt', data: enc.encode('x') }]));
        await canonicalize(parseArgs([slip, '-o', join(dir, 'c.zip')]));
        expect(envelope()).toMatchObject({ unsafeNames: 1, encrypted: 0 });
        delete process.env['ZIPNATIVE_JSON'];
        err = '';
        await canonicalize(parseArgs([slip, '-o', join(dir, 'c2.zip')]));
        expect(err).toMatch(/warning: 1 entry name\(s\) would not extract safely/);
    });

    it('merge names an internal duplicate as such', async () => {
        const dup = join(dir, 'dup.zip');
        await writeFile(dup, buildRawZip([{ name: 'a.txt', data: enc.encode('1') }, { name: 'a.txt', data: enc.encode('2') }]));
        const e = await refusal(() => merge(parseArgs([dup, '-o', join(dir, 'o.zip')])));
        expect(e.message).toMatch(/appears twice in/);
    });
});

describe('normalizeEnvSwitches', () => {
    it('maps the eight spellings, unsets the off forms and refuses anything else', async () => {
        const env: NodeJS.ProcessEnv = { ZIPNATIVE_DRY_RUN: 'true', ZIPNATIVE_QUIET: 'off', ZIPNATIVE_JSON: ' YES ', ZIPNATIVE_STRICT: '' };
        normalizeEnvSwitches(env);
        expect(env).toEqual({ ZIPNATIVE_DRY_RUN: '1', ZIPNATIVE_JSON: '1' });
        const bad = await refusal(() => { normalizeEnvSwitches({ ZIPNATIVE_DRY_RUN: 'maybe' }); });
        expect(bad.exitCode).toBe(2);
        expect(bad.message).not.toContain('maybe');
    });
});
