// 1.1.0 runtime hardening (parity with pkinative-cli and the engine's 1.1
// hardening), each item against the adversarial shape it closes:
//
//   • writes — an existing path (a dangling symlink included) is refused
//     without --overwrite; with it the bytes go to a temp sibling renamed
//     over the target, so a planted symlink is REPLACED, never followed, and
//     a failed write leaves the original intact; a write layer never removes
//     a file it did not create (the 1.0 race: an engine error before the
//     deferred open made `cat`/`inflate`/`create` unlink a pre-existing file);
//   • reads — a directory is E_IO; a non-regular file is byte-counted
//     (the /dev/zero case is in built-binary-smoke.test.ts);
//   • text output — archive names with terminal escapes / bidi controls are
//     made visible in text mode and kept exact in JSON;
//   • batch manifests — the argv invocation contract, checked for every task
//     before the first one runs.
//
// Hostile archives come from the raw builder (never a committed fixture).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { lstat, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batch } from '../../src/commands/batch.js';
import { cat } from '../../src/commands/cat.js';
import { create } from '../../src/commands/create.js';
import { extract } from '../../src/commands/extract.js';
import { list, type ListReport } from '../../src/commands/list.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { readFileOrStdin, writeOutput } from '../../src/utils/io.js';
import { escapeTerminal, hasTerminalControls } from '../../src/utils/sanitize.js';
import { buildRawZip } from '../helpers/raw-zip-builder.js';

interface Run {
    readonly text: string;
    readonly err: string;
    readonly error: unknown;
}

async function run(fn: () => Promise<void>): Promise<Run> {
    const out: Buffer[] = [];
    const errs: string[] = [];
    const o = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        out.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
        const cb = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
        if (cb !== undefined) cb();
        return true;
    }) as unknown as typeof process.stdout.write);
    const e = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        errs.push(String(chunk));
        return true;
    }) as unknown as typeof process.stderr.write);
    let error: unknown;
    try {
        await fn();
    } catch (x) {
        error = x;
    } finally {
        o.mockRestore();
        e.mockRestore();
    }
    return { text: Buffer.concat(out).toString('utf8'), err: errs.join(''), error };
}

const enc = new TextEncoder();
let dir = '';

/** Symlinks need a privilege (or developer mode) on Windows: probe once. */
async function canSymlink(): Promise<boolean> {
    const probe = join(dir, 'probe-link');
    try {
        await symlink(join(dir, 'nowhere'), probe);
        await rm(probe, { force: true });
        return true;
    } catch {
        return false;
    }
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-hard-'));
});

afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env['ZIPNATIVE_JSON'];
    await rm(dir, { recursive: true, force: true });
});

describe('writes: exclusive by default, temp + rename under --overwrite', () => {
    it('--overwrite REPLACES a symlink planted at the target instead of writing through it', async () => {
        if (!(await canSymlink())) return;
        const victim = join(dir, 'victim.txt');
        await writeFile(victim, 'precious');
        const target = join(dir, 'out.zip');
        await symlink(victim, target);
        const src = join(dir, 'a.txt');
        await writeFile(src, 'payload');
        const r = await run(() => create(parseArgs([src, '-o', target, '--overwrite'])));
        expect(r.error).toBeUndefined();
        expect(await readFile(victim, 'utf8')).toBe('precious');
        expect((await lstat(target)).isSymbolicLink()).toBe(false);
        expect((await readFile(target)).subarray(0, 2).toString()).toBe('PK');
    });

    it('a dangling symlink at the target is an existing path: refused without --overwrite, nothing created at its target', async () => {
        if (!(await canSymlink())) return;
        const pointee = join(dir, 'would-be-created.zip');
        const target = join(dir, 'dangling.zip');
        await symlink(pointee, target);
        const src = join(dir, 'a.txt');
        await writeFile(src, 'x');
        const r = await run(() => create(parseArgs([src, '-o', target])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO, remedy: '--overwrite' });
        await expect(lstat(pointee)).rejects.toThrow();
        expect(await readlink(target)).toBe(pointee);
    });

    it('extract --overwrite replaces a planted file-level symlink inside the destination, never follows it', async () => {
        if (!(await canSymlink())) return;
        const victim = join(dir, 'victim.txt');
        await writeFile(victim, 'precious');
        const out = join(dir, 'out');
        const zip = join(dir, 'a.zip');
        await writeFile(zip, buildRawZip([{ name: 'a.txt', data: enc.encode('from the archive') }]));
        // First extraction creates out/, then a link is planted at out/a.txt.
        expect((await run(() => extract(parseArgs(['--input', zip, '-d', out])))).error).toBeUndefined();
        await rm(join(out, 'a.txt'));
        await symlink(victim, join(out, 'a.txt'));
        const refused = await run(() => extract(parseArgs(['--input', zip, '-d', out])));
        expect(refused.error).toMatchObject({ code: ErrorCode.IO });
        const r = await run(() => extract(parseArgs(['--input', zip, '-d', out, '--overwrite'])));
        expect(r.error).toBeUndefined();
        expect(await readFile(victim, 'utf8')).toBe('precious');
        expect((await lstat(join(out, 'a.txt'))).isSymbolicLink()).toBe(false);
        expect(await readFile(join(out, 'a.txt'), 'utf8')).toBe('from the archive');
    });

    it('a failed --overwrite write leaves the original intact (cat of a CRC-corrupt entry)', async () => {
        const zip = join(dir, 'bad.zip');
        await writeFile(zip, buildRawZip([{ name: 'x.txt', data: enc.encode('corrupted content here'), crcOverride: 0x12345678 }]));
        const existing = join(dir, 'existing.txt');
        await writeFile(existing, 'precious original');
        const r = await run(() => cat(parseArgs([zip, 'x.txt', '-o', existing, '--overwrite'])));
        expect(r.error).toMatchObject({ code: ErrorCode.DATA, zipCode: 'ZIP_CRC_MISMATCH' });
        expect(await readFile(existing, 'utf8')).toBe('precious original');
    });

    it('an error before the first byte never removes a pre-existing output (the 1.0 deferred-open race)', async () => {
        // Method 96 has no codec: cat fails on the first pull of the entry.
        const zip = join(dir, 'm96.zip');
        await writeFile(zip, buildRawZip([{ name: 'x.bin', data: enc.encode('opaque'), method: 96 }]));
        const existing = join(dir, 'keep.txt');
        await writeFile(existing, 'precious original');
        const r = await run(() => cat(parseArgs([zip, 'x.bin', '-o', existing])));
        expect(r.error).toBeInstanceOf(CliError);
        expect(await readFile(existing, 'utf8')).toBe('precious original');
    });

    it('writeOutput leaves no temp file behind, and a refused exclusive write does not touch the file', async () => {
        const target = join(dir, 'w.bin');
        await writeOutput(enc.encode('one'), target, { exclusive: true });
        await expect(writeOutput(enc.encode('two'), target, { exclusive: true })).rejects.toMatchObject({ code: ErrorCode.IO });
        expect(await readFile(target, 'utf8')).toBe('one');
        await writeOutput(enc.encode('three'), target, {});
        expect(await readFile(target, 'utf8')).toBe('three');
        const { readdir } = await import('node:fs/promises');
        expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });
});

describe('reads: one descriptor, bounded', () => {
    it('a directory is E_IO, never read', async () => {
        const r = await run(() => list(parseArgs([dir])));
        expect(r.error).toBeInstanceOf(CliError);
        expect((r.error as CliError).code).toBe(ErrorCode.IO);
    });

    it('a regular file is read to its checked size and refused above the bound', async () => {
        const f = join(dir, 'f.bin');
        await writeFile(f, Buffer.alloc(4096, 7));
        expect((await readFileOrStdin(f, 4096)).length).toBe(4096);
        await expect(readFileOrStdin(f, 4095)).rejects.toMatchObject({ code: ErrorCode.LIMIT, detail: { limit: 'maxInputSize', observed: 4096 } });
    });
});

describe('text output: archive names cannot drive the terminal', () => {
    const hostile = 'a\x1b[2J\x1b]0;pwned\x07b\u202etxt.exe';

    it('escapeTerminal makes C0 / C1 / DEL / bidi controls visible and keeps TAB, LF and printable text', () => {
        expect(escapeTerminal(hostile)).toBe('a\\x1b[2J\\x1b]0;pwned\\x07b\\u202etxt.exe');
        expect(escapeTerminal('tab\there\nline é 日本')).toBe('tab\there\nline é 日本');
        expect(escapeTerminal('\x7f\x9b\u2066')).toBe('\\x7f\\x9b\\u2066');
        expect(hasTerminalControls(hostile)).toBe(true);
        expect(hasTerminalControls('plain.txt')).toBe(false);
    });

    it('list prints the escaped name in text mode and the exact name in JSON', async () => {
        const zip = join(dir, 'esc.zip');
        await writeFile(zip, buildRawZip([{ name: hostile, data: enc.encode('x'), flags: 0x0800 }]));
        const text = await run(() => list(parseArgs([zip])));
        expect(text.error).toBeUndefined();
        expect(text.text).not.toContain('\x1b');
        expect(text.text).not.toContain('\u202e');
        expect(text.text).toContain('a\\x1b[2J');
        const json = await run(() => list(parseArgs([zip, '--format', 'json'])));
        expect((JSON.parse(json.text) as ListReport).entries[0]?.name).toBe(hostile);
    });

    it('a text-mode diagnostic or progress line quoting the name is escaped too', async () => {
        const zip = join(dir, 'esc2.zip');
        // A name that sanitizeEntryPath refuses → a skipped-entry warning line.
        await writeFile(zip, buildRawZip([{ name: '../\x1b[1Aevil', data: enc.encode('x') }]));
        const r = await run(() => extract(parseArgs(['--input', zip, '-d', join(dir, 'o'), '--skip-unsafe'])));
        expect(r.error).toBeUndefined();
        expect(r.err).not.toContain('\x1b');
        expect(r.err).toContain('\\x1b[1A');
    });
});

describe('batch manifests honour the invocation contract', () => {
    it('an unknown flag in a later task is refused before ANY task runs', async () => {
        const src = join(dir, 'a.txt');
        await writeFile(src, 'x');
        const first = join(dir, 'first.zip');
        const manifest = join(dir, 'm.json');
        await writeFile(manifest, JSON.stringify({
            version: 1,
            tasks: [
                { id: 'one', command: 'create', flags: { input: src, output: first } },
                { id: 'two', command: 'list', flags: { input: '@one', overwite: true } },
            ],
        }));
        const r = await run(() => batch(parseArgs(['--manifest', manifest])));
        expect(r.error).toMatchObject({ code: ErrorCode.USAGE, exitCode: 2 });
        expect((r.error as CliError).message).toMatch(/Manifest task "two": Unknown flag --overwite/);
        await expect(lstat(first)).rejects.toThrow();
    });

    it('a "__proto__" flag key is refused, never merged into the prototype', async () => {
        const manifest = join(dir, 'p.json');
        await writeFile(manifest, '{"version":1,"tasks":[{"id":"a","command":"list","flags":{"__proto__":{"x":1}}}]}');
        const r = await run(() => batch(parseArgs(['--manifest', manifest])));
        expect(r.error).toMatchObject({ code: ErrorCode.USAGE });
        expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    });
});
