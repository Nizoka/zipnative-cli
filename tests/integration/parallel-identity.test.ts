// `create --parallel` (zipnative/worker pool) must be byte-identical to the
// sequential writer under --deterministic (pure-pinned tier on every thread),
// and both outputs must verify clean with or without the pin. Spawns real
// worker threads: --min-job-size 1 forces every entry through the pool.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from '../../src/commands/create.js';
import { verify } from '../../src/commands/verify.js';
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

function envelope(err: string): Record<string, unknown> {
    const lines = err.split('\n').filter((l) => l.startsWith('{'));
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

describe('integration: create --parallel byte identity', () => {
    let dir = '';
    let src = '';

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        src = join(dir, 'src');
        await mkdir(join(src, 'nested'), { recursive: true });
        await writeFile(join(src, 'text.txt'), 'the quick brown fox jumps over the lazy dog\n'.repeat(400));
        await writeFile(join(src, 'nested', 'numbers.csv'), Array.from({ length: 2000 }, (_, i) => `${i},${i * i},${i % 7}`).join('\n'));
        const noise = Buffer.alloc(24 * 1024);
        for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
        await writeFile(join(src, 'nested', 'noise.bin'), noise);
        await writeFile(join(src, 'tiny.txt'), 'x');
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_QUIET'];
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });

    async function build(name: string, ...flags: string[]): Promise<{ bytes: Uint8Array; env: Record<string, unknown> }> {
        const output = join(dir, name);
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => create(parseArgs([src, '--output', output, ...flags])));
        delete process.env['ZIPNATIVE_JSON'];
        expect(r.error).toBeUndefined();
        const env = envelope(r.err);
        expect(env).toMatchObject({ ok: true, command: 'create', entries: 4, files: 4 });
        return { bytes: new Uint8Array(await readFile(output)), env };
    }

    async function verifyOk(name: string): Promise<void> {
        const r = await run(() => verify(parseArgs(['--input', join(dir, name), '--format', 'json', '--strict'])));
        expect(r.error).toBeUndefined();
        const report = JSON.parse(r.text) as { ok: boolean; entryCount: number; failed: number; diagnostics: unknown[] };
        expect(report).toMatchObject({ ok: true, entryCount: 4, failed: 0, diagnostics: [] });
    }

    it('--parallel --workers 2 --min-job-size 1 --deterministic is byte-identical to the sequential writer', async () => {
        const parallel = await build('parallel.zip', '--parallel', '--workers', '2', '--min-job-size', '1', '--deterministic');
        const sequential = await build('sequential.zip', '--deterministic');
        expect(parallel.env).toMatchObject({ parallel: { workers: 2 }, deterministic: true, tier: 'pure-pinned' });
        expect(sequential.env).toMatchObject({ parallel: false, deterministic: true, tier: 'pure-pinned' });
        expect(parallel.bytes.length).toBe(sequential.bytes.length);
        expect(sha256(parallel.bytes)).toBe(sha256(sequential.bytes));
        expect(Buffer.from(parallel.bytes).equals(Buffer.from(sequential.bytes))).toBe(true);
        await verifyOk('parallel.zip');
        await verifyOk('sequential.zip');
    });

    it('a second deterministic parallel run reproduces the same bytes (stable across pools)', async () => {
        const first = await build('p1.zip', '--parallel', '--workers', '2', '--min-job-size', '1', '--deterministic');
        const second = await build('p2.zip', '--parallel', '--workers', '1', '--min-job-size', '1', '--deterministic');
        expect(sha256(first.bytes)).toBe(sha256(second.bytes));
    });

    it('without --deterministic both writers still produce archives that verify clean', async () => {
        const parallel = await build('parallel-fast.zip', '--parallel', '--workers', '2', '--min-job-size', '1');
        const sequential = await build('sequential-fast.zip');
        expect(parallel.env['deterministic']).toBe(false);
        expect(sequential.env['tier']).toBe('node-zlib');
        await verifyOk('parallel-fast.zip');
        await verifyOk('sequential-fast.zip');
        // Same entry set and payload sizes even when the deflate bytes may differ per tier.
        const names = (bytes: Uint8Array): string[] => {
            const text = Buffer.from(bytes).toString('latin1');
            return ['src/nested/noise.bin', 'src/nested/numbers.csv', 'src/text.txt', 'src/tiny.txt'].filter((n) => text.includes(n));
        };
        expect(names(parallel.bytes)).toHaveLength(4);
        expect(names(sequential.bytes)).toHaveLength(4);
    });

    it('--workers 0 runs the parallel writer on the calling thread and stays identical under --deterministic', async () => {
        const inline = await build('inline.zip', '--parallel', '--workers', '0', '--deterministic');
        const sequential = await build('seq.zip', '--deterministic');
        expect(inline.env).toMatchObject({ parallel: { workers: 0 } });
        expect(sha256(inline.bytes)).toBe(sha256(sequential.bytes));
    });

    it('the worker flags require --parallel (exit 2)', async () => {
        const r = await run(() => create(parseArgs([src, '--output', join(dir, 'x.zip'), '--workers', '2'])));
        expect(r.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });
});
