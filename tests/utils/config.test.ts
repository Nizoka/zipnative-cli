import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    CONFIG_KEYS,
    CONFIG_VALUE_KEYS,
    KNOWN_COMMANDS,
    activeConfig,
    applyConfigDefaults,
    loadConfig,
    setActiveConfig,
} from '../../src/utils/config.js';
import { knownFlags } from '../../src/commands/completion.js';
import { parseArgs } from '../../src/utils/args.js';
import { BOOLEAN_FLAGS } from '../../src/utils/flags.js';
import { CliError } from '../../src/utils/error.js';

const RC = '.zipnativerc.json';
let dir = '';

async function writeRc(content: unknown, at: string = dir): Promise<string> {
    const file = join(at, RC);
    await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
}

function expectUsage(fn: () => unknown, pattern?: RegExp): CliError {
    let caught: unknown;
    try {
        fn();
    } catch (e) {
        caught = e;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect(caught).toMatchObject({ exitCode: 2, code: 'E_USAGE' });
    if (pattern !== undefined) expect((caught as CliError).message).toMatch(pattern);
    return caught as CliError;
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
});

afterEach(async () => {
    setActiveConfig(undefined, []);
    await rm(dir, { recursive: true, force: true });
});

describe('KNOWN_COMMANDS and CONFIG_KEYS', () => {
    it('lists all 15 commands', () => {
        expect(KNOWN_COMMANDS).toHaveLength(15);
        expect([...KNOWN_COMMANDS].sort()).toEqual([
            'batch', 'cat', 'completion', 'crc32', 'create', 'doctor', 'extract', 'govern', 'inflate',
            'inspect', 'list', 'modify', 'schema', 'stream', 'verify',
        ]);
    });

    it('CONFIG_KEYS are presentation flags of the surface; the value keys are exactly the non-booleans', () => {
        const all = new Set(KNOWN_COMMANDS.flatMap((c) => [...knownFlags(c)]));
        for (const k of CONFIG_KEYS) {
            expect(all.has(k), k).toBe(true);
            expect(CONFIG_VALUE_KEYS.includes(k), k).toBe(!BOOLEAN_FLAGS.has(k));
        }
        // Nothing that reads, trusts, writes, bounds or runs code.
        for (const forbidden of ['input', 'output', 'output-dir', 'overwrite', 'skip-unsafe', 'skip-unsupported',
            'allow-symlinks', 'codec', 'config', 'max-entries', 'max-input-size', 'name-encoding', 'timeout',
            'in-place', 'follow-symlinks', 'preserve-mode', 'allow-codec-load', 'pure-codecs']) {
            expect(CONFIG_KEYS, forbidden).not.toContain(forbidden);
        }
    });
});

describe('loadConfig', () => {
    it('returns no path and no defaults when no config file is found', () => {
        // Discovery walks up; an isolated temp dir under the OS tmpdir has no rc.
        expect(loadConfig('list', undefined, dir)).toEqual({ defaults: {} });
    });

    it('reads global presentation defaults and names the file', async () => {
        const file = await writeRc({ 'no-color': true, pretty: true, format: 'json' });
        expect(loadConfig('list', undefined, dir)).toEqual({ path: file, defaults: { 'no-color': true, pretty: true, format: 'json' } });
    });

    it('selects the matching command section; a command section wins over the global keys', async () => {
        await writeRc({ format: 'text', list: { format: 'ndjson', long: true }, inspect: { summary: true } });
        expect(loadConfig('list', undefined, dir).defaults).toEqual({ format: 'ndjson', long: true });
        expect(loadConfig('inspect', undefined, dir).defaults).toEqual({ format: 'text', summary: true });
    });

    it('coerces a numeric value key to a string', async () => {
        await writeRc({ fields: 7 });
        expect(loadConfig('list', undefined, dir).defaults).toEqual({ fields: '7' });
    });

    it('refuses — never drops — a value of the wrong type', async () => {
        await writeRc({ pretty: 'yes' });
        expectUsage(() => loadConfig('list', undefined, dir), /"pretty" takes true or false/);
        await writeRc({ format: true });
        expectUsage(() => loadConfig('list', undefined, dir), /"format" takes a string/);
        await writeRc({ list: 'json' });
        expectUsage(() => loadConfig('list', undefined, dir), /section "list" must be an object/);
    });

    it('discovers a config file in a parent directory (upward walk) and prefers the nearest', async () => {
        const child = join(dir, 'a', 'b');
        await mkdir(child, { recursive: true });
        await writeRc({ pretty: true });
        expect(loadConfig('list', undefined, child).defaults).toEqual({ pretty: true });
        await writeRc({ quiet: true }, join(dir, 'a'));
        expect(loadConfig('list', undefined, child).defaults).toEqual({ quiet: true });
    });

    it('a directory named .zipnativerc.json is not a config file', async () => {
        await mkdir(join(dir, RC));
        expect(loadConfig('list', undefined, dir)).toEqual({ defaults: {} });
    });

    it('reads an explicit --config path and skips discovery; a missing one is exit 2', async () => {
        await writeRc({ pretty: true });
        const other = join(dir, 'other.json');
        await writeFile(other, JSON.stringify({ quiet: true }));
        expect(loadConfig('list', other, dir)).toEqual({ path: other, defaults: { quiet: true } });
        expectUsage(() => loadConfig('list', join(dir, 'missing.json'), dir), /not found/);
    });

    it('throws exit 2 on invalid JSON, a non-object, or a file over 1 MiB', async () => {
        await writeRc('{ not json');
        expectUsage(() => loadConfig('list', undefined, dir), /invalid JSON/);
        await writeRc('[1]');
        expectUsage(() => loadConfig('list', undefined, dir), /must contain a JSON object/);
        await writeRc(JSON.stringify({ pretty: true, pad: 'x'.repeat(1024 * 1024) }));
        expectUsage(() => loadConfig('list', undefined, dir), /1 MiB/);
    });
});

describe('loadConfig — security: configuration is presentation only (ADR 0001)', () => {
    it.each([
        ['overwrite', true],
        ['skip-unsafe', true],
        ['allow-symlinks', true],
        ['max-entries', '1000000000'],
        ['max-input-size', '1t'],
        ['codec', './evil.mjs'],
        ['output-dir', '/'],
        ['timeout', '1ms'],
        ['name-encoding', 'shift_jis'],
    ])('refuses "%s" globally and inside any command section, naming the file', async (key, value) => {
        const file = await writeRc({ [key]: value });
        const e = expectUsage(() => loadConfig('list', undefined, dir), new RegExp(`sets "${key}"`));
        expect(e.message).toContain(file);
        expect(e.remedy).toContain('--no-config');
        // Even in the section of ANOTHER command: the whole file is validated.
        await writeRc({ extract: { [key]: value } });
        expectUsage(() => loadConfig('list', undefined, dir), new RegExp(`sets "${key}"`));
    });

    it('refuses EVERY flag of the surface that is not a presentation key (derived from the registry, so a new flag is covered unnamed)', async () => {
        const all = new Set(KNOWN_COMMANDS.flatMap((c) => [...knownFlags(c)]));
        for (const flag of all) {
            if (CONFIG_KEYS.includes(flag)) continue;
            await writeRc({ [flag]: BOOLEAN_FLAGS.has(flag) ? true : 'x' });
            // A flag that is also a command name (stream, list, cat) reads as a section: refused too.
            expectUsage(() => loadConfig('list', undefined, dir), KNOWN_COMMANDS.includes(flag) ? /must be an object/ : new RegExp(`sets "${flag}"`));
        }
    });

    it('refuses the prototype keys', async () => {
        await writeRc('{"__proto__": {"overwrite": true}}');
        expectUsage(() => loadConfig('list', undefined, dir), /forbidden key "__proto__"/);
        await writeRc({ list: { constructor: true } });
        expectUsage(() => loadConfig('list', undefined, dir), /forbidden key "constructor"/);
    });

    it('never echoes a refused value', async () => {
        await writeRc({ codec: '/home/user/secret-token-path.mjs' });
        const e = expectUsage(() => loadConfig('list', undefined, dir));
        expect(e.message).not.toContain('secret-token-path');
    });
});

describe('applyConfigDefaults', () => {
    const known = knownFlags('list');

    it('fills only flags absent from the CLI args, and reports what it applied', () => {
        const args = parseArgs(['--format', 'text', 'a.zip']);
        const { args: merged, applied } = applyConfigDefaults(args, { format: 'json', long: true }, known);
        expect(merged.flags['format']).toBe('text');
        expect(merged.flags['long']).toBe(true);
        expect(merged.positionals).toEqual(['a.zip']);
        expect(applied).toEqual(['long']);
        expect(merged).not.toBe(args);
    });

    it('never overwrites a user-provided boolean flag or a repeated flag', () => {
        const args = parseArgs(['--long=false', '--include', 'a', '--include', 'b']);
        const { args: merged, applied } = applyConfigDefaults(args, { long: true }, known);
        expect(merged.flags['long']).toBe('false');
        expect(merged.flags['include']).toEqual(['a', 'b']);
        expect(applied).toEqual([]);
    });

    it('ignores a key the command does not declare (a list default never breaks doctor)', () => {
        const { args: merged, applied } = applyConfigDefaults(parseArgs([]), { long: true, summary: true }, knownFlags('doctor'));
        expect(merged.flags['long']).toBeUndefined();
        expect(applied).toEqual([]);
    });

    it('is a no-op for empty defaults; the merged record has no prototype', () => {
        const { args: merged, applied } = applyConfigDefaults(parseArgs(['x']), {}, known);
        expect(merged.positionals).toEqual(['x']);
        expect(applied).toEqual([]);
        expect(Object.getPrototypeOf(merged.flags)).toBeNull();
    });
});

describe('activeConfig', () => {
    it('is set only when a file supplied at least one default', () => {
        setActiveConfig('/x/.zipnativerc.json', []);
        expect(activeConfig()).toBeNull();
        setActiveConfig('/x/.zipnativerc.json', ['pretty']);
        expect(activeConfig()).toEqual({ path: '/x/.zipnativerc.json', applied: ['pretty'] });
        setActiveConfig(undefined, ['pretty']);
        expect(activeConfig()).toBeNull();
    });
});
