// Batch 1 of the 1.0.0 audit (A-01, A-37): the flag table drives the parser —
// boolean flags never consume the token that follows them.

import { describe, expect, it } from 'vitest';
import { getBoolFlag, hasFlag, parseArgs } from '../../src/utils/args.js';
import { BOOLEAN_FLAGS, COMMAND_BOOLEAN_FLAGS, GLOBAL_BOOLEAN_FLAGS } from '../../src/utils/flags.js';
import { COMMANDS, GLOBAL_FLAGS } from '../../src/commands/completion.js';
import { CliError } from '../../src/utils/error.js';

describe('parseArgs boolean-flag table', () => {
    it('a global boolean before the command keeps the command as a positional', () => {
        const args = parseArgs(['--json', 'list', '--input', 'a.zip']);
        expect(args.positionals).toEqual(['list']);
        expect(args.flags['json']).toBe(true);
        expect(args.flags['input']).toBe('a.zip');
    });

    it('a per-command boolean followed by a positional keeps the positional', () => {
        expect(parseArgs(['--long', 'a.zip']).positionals).toEqual(['a.zip']);
        expect(parseArgs(['--deterministic', 'src', '-o', 'out.zip']).positionals).toEqual(['src']);
        expect(parseArgs(['--overwrite', 'a.zip', '-d', 'x']).positionals).toEqual(['a.zip']);
        expect(parseArgs(['-q', 'a.zip']).positionals).toEqual(['a.zip']);
    });

    it('value flags still consume the next token', () => {
        const args = parseArgs(['--input', 'a.zip', '--level', '9', '-o', 'out.zip']);
        expect(args.flags).toEqual({ input: 'a.zip', level: '9', o: 'out.zip' });
        expect(args.positionals).toEqual([]);
    });

    it('--flag=false negates a boolean for hasFlag and getBoolFlag', () => {
        const args = parseArgs(['--json=false', '--long=off', '--stream=true']);
        expect(hasFlag(args.flags, 'json')).toBe(false);
        expect(hasFlag(args.flags, 'long')).toBe(false);
        expect(hasFlag(args.flags, 'stream')).toBe(true);
        expect(getBoolFlag(args.flags, 'json')).toBe(false);
        expect(getBoolFlag(args.flags, 'stream')).toBe(true);
    });

    it('a negative number is a value, not a flag', () => {
        expect(parseArgs(['--level', '-1']).flags).toEqual({ level: '-1' });
        expect(parseArgs(['-1']).positionals).toEqual(['-1']);
    });

    it('a lone dash is a value', () => {
        expect(parseArgs(['--input', '-']).flags).toEqual({ input: '-' });
        expect(parseArgs(['-o', '-']).flags).toEqual({ o: '-' });
    });

    it('combined short flags are refused with a usage error', () => {
        expect(() => parseArgs(['-lq', 'a.zip'])).toThrow(CliError);
        try {
            parseArgs(['-lq']);
        } catch (e) {
            expect((e as CliError).exitCode).toBe(2);
            expect((e as CliError).message).toContain('-l -q');
        }
    });

    it('an explicit empty boolean set restores the value-greedy behaviour', () => {
        const args = parseArgs(['--json', 'list'], { booleans: new Set() });
        expect(args.flags['json']).toBe('list');
    });

    it('the table covers every global boolean and every command has an entry', () => {
        for (const name of GLOBAL_BOOLEAN_FLAGS) expect(BOOLEAN_FLAGS.has(name)).toBe(true);
        for (const c of COMMANDS) expect(Object.keys(COMMAND_BOOLEAN_FLAGS)).toContain(c.name);
        // Every boolean flag named in the table is a real flag of the command (or global).
        for (const c of COMMANDS) {
            const known = new Set([...c.flags, ...GLOBAL_FLAGS].map((f) => f.replace(/^--/, '')));
            for (const b of COMMAND_BOOLEAN_FLAGS[c.name] ?? []) {
                expect(known.has(b), `${c.name}: boolean flag --${b} is not in the COMMANDS table`).toBe(true);
            }
        }
    });
});
