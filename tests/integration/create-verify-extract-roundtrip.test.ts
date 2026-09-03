// End-to-end: create --deterministic → verify → inspect --check → extract →
// byte-equal files → second create byte-identical → list count matches.
// Every command runs in-process through parseArgs, exactly as index.ts
// dispatches them.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { create } from '../../src/commands/create.js';
import { verify, type VerifyReport } from '../../src/commands/verify.js';
import { inspect, type InspectReport } from '../../src/commands/inspect.js';
import { extract } from '../../src/commands/extract.js';
import { list, type ListReport } from '../../src/commands/list.js';
import { parseArgs } from '../../src/utils/args.js';

const ENV_KEYS = ['ZIPNATIVE_JSON', 'ZIPNATIVE_DRY_RUN', 'ZIPNATIVE_QUIET', 'ZIPNATIVE_STRICT'] as const;
const savedEnv: Record<string, string | undefined> = {};

function captureStdout(): { text(): string } {
    const chunks: Buffer[] = [];
    const impl = (chunk: unknown, enc?: unknown, cb?: unknown): boolean => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
        const done = typeof enc === 'function' ? enc : cb;
        if (typeof done === 'function') (done as () => void)();
        return true;
    };
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(impl as typeof process.stdout.write);
    return {
        text: () => {
            spy.mockRestore();
            return Buffer.concat(chunks).toString('utf8');
        },
    };
}

let tmp: string;

const BIN = Buffer.alloc(8192);
for (let i = 0; i < BIN.length; i++) BIN[i] = (i * 31 + (i >> 5)) & 0xff;

const TREE: Record<string, Buffer> = {
    'README.md': Buffer.from('# roundtrip\n'.repeat(64)),
    'data/blob.bin': BIN,
    'data/nested/deeper/leaf.txt': Buffer.from('leaf\n'),
    'unicode/café ☕.txt': Buffer.from('unicode content ✓\n'),
    'unicode/日本語.txt': Buffer.from('日本語のテキスト\n'),
};

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

describe('create → verify → inspect → extract round trip', () => {
    it('reproduces the tree byte-for-byte and the archive byte-for-byte', async () => {
        // ── tree
        const src = join(tmp, 'project');
        for (const [rel, data] of Object.entries(TREE)) {
            const abs = join(src, ...rel.split('/'));
            await mkdir(join(abs, '..'), { recursive: true });
            await writeFile(abs, data);
        }

        // ── create --deterministic
        const zip = join(tmp, 'project.zip');
        await create(parseArgs([src, '--base', src, '--deterministic', '--dir-entries', '--comment', 'roundtrip', '-o', zip]));
        const first = await readFile(zip);
        expect(first.subarray(0, 2).toString('latin1')).toBe('PK');

        // ── verify (json)
        const verifyOut = captureStdout();
        await verify(parseArgs(['--input', zip, '--format', 'json']));
        const report = JSON.parse(verifyOut.text()) as VerifyReport;
        expect(report.ok).toBe(true);
        expect(report.error).toBeNull();
        expect(report.failed).toBe(0);
        expect(report.diagnostics).toEqual([]);
        expect(report.entries.every((e) => e.ok)).toBe(true);
        const expectedNames = [...Object.keys(TREE), 'data/', 'data/nested/', 'data/nested/deeper/', 'unicode/'].sort();
        expect(report.entries.map((e) => e.name).sort()).toEqual(expectedNames);

        // ── inspect --check deterministic,no-diagnostics (+ a few more gates)
        const inspectOut = captureStdout();
        await inspect(parseArgs([
            '--input', zip, '--format', 'json',
            '--check', 'deterministic,no-diagnostics,utf8-names,no-data-descriptor,no-zip64,has=unicode/日本語.txt',
        ]));
        const facts = JSON.parse(inspectOut.text()) as InspectReport;
        expect(facts.determinism.deterministic).toBe(true);
        expect(facts.archive.comment).toBe('roundtrip');
        expect(facts.stats.utf8Names).toBe(expectedNames.length);
        expect(facts.checks?.every((c) => c.ok)).toBe(true);

        // ── extract
        const out = join(tmp, 'restored');
        await extract(parseArgs(['--input', zip, '--output-dir', out]));
        for (const [rel, data] of Object.entries(TREE)) {
            const restored = await readFile(join(out, ...rel.split('/')));
            expect(restored.equals(data)).toBe(true);
        }

        // ── second create is byte-identical
        const zip2 = join(tmp, 'project-again.zip');
        await create(parseArgs([src, '--base', src, '--deterministic', '--dir-entries', '--comment', 'roundtrip', '-o', zip2]));
        expect((await readFile(zip2)).equals(first)).toBe(true);

        // ── re-archiving the RESTORED tree is byte-identical too
        const zip3 = join(tmp, 'restored.zip');
        await create(parseArgs([out, '--base', out, '--deterministic', '--dir-entries', '--comment', 'roundtrip', '-o', zip3]));
        expect((await readFile(zip3)).equals(first)).toBe(true);

        // ── list --format json
        const listOut = captureStdout();
        await list(parseArgs(['--input', zip, '--format', 'json']));
        const listing = JSON.parse(listOut.text()) as ListReport;
        expect(listing.archive.entryCount).toBe(expectedNames.length);
        expect(listing.entries.length).toBe(expectedNames.length);
        expect(listing.entries.map((e) => e.name).sort()).toEqual(expectedNames);
        expect(listing.entries.filter((e) => e.isDirectory).length).toBe(4);
        expect(listing.entries.every((e) => e.nameEncoding === 'utf-8')).toBe(true);
    });

    it('the streaming and parallel writers round-trip the same tree', async () => {
        const src = join(tmp, 'project');
        for (const [rel, data] of Object.entries(TREE)) {
            const abs = join(src, ...rel.split('/'));
            await mkdir(join(abs, '..'), { recursive: true });
            await writeFile(abs, data);
        }
        const streamed = join(tmp, 'streamed.zip');
        await create(parseArgs([src, '--base', src, '--stream', '-o', streamed]));
        const parallel = join(tmp, 'parallel.zip');
        await create(parseArgs([src, '--base', src, '--parallel', '--workers', '2', '--min-job-size', '1', '--deterministic', '-o', parallel]));
        const sequential = join(tmp, 'sequential.zip');
        await create(parseArgs([src, '--base', src, '--deterministic', '-o', sequential]));
        expect((await readFile(parallel)).equals(await readFile(sequential))).toBe(true);

        for (const zip of [streamed, parallel]) {
            const verifyOut = captureStdout();
            await verify(parseArgs(['--input', zip, '--format', 'json']));
            expect((JSON.parse(verifyOut.text()) as VerifyReport).ok).toBe(true);
            const out = join(tmp, `out-${zip.endsWith('streamed.zip') ? 's' : 'p'}`);
            await extract(parseArgs(['--input', zip, '--output-dir', out]));
            for (const [rel, data] of Object.entries(TREE)) {
                expect((await readFile(join(out, ...rel.split('/')))).equals(data)).toBe(true);
            }
        }
    });
});
