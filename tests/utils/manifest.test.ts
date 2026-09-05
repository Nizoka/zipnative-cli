import { describe, it, expect } from 'vitest';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseManifest, assertCodecPolicy, MANIFEST_COMMANDS, type ManifestPlan } from '../../src/utils/manifest.js';
import { CliError } from '../../src/utils/error.js';

const DIR = resolve(process.cwd(), 'tests', 'fixtures', 'manifest-dir');

function manifest(tasks: readonly unknown[], version: unknown = 1): string {
    return JSON.stringify({ version, tasks });
}

function caught(fn: () => unknown): CliError {
    try {
        fn();
    } catch (e) {
        if (e instanceof CliError) return e;
        throw e;
    }
    throw new Error('expected a CliError');
}

function expectUsage(fn: () => unknown, pattern?: RegExp): void {
    const e = caught(fn);
    expect(e).toMatchObject({ exitCode: 2, code: 'E_USAGE' });
    if (pattern !== undefined) expect(e.message).toMatch(pattern);
}

function expectInput(fn: () => unknown, pattern?: RegExp): void {
    const e = caught(fn);
    expect(e).toMatchObject({ exitCode: 1, code: 'E_INPUT' });
    if (pattern !== undefined) expect(e.message).toMatch(pattern);
}

describe('MANIFEST_COMMANDS', () => {
    it('whitelists exactly the ten archive commands', () => {
        expect([...MANIFEST_COMMANDS].sort()).toEqual([
            'cat', 'crc32', 'create', 'extract', 'inflate', 'inspect', 'list', 'modify', 'stream', 'verify',
        ]);
    });
});

describe('parseManifest — valid pipelines', () => {
    it('parses a pipeline and resolves relative paths against the manifest directory', () => {
        const plan = parseManifest(
            manifest([
                { id: 'build', command: 'create', flags: { output: 'out/site.zip', input: 'src', level: 9, deterministic: true } },
                { id: 'check', command: 'verify', flags: { input: '@build' } },
                { id: 'unpack', command: 'extract', flags: { input: '@build', 'output-dir': 'unpacked' } },
                { id: 'peek', command: 'list', flags: { input: '@unpack' } },
            ]),
            DIR,
        );
        expect(plan.tasks.map((t) => t.id)).toEqual(['build', 'check', 'unpack', 'peek']);

        const build = plan.tasks[0] as ManifestPlan['tasks'][number];
        expect(build.command).toBe('create');
        expect(build.flags).toEqual({
            output: resolve(DIR, 'out/site.zip'),
            input: resolve(DIR, 'src'),
            level: '9',
            deterministic: true,
        });
        expect(build.output).toBe(resolve(DIR, 'out/site.zip'));
        expect(build.outputDir).toBe(dirname(resolve(DIR, 'out/site.zip')));
        expect(build.dependsOn).toEqual([]);
        expect(build.loadsCodec).toBe(false);

        const check = plan.tasks[1] as ManifestPlan['tasks'][number];
        expect(check.flags['input']).toBe(build.output);
        expect(check.dependsOn).toEqual(['build']);
        expect(check.output).toBeUndefined();
        expect(check.outputDir).toBeUndefined();

        const unpack = plan.tasks[2] as ManifestPlan['tasks'][number];
        expect(unpack.outputDir).toBe(resolve(DIR, 'unpacked'));
        expect(unpack.output).toBeUndefined();

        const peek = plan.tasks[3] as ManifestPlan['tasks'][number];
        expect(peek.flags['input']).toBe(resolve(DIR, 'unpacked')); // @unpack → its output-dir
        expect(peek.dependsOn).toEqual(['unpack']);
    });

    it('resolves the short aliases -o / -d / -i and other path flags', () => {
        const plan = parseManifest(
            manifest([
                { id: 'a', command: 'create', flags: { o: 'a.zip', base: 'src', 'from-manifest': 'files.json' } },
                { id: 'b', command: 'extract', flags: { i: '@a', d: 'out' } },
            ]),
            DIR,
        );
        const a = plan.tasks[0] as ManifestPlan['tasks'][number];
        expect(a.output).toBe(resolve(DIR, 'a.zip'));
        expect(a.flags['base']).toBe(resolve(DIR, 'src'));
        expect(a.flags['from-manifest']).toBe(resolve(DIR, 'files.json'));
        const b = plan.tasks[1] as ManifestPlan['tasks'][number];
        expect(b.flags['i']).toBe(a.output);
        expect(b.outputDir).toBe(resolve(DIR, 'out'));
    });

    it('leaves absolute paths, "-" and non-path flags untouched', () => {
        const abs = resolve(DIR, 'elsewhere', 'x.zip');
        const plan = parseManifest(
            manifest([{ id: 'a', command: 'cat', flags: { input: abs, output: '-', entry: 'dir/file.txt', include: 'sub/*' } }]),
            DIR,
        );
        const a = plan.tasks[0] as ManifestPlan['tasks'][number];
        expect(a.flags['input']).toBe(abs);
        expect(a.flags['output']).toBe('-');
        expect(a.output).toBeUndefined();
        expect(a.flags['entry']).toBe('dir/file.txt');
        expect(a.flags['include']).toBe('sub/*');
    });

    it('resolves only the path half of add / replace name=path values', () => {
        const plan = parseManifest(
            manifest([
                { id: 'src', command: 'create', flags: { output: 'src.zip' } },
                {
                    id: 'm',
                    command: 'modify',
                    flags: { input: '@src', add: 'docs/readme.md=README.md', replace: ['a.txt=new/a.txt', 'bare.txt', 'stdin.bin=-', 'ref.zip=@src'] },
                },
            ]),
            DIR,
        );
        const m = plan.tasks[1] as ManifestPlan['tasks'][number];
        expect(m.flags['add']).toBe(`docs/readme.md=${resolve(DIR, 'README.md')}`);
        expect(m.flags['replace']).toEqual([
            `a.txt=${resolve(DIR, 'new/a.txt')}`,
            resolve(DIR, 'bare.txt'),
            'stdin.bin=-',
            `ref.zip=${resolve(DIR, 'src.zip')}`,
        ]);
        expect(m.dependsOn).toEqual(['src']);
    });

    it('maps flag value types: string, number, boolean (false omitted), string[]', () => {
        const plan = parseManifest(
            manifest([{ id: 'a', command: 'list', flags: { input: 'a.zip', long: true, quiet: false, workers: 4, ratio: 1.5, include: ['*.txt', 'b/*'] } }]),
            DIR,
        );
        const a = plan.tasks[0] as ManifestPlan['tasks'][number];
        expect(a.flags).toEqual({
            input: resolve(DIR, 'a.zip'),
            long: true,
            workers: '4',
            ratio: '1.5',
            include: ['*.txt', 'b/*'],
        });
        expect('quiet' in a.flags).toBe(false);
    });

    it('accepts a task without flags', () => {
        const plan = parseManifest(manifest([{ id: 'a', command: 'list' }]), DIR);
        expect(plan.tasks[0]?.flags).toEqual({});
    });

    it('marks tasks carrying a codec flag', () => {
        const plan = parseManifest(manifest([{ id: 'a', command: 'list', flags: { codec: './c.mjs' } }]), DIR);
        expect(plan.tasks[0]?.loadsCodec).toBe(true);
    });

    it('accepts exactly 1000 tasks', () => {
        const tasks = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}`, command: 'list' }));
        expect(parseManifest(manifest(tasks), DIR).tasks).toHaveLength(1000);
    });

    it('produces absolute paths for every resolved path flag', () => {
        const plan = parseManifest(manifest([{ id: 'a', command: 'create', flags: { output: 'rel/out.zip', input: ['x', 'y/z'] } }]), DIR);
        const a = plan.tasks[0] as ManifestPlan['tasks'][number];
        expect(isAbsolute(a.flags['output'] as string)).toBe(true);
        for (const p of a.flags['input'] as readonly string[]) expect(isAbsolute(p)).toBe(true);
    });
});

describe('parseManifest — structural violations (exit 2, E_USAGE)', () => {
    it('rejects invalid JSON with E_PARSE', () => {
        const e = caught(() => parseManifest('{nope', DIR));
        expect(e).toMatchObject({ exitCode: 1, code: 'E_PARSE' });
        expect(e.message).toMatch(/Manifest is not valid JSON/);
    });

    it('rejects a non-object document', () => {
        expectUsage(() => parseManifest('[]', DIR), /must be a JSON object/);
        expectUsage(() => parseManifest('null', DIR), /must be a JSON object/);
        expectUsage(() => parseManifest('"x"', DIR), /must be a JSON object/);
    });

    it('rejects a missing or unsupported version', () => {
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list' }], 2), DIR), /Unsupported manifest "version": 2/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list' }], '1'), DIR), /Unsupported manifest "version": "1"/);
        expectUsage(() => parseManifest(JSON.stringify({ tasks: [] }), DIR), /Unsupported manifest "version": undefined/);
    });

    it('rejects a missing, empty or non-array tasks list', () => {
        expectUsage(() => parseManifest(manifest([]), DIR), /"tasks" must be a non-empty array/);
        expectUsage(() => parseManifest(JSON.stringify({ version: 1 }), DIR), /"tasks" must be a non-empty array/);
        expectUsage(() => parseManifest(JSON.stringify({ version: 1, tasks: {} }), DIR), /"tasks" must be a non-empty array/);
    });

    it('rejects more than 1000 tasks', () => {
        const tasks = Array.from({ length: 1001 }, (_, i) => ({ id: `t${i}`, command: 'list' }));
        expectUsage(() => parseManifest(manifest(tasks), DIR), /declares 1001 tasks — the maximum is 1000/);
    });

    it('rejects a non-object task', () => {
        expectUsage(() => parseManifest(manifest(['list']), DIR), /task #1 must be an object/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list' }, null]), DIR), /task #2 must be an object/);
    });

    it('rejects a missing / non-string / empty id', () => {
        expectUsage(() => parseManifest(manifest([{ command: 'list' }]), DIR), /task #1: "id" must be a non-empty string/);
        expectUsage(() => parseManifest(manifest([{ id: '', command: 'list' }]), DIR), /"id" must be a non-empty string/);
        expectUsage(() => parseManifest(manifest([{ id: 7, command: 'list' }]), DIR), /"id" must be a non-empty string/);
    });

    it('rejects a missing / empty command', () => {
        expectUsage(() => parseManifest(manifest([{ id: 'a' }]), DIR), /task "a": "command" must be a non-empty string/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: '' }]), DIR), /"command" must be a non-empty string/);
    });

    it('rejects non-object flags', () => {
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: ['x'] }]), DIR), /"flags" must be an object/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: 'x' }]), DIR), /"flags" must be an object/);
    });

    it('rejects invalid flag names', () => {
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { '--input': 'x' } }]), DIR), /invalid flag name "--input"/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { 'in put': 'x' } }]), DIR), /invalid flag name/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { 'a=b': 'x' } }]), DIR), /invalid flag name/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { '': 'x' } }]), DIR), /invalid flag name ""/);
    });

    it('rejects unsupported flag value types', () => {
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { x: null } }]), DIR), /unsupported value type/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { x: { nested: 1 } } }]), DIR), /unsupported value type/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { x: [1, 2] } }]), DIR), /must be an array of strings/);
        expectUsage(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { x: ['ok', null] } }]), DIR), /must be an array of strings/);
    });

    it('rejects a non-finite number (via JSON it cannot occur, but the guard is unreachable only if JSON refuses)', () => {
        // JSON.parse never yields Infinity/NaN; documented guard stays for callers feeding parsed objects.
        expect(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { x: Number.POSITIVE_INFINITY } }]), DIR)).toThrow(CliError);
    });
});

describe('parseManifest — value violations (exit 1, E_INPUT)', () => {
    it('rejects a forbidden meta/orchestration command, naming it', () => {
        for (const cmd of ['batch', 'govern', 'schema', 'completion', 'doctor']) {
            expectInput(
                () => parseManifest(manifest([{ id: 'a', command: cmd }]), DIR),
                new RegExp(`"${cmd}" is a meta/orchestration command and is never allowed in a manifest`),
            );
        }
    });

    it('rejects an unknown command and lists the allowed ones', () => {
        expectInput(() => parseManifest(manifest([{ id: 'a', command: 'rm-rf' }]), DIR), /"rm-rf" is not a whitelisted manifest command\. Allowed: create, list/);
    });

    it('rejects an id with disallowed characters', () => {
        expectInput(() => parseManifest(manifest([{ id: 'a b', command: 'list' }]), DIR), /invalid id — allowed characters/);
        expectInput(() => parseManifest(manifest([{ id: '@ref', command: 'list' }]), DIR), /invalid id/);
        expectInput(() => parseManifest(manifest([{ id: 'a/b', command: 'list' }]), DIR), /invalid id/);
    });

    it('rejects a duplicate id', () => {
        expectInput(
            () => parseManifest(manifest([{ id: 'a', command: 'list' }, { id: 'a', command: 'verify' }]), DIR),
            /id "a" is duplicated/,
        );
    });

    it('rejects a forward reference', () => {
        expectInput(
            () => parseManifest(manifest([{ id: 'a', command: 'verify', flags: { input: '@b' } }, { id: 'b', command: 'create', flags: { output: 'x.zip' } }]), DIR),
            /flag "input" references "@b", which is not an EARLIER task/,
        );
    });

    it('rejects an unknown reference', () => {
        expectInput(() => parseManifest(manifest([{ id: 'a', command: 'verify', flags: { input: '@nope' } }]), DIR), /references "@nope"/);
    });

    it('rejects a reference to a task without output / output-dir', () => {
        expectInput(
            () => parseManifest(manifest([{ id: 'a', command: 'list', flags: { input: 'x.zip' } }, { id: 'b', command: 'verify', flags: { input: '@a' } }]), DIR),
            /references "@a", but task "a" declares no "output" or "output-dir" flag/,
        );
    });

    it('treats output "-" (stdout) as no referenceable output', () => {
        expectInput(
            () => parseManifest(manifest([{ id: 'a', command: 'create', flags: { output: '-' } }, { id: 'b', command: 'verify', flags: { input: '@a' } }]), DIR),
            /declares no "output" or "output-dir"/,
        );
    });

    it('rejects references inside arrays and name=path values the same way', () => {
        expectInput(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { input: ['@x'] } }]), DIR), /references "@x"/);
        expectInput(() => parseManifest(manifest([{ id: 'a', command: 'modify', flags: { add: 'n=@x' } }]), DIR), /references "@x"/);
    });

    it('applies the CLI traversal check to relative path flags', () => {
        expectInput(() => parseManifest(manifest([{ id: 'a', command: 'list', flags: { input: '../escape.zip' } }]), DIR), /Path traversal/);
        expectInput(() => parseManifest(manifest([{ id: 'a', command: 'modify', flags: { add: 'n=../x' } }]), DIR), /Path traversal/);
    });
});

describe('assertCodecPolicy', () => {
    const withCodec = parseManifest(manifest([{ id: 'ok', command: 'list' }, { id: 'c', command: 'list', flags: { codec: './c.mjs' } }]), DIR);
    const without = parseManifest(manifest([{ id: 'ok', command: 'list' }]), DIR);

    it('refuses a codec flag unless --allow-codec-load was given', () => {
        expectUsage(() => assertCodecPolicy(withCodec, false), /Manifest task "c" carries a "codec" flag.*without --allow-codec-load/);
    });

    it('passes when allowed or when no task loads a codec', () => {
        expect(() => assertCodecPolicy(withCodec, true)).not.toThrow();
        expect(() => assertCodecPolicy(without, false)).not.toThrow();
    });
});
