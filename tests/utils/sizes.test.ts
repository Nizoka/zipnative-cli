import { describe, it, expect } from 'vitest';
import { parseByteSize, parseCount, parsePositiveInt, formatBytes, formatRatio } from '../../src/utils/sizes.js';
import { CliError } from '../../src/utils/error.js';

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

describe('parseByteSize', () => {
    it.each([
        ['65536', 65536],
        ['0', 0],
        ['512k', 512 * 1024],
        ['512K', 512 * 1024],
        ['1m', 1024 ** 2],
        ['1MiB', 1024 ** 2],
        ['1mb', 1024 ** 2],
        ['1 m', 1024 ** 2],
        ['4gb', 4 * 1024 ** 3],
        ['8G', 8 * 1024 ** 3],
        ['2t', 2 * 1024 ** 4],
        ['2TiB', 2 * 1024 ** 4],
        ['  7k  ', 7 * 1024],
        ['16b', 16],
    ])('parses %j → %d', (raw, expected) => {
        expect(parseByteSize(raw, 'flag')).toBe(expected);
    });

    it.each(['none', 'NONE', 'inf', 'infinity', ' Inf '])('resolves %j to Infinity', (raw) => {
        expect(parseByteSize(raw, 'flag')).toBe(Infinity);
    });

    it.each(['', 'abc', '1.5m', '-1', '1x', 'k', '1kk', '1 000', '0x10', '1e3'])('rejects %j with exit 2 naming the flag', (raw) => {
        expectUsage(() => parseByteSize(raw, 'max-total-size'), /--max-total-size expects a byte size/);
    });

    it('rejects values too large to represent exactly', () => {
        expectUsage(() => parseByteSize('99999999t', 'flag'), /too large to represent exactly/);
        expectUsage(() => parseByteSize('9007199254740992', 'flag'), /too large/);
    });

    it('accepts the largest safe integer', () => {
        expect(parseByteSize('9007199254740991', 'flag')).toBe(Number.MAX_SAFE_INTEGER);
    });
});

describe('parseCount', () => {
    it.each([
        ['0', 0],
        ['12', 12],
        ['  100000 ', 100000],
    ])('parses %j → %d', (raw, expected) => {
        expect(parseCount(raw, 'max-entries')).toBe(expected);
    });

    it('resolves none/inf/infinity to Infinity', () => {
        expect(parseCount('none', 'f')).toBe(Infinity);
        expect(parseCount('INF', 'f')).toBe(Infinity);
        expect(parseCount('infinity', 'f')).toBe(Infinity);
    });

    it.each(['', '-1', '1k', '1.0', 'x', '0x1'])('rejects %j with exit 2', (raw) => {
        expectUsage(() => parseCount(raw, 'max-entries'), /--max-entries expects a non-negative integer/);
    });

    it('rejects values beyond the safe-integer range', () => {
        expectUsage(() => parseCount('99999999999999999999', 'f'), /too large/);
    });
});

describe('parsePositiveInt', () => {
    it('parses strictly positive integers', () => {
        expect(parsePositiveInt('1', 'workers')).toBe(1);
        expect(parsePositiveInt('42', 'workers')).toBe(42);
    });

    it('rejects 0 with exit 2', () => {
        expectUsage(() => parsePositiveInt('0', 'workers'), /--workers expects a positive integer/);
    });

    it('rejects none / Infinity', () => {
        expectUsage(() => parsePositiveInt('none', 'workers'), /positive integer/);
    });

    it('rejects malformed values', () => {
        expectUsage(() => parsePositiveInt('-3', 'workers'));
        expectUsage(() => parsePositiveInt('abc', 'workers'));
    });
});

describe('formatBytes', () => {
    it.each([
        [0, '0 B'],
        [1, '1 B'],
        [1023, '1023 B'],
        [1024, '1.0 KiB'],
        [1536, '1.5 KiB'],
        [100 * 1024, '100 KiB'],
        [1024 ** 2, '1.0 MiB'],
        [2.5 * 1024 ** 3, '2.5 GiB'],
        [1024 ** 4, '1.0 TiB'],
        [1024 ** 5, '1024 TiB'],
    ])('formats %d as %j', (n, expected) => {
        expect(formatBytes(n)).toBe(expected);
    });

    it('renders Infinity as unlimited', () => {
        expect(formatBytes(Infinity)).toBe('unlimited');
        expect(formatBytes(NaN)).toBe('unlimited');
    });
});

describe('formatRatio', () => {
    it('returns 0% for an empty uncompressed size', () => {
        expect(formatRatio(0, 0)).toBe('0%');
        expect(formatRatio(10, 0)).toBe('0%');
    });

    it('reports the percentage saved, rounded', () => {
        expect(formatRatio(50, 100)).toBe('50%');
        expect(formatRatio(33, 100)).toBe('67%');
        expect(formatRatio(0, 100)).toBe('100%');
        expect(formatRatio(100, 100)).toBe('0%');
    });

    it('clamps negative savings (expansion) to 0%', () => {
        expect(formatRatio(150, 100)).toBe('0%');
    });
});
