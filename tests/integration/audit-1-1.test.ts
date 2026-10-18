// Regression tests for the 1.1.0 release audit (/release-audit, round 3; the
// ledger is local under .audit/1.1.0/, summarised in the release PR draft):
//   D-03f  verify reports a bound as E_LIMIT on the buffered paths too, and a
//          limit refusal at open keeps its class and detail (V-03);
//   D-19b  verify --strict names ZIP_STRICT_DIAGNOSTIC;
//   D-31   a missing file is E_IO on every path (govern verify-issue, a raw
//          manifest path);
//   D-20c  CRC details are numbers on every path;
//   D-25   list --format ndjson warns when a projection flag is ignored;
//   D-32/D-33  the refusals whose message names the lifting flag carry it as
//          remedy;
//   D-17b  batch --task verify rows carry entryName, detail and remedy.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { batch } from '../../src/commands/batch.js';
import { canonicalize } from '../../src/commands/canonicalize.js';
import { create } from '../../src/commands/create.js';
import { govern } from '../../src/commands/govern.js';
import { list } from '../../src/commands/list.js';
import { modify } from '../../src/commands/modify.js';
import { stream } from '../../src/commands/stream.js';
import { verify } from '../../src/commands/verify.js';
import { createZip } from '../../src/core-bridge/index.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { buildRawZip } from '../helpers/raw-zip-builder.js';

const enc = new TextEncoder();
let dir = '';
let out = '';
let err = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-audit11-'));
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

async function refusal(fn: () => Promise<void>): Promise<CliError> {
    try { await fn(); } catch (e) { if (e instanceof CliError) return e; throw e; }
    throw new Error('expected a CliError');
}

async function zipOf(name: string, files: Record<string, string>): Promise<string> {
    const w = createZip({ defaultDate: new Date(2021, 4, 6, 7, 8, 10) });
    for (const [n, d] of Object.entries(files)) w.add(n, d);
    const p = join(dir, name);
    await writeFile(p, w.toBytes());
    return p;
}

describe('verify: a bound is never a verdict (D-03f, V-03, D-19b)', () => {
    it('buffered verify reports an entry over --max-entry-size as E_LIMIT with the bound', async () => {
        const z = await zipOf('big.zip', { 'a.txt': 'alpha'.repeat(100), 'b.txt': 'beta' });
        const e = await refusal(() => verify(parseArgs([z, '--max-entry-size', '100'])));
        expect(e).toMatchObject({
            code: ErrorCode.LIMIT,
            zipCode: 'ZIP_LIMIT_EXCEEDED',
            entryName: 'a.txt',
            detail: { limit: 'maxEntryUncompressedSize', configured: 100, observed: 500 },
        });
        expect(e.remedy).toContain('--max-entry-size');
        // --entry takes the same path.
        const s = await refusal(() => verify(parseArgs([z, '--entry', 'a.txt', '--max-entry-size', '100'])));
        expect(s).toMatchObject({ code: ErrorCode.LIMIT, entryName: 'a.txt' });
        // Within the bound the archive is intact.
        await verify(parseArgs([z, '--max-entry-size', '1k', '--summary']));
        expect(JSON.parse(out)).toMatchObject({ ok: true, failed: 0 });
    });

    it('a limit refusal at open keeps E_LIMIT and its detail, buffered and --range', async () => {
        const z = await zipOf('two.zip', { 'a.txt': 'a', 'b.txt': 'b' });
        for (const extra of [[], ['--range']]) {
            const e = await refusal(() => verify(parseArgs([z, '--max-entries', '1', ...extra])));
            expect(e, extra.join(' ')).toMatchObject({ code: ErrorCode.LIMIT, zipCode: 'ZIP_LIMIT_EXCEEDED', detail: { limit: 'maxEntries' } });
        }
    });

    it('a lying entry is still E_VERIFY_FAILED, and --strict names ZIP_STRICT_DIAGNOSTIC', async () => {
        const lie = join(dir, 'lie.zip');
        await writeFile(lie, buildRawZip([{ name: 'bad.txt', data: enc.encode('bad'), crcOverride: 1 }]));
        expect((await refusal(() => verify(parseArgs([lie]))))).toMatchObject({ code: ErrorCode.VERIFY_FAILED, entryName: 'bad.txt' });
        // A diagnostic-only archive (prepended data) is ok, and fails under --strict with its cause.
        const w = createZip();
        w.add('a.txt', 'a');
        const dirty = join(dir, 'dirty.zip');
        await writeFile(dirty, Buffer.concat([Buffer.from('prepended'), Buffer.from(w.toBytes())]));
        out = '';
        await verify(parseArgs([dirty, '--summary']));
        expect(JSON.parse(out)).toMatchObject({ ok: true });
        const e = await refusal(() => verify(parseArgs([dirty, '--strict'])));
        expect(e).toMatchObject({ code: ErrorCode.VERIFY_FAILED, zipCode: 'ZIP_STRICT_DIAGNOSTIC' });
    });
});

describe('a missing file is E_IO on every path (D-31)', () => {
    it('govern verify-issue and a raw manifest path', async () => {
        const g = await refusal(() => govern(parseArgs(['verify-issue', join(dir, 'missing.md')])));
        expect(g.code).toBe(ErrorCode.IO);
        expect(g.message).toContain('missing.md');
        await writeFile(join(dir, 'm.json'), JSON.stringify({ entries: [{ name: 'r.txt', path: 'absent.bin', raw: { method: 0, crc32: 0, uncompressedSize: 0 } }] }));
        const c = await refusal(() => create(parseArgs(['--from-manifest', join(dir, 'm.json'), '-o', join(dir, 'r.zip')])));
        expect(c.code).toBe(ErrorCode.IO);
    });
});

describe('agent envelope consistency (D-20c, D-25, D-32, D-33)', () => {
    it('a raw manifest CRC lie reports numeric CRCs like cat and crc32', async () => {
        const data = Buffer.from('hello raw '.repeat(30));
        await writeFile(join(dir, 'p.bin'), deflateRawSync(data));
        const wrong = (zlibCrc32(data) ^ 1) >>> 0;
        await writeFile(join(dir, 'bad.json'), JSON.stringify({ entries: [{ name: 'r.txt', path: 'p.bin', raw: { method: 8, crc32: wrong, uncompressedSize: data.length } }] }));
        const e = await refusal(() => create(parseArgs(['--from-manifest', join(dir, 'bad.json'), '-o', join(dir, 'bad.zip')])));
        expect(e.zipCode).toBe('ZIP_CRC_MISMATCH');
        expect(e.detail).toEqual({ expectedCrc: wrong, actualCrc: zlibCrc32(data) });
    });

    it('list --format ndjson warns when --fields or --summary is ignored', async () => {
        const z = await zipOf('n.zip', { 'a.txt': 'a' });
        await list(parseArgs([z, '--format', 'ndjson', '--fields', 'name']));
        expect(out.trim().split('\n')).toHaveLength(1);
        expect(JSON.parse(out)).toHaveProperty('compressedSize');
        expect(err).toContain('--fields shape the JSON report only');
    });

    it('the refusals whose message names the lifting flag carry it as remedy', async () => {
        const z = await zipOf('r.zip', { 'a.txt': 'a' });
        const src = join(dir, 'f.txt');
        await writeFile(src, 'f');
        const cases: readonly [string, () => Promise<void>, string][] = [
            ['canonicalize --date now', () => canonicalize(parseArgs([z, '-o', join(dir, 'c.zip'), '--date', 'now'])), '--date epoch'],
            ['create --zip64 alone', () => create(parseArgs([src, '-o', join(dir, 'z.zip'), '--zip64'])), '--stream'],
            ['modify --canonical alone', () => modify(parseArgs([z, '--canonical', '-o', join(dir, 'm.zip')])), '--compact --canonical'],
            ['verify --name-encoding alone', () => verify(parseArgs([z, '--name-encoding', 'cp437'])), '--entry <decoded name>'],
            ['--timeout malformed', () => list(parseArgs([z, '--timeout', 'soon'])), '--timeout <n>'],
            ['--range on stdin', () => list(parseArgs(['-', '--range'])), 'omit --range'],
        ];
        for (const [label, fn, remedy] of cases) {
            const e = await refusal(fn);
            expect(e.exitCode, label).toBe(2);
            expect(e.remedy, label).toContain(remedy);
        }
        // stream --cat on a name that never arrives: the remedy says stream --list, as the message does.
        const file = await zipOf('s.zip', { 'a.txt': 'a' });
        const e = await refusal(() => stream(parseArgs(['--cat', 'nope.txt', '--input', file])));
        expect(e).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
        expect(e.remedy).toContain('stream --list');
    });
});

describe('batch --task verify rows (D-17b)', () => {
    it('name the failing entry and carry detail and remedy', async () => {
        const archives = join(dir, 'archives');
        await mkdir(archives);
        await writeFile(join(archives, 'lie.zip'), buildRawZip([{ name: 'ok.txt', data: enc.encode('ok') }, { name: 'bad.txt', data: enc.encode('bad'), crcOverride: 1 }]));
        const big = createZip();
        big.add('a.txt', 'alpha'.repeat(100));
        await writeFile(join(archives, 'big.zip'), big.toBytes());
        await refusal(() => batch(parseArgs(['--input-dir', archives, '--task', 'verify', '--format', 'json', '--max-entry-size', '100'])));
        const report = JSON.parse(out) as { results: { input: string; entryName?: string; detail?: Record<string, unknown>; remedy?: string; zipCode?: string; code?: string }[] };
        const lieRow = report.results.find((r) => r.input.endsWith('lie.zip'));
        const bigRow = report.results.find((r) => r.input.endsWith('big.zip'));
        expect(lieRow).toMatchObject({ code: ErrorCode.VERIFY_FAILED, entryName: 'bad.txt', detail: { failedEntries: 'bad.txt', failedCount: 1 } });
        expect(bigRow).toMatchObject({ code: ErrorCode.LIMIT, zipCode: 'ZIP_LIMIT_EXCEEDED', entryName: 'a.txt', detail: { limit: 'maxEntryUncompressedSize' } });
        expect(bigRow?.remedy).toContain('--max-entry-size');
    });
});
