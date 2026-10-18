// Unit tests for the 1.1.0 hardening helpers the command suites reach only
// partly: the engines range evaluator, the in-flight registry, the device
// branch of the bounded read, the progress handler and the glob refusal the
// fuzz suite found.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVersion, satisfies } from '../../src/utils/engines.js';
import { clearInFlight, inFlightPaths, markInFlight, removeInFlight } from '../../src/utils/inflight.js';
import { readFileOrStdin } from '../../src/utils/io.js';
import { _resetControl, armTimeout, checkAborted, isProgress, progressHandler, runSignal } from '../../src/utils/control.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { compileGlob } from '../../src/utils/glob.js';
import { nodeRange } from '../../src/utils/version.js';

afterEach(() => {
    vi.restoreAllMocks();
    _resetControl();
    for (const k of ['ZIPNATIVE_PROGRESS', 'ZIPNATIVE_JSON', 'ZIPNATIVE_QUIET']) delete process.env[k];
});

describe('engines.ts', () => {
    it('parses versions with or without the v prefix and the minor / patch parts', () => {
        expect(parseVersion('v22.23.2')).toEqual([22, 23, 2]);
        expect(parseVersion('22')).toEqual([22, 0, 0]);
        expect(parseVersion('24.1')).toEqual([24, 1, 0]);
        expect(parseVersion('nope')).toBeUndefined();
    });

    it('evaluates >=, ^ (major and 0.x), exact versions and || unions', () => {
        expect(satisfies('22.0.0', '>=22')).toBe(true);
        expect(satisfies('21.9.9', '>=22')).toBe(false);
        expect(satisfies('22.22.2', '^22.22.2 || ^24.14.1 || >=25.8.2')).toBe(true);
        expect(satisfies('22.22.1', '^22.22.2 || ^24.14.1 || >=25.8.2')).toBe(false);
        expect(satisfies('23.0.0', '^22.22.2 || ^24.14.1 || >=25.8.2')).toBe(false);
        expect(satisfies('26.0.0', '^22.22.2 || ^24.14.1 || >=25.8.2')).toBe(true);
        expect(satisfies('0.3.9', '^0.3.1')).toBe(true);
        expect(satisfies('0.4.0', '^0.3.1')).toBe(false);
        expect(satisfies('1.2.3', '1.2.3')).toBe(true);
        expect(satisfies('garbage', '>=22')).toBe(false);
        expect(() => satisfies('22.0.0', '~22')).toThrow(/Unsupported version range/);
    });

    it('the package range doctor checks is package.json engines.node, and this runtime satisfies it', () => {
        expect(nodeRange()).toBe('^22.17.1 || >=24.4.1');
        expect(satisfies('22.17.0', nodeRange())).toBe(false);
        expect(satisfies('24.4.0', nodeRange())).toBe(false);
        expect(satisfies('22.17.1', nodeRange())).toBe(true);
        expect(satisfies(process.versions.node, nodeRange())).toBe(true);
    });
});

describe('inflight.ts', () => {
    it('registers, clears and removes exactly the in-flight paths', () => {
        const dir = mkdtempSync(join(tmpdir(), 'zipnative-inflight-'));
        try {
            const a = join(dir, 'a.part');
            const b = join(dir, 'b.part');
            writeFileSync(a, 'x');
            writeFileSync(b, 'y');
            markInFlight(a);
            markInFlight(b);
            clearInFlight(b);
            expect(inFlightPaths()).toEqual([a]);
            expect(removeInFlight()).toEqual([a]);
            expect(existsSync(a)).toBe(false);
            expect(existsSync(b)).toBe(true);
            expect(inFlightPaths()).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('readFileOrStdin on a device (the byte-counted branch)', () => {
    const NULL_DEVICE = process.platform === 'win32' ? '\\\\.\\NUL' : '/dev/null';

    it('reads a character device through the same descriptor, byte-counted (empty here)', async () => {
        expect((await readFileOrStdin(NULL_DEVICE, 16)).length).toBe(0);
    });

    it.skipIf(process.platform === 'win32')('refuses a device that never ends at the bound, instead of reading it whole', async () => {
        await expect(readFileOrStdin('/dev/zero', 1024 * 1024)).rejects.toMatchObject({ code: ErrorCode.LIMIT, detail: { limit: 'maxInputSize' } });
    });

    it('refuses a directory with E_IO', async () => {
        await expect(readFileOrStdin(tmpdir(), 16)).rejects.toBeInstanceOf(Error);
    });
});

describe('control.ts', () => {
    it('arms the deadline once; checkAborted throws the CliError reason after it', async () => {
        expect(runSignal()).toBeUndefined();
        checkAborted();
        armTimeout(parseArgs(['--timeout', '1']));
        armTimeout(parseArgs(['--timeout', '1h'])); // idempotent: the first one wins
        await new Promise((r) => setTimeout(r, 20));
        expect(runSignal()?.aborted).toBe(true);
        expect(() => { checkAborted(); }).toThrow(CliError);
    });

    it('progress is off by default, on by flag or env, silenced by --quiet, throttled, and NDJSON under --json', () => {
        expect(isProgress()).toBe(false);
        expect(progressHandler('create', parseArgs([]))).toBeUndefined();
        process.env['ZIPNATIVE_PROGRESS'] = '1';
        expect(isProgress()).toBe(true);
        process.env['ZIPNATIVE_QUIET'] = '1';
        expect(progressHandler('create')).toBeUndefined();
        delete process.env['ZIPNATIVE_QUIET'];

        const writes: string[] = [];
        vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { writes.push(String(chunk)); return true; }) as unknown as typeof process.stderr.write);
        const text = progressHandler('stream') as (p: { entriesDone: number; entriesTotal: number | null; bytesIn: number; bytesOut: number }) => void;
        text({ entriesDone: 1, entriesTotal: null, bytesIn: 10, bytesOut: 5 });
        text({ entriesDone: 2, entriesTotal: null, bytesIn: 20, bytesOut: 9 }); // throttled away
        expect(writes).toEqual(['progress: 1 entries, 10 B in, 5 B out\n']);
        process.env['ZIPNATIVE_JSON'] = '1';
        const json = progressHandler('extract') as typeof text;
        json({ entriesDone: 3, entriesTotal: 3, bytesIn: 1, bytesOut: 1 });
        expect(JSON.parse(writes[1] as string)).toEqual({ type: 'progress', command: 'extract', entriesDone: 3, entriesTotal: 3, bytesIn: 1, bytesOut: 1 });
    });
});

describe('glob', () => {
    it('a character class with a range out of order is a usage error, never E_RUNTIME (fuzz finding)', () => {
        for (const p of ['[z-a]', '[h-%]', 'a/[..h-%*]li']) {
            let caught: unknown;
            try { compileGlob(p); } catch (e) { caught = e; }
            expect(caught, p).toBeInstanceOf(CliError);
            expect((caught as CliError).exitCode).toBe(2);
        }
        expect(compileGlob('[a-z]*.txt').test('dir/b1.txt')).toBe(true);
    });
});
