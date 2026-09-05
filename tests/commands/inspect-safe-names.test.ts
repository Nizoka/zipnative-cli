// `inspect --check safe-names` (review finding Q2-F3): `verify` proves
// integrity and structure, never path safety; this assertion is the
// pre-extraction gate for names the engine's sanitizeEntryPath() refuses.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect, type InspectReport } from '../../src/commands/inspect.js';
import { verify, type VerifyReport } from '../../src/commands/verify.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';
import { buildRawZip } from '../helpers/raw-zip-builder.js';

async function run(fn: () => Promise<void>): Promise<{ text: string; error: unknown }> {
    const out: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => { out.push(String(chunk)); return true; }) as typeof process.stdout.write);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
    let error: unknown;
    try {
        await fn();
    } catch (e) {
        error = e;
    } finally {
        outSpy.mockRestore();
        errSpy.mockRestore();
    }
    return { text: out.join(''), error };
}

let dir = '';
let hostile = '';
let clean = '';
const enc = new TextEncoder();

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-safe-'));
    hostile = join(dir, 'hostile.zip');
    await writeFile(hostile, buildRawZip([
        { name: 'ok.txt', data: enc.encode('fine') },
        { name: '../evil.txt', data: enc.encode('slip') },
        { name: '/abs.txt', data: enc.encode('abs') },
        { name: 'sub/', data: new Uint8Array(0), externalAttributes: 0x10 },
    ]));
    clean = join(dir, 'clean.zip');
    await writeFile(clean, buildRawZip([{ name: 'a.txt', data: enc.encode('a') }, { name: 'd/', data: new Uint8Array(0), externalAttributes: 0x10 }]));
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

describe('inspect --check safe-names', () => {
    it('counts the names sanitizeEntryPath() refuses and fails the check (after printing the report)', async () => {
        const r = await run(() => inspect(parseArgs([hostile, '--format', 'json', '--check', 'safe-names'])));
        expect(r.error).toMatchObject({ code: ErrorCode.CHECK_FAILED, exitCode: 1 });
        const report = JSON.parse(r.text) as InspectReport;
        expect(report.stats.unsafeNames).toBe(2);
        expect(report.checks).toEqual([{ check: 'safe-names', ok: false, detail: '2 unsafe names (traversal, absolute, drive/UNC, NUL, ADS or reserved device name)' }]);
    });

    it('passes on a clean archive (directory names are checked without their slash) and shows up in the text report', async () => {
        const r = await run(() => inspect(parseArgs([clean, '--format', 'json', '--check', 'safe-names,no-symlinks'])));
        expect(r.error).toBeUndefined();
        const report = JSON.parse(r.text) as InspectReport;
        expect(report.stats.unsafeNames).toBe(0);
        expect(report.checks?.every((c) => c.ok)).toBe(true);
        const text = await run(() => inspect(parseArgs([hostile])));
        expect(text.text).toMatch(/names\s+\d+ utf-8, \d+ cp437, \d+ duplicates, 2 unsafe/);
    });

    it('verify still says ok on the same hostile archive — integrity is not path safety', async () => {
        const r = await run(() => verify(parseArgs([hostile, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        expect((JSON.parse(r.text) as VerifyReport).ok).toBe(true);
    });
});
