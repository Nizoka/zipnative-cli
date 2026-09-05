import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { style } from '../../src/utils/colors.js';

// `style()` decorates the stderr progress lines, so the decision is taken on
// process.stderr — stdout may be a pipe carrying the artefact while stderr
// is still a terminal.

const ENV = ['NO_COLOR', 'FORCE_COLOR', 'TERM'] as const;
const saved: Record<string, string | undefined> = {};
const origErrTTY = process.stderr.isTTY;
const origOutTTY = process.stdout.isTTY;

function tty(stream: NodeJS.WriteStream, value: boolean | undefined): void {
    Object.defineProperty(stream, 'isTTY', { value, configurable: true });
}

beforeEach(() => {
    for (const k of ENV) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
});

afterEach(() => {
    for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    tty(process.stderr, origErrTTY);
    tty(process.stdout, origOutTTY);
});

describe('style', () => {
    it('returns plain text when NO_COLOR is set (even to an empty string)', () => {
        process.env['NO_COLOR'] = '';
        tty(process.stderr, true);
        expect(style('hello', 'red')).toBe('hello');
    });

    it('decides on STDERR, not stdout', () => {
        tty(process.stdout, false);
        tty(process.stderr, true);
        expect(style('hello', 'green')).toBe('\x1b[32mhello\x1b[0m');
        tty(process.stdout, true);
        tty(process.stderr, false);
        expect(style('hello', 'green')).toBe('hello');
        tty(process.stderr, undefined);
        expect(style('hello', 'green')).toBe('hello');
    });

    it('FORCE_COLOR turns colour on for a non-TTY (CI log viewers), except "0" / "false"', () => {
        tty(process.stderr, false);
        process.env['FORCE_COLOR'] = '1';
        expect(style('x', 'red')).toBe('\x1b[31mx\x1b[0m');
        process.env['FORCE_COLOR'] = '';
        expect(style('x', 'red')).toBe('\x1b[31mx\x1b[0m');
        process.env['FORCE_COLOR'] = '0';
        expect(style('x', 'red')).toBe('x');
        process.env['FORCE_COLOR'] = 'false';
        expect(style('x', 'red')).toBe('x');
    });

    it('NO_COLOR beats FORCE_COLOR; TERM=dumb turns colour off on a TTY', () => {
        tty(process.stderr, true);
        process.env['FORCE_COLOR'] = '1';
        process.env['NO_COLOR'] = '1';
        expect(style('x', 'red')).toBe('x');
        delete process.env['NO_COLOR'];
        delete process.env['FORCE_COLOR'];
        process.env['TERM'] = 'dumb';
        expect(style('x', 'red')).toBe('x');
        process.env['FORCE_COLOR'] = '1';
        expect(style('x', 'red')).toBe('\x1b[31mx\x1b[0m');
    });

    it('wraps text in ANSI codes when colour is enabled', () => {
        tty(process.stderr, true);
        const out = style('hi', 'bold', 'cyan');
        expect(out.startsWith('\x1b[1m\x1b[36m')).toBe(true);
        expect(out.endsWith('\x1b[0m')).toBe(true);
        expect(out).toContain('hi');
    });

    it.each([
        ['bold', '\x1b[1m'],
        ['dim', '\x1b[2m'],
        ['red', '\x1b[31m'],
        ['green', '\x1b[32m'],
        ['yellow', '\x1b[33m'],
        ['cyan', '\x1b[36m'],
    ] as const)('emits the %s code', (name, code) => {
        tty(process.stderr, true);
        expect(style('x', name)).toBe(`${code}x\x1b[0m`);
    });

    it('with no styles wraps text in just the reset code', () => {
        tty(process.stderr, true);
        expect(style('x')).toBe('x\x1b[0m');
    });
});
