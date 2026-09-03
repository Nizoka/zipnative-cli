import { describe, it, expect, vi, afterEach } from 'vitest';
import { completion, COMMANDS, COMMAND_NAMES, GLOBAL_FLAGS, DRY_RUN_COMMANDS } from '../../src/commands/completion.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';

async function capture(fn: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
    }) as unknown as typeof process.stdout.write);
    try {
        await fn();
    } finally {
        spy.mockRestore();
    }
    return chunks.join('');
}

const NAMES = [
    'create', 'modify', 'list', 'inspect', 'cat', 'extract', 'stream', 'verify', 'crc32', 'inflate',
    'batch', 'doctor', 'schema', 'completion', 'govern',
];

/** One flag that only makes sense for its command — proves per-command flag wiring. */
const DISTINCTIVE: Record<string, string> = {
    create: '--from-manifest',
    modify: '--compact',
    extract: '--output-dir',
    inspect: '--check',
    stream: '--cat',
    inflate: '--max-output',
    crc32: '--expect',
    batch: '--manifest',
};

const MAX_FLAGS = [
    '--max-entries', '--max-entry-size', '--max-total-size', '--max-ratio',
    '--max-name-bytes', '--max-extra-bytes', '--max-comment-bytes', '--max-cd-bytes',
];

describe('completion', () => {
    afterEach(() => vi.restoreAllMocks());

    it('COMMANDS is the single source of truth for the 15 commands', () => {
        expect(COMMANDS).toHaveLength(15);
        expect([...COMMAND_NAMES]).toEqual(NAMES);
        expect(new Set(COMMAND_NAMES).size).toBe(15);
        for (const [name, flag] of Object.entries(DISTINCTIVE)) {
            expect(COMMANDS.find((c) => c.name === name)?.flags).toContain(flag);
        }
        expect(COMMANDS.find((c) => c.name === 'schema')?.flags).toEqual([]);
    });

    it('GLOBAL_FLAGS carries the agent flags and all eight --max-* bounds', () => {
        expect(GLOBAL_FLAGS).toEqual(expect.arrayContaining(['--json', '--dry-run', '--quiet', '--strict', '--pure-codecs', '--codec', '--config', '--no-config', '--pretty', ...MAX_FLAGS]));
        expect(GLOBAL_FLAGS.filter((f) => f.startsWith('--max-'))).toHaveLength(8);
    });

    it('DRY_RUN_COMMANDS lists the commands that plan without writing', () => {
        expect([...DRY_RUN_COMMANDS]).toEqual(['create', 'extract', 'modify', 'stream', 'cat', 'inflate', 'batch']);
        for (const c of DRY_RUN_COMMANDS) expect(NAMES).toContain(c);
    });

    it.each(['bash', 'zsh', 'fish', 'powershell', 'pwsh'])('the %s script names every command, a distinctive flag per command and the global flags', async (shell) => {
        const out = await capture(() => completion(parseArgs([shell])));
        // fish declares long options as `-l name`; every other shell lists `--name`.
        const form = (flag: string): string => (shell === 'fish' ? flag.replace(/^--/, '-l ') : flag);
        for (const name of NAMES) expect(out).toContain(name);
        for (const flag of Object.values(DISTINCTIVE)) expect(out).toContain(form(flag));
        for (const flag of ['--json', '--dry-run', '--max-entries', '--codec', ...MAX_FLAGS]) {
            expect(out).toContain(form(flag));
        }
    });

    it('bash: defines the completion function and registers it', async () => {
        const out = await capture(() => completion(parseArgs(['bash'])));
        expect(out.startsWith('# bash completion for zipnative')).toBe(true);
        expect(out).toContain('_zipnative()');
        expect(out).toContain('complete -F _zipnative zipnative');
        expect(out).toContain('        modify) opts="--input --output --add');
    });

    it('zsh: starts with #compdef and describes every command with its summary', async () => {
        const out = await capture(() => completion(parseArgs(['zsh'])));
        expect(out.startsWith('#compdef zipnative')).toBe(true);
        expect(out).toContain('_describe');
        expect(out).toContain("'stream:Forward-only reader over stdin/pipes (no central directory)'");
        expect(out).not.toContain("''");
    });

    it('fish: one subcommand line per command and per-command -l flags', async () => {
        const out = await capture(() => completion(parseArgs(['fish'])));
        expect(out.startsWith('# fish completion for zipnative')).toBe(true);
        expect(out).toContain('complete -c zipnative -f');
        for (const name of NAMES) expect(out).toContain(`-n __fish_use_subcommand -a ${name} -d`);
        expect(out).toContain("-n '__fish_seen_subcommand_from inflate' -l max-output");
        expect(out).toContain("-n '__fish_seen_subcommand_from schema' -l json");
    });

    it('powershell (and the pwsh alias): a Register-ArgumentCompleter block with a switch per command', async () => {
        const ps = await capture(() => completion(parseArgs(['powershell'])));
        expect(ps).toContain('Register-ArgumentCompleter -Native -CommandName zipnative');
        expect(ps).toContain("$commands = @('create', 'modify'");
        expect(ps).toContain("'crc32' { @('--input', '--seed', '--expect', '--format'");
        expect(ps).toContain('default { @(');
        const pwsh = await capture(() => completion(parseArgs(['pwsh'])));
        expect(pwsh).toBe(ps);
    });

    it('requires a shell (exit 2) and rejects an unsupported one (exit 2)', async () => {
        await expect(completion(parseArgs([]))).rejects.toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
        await expect(completion(parseArgs(['tcsh']))).rejects.toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });
});
