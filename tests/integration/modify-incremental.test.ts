// Incremental modification end to end through the CLI commands:
//   create → modify (append-only) → verify → modify --compact → verify → list
// Asserts the two save layouts' contracts: the append-only output keeps the
// original bytes as a verbatim prefix (and the removed/replaced payloads
// recoverable), the compact rewrite truly drops them, and both verify clean.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from '../../src/commands/create.js';
import { modify } from '../../src/commands/modify.js';
import { verify } from '../../src/commands/verify.js';
import { list } from '../../src/commands/list.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';

interface Run {
    readonly text: string;
    readonly err: string;
    readonly error: unknown;
}

async function run(fn: () => Promise<void>): Promise<Run> {
    const outChunks: string[] = [];
    const errChunks: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        outChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
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
    return { text: outChunks.join(''), err: errChunks.join(''), error };
}

interface VerifyReport {
    ok: boolean;
    error: { code: string } | null;
    entryCount: number;
    entries: { name: string; ok: boolean }[];
    diagnostics: { code: string }[];
    failed: number;
}

interface ListReport {
    archive: { entryCount: number; comment: string };
    entries: { name: string; uncompressedSize: number; method: number }[];
}

const A_OLD = 'alpha-original-AAAA-';
const B_OLD = 'bravo-original-BBBB-';
const A_NEW = 'alpha-REPLACED-aaaa-';
const D_NEW = 'delta-ADDED-dddd-';

function contains(bytes: Uint8Array, text: string): boolean {
    return Buffer.from(bytes).includes(Buffer.from(text));
}

describe('integration: modify incremental → compact', () => {
    let dir = '';
    let original = '';

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        const src = join(dir, 'src');
        await mkdir(src);
        await writeFile(join(src, 'a.txt'), A_OLD.repeat(4));
        await writeFile(join(src, 'b.txt'), B_OLD.repeat(4));
        await writeFile(join(src, 'c.txt'), 'charlie-kept');
        await writeFile(join(dir, 'a-new.txt'), A_NEW.repeat(4));
        await writeFile(join(dir, 'd-new.txt'), D_NEW.repeat(4));
        original = join(dir, 'original.zip');
        // Stored payloads so remanence is observable as plain text in the bytes.
        const r = await run(() => create(parseArgs([src, '--output', original, '--method', 'store', '--comment', 'v1'])));
        expect(r.error).toBeUndefined();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_QUIET'];
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });

    async function verifyJson(path: string, ...extra: string[]): Promise<{ report: VerifyReport; error: unknown }> {
        const r = await run(() => verify(parseArgs(['--input', path, '--format', 'json', ...extra])));
        return { report: JSON.parse(r.text) as VerifyReport, error: r.error };
    }

    async function listJson(path: string): Promise<ListReport> {
        const r = await run(() => list(parseArgs(['--input', path, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        return JSON.parse(r.text) as ListReport;
    }

    it('append-only edits verify clean, keep the original prefix and leave old payloads recoverable', async () => {
        const originalBytes = new Uint8Array(await readFile(original));
        const step1 = join(dir, 'step1.zip');
        const edit = await run(() => modify(parseArgs([
            '--input', original, '--output', step1,
            '--replace', `src/a.txt=${join(dir, 'a-new.txt')}`,
            '--add', `src/d.txt=${join(dir, 'd-new.txt')}`,
            '--remove', 'src/b.txt',
            '--method', 'store',
        ])));
        expect(edit.error).toBeUndefined();
        expect(edit.err).toContain('info: append-only save keeps removed/replaced bytes recoverable');

        const bytes = new Uint8Array(await readFile(step1));
        expect(bytes.length).toBeGreaterThan(originalBytes.length);
        expect(Buffer.from(bytes.subarray(0, originalBytes.length)).equals(Buffer.from(originalBytes))).toBe(true);
        expect(contains(bytes, A_OLD)).toBe(true);
        expect(contains(bytes, B_OLD)).toBe(true);
        expect(contains(bytes, A_NEW)).toBe(true);
        expect(contains(bytes, D_NEW)).toBe(true);

        const { report, error } = await verifyJson(step1);
        expect(error).toBeUndefined();
        expect(report.ok).toBe(true);
        expect(report.error).toBeNull();
        expect(report.entryCount).toBe(3);
        expect(report.entries.map((e) => e.name).sort()).toEqual(['src/a.txt', 'src/c.txt', 'src/d.txt']);
        expect(report.entries.every((e) => e.ok)).toBe(true);
        // The copied prefix still holds the old EOCD: a conformant reader picks
        // the trailing one and reports the earlier record as informational.
        expect(report.diagnostics.map((d) => d.code)).toContain('ZIP_MULTIPLE_EOCD');
        // ...which is exactly what --strict escalates.
        const strict = await verifyJson(step1, '--strict');
        expect(strict.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED });
        expect(strict.report.ok).toBe(false);

        const listing = await listJson(step1);
        expect(listing.archive.comment).toBe('v1');
        expect(listing.entries.map((e) => e.name)).toEqual(['src/a.txt', 'src/c.txt', 'src/d.txt']);
        expect(listing.entries.find((e) => e.name === 'src/a.txt')?.uncompressedSize).toBe(A_NEW.length * 4);
    });

    it('--compact from the same edits verifies clean with the removed payloads truly gone', async () => {
        const compact = join(dir, 'compact.zip');
        const edit = await run(() => modify(parseArgs([
            '--input', original, '--output', compact, '--compact',
            '--replace', `src/a.txt=${join(dir, 'a-new.txt')}`,
            '--add', `src/d.txt=${join(dir, 'd-new.txt')}`,
            '--remove', 'src/b.txt',
            '--method', 'store',
        ])));
        expect(edit.error).toBeUndefined();
        expect(edit.err).not.toContain('info: append-only');

        const bytes = new Uint8Array(await readFile(compact));
        expect(contains(bytes, A_OLD)).toBe(false);
        expect(contains(bytes, B_OLD)).toBe(false);
        expect(contains(bytes, A_NEW)).toBe(true);
        expect(contains(bytes, D_NEW)).toBe(true);
        expect(contains(bytes, 'charlie-kept')).toBe(true);

        const { report, error } = await verifyJson(compact, '--strict');
        expect(error).toBeUndefined();
        expect(report.ok).toBe(true);
        expect(report.diagnostics).toEqual([]);
        expect(report.entries.map((e) => e.name)).toEqual(['src/a.txt', 'src/c.txt', 'src/d.txt']);

        const listing = await listJson(compact);
        expect(listing.archive.entryCount).toBe(3);
        expect(listing.archive.comment).toBe('v1');
        expect(listing.entries.map((e) => e.name)).toEqual(['src/a.txt', 'src/c.txt', 'src/d.txt']);
    });

    it('compacting an append-only output yields the same entry set and drops the dead bytes', async () => {
        const step1 = join(dir, 'step1.zip');
        const step2 = join(dir, 'step2.zip');
        process.env['ZIPNATIVE_QUIET'] = '1';
        expect((await run(() => modify(parseArgs(['--input', original, '--output', step1, '--remove', 'src/b.txt'])))).error).toBeUndefined();
        expect((await run(() => modify(parseArgs(['--input', step1, '--output', step2, '--compact', '--comment', 'v2'])))).error).toBeUndefined();
        const step1Bytes = new Uint8Array(await readFile(step1));
        const step2Bytes = new Uint8Array(await readFile(step2));
        expect(step2Bytes.length).toBeLessThan(step1Bytes.length);
        expect(contains(step1Bytes, B_OLD)).toBe(true);
        expect(contains(step2Bytes, B_OLD)).toBe(false);
        const first = await verifyJson(step1);
        const second = await verifyJson(step2, '--strict');
        expect(first.report.ok).toBe(true);
        expect(second.error).toBeUndefined();
        expect(second.report.ok).toBe(true);
        const listing = await listJson(step2);
        expect(listing.entries.map((e) => e.name)).toEqual(['src/a.txt', 'src/c.txt']);
        expect(listing.archive.comment).toBe('v2');
    });
});
