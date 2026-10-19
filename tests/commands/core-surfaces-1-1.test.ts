// The zipnative 1.1 capabilities exposed by the second 1.1.0 review (M-17):
//   canonicalize / modify --compact --canonical  (canonicalizeZip, CompactOptions)
//   merge                                         (addFromReader, RawEntryReader)
//   --range on list / cat / verify               (openZipRange, ByteRangeSource) + --max-entry-compressed-size
//   create --from-manifest `raw` entries          (addRaw, RawEntryMeta)
// Each one keeps the CLI's verification rule: nothing unverified is written.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { canonicalize } from '../../src/commands/canonicalize.js';
import { cat } from '../../src/commands/cat.js';
import { create } from '../../src/commands/create.js';
import { list } from '../../src/commands/list.js';
import { merge } from '../../src/commands/merge.js';
import { modify } from '../../src/commands/modify.js';
import { verify } from '../../src/commands/verify.js';
import { inspect } from '../../src/commands/inspect.js';
import { analyzeDeterminism, createZip, openZipRange, rangeSourceFromBytes } from '../../src/core-bridge/index.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { buildRawZip } from '../helpers/raw-zip-builder.js';

const enc = new TextEncoder();
let dir = '';
let out = '';
let err = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-core11-'));
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
    delete process.env['ZIPNATIVE_JSON'];
    await rm(dir, { recursive: true, force: true });
});

const envelope = (): Record<string, unknown> => JSON.parse(err.trim().split('\n').filter((l) => l.startsWith('{')).pop() as string) as Record<string, unknown>;

async function refusal(fn: () => Promise<void>): Promise<CliError> {
    try { await fn(); } catch (e) { if (e instanceof CliError) return e; throw e; }
    throw new Error('expected a CliError');
}

async function zipOf(name: string, files: Record<string, string>, comment?: string): Promise<string> {
    const w = createZip({ defaultDate: new Date(2021, 4, 6, 7, 8, 10), ...(comment !== undefined ? { comment } : {}) });
    for (const [n, d] of Object.entries(files)) w.add(n, d);
    const path = join(dir, name);
    await writeFile(path, w.toBytes());
    return path;
}

describe('canonicalize', () => {
    it('rewrites a non-canonical archive into the canonical form, idempotently', async () => {
        const src = await zipOf('src.zip', { 'b.txt': 'b', 'a.txt': 'a' }, 'note');
        expect(analyzeDeterminism(new Uint8Array(await readFile(src))).deterministic).toBe(false);
        await canonicalize(parseArgs([src, '-o', join(dir, 'c1.zip')]));
        expect(envelope()).toMatchObject({ ok: true, command: 'canonicalize', entries: 2, changed: true, deterministic: true, canonicalForm: true });
        const c1 = new Uint8Array(await readFile(join(dir, 'c1.zip')));
        expect(analyzeDeterminism(c1).deterministic).toBe(true);
        err = '';
        await canonicalize(parseArgs([join(dir, 'c1.zip'), '-o', join(dir, 'c2.zip')]));
        expect(envelope()).toMatchObject({ changed: false });
        expect(Buffer.compare(Buffer.from(c1), await readFile(join(dir, 'c2.zip')))).toBe(0);
    });

    it('refuses --date now and a missing -o; --dry-run writes nothing', async () => {
        const src = await zipOf('src.zip', { 'a.txt': 'a' });
        expect((await refusal(() => canonicalize(parseArgs([src, '-o', join(dir, 'x.zip'), '--date', 'now'])))).exitCode).toBe(2);
        expect((await refusal(() => canonicalize(parseArgs([src])))).exitCode).toBe(2);
        await canonicalize(parseArgs([src, '-o', join(dir, 'dry.zip'), '--dry-run']));
        expect(envelope()).toMatchObject({ dryRun: true });
        expect(existsSync(join(dir, 'dry.zip'))).toBe(false);
    });

    it('modify --compact --canonical writes the canonical form; --canonical alone is refused', async () => {
        const src = await zipOf('src.zip', { 'b.txt': 'b', 'a.txt': 'a' });
        await modify(parseArgs([src, '-o', join(dir, 'm.zip'), '--remove', 'b.txt', '--compact', '--canonical']));
        expect(envelope()).toMatchObject({ canonical: true, layout: 'compact' });
        expect(analyzeDeterminism(new Uint8Array(await readFile(join(dir, 'm.zip')))).deterministic).toBe(true);
        expect((await refusal(() => modify(parseArgs([src, '-o', join(dir, 'n.zip'), '--canonical'])))).exitCode).toBe(2);
    });
});

describe('merge', () => {
    it('merges, refuses a duplicate name, honours --on-duplicate and splits by filter', async () => {
        const a = await zipOf('a.zip', { 'docs/a.txt': 'A', 'same.txt': 'one' });
        const b = await zipOf('b.zip', { 'docs/b.txt': 'B', 'same.txt': 'two' });
        const dup = await refusal(() => merge(parseArgs([a, b, '-o', join(dir, 'm.zip')])));
        expect(dup).toMatchObject({ code: ErrorCode.INPUT, entryName: 'same.txt' });
        expect(existsSync(join(dir, 'm.zip'))).toBe(false);

        await merge(parseArgs([a, b, '-o', join(dir, 'm.zip'), '--on-duplicate', 'last']));
        expect(envelope()).toMatchObject({ ok: true, inputs: 2, entries: 3 });
        out = '';
        await cat(parseArgs([join(dir, 'm.zip'), 'same.txt', '--quiet']));
        expect(out).toBe('two');

        err = '';
        await merge(parseArgs([join(dir, 'm.zip'), '--include', 'docs/**', '-o', join(dir, 'docs.zip')]));
        expect(envelope()).toMatchObject({ entries: 2 });
    });

    it('never launders: a CRC lie is refused (E_DATA), an unregistered method refused or skipped', async () => {
        const lie = join(dir, 'lie.zip');
        await writeFile(lie, buildRawZip([{ name: 'x.txt', data: enc.encode('payload'), crcOverride: 0x12345678 }]));
        const e = await refusal(() => merge(parseArgs([lie, '-o', join(dir, 'o.zip')])));
        expect(e.code).toBe(ErrorCode.DATA);
        expect(existsSync(join(dir, 'o.zip'))).toBe(false);

        const odd = join(dir, 'odd.zip');
        await writeFile(odd, buildRawZip([{ name: 'ok.txt', data: enc.encode('ok') }, { name: 'odd.bin', data: enc.encode('opaque'), method: 96 }]));
        expect(await refusal(() => merge(parseArgs([odd, '-o', join(dir, 'o2.zip')])))).toMatchObject({ code: ErrorCode.UNSUPPORTED, zipCode: 'ZIP_UNSUPPORTED_METHOD' });
        await merge(parseArgs([odd, '-o', join(dir, 'o3.zip'), '--skip-unsupported']));
        expect(envelope()).toMatchObject({ entries: 1 });
    });
});

describe('--range (list, cat, verify) and --max-entry-compressed-size', () => {
    it('reads an archive larger than --max-input-size without loading it', async () => {
        const z = await zipOf('big.zip', { 'a.txt': 'alpha'.repeat(100), 'b.txt': 'beta' });
        expect((await refusal(() => list(parseArgs([z, '--max-input-size', '64'])))).code).toBe(ErrorCode.LIMIT);
        await list(parseArgs([z, '--range', '--max-input-size', '64', '--summary']));
        expect(JSON.parse(out)).toMatchObject({ entries: 2 });
        out = '';
        await cat(parseArgs([z, 'b.txt', '--range', '--max-input-size', '64', '--quiet']));
        expect(out).toBe('beta');
        out = '';
        await verify(parseArgs([z, '--range', '--max-input-size', '64', '--summary']));
        expect(JSON.parse(out)).toMatchObject({ ok: true, entries: 2, failed: 0 });
    });

    it('bounds a whole-entry fetch with --max-entry-compressed-size and refuses stdin', async () => {
        const z = await zipOf('z.zip', { 'a.txt': 'alpha'.repeat(100) });
        const e = await refusal(() => cat(parseArgs([z, 'a.txt', '--range', '--raw', '--max-entry-compressed-size', '4', '--quiet'])));
        expect(e).toMatchObject({ code: ErrorCode.LIMIT, detail: { limit: 'maxEntryCompressedSize' } });
        expect((await refusal(() => list(parseArgs(['-', '--range'])))).exitCode).toBe(2);
    });

    it('verify --range reports an entry over --max-entry-compressed-size as E_LIMIT, never as corruption (audit A-70)', async () => {
        const z = await zipOf('bound.zip', { 'a.txt': 'alpha'.repeat(100), 'b.txt': 'beta' });
        // The engine's range verifyEntry() swallows the bound refusal into
        // ok: false / crcMatch: false — the CLI applies the bound first.
        const e = await refusal(() => verify(parseArgs([z, '--range', '--max-entry-compressed-size', '4', '--json'])));
        expect(e).toMatchObject({
            code: ErrorCode.LIMIT,
            zipCode: 'ZIP_LIMIT_EXCEEDED',
            entryName: 'a.txt',
            detail: { limit: 'maxEntryCompressedSize', configured: 4 },
        });
        expect(e.remedy).toContain('--max-entry-compressed-size');
        expect(out).toBe('');
        // The same archive under a bound it fits is intact.
        await verify(parseArgs([z, '--range', '--max-entry-compressed-size', '1m', '--summary']));
        expect(JSON.parse(out)).toMatchObject({ ok: true, failed: 0 });
    });

    it('the in-memory byte source lists the same entries as the file source (rangeSourceFromBytes parity)', async () => {
        const z = await zipOf('parity.zip', { 'a.txt': 'alpha', 'sub/b.txt': 'beta' });
        await list(parseArgs([z, '--range', '--json', '--fields', 'entries.name']));
        const viaFile = JSON.parse(out) as { entries: { name: string }[] };
        const reader = await openZipRange(rangeSourceFromBytes(await readFile(z)));
        const viaBytes = [...reader.entries()].map((e) => e.name);
        expect(viaFile.entries.map((e) => e.name)).toEqual(viaBytes);
    });

    it('verify --range fails a lying entry like verify does', async () => {
        const lie = join(dir, 'lie.zip');
        await writeFile(lie, buildRawZip([{ name: 'ok.txt', data: enc.encode('ok') }, { name: 'bad.txt', data: enc.encode('bad'), crcOverride: 1 }]));
        const e = await refusal(() => verify(parseArgs([lie, '--range'])));
        expect(e).toMatchObject({ code: ErrorCode.VERIFY_FAILED, entryName: 'bad.txt' });
    });
});

describe('--summary zip64 facts (audit B-53)', () => {
    it('a streamed --zip64 archive reports zip64Entries without a Zip64 EOCD', async () => {
        const src = join(dir, 'z64.txt');
        await writeFile(src, 'zip64 payload');
        const z = join(dir, 'z64.zip');
        await create(parseArgs([src, '--stream', '--zip64', '-o', z, '--quiet']));
        await list(parseArgs([z, '--summary']));
        expect(JSON.parse(out)).toMatchObject({ zip64: false, zip64Entries: 1 });
        out = '';
        await inspect(parseArgs([z, '--format', 'json', '--summary', '--check', 'zip64']));
        expect(JSON.parse(out)).toMatchObject({ zip64: false, zip64Entries: 1, checksPassed: true });
    });
});

describe('create --from-manifest raw entries (addRaw)', () => {
    it('copies a verified pre-compressed payload; a lying CRC or size is refused and nothing is written', async () => {
        const data = Buffer.from('hello raw '.repeat(30));
        await writeFile(join(dir, 'p.bin'), deflateRawSync(data));
        const crc = zlibCrc32(data).toString(16).padStart(8, '0');
        await writeFile(join(dir, 'm.json'), JSON.stringify({ entries: [{ name: 'r.txt', path: 'p.bin', raw: { method: 8, crc32: crc, uncompressedSize: data.length } }] }));
        await create(parseArgs(['--from-manifest', join(dir, 'm.json'), '-o', join(dir, 'r.zip')]));
        out = '';
        await cat(parseArgs([join(dir, 'r.zip'), 'r.txt', '--quiet']));
        expect(out).toBe(data.toString('latin1'));

        for (const [raw, zipCode] of [
            [{ method: 8, crc32: 'deadbeef', uncompressedSize: data.length }, 'ZIP_CRC_MISMATCH'],
            [{ method: 8, crc32: crc, uncompressedSize: data.length - 1 }, 'ZIP_SIZE_MISMATCH'],
            [{ method: 96, crc32: crc, uncompressedSize: data.length }, 'ZIP_UNSUPPORTED_METHOD'],
        ] as const) {
            await writeFile(join(dir, 'bad.json'), JSON.stringify({ entries: [{ name: 'r.txt', path: 'p.bin', raw }] }));
            const e = await refusal(() => create(parseArgs(['--from-manifest', join(dir, 'bad.json'), '-o', join(dir, 'bad.zip')])));
            expect(e.zipCode, zipCode).toBe(zipCode);
            expect(existsSync(join(dir, 'bad.zip'))).toBe(false);
        }
        await writeFile(join(dir, 'mix.json'), JSON.stringify({ entries: [{ name: 'r.txt', path: 'p.bin', method: 'store', raw: { method: 8, crc32: crc, uncompressedSize: data.length } }] }));
        expect((await refusal(() => create(parseArgs(['--from-manifest', join(dir, 'mix.json'), '-o', join(dir, 'mix.zip')])))).code).toBe(ErrorCode.INPUT);
    });
});
