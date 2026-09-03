// Refusal posture over hand-crafted hostile archives. Every shape is built
// byte by byte (the writer refuses to produce them), then driven through the
// real commands. The contract under test: "conformant is not safe" —
// `list` / `verify` may open what `extract` / `cat` must refuse, and every
// refusal names the exact frozen zipnative code.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extract } from '../../src/commands/extract.js';
import { list } from '../../src/commands/list.js';
import { inspect } from '../../src/commands/inspect.js';
import { cat } from '../../src/commands/cat.js';
import { verify } from '../../src/commands/verify.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';

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

// ── Raw LFH / CD / EOCD builder ───────────────────────────────────────
// CRC-32 via a small table (node:zlib.crc32 is not guaranteed on Node 22.0).

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
}
function crc32(data: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of data) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

interface RawEntry {
    /** Central-directory name (authoritative). */
    readonly name: string;
    /** Local-header name when it should differ from the CD (parser differential). */
    readonly lfhName?: string;
    /** Stored payload (method 0). */
    readonly data: Uint8Array;
    /** Override the CD's local-header offset (overlap shapes). */
    readonly localHeaderOffset?: number;
    /** Override the CD's declared uncompressed size (bomb shapes). */
    readonly uncompressedSize?: number;
}

interface RawOptions {
    /** Override the EOCD entry counts (declared vs actual mismatch). */
    readonly count?: number;
}

function rawZip(entries: readonly RawEntry[], options: RawOptions = {}): Uint8Array {
    const enc = new TextEncoder();
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    const offsets: number[] = [];
    let offset = 0;
    for (const e of entries) {
        const name = Buffer.from(enc.encode(e.lfhName ?? e.name));
        const crc = crc32(e.data);
        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0);   // signature
        lfh.writeUInt16LE(20, 4);           // version needed
        lfh.writeUInt16LE(0x800, 6);        // flags: UTF-8 names
        lfh.writeUInt16LE(0, 8);            // method: store
        lfh.writeUInt16LE(0, 10);           // dos time
        lfh.writeUInt16LE(0x21, 12);        // dos date (1980-01-01)
        lfh.writeUInt32LE(crc, 14);
        lfh.writeUInt32LE(e.data.length, 18);
        lfh.writeUInt32LE(e.data.length, 22);
        lfh.writeUInt16LE(name.length, 26);
        lfh.writeUInt16LE(0, 28);           // extra length
        offsets.push(offset);
        locals.push(lfh, name, Buffer.from(e.data));
        offset += lfh.length + name.length + e.data.length;
    }
    entries.forEach((e, i) => {
        const name = Buffer.from(enc.encode(e.name));
        const crc = crc32(e.data);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);    // signature
        cd.writeUInt16LE(0x031e, 4);        // made by: Unix, 3.0
        cd.writeUInt16LE(20, 6);            // version needed
        cd.writeUInt16LE(0x800, 8);         // flags
        cd.writeUInt16LE(0, 10);            // method
        cd.writeUInt16LE(0, 12);            // dos time
        cd.writeUInt16LE(0x21, 14);         // dos date
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(e.data.length, 20);
        cd.writeUInt32LE(e.uncompressedSize ?? e.data.length, 24);
        cd.writeUInt16LE(name.length, 28);
        cd.writeUInt16LE(0, 30);            // extra length
        cd.writeUInt16LE(0, 32);            // comment length
        cd.writeUInt16LE(0, 34);            // disk number start
        cd.writeUInt16LE(0, 36);            // internal attributes
        cd.writeUInt32LE(0x81a40000, 38);   // external attributes: 0100644
        cd.writeUInt32LE(e.localHeaderOffset ?? (offsets[i] as number), 42);
        centrals.push(cd, name);
    });
    const cdSize = centrals.reduce((n, b) => n + b.length, 0);
    const count = options.count ?? entries.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);               // this disk
    eocd.writeUInt16LE(0, 6);               // cd disk
    eocd.writeUInt16LE(count, 8);           // entries on this disk
    eocd.writeUInt16LE(count, 10);          // entries total
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(offset, 16);         // cd offset
    eocd.writeUInt16LE(0, 20);              // comment length
    return new Uint8Array(Buffer.concat([...locals, ...centrals, eocd]));
}

// ── The seven shapes ──────────────────────────────────────────────────

const enc = new TextEncoder();
const text = (s: string): Uint8Array => enc.encode(s);

const SHAPES = {
    'zip-slip': rawZip([{ name: '../evil.txt', data: text('evil') }]),
    'device-name': rawZip([{ name: 'aux.txt', data: text('device') }]),
    'duplicate-paths': rawZip([{ name: 'same.txt', data: text('one') }, { name: 'same.txt', data: text('two') }]),
    'overlap': rawZip([{ name: 'a.txt', data: text('aaaa') }, { name: 'b.txt', data: text('bbbb'), localHeaderOffset: 0 }]),
    'cd-count-mismatch': rawZip([{ name: 'a.txt', data: text('aaaa') }], { count: 9 }),
    'declared-bomb': rawZip([{ name: 'bomb.bin', data: text('1234'), uncompressedSize: 2 * 1024 * 1024 * 1024 }]),
    'lfh-cd-name-mismatch': rawZip([{ name: 'cd-name.txt', lfhName: 'lfh-name.txt', data: text('mm') }]),
} as const;

type Shape = keyof typeof SHAPES;

interface ListReport {
    archive: { entryCount: number };
    entries: { name: string; uncompressedSize: number }[];
    diagnostics: { code: string }[];
}

interface InspectReport {
    archive: { entryCount: number };
    stats: { duplicateNames: number };
    diagnostics: { code: string; entryName?: string; severity: string }[];
    checks?: { check: string; ok: boolean }[];
}

interface VerifyReport {
    ok: boolean;
    error: { code: string } | null;
    entryCount: number;
    entries: { name: string; ok: boolean; crcMatch: boolean; sizeMatch: boolean; localHeaderMatch: boolean }[];
    diagnostics: { code: string }[];
    failed: number;
}

describe('integration: refusal posture over crafted archives', () => {
    let dir = '';
    const paths = {} as Record<Shape, string>;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        for (const [shape, bytes] of Object.entries(SHAPES) as [Shape, Uint8Array][]) {
            paths[shape] = join(dir, `${shape}.zip`);
            await writeFile(paths[shape], bytes);
        }
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_QUIET'];
        delete process.env['ZIPNATIVE_STRICT'];
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });

    const outDir = (): string => join(dir, 'out');

    /**
     * No hostile payload reached the disk. A refusal raised on the FIRST pull
     * of an entry's stream may leave a 0-byte placeholder behind on Windows
     * (the write stream's close races the partial-file removal), so an empty
     * file is tolerated — bytes are not.
     */
    function expectNoPayload(path: string): void {
        if (!existsSync(path)) return;
        expect(statSync(path).size).toBe(0);
    }

    async function listJson(shape: Shape, ...extra: string[]): Promise<Run & { report: ListReport | null }> {
        const r = await run(() => list(parseArgs(['--input', paths[shape], '--format', 'json', ...extra])));
        return { ...r, report: r.error === undefined ? (JSON.parse(r.text) as ListReport) : null };
    }

    async function inspectJson(shape: Shape, ...extra: string[]): Promise<Run & { report: InspectReport | null }> {
        const r = await run(() => inspect(parseArgs(['--input', paths[shape], '--format', 'json', ...extra])));
        return { ...r, report: r.text.length > 0 ? (JSON.parse(r.text) as InspectReport) : null };
    }

    async function verifyJson(shape: Shape, ...extra: string[]): Promise<Run & { report: VerifyReport }> {
        const r = await run(() => verify(parseArgs(['--input', paths[shape], '--format', 'json', ...extra])));
        return { ...r, report: JSON.parse(r.text) as VerifyReport };
    }

    // ── 1–3: name-level hazards — conformant, refused only by the sink ──

    it.each<[Shape, string, string]>([
        ['zip-slip', '../evil.txt', 'ZIP_PATH_TRAVERSAL'],
        ['device-name', 'aux.txt', 'ZIP_PATH_TRAVERSAL'],
        ['duplicate-paths', 'same.txt', 'ZIP_EXTRACT_DUPLICATE_PATH'],
    ])('%s: extract refuses (E_SECURITY %s → %s) while list and verify open it', async (shape, entryName, zipCode) => {
        const ex = await run(() => extract(parseArgs(['--input', paths[shape], '--output-dir', outDir()])));
        expect(ex.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode, entryName, exitCode: 1 });
        expect(existsSync(outDir())).toBe(false);
        expect(existsSync(join(dir, 'evil.txt'))).toBe(false);

        const ls = await listJson(shape);
        expect(ls.error).toBeUndefined();
        expect(ls.report?.entries[0]?.name).toBe(entryName);

        const vr = await verifyJson(shape);
        expect(vr.error).toBeUndefined();
        expect(vr.report.ok).toBe(true);
        expect(vr.report.error).toBeNull();
    });

    it('zip-slip: --skip-unsafe writes nothing for the hostile name and reports it', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => extract(parseArgs(['--input', paths['zip-slip'], '--output-dir', outDir(), '--skip-unsafe'])));
        expect(r.error).toBeUndefined();
        expect(existsSync(join(dir, 'evil.txt'))).toBe(false);
        expect(existsSync(join(outDir(), 'evil.txt'))).toBe(false);
        const env = JSON.parse(r.err.split('\n').filter((l) => l.startsWith('{')).pop() as string) as { skipped: unknown[]; entries: number };
        expect(env.entries).toBe(0);
        expect(env.skipped).toEqual([{ name: '../evil.txt', reason: 'unsafe-path' }]);
    });

    it('duplicate-paths: inspect counts the duplicate, --on-duplicate resolves deliberately', async () => {
        const ins = await inspectJson('duplicate-paths');
        expect(ins.error).toBeUndefined();
        expect(ins.report?.stats.duplicateNames).toBe(1);
        const gated = await inspectJson('duplicate-paths', '--check', 'no-duplicates');
        expect(gated.error).toMatchObject({ code: ErrorCode.CHECK_FAILED });
        const last = join(dir, 'last');
        const r = await run(() => extract(parseArgs(['--input', paths['duplicate-paths'], '--output-dir', last, '--on-duplicate', 'last'])));
        expect(r.error).toBeUndefined();
        const { readFile } = await import('node:fs/promises');
        expect(await readFile(join(last, 'same.txt'), 'utf8')).toBe('two');
        const first = join(dir, 'first');
        await run(() => extract(parseArgs(['--input', paths['duplicate-paths'], '--output-dir', first, '--on-duplicate', 'first'])));
        expect(await readFile(join(first, 'same.txt'), 'utf8')).toBe('one');
    });

    // ── 4: overlapping entries — structural, refused by every eager path ──

    it('overlap: inspect, eager list, extract and cat refuse with E_SECURITY / ZIP_ENTRY_OVERLAP', async () => {
        const ins = await inspectJson('overlap');
        expect(ins.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_ENTRY_OVERLAP', exitCode: 1 });
        const eager = await listJson('overlap', '--validate', 'eager');
        expect(eager.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_ENTRY_OVERLAP' });
        const ex = await run(() => extract(parseArgs(['--input', paths['overlap'], '--output-dir', outDir()])));
        expect(ex.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_ENTRY_OVERLAP' });
        // The shared-offset table trips on the first read (either entry shares
        // the offset), so the refusal lands mid-extraction: no payload is written.
        expect(['a.txt', 'b.txt']).toContain((ex.error as { entryName: string }).entryName);
        expectNoPayload(join(outDir(), 'a.txt'));
        expectNoPayload(join(outDir(), 'b.txt'));
        const c = await run(() => cat(parseArgs(['--input', paths['overlap'], '--entry', 'b.txt'])));
        expect(c.error).toMatchObject({ code: ErrorCode.SECURITY, zipCode: 'ZIP_ENTRY_OVERLAP' });
        expect(c.out.length).toBe(0);
        // The lazy listing only parses the central directory — it opens (and
        // shows both names): structural refusals need an eager pass.
        const lazy = await listJson('overlap');
        expect(lazy.error).toBeUndefined();
        expect(lazy.report?.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
    });

    it('overlap: verify reports the structural refusal and exits with its zipCode', async () => {
        const vr = await verifyJson('overlap');
        expect(vr.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED, zipCode: 'ZIP_ENTRY_OVERLAP', exitCode: 1 });
        expect(vr.report.ok).toBe(false);
        expect(vr.report.error?.code).toBe('ZIP_ENTRY_OVERLAP');
        expect(vr.report.entryCount).toBe(0);
    });

    // ── 5: EOCD declares more entries than the central directory holds ──

    it('cd-count-mismatch: list and inspect refuse with E_PARSE / ZIP_CD_INCONSISTENT, verify carries it', async () => {
        const ls = await listJson('cd-count-mismatch');
        expect(ls.error).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_CD_INCONSISTENT', exitCode: 1 });
        const ins = await inspectJson('cd-count-mismatch');
        expect(ins.error).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_CD_INCONSISTENT' });
        const ex = await run(() => extract(parseArgs(['--input', paths['cd-count-mismatch'], '--output-dir', outDir()])));
        expect(ex.error).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_CD_INCONSISTENT' });
        const vr = await verifyJson('cd-count-mismatch');
        expect(vr.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED, zipCode: 'ZIP_CD_INCONSISTENT' });
        expect(vr.report.error?.code).toBe('ZIP_CD_INCONSISTENT');
        expect((vr.error as Error).message).toContain('9 declared');
    });

    // ── 6: declared decompression bomb — bounded before a byte is inflated ──

    it('declared-bomb: cat and extract refuse with E_LIMIT / ZIP_LIMIT_EXCEEDED and structured detail', async () => {
        const c = await run(() => cat(parseArgs(['--input', paths['declared-bomb'], '--entry', 'bomb.bin'])));
        expect(c.error).toMatchObject({
            code: ErrorCode.LIMIT,
            zipCode: 'ZIP_LIMIT_EXCEEDED',
            exitCode: 1,
            detail: { limit: 'maxEntryUncompressedSize', configured: 1024 * 1024 * 1024, observed: 2 * 1024 * 1024 * 1024 },
        });
        expect(c.out.length).toBe(0);
        const ex = await run(() => extract(parseArgs(['--input', paths['declared-bomb'], '--output-dir', outDir()])));
        expect(ex.error).toMatchObject({ code: ErrorCode.LIMIT, zipCode: 'ZIP_LIMIT_EXCEEDED', entryName: 'bomb.bin' });
        expectNoPayload(join(outDir(), 'bomb.bin'));
        // Raising the bound does not help: the payload is 4 bytes, the CD lies.
        const raised = await run(() => cat(parseArgs(['--input', paths['declared-bomb'], '--entry', 'bomb.bin', '--max-entry-size', '4g'])));
        expect(raised.error).toMatchObject({ code: ErrorCode.DATA });
    });

    it('declared-bomb: list shows the declared size, verify fails the entry, inspect --check gates it', async () => {
        const ls = await listJson('declared-bomb');
        expect(ls.error).toBeUndefined();
        expect(ls.report?.entries[0]?.uncompressedSize).toBe(2 * 1024 * 1024 * 1024);
        const vr = await verifyJson('declared-bomb');
        expect(vr.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED });
        expect(vr.error).not.toHaveProperty('zipCode', expect.any(String));
        expect(vr.report.ok).toBe(false);
        expect(vr.report.error).toBeNull();
        expect(vr.report.entries[0]).toMatchObject({ name: 'bomb.bin', ok: false, sizeMatch: false });
        expect(vr.report.failed).toBe(1);
        const ins = await inspectJson('declared-bomb', '--check', 'max-uncompressed=1m,max-entries=5');
        expect(ins.error).toMatchObject({ code: ErrorCode.CHECK_FAILED, exitCode: 1 });
        expect(ins.report?.checks).toEqual([
            { check: 'max-uncompressed=1m', ok: false, detail: expect.any(String) },
            { check: 'max-entries=5', ok: true, detail: expect.any(String) },
        ]);
    });

    // ── 7: parser differential — opens with a diagnostic, --strict rejects ──

    it('lfh-cd-name-mismatch: opens (CD authoritative); reading raises ZIP_NAME_MISMATCH, --strict escalates', async () => {
        // The name cross-check runs when an entry is READ: the eager open
        // (inspect) reports a clean structure with the CD name.
        const ins = await inspectJson('lfh-cd-name-mismatch');
        expect(ins.error).toBeUndefined();
        expect(ins.report?.archive.entryCount).toBe(1);
        expect(ins.report?.diagnostics).toEqual([]);
        const ls = await listJson('lfh-cd-name-mismatch');
        expect(ls.report?.entries.map((e) => e.name)).toEqual(['cd-name.txt']);

        const c = await run(() => cat(parseArgs(['--input', paths['lfh-cd-name-mismatch'], '--entry', 'cd-name.txt'])));
        expect(c.error).toBeUndefined();
        expect(c.text).toBe('mm');
        expect(c.err).toContain("warning: [ZIP_NAME_MISMATCH] entry 'cd-name.txt':");

        const vr = await verifyJson('lfh-cd-name-mismatch');
        expect(vr.error).toBeUndefined();
        expect(vr.report.ok).toBe(true);
        expect(vr.report.entries[0]).toMatchObject({ name: 'cd-name.txt', ok: true, localHeaderMatch: true });
        expect(vr.report.diagnostics).toEqual([
            { code: 'ZIP_NAME_MISMATCH', severity: 'warning', message: expect.any(String), entryName: 'cd-name.txt' },
        ]);

        const strictVerify = await verifyJson('lfh-cd-name-mismatch', '--strict');
        expect(strictVerify.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED });
        expect(strictVerify.report.ok).toBe(false);
        const strictCat = await run(() => cat(parseArgs(['--input', paths['lfh-cd-name-mismatch'], '--entry', 'cd-name.txt', '--strict'])));
        expect(strictCat.error).toMatchObject({ code: ErrorCode.CHECK_FAILED, zipCode: 'ZIP_STRICT_DIAGNOSTIC', exitCode: 1 });
        process.env['ZIPNATIVE_STRICT'] = '1';
        const envStrict = await run(() => extract(parseArgs(['--input', paths['lfh-cd-name-mismatch'], '--output-dir', outDir()])));
        expect(envStrict.error).toMatchObject({ code: ErrorCode.CHECK_FAILED, zipCode: 'ZIP_STRICT_DIAGNOSTIC' });
        expectNoPayload(join(outDir(), 'cd-name.txt'));
    });

    it('every refusal carries a frozen zipCode that the schema maps (never E_RUNTIME)', async () => {
        const errors: unknown[] = [];
        for (const shape of ['zip-slip', 'device-name', 'duplicate-paths', 'overlap', 'cd-count-mismatch', 'declared-bomb'] as Shape[]) {
            const r = await run(() => extract(parseArgs(['--input', paths[shape], '--output-dir', outDir()])));
            errors.push(r.error);
        }
        const { ZIP_TO_CLI } = await import('../../src/utils/ziperr.js');
        for (const e of errors as { code: string; zipCode: string }[]) {
            expect(e.code).not.toBe(ErrorCode.RUNTIME);
            expect(Object.keys(ZIP_TO_CLI)).toContain(e.zipCode);
            expect((ZIP_TO_CLI as Record<string, readonly [string, number]>)[e.zipCode]?.[0]).toBe(e.code);
        }
    });
});
