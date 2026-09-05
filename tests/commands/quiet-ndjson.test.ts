// `--quiet` means "no text on stderr" in every mode. NDJSON listings have no
// wrapper for diagnostics, so they print them as text progress lines under
// --json — lines that --quiet must suppress like every other progress line.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { list } from '../../src/commands/list.js';
import { stream } from '../../src/commands/stream.js';
import { parseArgs } from '../../src/utils/args.js';
import { formatDiagnosticLine } from '../../src/utils/diagnostics.js';
import { createZip } from '../../src/core-bridge/index.js';

interface Run {
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
    return { text: Buffer.concat(outChunks).toString('utf8'), err: errChunks.join(''), error };
}

let dir = '';
let prefixed = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-quiet-'));
    const w = createZip();
    w.add('a.txt', 'alpha');
    w.add('b.txt', 'bravo');
    // Prepended bytes raise the ZIP_PREPENDED_DATA diagnostic on every read.
    prefixed = join(dir, 'prefixed.zip');
    await writeFile(prefixed, Buffer.concat([Buffer.from('JUNKJUNKJUNK'), Buffer.from(w.toBytes())]));
    process.env['ZIPNATIVE_JSON'] = '1';
});

afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env['ZIPNATIVE_JSON'];
    delete process.env['ZIPNATIVE_QUIET'];
    await rm(dir, { recursive: true, force: true });
});

describe('formatDiagnosticLine', () => {
    it('renders severity, code, optional entry and message in the one stderr form', () => {
        expect(formatDiagnosticLine({ code: 'ZIP_PREPENDED_DATA', severity: 'info', message: 'm' })).toBe('info: [ZIP_PREPENDED_DATA] m');
        expect(formatDiagnosticLine({ code: 'ZIP_NAME_MISMATCH', severity: 'warning', message: 'm', entryName: 'a.txt' })).toBe("warning: [ZIP_NAME_MISMATCH] entry 'a.txt': m");
    });
});

describe('NDJSON diagnostics honour --quiet', () => {
    it('list --format ndjson: text diagnostics under --json, none under --json --quiet', async () => {
        const loud = await run(() => list(parseArgs([prefixed, '--format', 'ndjson'])));
        expect(loud.error).toBeUndefined();
        expect(loud.text.trim().split('\n')).toHaveLength(2);
        expect(loud.err).toMatch(/^info: \[ZIP_PREPENDED_DATA\]/m);
        process.env['ZIPNATIVE_QUIET'] = '1';
        const quiet = await run(() => list(parseArgs([prefixed, '--format', 'ndjson'])));
        expect(quiet.error).toBeUndefined();
        expect(quiet.text.trim().split('\n')).toHaveLength(2);
        expect(quiet.err).toBe('');
    });

    it('stream --list (ndjson under --json): the caveat and the diagnostic lines vanish under --quiet, the rows stay', async () => {
        // Forward mode cannot skip prepended bytes; a clean archive is enough
        // to prove the stderr text (the trust caveat) goes through progress().
        const clean = join(dir, 'clean.zip');
        const w = createZip();
        w.add('a.txt', 'alpha');
        await writeFile(clean, w.toBytes());
        const loud = await run(() => stream(parseArgs([clean, '--list'])));
        expect(loud.error).toBeUndefined();
        expect(loud.err).toMatch(/warning: forward streaming/);
        process.env['ZIPNATIVE_QUIET'] = '1';
        const quiet = await run(() => stream(parseArgs([clean, '--list'])));
        expect(quiet.error).toBeUndefined();
        expect(quiet.err).toBe('');
        expect(quiet.text.trim().split('\n')).toHaveLength(1);
        expect((await readFile(clean)).length).toBeGreaterThan(0);
    });
});
