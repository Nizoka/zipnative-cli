// Batch 2 of the 1.0.0 audit (A-02, B-31): explicit dates are UTC wall-clock
// so the DOS fields the engine stores do not depend on the host time zone.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../../src/utils/args.js';
import { parseChunkSize, parseDateFlag, parseIsoDateUtc } from '../../src/utils/zipops.js';
import { CliError } from '../../src/utils/error.js';

function localFields(d: Date): number[] {
    return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
}

describe('parseIsoDateUtc', () => {
    afterEach(() => {
        delete process.env['ZIPNATIVE_QUIET'];
        vi.restoreAllMocks();
    });

    it('a zoned instant yields a Date whose LOCAL fields are the UTC wall-clock', () => {
        const d = parseIsoDateUtc('2020-06-01T12:00:00Z', '--date');
        expect(localFields(d)).toEqual([2020, 5, 1, 12, 0, 0]);
        const offset = parseIsoDateUtc('2020-06-01T14:00:00+02:00', '--date');
        expect(localFields(offset)).toEqual([2020, 5, 1, 12, 0, 0]);
    });

    it('a naive string and a date-only string are read as UTC', () => {
        expect(localFields(parseIsoDateUtc('2020-06-01T12:00:00', '--date'))).toEqual([2020, 5, 1, 12, 0, 0]);
        expect(localFields(parseIsoDateUtc('2020-06-01', '--date'))).toEqual([2020, 5, 1, 0, 0, 0]);
    });

    it('is independent of the local time zone (same fields whatever getTimezoneOffset says)', () => {
        const d = parseIsoDateUtc('2021-01-15T23:30:00Z', '--date');
        expect(localFields(d)).toEqual([2021, 0, 15, 23, 30, 0]);
        // The instant itself moves with the zone; the fields do not.
        expect(d.getTimezoneOffset()).toBe(new Date(2021, 0, 15).getTimezoneOffset());
    });

    it('warns about out-of-range years and odd seconds (suppressed by --quiet)', () => {
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        parseIsoDateUtc('1970-01-01T00:00:00Z', '--date');
        parseIsoDateUtc('2200-01-01T00:00:00Z', '--date');
        parseIsoDateUtc('2020-01-01T00:00:01Z', '--date');
        const text = stderr.mock.calls.map((c) => String(c[0])).join('');
        expect(text).toContain('outside the DOS timestamp range');
        expect(text).toContain('2200');
        expect(text).toContain('2-second resolution');
        stderr.mockClear();
        process.env['ZIPNATIVE_QUIET'] = '1';
        parseIsoDateUtc('1970-01-01T00:00:00Z', '--date');
        expect(stderr).not.toHaveBeenCalled();
    });

    it('rejects garbage with exit 2 (flags) or E_INPUT (manifests)', () => {
        expect(() => parseIsoDateUtc('yesterday', '--date')).toThrow(CliError);
        try {
            parseIsoDateUtc('yesterday', '--date');
        } catch (e) {
            expect((e as CliError).exitCode).toBe(2);
        }
        try {
            parseIsoDateUtc('yesterday', 'entries[0]', false);
        } catch (e) {
            expect((e as CliError).code).toBe('E_INPUT');
        }
    });

    it('parseDateFlag routes epoch/now and ISO strings', () => {
        expect(parseDateFlag(parseArgs(['--date', 'epoch']))).toBeUndefined();
        expect(parseDateFlag(parseArgs(['--date', 'now']))).toBe('now');
        expect(localFields(parseDateFlag(parseArgs(['--date', '2020-06-01T12:00:00Z'])) as Date)).toEqual([2020, 5, 1, 12, 0, 0]);
    });
});

describe('parseChunkSize clamp warning', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('warns below 1 KiB and above 16 MiB, silent in range', () => {
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        expect(parseChunkSize(parseArgs(['--chunk-size', '100']))).toBe(100);
        expect(parseChunkSize(parseArgs(['--chunk-size', '1g']))).toBe(1024 ** 3);
        expect(stderr).toHaveBeenCalledTimes(2);
        stderr.mockClear();
        expect(parseChunkSize(parseArgs(['--chunk-size', '64k']))).toBe(65536);
        expect(stderr).not.toHaveBeenCalled();
    });
});
