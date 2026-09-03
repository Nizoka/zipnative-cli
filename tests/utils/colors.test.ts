import { describe, it, expect, afterEach } from 'vitest';
import { style } from '../../src/utils/colors.js';

describe('style', () => {
    const origNoColor = process.env['NO_COLOR'];
    const origTTY = process.stdout.isTTY;

    afterEach(() => {
        if (origNoColor === undefined) delete process.env['NO_COLOR'];
        else process.env['NO_COLOR'] = origNoColor;
        Object.defineProperty(process.stdout, 'isTTY', { value: origTTY, configurable: true });
    });

    it('returns plain text when NO_COLOR is set (even to an empty string)', () => {
        process.env['NO_COLOR'] = '';
        Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
        expect(style('hello', 'red')).toBe('hello');
    });

    it('returns plain text when stdout is not a TTY', () => {
        delete process.env['NO_COLOR'];
        Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
        expect(style('hello', 'green')).toBe('hello');
        Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true });
        expect(style('hello', 'green')).toBe('hello');
    });

    it('wraps text in ANSI codes when colour is enabled', () => {
        delete process.env['NO_COLOR'];
        Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
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
        delete process.env['NO_COLOR'];
        Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
        expect(style('x', name)).toBe(`${code}x\x1b[0m`);
    });

    it('with no styles wraps text in just the reset code', () => {
        delete process.env['NO_COLOR'];
        Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
        expect(style('x')).toBe('x\x1b[0m');
    });
});
