import { describe, it, expect } from 'vitest';
import {
    parseArgs,
    getStringFlag,
    getStringFlagAll,
    hasFlag,
    getBoolFlag,
} from '../../src/utils/args.js';
import { CliError } from '../../src/utils/error.js';

describe('parseArgs', () => {
    it('returns empty flags and positionals for empty argv', () => {
        const result = parseArgs([]);
        expect(result.flags).toEqual({});
        expect(result.positionals).toEqual([]);
    });

    it('handles --flag value', () => {
        const result = parseArgs(['--input', 'file.zip']);
        expect(result.flags['input']).toBe('file.zip');
    });

    it('handles --flag=value notation', () => {
        const result = parseArgs(['--input=file.zip']);
        expect(result.flags['input']).toBe('file.zip');
    });

    it('keeps everything after the first = in --flag=value', () => {
        const result = parseArgs(['--add=name=path/with=eq']);
        expect(result.flags['add']).toBe('name=path/with=eq');
    });

    it('handles -f value (single-dash short flag)', () => {
        const result = parseArgs(['-i', 'file.zip']);
        expect(result.flags['i']).toBe('file.zip');
    });

    it('handles boolean --flag (no value following)', () => {
        const result = parseArgs(['--stream']);
        expect(result.flags['stream']).toBe(true);
    });

    it('handles boolean -f at the end of argv', () => {
        const result = parseArgs(['-v']);
        expect(result.flags['v']).toBe(true);
    });

    it('treats boolean flag when next token starts with -', () => {
        const result = parseArgs(['--stream', '--output', 'out.zip']);
        expect(result.flags['stream']).toBe(true);
        expect(result.flags['output']).toBe('out.zip');
    });

    it('collects positional arguments', () => {
        const result = parseArgs(['list', '--input', 'f.zip']);
        expect(result.positionals).toContain('list');
        expect(result.flags['input']).toBe('f.zip');
    });

    it('stops flag parsing at --', () => {
        const result = parseArgs(['--input', 'a.zip', '--', '--not-a-flag', 'pos']);
        expect(result.flags['input']).toBe('a.zip');
        expect(result.positionals).toEqual(['--not-a-flag', 'pos']);
    });

    it('handles multiple flags', () => {
        const result = parseArgs(['--input', 'a.zip', '--output', 'b.zip', '--stream']);
        expect(result.flags['input']).toBe('a.zip');
        expect(result.flags['output']).toBe('b.zip');
        expect(result.flags['stream']).toBe(true);
    });

    it('collects unknown flags silently', () => {
        const result = parseArgs(['--weird-unknown-flag', 'val']);
        expect(result.flags['weird-unknown-flag']).toBe('val');
    });

    it('treats a lone "-" as a positional and refuses combined short flags', () => {
        expect(parseArgs(['-']).positionals).toEqual(['-']);
        expect(() => parseArgs(['-abc'])).toThrow(CliError);
    });

    it('collects repeated string flags into an array in order', () => {
        const result = parseArgs(['--remove', 'a.txt', '--remove', 'b.txt', '--remove=c.txt']);
        expect(result.flags['remove']).toEqual(['a.txt', 'b.txt', 'c.txt']);
    });

    it('lets a later string value replace an earlier boolean', () => {
        const result = parseArgs(['--x', '--x', 'v']);
        expect(result.flags['x']).toBe('v');
    });

    it('keeps the existing string value when a later occurrence is boolean', () => {
        const result = parseArgs(['--x', 'v', '--x']);
        expect(result.flags['x']).toBe('v');
    });

    it.each([
        ['--flag value', ['--format', 'json'], 'format', 'json'],
        ['--flag=value', ['--format=ndjson'], 'format', 'ndjson'],
        ['-f value', ['-f', 'table'], 'f', 'table'],
    ])('handles %s correctly', (_label, argv, key, expected) => {
        const result = parseArgs(argv);
        expect(result.flags[key]).toBe(expected);
    });
});

describe('getStringFlag', () => {
    it('returns the string value for a matching flag', () => {
        expect(getStringFlag({ input: 'file.zip' }, 'input')).toBe('file.zip');
    });

    it('returns undefined when flag is not present', () => {
        expect(getStringFlag({}, 'input')).toBeUndefined();
    });

    it('returns first matching alias', () => {
        expect(getStringFlag({ i: 'file.zip' }, 'input', 'i')).toBe('file.zip');
    });

    it('returns the FIRST value of a repeated flag', () => {
        expect(getStringFlag({ remove: ['a', 'b'] }, 'remove')).toBe('a');
    });

    it('throws CliError(2) when flag value is boolean (no value given)', () => {
        expect(() => getStringFlag({ input: true }, 'input')).toThrow(CliError);
        try {
            getStringFlag({ input: true }, 'input');
        } catch (e) {
            expect(e).toMatchObject({ exitCode: 2, code: 'E_USAGE' });
            expect((e as CliError).message).toMatch(/--input requires a value/);
        }
    });
});

describe('getStringFlagAll', () => {
    it('returns an empty array when nothing matches', () => {
        expect(getStringFlagAll({}, 'include')).toEqual([]);
    });

    it('returns every value across aliases in order', () => {
        const flags = { include: ['*.txt', '*.md'], I: 'x' };
        expect(getStringFlagAll(flags, 'include', 'I')).toEqual(['*.txt', '*.md', 'x']);
    });

    it('wraps a single string value', () => {
        expect(getStringFlagAll({ include: 'one' }, 'include')).toEqual(['one']);
    });

    it('throws CliError(2) for a boolean occurrence', () => {
        expect(() => getStringFlagAll({ include: true }, 'include')).toThrow(CliError);
    });
});

describe('hasFlag', () => {
    it('returns true when flag exists', () => {
        expect(hasFlag({ stream: true }, 'stream')).toBe(true);
    });

    it('returns true for a string-valued flag', () => {
        expect(hasFlag({ output: 'x' }, 'output')).toBe(true);
    });

    it('returns false when flag is absent', () => {
        expect(hasFlag({}, 'stream')).toBe(false);
    });

    it('returns true for any matching alias', () => {
        expect(hasFlag({ h: true }, 'help', 'h')).toBe(true);
    });
});

describe('getBoolFlag', () => {
    it('returns undefined when absent', () => {
        expect(getBoolFlag({}, 'color')).toBeUndefined();
    });

    it('returns true for a bare flag', () => {
        expect(getBoolFlag({ color: true }, 'color')).toBe(true);
    });

    it.each(['true', '1', 'yes', 'on', 'TRUE', ' Yes ', ''])('returns true for %j', (v) => {
        expect(getBoolFlag({ color: v }, 'color')).toBe(true);
    });

    it.each(['false', '0', 'no', 'off', 'FALSE', ' Off '])('returns false for %j', (v) => {
        expect(getBoolFlag({ color: v }, 'color')).toBe(false);
    });

    it('uses the first value of a repeated flag', () => {
        expect(getBoolFlag({ color: ['false', 'true'] }, 'color')).toBe(false);
    });

    it('checks aliases in order', () => {
        expect(getBoolFlag({ c: 'no' }, 'color', 'c')).toBe(false);
    });

    it('throws CliError(2) on a non-boolean value', () => {
        expect(() => getBoolFlag({ color: 'maybe' }, 'color')).toThrow(CliError);
        try {
            getBoolFlag({ color: 'maybe' }, 'color');
        } catch (e) {
            expect(e).toMatchObject({ exitCode: 2, code: 'E_USAGE' });
        }
    });
});

