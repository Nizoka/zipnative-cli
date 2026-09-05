import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, applyConfigDefaults, KNOWN_COMMANDS } from '../../src/utils/config.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError } from '../../src/utils/error.js';

const RC = '.zipnativerc.json';
let dir = '';

async function writeRc(content: unknown, at: string = dir): Promise<string> {
    const file = join(at, RC);
    await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
}

function expectUsage(fn: () => unknown, pattern?: RegExp): void {
    let caught: unknown;
    try {
        fn();
    } catch (e) {
        caught = e;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect(caught).toMatchObject({ exitCode: 2, code: 'E_USAGE' });
    if (pattern !== undefined) expect((caught as CliError).message).toMatch(pattern);
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('KNOWN_COMMANDS', () => {
    it('lists all 15 commands', () => {
        expect(KNOWN_COMMANDS).toHaveLength(15);
        expect([...KNOWN_COMMANDS].sort()).toEqual([
            'batch', 'cat', 'completion', 'crc32', 'create', 'doctor', 'extract', 'govern', 'inflate',
            'inspect', 'list', 'modify', 'schema', 'stream', 'verify',
        ]);
    });
});

describe('loadConfig', () => {
    it('returns an empty object when no config file is found', async () => {
        // Discovery walks up; an isolated temp dir under the OS tmpdir has no rc.
        expect(loadConfig('list', undefined, dir)).toEqual({});
    });

    it('reads global flag defaults', async () => {
        await writeRc({ 'no-color': true, 'max-entries': '10' });
        expect(loadConfig('list', undefined, dir)).toEqual({ 'no-color': true, 'max-entries': '10' });
    });

    it('selects the matching command section and ignores other commands', async () => {
        await writeRc({
            create: { deterministic: true, level: 9 },
            extract: { overwrite: true },
        });
        expect(loadConfig('create', undefined, dir)).toEqual({ deterministic: true, level: '9' });
        expect(loadConfig('extract', undefined, dir)).toEqual({ overwrite: true });
        expect(loadConfig('list', undefined, dir)).toEqual({});
    });

    it('lets command-scoped values win over global ones', async () => {
        await writeRc({ 'max-total-size': '32g', extract: { 'max-total-size': '1g' } });
        expect(loadConfig('extract', undefined, dir)).toEqual({ 'max-total-size': '1g' });
        expect(loadConfig('list', undefined, dir)).toEqual({ 'max-total-size': '32g' });
    });

    it('coerces numbers to strings and arrays element-wise', async () => {
        await writeRc({ level: 6, include: ['*.txt', 7] });
        expect(loadConfig('create', undefined, dir)).toEqual({ level: '6', include: ['*.txt', '7'] });
    });

    it('drops values of unsupported types (null, nested objects under non-commands)', async () => {
        await writeRc({ weird: null, nested: { a: 1 }, ok: 'yes' });
        expect(loadConfig('list', undefined, dir)).toEqual({ ok: 'yes' });
    });

    it('treats a command key whose value is not an object as a plain global flag', async () => {
        await writeRc({ list: 'not-a-section', verify: ['x'] });
        expect(loadConfig('list', undefined, dir)).toEqual({ list: 'not-a-section', verify: ['x'] });
    });

    it('discovers a config file in a parent directory (upward walk)', async () => {
        await writeRc({ quiet: true });
        const child = join(dir, 'a', 'b', 'c');
        await mkdir(child, { recursive: true });
        expect(loadConfig('inspect', undefined, child)).toEqual({ quiet: true });
    });

    it('prefers the nearest config file', async () => {
        await writeRc({ level: 1 });
        const child = join(dir, 'sub');
        await mkdir(child);
        await writeRc({ level: 9 }, child);
        expect(loadConfig('create', undefined, child)).toEqual({ level: '9' });
    });

    it('throws exit 2 for an explicit --config that does not exist', () => {
        expectUsage(() => loadConfig('list', join(dir, 'no-such-file.json')), /Config file not found/);
    });

    it('reads an explicit --config path and skips discovery', async () => {
        await writeRc({ quiet: true });
        const custom = join(dir, 'custom.json');
        await writeFile(custom, JSON.stringify({ verify: { 'max-entries': '5' } }));
        expect(loadConfig('verify', custom, dir)).toEqual({ 'max-entries': '5' });
    });

    it('throws exit 2 for invalid JSON', async () => {
        await writeRc('{not valid');
        expectUsage(() => loadConfig('list', undefined, dir), /invalid JSON/);
    });

    it('throws exit 2 when the top level is not an object', async () => {
        await writeRc([1, 2, 3]);
        expectUsage(() => loadConfig('list', undefined, dir), /must contain a JSON object/);
        await writeRc('null');
        expectUsage(() => loadConfig('list', undefined, dir), /must contain a JSON object/);
        await writeRc('"str"');
        expectUsage(() => loadConfig('list', undefined, dir), /must contain a JSON object/);
    });

    it('throws exit 2 when the file exceeds the 1 MB limit', async () => {
        const padding = 'x'.repeat(1024 * 1024);
        await writeRc(`{"pad":"${padding}"}`);
        expectUsage(() => loadConfig('list', undefined, dir), /exceeds the 1 MB limit/);
    });

    describe('security: the codec key is only accepted on the command line', () => {
        it('refuses a top-level codec key', async () => {
            await writeRc({ codec: './evil.mjs' });
            expectUsage(() => loadConfig('list', undefined, dir), /"codec".*only accepted on the command line/);
        });

        it('refuses codec inside the section of the command being run', async () => {
            await writeRc({ extract: { codec: './evil.mjs' } });
            expectUsage(() => loadConfig('extract', undefined, dir), /"codec".*only accepted on the command line/);
        });

        it('refuses codec inside the section of ANY command, even one not being run', async () => {
            await writeRc({ extract: { codec: './evil.mjs' } });
            expectUsage(() => loadConfig('list', undefined, dir), /"codec"/);
        });

        it('refuses codec regardless of value type', async () => {
            await writeRc({ codec: true });
            expectUsage(() => loadConfig('list', undefined, dir), /"codec"/);
            await writeRc({ create: { codec: ['a.mjs'] } });
            expectUsage(() => loadConfig('create', undefined, dir), /"codec"/);
        });

        it('names the offending file in the message', async () => {
            const file = await writeRc({ codec: 'x' });
            expectUsage(() => loadConfig('list', undefined, dir), new RegExp(file.replace(/[\\.]/g, '\\$&')));
        });
    });
});

describe('applyConfigDefaults', () => {
    it('fills only flags absent from the CLI args', () => {
        const args = parseArgs(['--level', '1']);
        const merged = applyConfigDefaults(args, { level: '9', deterministic: true });
        expect(merged.flags['level']).toBe('1'); // CLI wins
        expect(merged.flags['deterministic']).toBe(true); // filled from config
    });

    it('never overwrites a user-provided boolean flag', () => {
        const args = parseArgs(['--deterministic']);
        const merged = applyConfigDefaults(args, { deterministic: false });
        expect(merged.flags['deterministic']).toBe(true);
    });

    it('never overwrites a repeated (array) flag', () => {
        const args = parseArgs(['--include', 'a', '--include', 'b']);
        const merged = applyConfigDefaults(args, { include: ['z'] });
        expect(merged.flags['include']).toEqual(['a', 'b']);
    });

    it('preserves positionals and returns a new object', () => {
        const args = parseArgs(['archive.zip']);
        const merged = applyConfigDefaults(args, { quiet: true });
        expect(merged).not.toBe(args);
        expect(merged.positionals).toEqual(['archive.zip']);
        expect(merged.flags['quiet']).toBe(true);
        expect(args.flags).toEqual({});
    });

    it('is a no-op for empty defaults', () => {
        const args = parseArgs(['--a', '1']);
        expect(applyConfigDefaults(args, {}).flags).toEqual({ a: '1' });
    });
});
