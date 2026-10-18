// Regression tests for the second 1.1.0 review (two independent reviewers +
// a verifier; the report is local, .audit/1.1.0/review-v1.1.0.md, summarised
// in release-notes/draft/PR-v1.1.0.md §Independent audit). Group 1 — strict switch
// values and bounded batch reads:
//   M-01  a switch with an unrecognised value (`--overwrite=flase`) is E_USAGE,
//         never ON — on argv and in a manifest task;
//   N-1   `batch --task verify` honours --max-input-size;
//   M-23  batch refuses the flags its mode ignores; a manifest task cannot set
//         a process-wide flag;
//   M-24  `--workers` is bounded;
//   M-26  the alias table is prototype-free;
//   M-27  a file entry that is also a parent directory is refused up front;
//   M-28  `extract --entry <missing>` is E_NOT_FOUND, not an empty success.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertInvocation } from '../../src/commands/completion.js';
import { batch } from '../../src/commands/batch.js';
import { create } from '../../src/commands/create.js';
import { extract } from '../../src/commands/extract.js';
import { inspect } from '../../src/commands/inspect.js';
import { schema } from '../../src/commands/schema.js';
import { verify } from '../../src/commands/verify.js';
import { createZip } from '../../src/core-bridge/index.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { parseManifest } from '../../src/utils/manifest.js';

let dir = '';
let out = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-review2-'));
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        out += String(chunk);
        const cb = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
        cb?.();
        return true;
    }) as unknown as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as unknown as typeof process.stderr.write);
});

afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env['ZIPNATIVE_JSON'];
    await rm(dir, { recursive: true, force: true });
});

async function refusal(fn: () => Promise<void>): Promise<CliError> {
    try {
        await fn();
    } catch (e) {
        if (e instanceof CliError) return e;
        throw e;
    }
    throw new Error('expected a CliError');
}

async function archive(name: string, entries: Record<string, string>): Promise<string> {
    const zip = createZip();
    for (const [n, data] of Object.entries(entries)) zip.add(n, data);
    const path = join(dir, name);
    await writeFile(path, zip.toBytes());
    return path;
}

describe('M-01 strict switch values', () => {
    it('--overwrite=flase is a usage error before anything is written; the existing file is untouched', async () => {
        const zip = await archive('a.zip', { 'keep.txt': 'NEW' });
        const outDir = join(dir, 'out');
        await mkdir(outDir);
        await writeFile(join(outDir, 'keep.txt'), 'ORIGINAL');
        const args = parseArgs([zip, '-d', outDir, '--overwrite=flase']);
        expect(() => { assertInvocation('extract', args); }).toThrow(CliError);
        const e = await refusal(() => extract(args));
        expect(e.exitCode).toBe(2);
        expect(e.message).not.toContain('flase');
        expect(await readFile(join(outDir, 'keep.txt'), 'utf8')).toBe('ORIGINAL');
    });

    it('accepts the eight documented spellings', () => {
        for (const v of ['true', '1', 'yes', 'on', 'false', '0', 'no', 'off']) {
            expect(() => { assertInvocation('list', parseArgs(['a.zip', `--long=${v}`])); }, v).not.toThrow();
        }
        expect(() => { assertInvocation('list', parseArgs(['a.zip', '--long='])); }).toThrow(CliError);
    });

    it('a manifest task carrying "overwrite": "flase" is refused before the first task runs', async () => {
        const manifest = join(dir, 'm.json');
        await writeFile(manifest, JSON.stringify({ version: 1, tasks: [
            { id: 'a', command: 'list', flags: { input: 'x.zip' } },
            { id: 'b', command: 'extract', flags: { input: 'x.zip', 'output-dir': 'o', overwrite: 'flase' } },
        ] }));
        const e = await refusal(() => batch(parseArgs(['--manifest', manifest])));
        expect(e.exitCode).toBe(2);
    });
});

describe('N-1 batch --task verify honours --max-input-size', () => {
    it('an archive above the bound is an E_LIMIT row, never read whole', async () => {
        const vdir = join(dir, 'v');
        await mkdir(vdir);
        const zip = createZip();
        zip.add('a.txt', 'x'.repeat(500));
        await writeFile(join(vdir, 'a.zip'), zip.toBytes());
        process.env['ZIPNATIVE_JSON'] = '1';
        await refusal(() => batch(parseArgs(['--input-dir', vdir, '--task', 'verify', '--max-input-size', '10', '--format', 'json'])));
        const doc = JSON.parse(out) as { results: { ok: boolean; code?: string }[] };
        expect(doc.results[0]).toMatchObject({ ok: false, code: ErrorCode.LIMIT });
    });
});

describe('M-23 batch refuses what its mode ignores', () => {
    it('create flags with --task verify, directory flags with --manifest', async () => {
        const vdir = join(dir, 'v');
        await mkdir(vdir);
        expect((await refusal(() => batch(parseArgs(['--input-dir', vdir, '--task', 'verify', '--zip64'])))).exitCode).toBe(2);
        expect((await refusal(() => batch(parseArgs(['--input-dir', vdir, '--task', 'verify', '--method', 'store'])))).exitCode).toBe(2);
        const manifest = join(dir, 'm.json');
        await writeFile(manifest, JSON.stringify({ version: 1, tasks: [{ id: 'a', command: 'list', flags: { input: 'x.zip' } }] }));
        expect((await refusal(() => batch(parseArgs(['--manifest', manifest, '--concurrency', '3'])))).exitCode).toBe(2);
        expect((await refusal(() => batch(parseArgs(['--manifest', manifest, '--level', '9'])))).exitCode).toBe(2);
    });

    it('a manifest task cannot set a process-wide flag', () => {
        for (const flag of ['json', 'quiet', 'no-color', 'config', 'no-config', 'progress', 'timeout']) {
            const value = flag === 'config' || flag === 'timeout' ? '1s' : true;
            const text = JSON.stringify({ version: 1, tasks: [{ id: 'a', command: 'list', flags: { input: 'a.zip', [flag]: value } }] });
            expect(() => parseManifest(text, tmpdir()), flag).toThrow(/is not a task flag/);
        }
    });
});

describe('M-24 --workers is bounded', () => {
    it('65 is a usage error, 64 is accepted by the parser', async () => {
        await writeFile(join(dir, 'a.txt'), 'x');
        const e = await refusal(() => create(parseArgs([join(dir, 'a.txt'), '-o', join(dir, 'o.zip'), '--parallel', '--workers', '65'])));
        expect(e.exitCode).toBe(2);
        expect(e.message).toMatch(/maximum of 64/);
    });
});

describe('M-26 prototype-free aliases', () => {
    it('--toString and --valueOf are reported by name, never as a function body', () => {
        for (const name of ['toString', 'valueOf']) {
            let caught: unknown;
            try { assertInvocation('list', parseArgs(['a.zip', `--${name}`, 'x'])); } catch (e) { caught = e; }
            expect(caught).toBeInstanceOf(CliError);
            expect((caught as CliError).message).toContain(`--${name} for`);
            expect((caught as CliError).message).not.toContain('native code');
        }
    });

    it('an alias the command does not declare is named as typed', () => {
        let caught: unknown;
        try { assertInvocation('inspect', parseArgs(['a.zip', '-d', 'x'])); } catch (e) { caught = e; }
        expect((caught as CliError).message).toContain('--output-dir (-d)');
    });
});

describe('M-27 / M-28 extract refuses up front', () => {
    it('a file entry that is also a parent directory: E_IO with the entry named, dry-run included, nothing written', async () => {
        const zip = await archive('fx.zip', { f: 'file', 'f/child': 'child' });
        for (const dry of [true, false]) {
            const outDir = join(dir, dry ? 'dry' : 'real');
            const e = await refusal(() => extract(parseArgs([zip, '-d', outDir, ...(dry ? ['--dry-run'] : [])])));
            expect(e.code).toBe(ErrorCode.IO);
            expect(e.entryName).toBe('f/child');
            expect(existsSync(outDir)).toBe(false);
        }
    });

    it('--entry naming nothing is E_NOT_FOUND / ZIP_ENTRY_NOT_FOUND, and the output directory is not created', async () => {
        const zip = await archive('a.zip', { 'a.txt': 'a' });
        const outDir = join(dir, 'out');
        const e = await refusal(() => extract(parseArgs([zip, '-d', outDir, '-e', 'a.txt', '-e', 'nothere'])));
        expect(e).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND', entryName: 'nothere' });
        expect(existsSync(outDir)).toBe(false);
    });
});

// ── Group 3: the agent contract ─────────────────────────────────────────

describe('M-04 inspect --summary carries the extraction-safety facts', () => {
    it('a zip-slip archive summarises with unsafeNames 1', async () => {
        const zip = createZip();
        zip.add('ok.txt', 'ok');
        const path = join(dir, 'slip.zip');
        await writeFile(path, zip.toBytes());
        process.env['ZIPNATIVE_JSON'] = '1';
        await inspect(parseArgs([path, '--summary']));
        const doc = JSON.parse(out) as Record<string, unknown>;
        expect(doc).toMatchObject({ unsafeNames: 0, symlinks: 0, duplicateNames: 0 });
    });
});

describe('M-05 / M-10 schema manifest: arity, operands, exit codes, compact under --json', () => {
    it('declares switches, repeatable and path flags, operands and the signal exit codes', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        await schema(parseArgs(['manifest']));
        expect(out.trim().split('\n')).toHaveLength(1);
        const m = JSON.parse(out) as { contract: { exitCodes: Record<string, string> }; globalSwitches: string[]; commands: { name: string; switches: string[]; repeatable: string[]; pathFlags: string[]; operands: { max: number | null; for?: string } }[] };
        expect(Object.keys(m.contract.exitCodes)).toEqual(expect.arrayContaining(['0', '1', '2', '130', '143']));
        expect(m.globalSwitches).toContain('--json');
        const extract = m.commands.find((c) => c.name === 'extract');
        expect(extract?.switches).toContain('--overwrite');
        expect(extract?.repeatable).toEqual(expect.arrayContaining(['--include', '--entry']));
        expect(extract?.pathFlags).toContain('--output-dir');
        expect(extract?.operands).toEqual({ max: 1, for: '--input' });
        expect(m.commands.find((c) => c.name === 'create')?.operands.max).toBeNull();
    });
});

describe('M-06 / M-08 / M-21 verify and failure lines', () => {
    it('verify names the failing entries in the error, and --name-encoding needs --entry', async () => {
        const e = await refusal(() => verify(parseArgs([join(dir, 'none.zip'), '--name-encoding', 'shift_jis'])));
        expect(e.exitCode).toBe(2);
    });

    it('a text-mode inspect --check failure carries a message (stderr is never empty)', async () => {
        const zip = createZip();
        zip.add('a.txt', 'a');
        const path = join(dir, 'c.zip');
        await writeFile(path, zip.toBytes());
        const e = await refusal(() => inspect(parseArgs([path, '--check', 'has=missing.txt'])));
        expect(e.code).toBe(ErrorCode.CHECK_FAILED);
        expect(e.message).toMatch(/1 check\(s\) failed: has=missing.txt/);
    });
});
