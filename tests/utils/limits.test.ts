import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    ENGINE_ONLY_LIMITS,
    LIMIT_FLAGS,
    LIMIT_FLAG_NAMES,
    LIMIT_KEYS,
    parseLimitFlags,
    effectiveLimits,
    formatLimitValue,
    DEFAULT_MAX_INPUT_SIZE,
    MAX_INPUT_SIZE_FLAG,
    parseInputSizeFlag,
    type LimitFlag,
} from '../../src/utils/limits.js';
import { DEFAULT_ZIP_LIMITS, type ZipLimits } from '../../src/core-bridge/index.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError } from '../../src/utils/error.js';
import { captureStderr } from '../helpers/capture.js';

const ZIP_LIMITS_ORDER: readonly (keyof ZipLimits)[] = [
    'maxEntries',
    'maxEntryUncompressedSize',
    'maxEntryCompressedSize',
    'maxTotalUncompressedSize',
    'maxCompressionRatio',
    'maxNameBytes',
    'maxExtraFieldBytes',
    'maxCommentBytes',
    'maxCentralDirectoryBytes',
];

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

afterEach(() => {
    delete process.env['ZIPNATIVE_QUIET'];
    delete process.env['ZIPNATIVE_JSON'];
    vi.restoreAllMocks();
});

describe('LIMIT_FLAGS', () => {
    it('has 8 flagged entries in ZipLimits declaration order (the engine-only key skipped)', () => {
        expect(LIMIT_FLAGS).toHaveLength(8);
        expect(LIMIT_FLAGS.map((l) => l.key)).toEqual(ZIP_LIMITS_ORDER.filter((k) => k !== 'maxEntryCompressedSize'));
        expect(Object.keys(DEFAULT_ZIP_LIMITS)).toEqual(ZIP_LIMITS_ORDER);
        expect(LIMIT_KEYS).toEqual(ZIP_LIMITS_ORDER);
    });

    it('every ZipLimits key is either flagged or engine-only, never both', () => {
        const flagged = new Set(LIMIT_FLAGS.map((l) => l.key));
        const engineOnly = ENGINE_ONLY_LIMITS.map((l) => l.key);
        expect(engineOnly).toEqual(['maxEntryCompressedSize']);
        for (const k of engineOnly) expect(flagged.has(k)).toBe(false);
        expect(flagged.size + engineOnly.length).toBe(LIMIT_KEYS.length);
        for (const l of ENGINE_ONLY_LIMITS) {
            expect(l.cwe).toMatch(/^CWE-\d+$/);
            expect(l.reason).toContain('openZipRange');
        }
    });

    it('uses distinct --max-* flag names with a kind, a CWE and a description', () => {
        const flags = LIMIT_FLAGS.map((l) => l.flag);
        expect(new Set(flags).size).toBe(8);
        for (const l of LIMIT_FLAGS) {
            expect(l.flag).toMatch(/^max-[a-z-]+$/);
            expect(['size', 'count', 'ratio']).toContain(l.kind);
            expect(l.cwe).toMatch(/^CWE-\d+$/);
            expect(l.description.length).toBeGreaterThan(10);
        }
    });

    it('kinds: entries is a count, ratio is a ratio, the rest are sizes', () => {
        const byFlag = new Map(LIMIT_FLAGS.map((l) => [l.flag, l.kind]));
        expect(byFlag.get('max-entries')).toBe('count');
        expect(byFlag.get('max-ratio')).toBe('ratio');
        for (const f of ['max-entry-size', 'max-total-size', 'max-name-bytes', 'max-extra-bytes', 'max-comment-bytes', 'max-cd-bytes']) {
            expect(byFlag.get(f), f).toBe('size');
        }
    });

    it('LIMIT_FLAG_NAMES carries the dashed forms', () => {
        expect(LIMIT_FLAG_NAMES).toEqual(LIMIT_FLAGS.map((l) => `--${l.flag}`));
        expect(LIMIT_FLAG_NAMES).toContain('--max-total-size');
    });
});

describe('parseLimitFlags', () => {
    it('returns undefined when no --max-* flag is present', () => {
        expect(parseLimitFlags(parseArgs([]))).toBeUndefined();
        expect(parseLimitFlags(parseArgs(['--level', '9', 'a.zip']))).toBeUndefined();
    });

    it.each(LIMIT_FLAGS.map((l) => [l.flag, l.key] as const))('maps --%s to %s', (flag, key) => {
        const out = parseLimitFlags(parseArgs([`--${flag}`, '7']));
        expect(out).toEqual({ [key]: 7 });
    });

    it('accepts binary suffixes on size flags', () => {
        expect(parseLimitFlags(parseArgs(['--max-entry-size', '512k']))).toEqual({ maxEntryUncompressedSize: 512 * 1024 });
        expect(parseLimitFlags(parseArgs(['--max-total-size', '32g']))).toEqual({ maxTotalUncompressedSize: 32 * 1024 ** 3 });
        expect(parseLimitFlags(parseArgs(['--max-cd-bytes=1MiB']))).toEqual({ maxCentralDirectoryBytes: 1024 ** 2 });
    });

    it('rejects suffixes on count/ratio flags', () => {
        expectUsage(() => parseLimitFlags(parseArgs(['--max-entries', '1k'])), /--max-entries expects a non-negative integer/);
        expectUsage(() => parseLimitFlags(parseArgs(['--max-ratio', '1m'])), /--max-ratio/);
    });

    it('collects several flags at once', () => {
        const out = parseLimitFlags(parseArgs(['--max-entries', '10', '--max-ratio', '50', '--max-name-bytes', '1k']));
        expect(out).toEqual({ maxEntries: 10, maxCompressionRatio: 50, maxNameBytes: 1024 });
    });

    it('rejects 0 with exit 2', () => {
        expectUsage(() => parseLimitFlags(parseArgs(['--max-entries', '0'])), /--max-entries must be a positive bound/);
        expectUsage(() => parseLimitFlags(parseArgs(['--max-total-size', '0'])), /--max-total-size must be a positive bound/);
    });

    it('rejects malformed values with exit 2', () => {
        expectUsage(() => parseLimitFlags(parseArgs(['--max-total-size', 'lots'])), /--max-total-size expects a byte size/);
        expectUsage(() => parseLimitFlags(parseArgs(['--max-entries'])), /--max-entries requires a value/);
    });

    it.each(['none', 'NONE', 'inf', 'infinity', ' Inf '])('refuses the 1.0 unbounded form %j (exit 2) with an explicit-value remedy', (raw) => {
        for (const spec of LIMIT_FLAGS) {
            let caught: unknown;
            try {
                parseLimitFlags(parseArgs([`--${spec.flag}`, raw]));
            } catch (e) {
                caught = e;
            }
            expect(caught, spec.flag).toBeInstanceOf(CliError);
            expect(caught).toMatchObject({ exitCode: 2, code: 'E_USAGE' });
            expect((caught as CliError).message).toMatch(/no longer accepted: since 1\.1\.0 every bound is finite/);
            expect((caught as CliError).remedy).toMatch(new RegExp(`^--${spec.flag} \\d+`));
        }
    });

    it('never prints anything on stderr (no "disabled bound" warning exists any more)', () => {
        const err = captureStderr();
        parseLimitFlags(parseArgs(['--max-entries', '5', '--max-total-size', '64g']));
        expect(err.calls).toBe(0);
    });
});

describe('effectiveLimits', () => {
    it('returns the core defaults when nothing is overridden', () => {
        expect(effectiveLimits(undefined)).toEqual(DEFAULT_ZIP_LIMITS);
        expect(effectiveLimits({})).toEqual(DEFAULT_ZIP_LIMITS);
    });

    it('merges overrides on top of the defaults without mutating them', () => {
        const before = { ...DEFAULT_ZIP_LIMITS };
        const out = effectiveLimits({ maxEntries: 3, maxCompressionRatio: 4096 });
        expect(out.maxEntries).toBe(3);
        expect(out.maxCompressionRatio).toBe(4096);
        expect(out.maxNameBytes).toBe(DEFAULT_ZIP_LIMITS.maxNameBytes);
        expect(DEFAULT_ZIP_LIMITS).toEqual(before);
    });
});

describe('formatLimitValue', () => {
    const size: LimitFlag = LIMIT_FLAGS.find((l) => l.kind === 'size') as LimitFlag;
    const count: LimitFlag = LIMIT_FLAGS.find((l) => l.kind === 'count') as LimitFlag;
    const ratio: LimitFlag = LIMIT_FLAGS.find((l) => l.kind === 'ratio') as LimitFlag;

    it('renders sizes with a human suffix', () => {
        expect(formatLimitValue(size, 65536)).toBe('65536 (64.0 KiB)');
        expect(formatLimitValue(size, 1024 ** 3)).toBe(`${1024 ** 3} (1.0 GiB)`);
    });

    it('renders ratios as N:1 and counts bare', () => {
        expect(formatLimitValue(ratio, 1024)).toBe('1024:1');
        expect(formatLimitValue(count, 100000)).toBe('100000');
    });

});

describe('parseInputSizeFlag (--max-input-size)', () => {
    it('defaults to 4 GiB and is not a ZipLimits key', () => {
        expect(DEFAULT_MAX_INPUT_SIZE).toBe(4 * 1024 ** 3);
        expect(parseInputSizeFlag(parseArgs([]))).toBe(DEFAULT_MAX_INPUT_SIZE);
        expect(LIMIT_FLAGS.some((l) => l.flag === MAX_INPUT_SIZE_FLAG)).toBe(false);
    });

    it('parses byte sizes', () => {
        expect(parseInputSizeFlag(parseArgs(['--max-input-size', '1m']))).toBe(1024 * 1024);
        expect(parseInputSizeFlag(parseArgs(['--max-input-size', '65536']))).toBe(65536);
    });

    it('"none" is refused (exit 2): the buffered-read bound is always finite', () => {
        expectUsage(() => parseInputSizeFlag(parseArgs(['--max-input-size', 'none'])), /no longer accepted/);
    });

    it('0 and garbage are usage errors', () => {
        expectUsage(() => parseInputSizeFlag(parseArgs(['--max-input-size', '0'])), /must be a positive bound/);
        expectUsage(() => parseInputSizeFlag(parseArgs(['--max-input-size', 'lots'])));
    });
});
