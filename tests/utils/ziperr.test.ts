import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
    ZipDataError,
    ZipError,
    ZipFormatError,
    ZipLimitError,
    ZipSecurityError,
    ZipUnsupportedError,
    openZip,
    type ZipErrorCode,
} from '../../src/core-bridge/index.js';
import {
    ZIP_DIAGNOSTIC_CODES,
    ZIP_ERROR_CODES,
    ZIP_TO_CLI,
    guard,
    guardAsync,
    isFsError,
    mapZipError,
} from '../../src/utils/ziperr.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { buildRawZip } from '../helpers/raw-zip-builder.js';

const te = new TextEncoder();

/** The 39 frozen zipnative codes, in table order. Frozen here on purpose. */
const FROZEN_ZIP_CODES = [
    'ZIP_INVALID_OPTION',
    'ZIP_INPUT_TOO_LARGE',
    'ZIP_ENTRY_NOT_FOUND',
    'ZIP_ENTRY_EXISTS',
    'ZIP_API_MISUSE',
    'ZIP_STRICT_DIAGNOSTIC',
    'ZIP_INTERNAL',
    'ZIP_EOCD_NOT_FOUND',
    'ZIP_EOCD_INCONSISTENT',
    'ZIP_ZIP64_LOCATOR_MISSING',
    'ZIP_ZIP64_EOCD_MISPLACED',
    'ZIP_CD_INCONSISTENT',
    'ZIP_RECORD_TRUNCATED',
    'ZIP_SIGNATURE_MISMATCH',
    'ZIP_STREAM_TRUNCATED',
    'ZIP_VALUE_UNREPRESENTABLE',
    'ZIP_INVALID_ENTRY_NAME',
    'ZIP_DUPLICATE_ENTRY_NAME',
    'ZIP_DEFLATE_TRUNCATED',
    'ZIP_DEFLATE_CORRUPT',
    'ZIP_ENTRY_OVERLAP',
    'ZIP_CD_LFH_MISMATCH',
    'ZIP_ZIP64_CONTRADICTION',
    'ZIP_PATH_TRAVERSAL',
    'ZIP_SYMLINK_REJECTED',
    'ZIP_EXTRACT_DUPLICATE_PATH',
    'ZIP_CRC_MISMATCH',
    'ZIP_SIZE_MISMATCH',
    'ZIP_INFLATE_OUTPUT_OVERFLOW',
    'ZIP_DESCRIPTOR_MISMATCH',
    'ZIP_DECOMPRESSION_FAILED',
    'ZIP_LIMIT_EXCEEDED',
    'ZIP_LIMIT_INVALID',
    'ZIP_UNSUPPORTED_ENCRYPTION',
    'ZIP_UNSUPPORTED_METHOD',
    'ZIP_UNSUPPORTED_MULTI_DISK',
    'ZIP_UNSUPPORTED_ZIP64_STREAMING',
    'ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR',
    'ZIP_UNSUPPORTED_CODEC_MODE',
] as const;

const FORMAT_CODES = FROZEN_ZIP_CODES.slice(7, 20);
const SECURITY_CODES = FROZEN_ZIP_CODES.slice(20, 26);
const DATA_CODES = FROZEN_ZIP_CODES.slice(26, 31);
const UNSUPPORTED_CODES = FROZEN_ZIP_CODES.slice(33, 39);

describe('ZIP_ERROR_CODES (frozen table)', () => {
    it('has exactly the 39 frozen codes, in table order', () => {
        expect(ZIP_ERROR_CODES).toHaveLength(39);
        expect([...ZIP_ERROR_CODES]).toEqual([...FROZEN_ZIP_CODES]);
    });

    it('has no duplicates and every code is a ZIP_* identifier', () => {
        expect(new Set(ZIP_ERROR_CODES).size).toBe(39);
        for (const code of ZIP_ERROR_CODES) expect(code).toMatch(/^ZIP_[A-Z0-9_]+$/);
    });

    it('every mapping names a real ErrorCode and a 1 or 2 exit code', () => {
        const known = new Set<string>(Object.values(ErrorCode));
        for (const code of ZIP_ERROR_CODES) {
            const [cls, exit] = ZIP_TO_CLI[code];
            expect(known.has(cls)).toBe(true);
            expect([1, 2]).toContain(exit);
        }
    });

    it('format codes → E_PARSE, except the two entry-name codes → E_INPUT', () => {
        for (const code of FORMAT_CODES) {
            const [cls, exit] = ZIP_TO_CLI[code];
            if (code === 'ZIP_INVALID_ENTRY_NAME' || code === 'ZIP_DUPLICATE_ENTRY_NAME') {
                expect(cls, code).toBe('E_INPUT');
            } else {
                expect(cls, code).toBe('E_PARSE');
            }
            expect(exit).toBe(1);
        }
    });

    it('security codes → E_SECURITY (exit 1)', () => {
        for (const code of SECURITY_CODES) expect(ZIP_TO_CLI[code], code).toEqual(['E_SECURITY', 1]);
    });

    it('data codes → E_DATA (exit 1)', () => {
        for (const code of DATA_CODES) expect(ZIP_TO_CLI[code], code).toEqual(['E_DATA', 1]);
    });

    it('limit codes: EXCEEDED → E_LIMIT, INVALID → E_USAGE exit 2', () => {
        expect(ZIP_TO_CLI.ZIP_LIMIT_EXCEEDED).toEqual(['E_LIMIT', 1]);
        expect(ZIP_TO_CLI.ZIP_LIMIT_INVALID).toEqual(['E_USAGE', 2]);
    });

    it('unsupported codes → E_UNSUPPORTED (exit 1)', () => {
        for (const code of UNSUPPORTED_CODES) expect(ZIP_TO_CLI[code], code).toEqual(['E_UNSUPPORTED', 1]);
    });

    it('base codes map as documented', () => {
        expect(ZIP_TO_CLI.ZIP_INVALID_OPTION).toEqual(['E_USAGE', 2]);
        expect(ZIP_TO_CLI.ZIP_INPUT_TOO_LARGE).toEqual(['E_LIMIT', 1]);
        expect(ZIP_TO_CLI.ZIP_ENTRY_NOT_FOUND).toEqual(['E_NOT_FOUND', 1]);
        expect(ZIP_TO_CLI.ZIP_ENTRY_EXISTS).toEqual(['E_INPUT', 1]);
        expect(ZIP_TO_CLI.ZIP_API_MISUSE).toEqual(['E_RUNTIME', 1]);
        expect(ZIP_TO_CLI.ZIP_INTERNAL).toEqual(['E_RUNTIME', 1]);
        expect(ZIP_TO_CLI.ZIP_STRICT_DIAGNOSTIC).toEqual(['E_CHECK_FAILED', 1]);
    });

    it('only the two usage-class codes exit 2', () => {
        const exit2 = ZIP_ERROR_CODES.filter((c) => ZIP_TO_CLI[c][1] === 2);
        expect(exit2.sort()).toEqual(['ZIP_INVALID_OPTION', 'ZIP_LIMIT_INVALID']);
    });
});

describe('ZIP_DIAGNOSTIC_CODES', () => {
    it('lists the 11 core diagnostic codes', () => {
        expect(ZIP_DIAGNOSTIC_CODES).toHaveLength(11);
        expect(new Set(ZIP_DIAGNOSTIC_CODES).size).toBe(11);
        expect(ZIP_DIAGNOSTIC_CODES).toContain('ZIP_PREPENDED_DATA');
        expect(ZIP_DIAGNOSTIC_CODES).toContain('ZIP_DEAD_BYTES_RATIO');
        for (const c of ZIP_DIAGNOSTIC_CODES) expect(c).toMatch(/^ZIP_[A-Z0-9_]+$/);
    });

    it('does not overlap the error-code table', () => {
        const errors = new Set<string>(ZIP_ERROR_CODES);
        for (const c of ZIP_DIAGNOSTIC_CODES) expect(errors.has(c)).toBe(false);
    });
});

describe('isFsError', () => {
    it('recognises a Node errno error', () => {
        const e = Object.assign(new Error('nope'), { code: 'ENOENT' });
        expect(isFsError(e)).toBe(true);
    });

    it('rejects errors without a known code and non-errors', () => {
        expect(isFsError(new Error('x'))).toBe(false);
        expect(isFsError(Object.assign(new Error('x'), { code: 'WHATEVER' }))).toBe(false);
        expect(isFsError({ code: 'ENOENT' })).toBe(false);
        expect(isFsError(null)).toBe(false);
    });
});

describe('mapZipError — real core errors', () => {
    it('maps a non-ZIP buffer to E_PARSE carrying ZIP_EOCD_NOT_FOUND', () => {
        let caught: unknown;
        try {
            openZip(te.encode('definitely not a zip archive, no EOCD anywhere here'));
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(ZipFormatError);
        const mapped = mapZipError(caught, 'Failed to open archive');
        expect(mapped).toBeInstanceOf(CliError);
        expect(mapped).toMatchObject({ code: 'E_PARSE', exitCode: 1, zipCode: 'ZIP_EOCD_NOT_FOUND' });
        expect(mapped.message.startsWith('Failed to open archive: ')).toBe(true);
        expect(mapped.message).toContain((caught as Error).message);
        expect(mapped.entryName).toBeUndefined();
        expect(mapped.detail).toBeUndefined();
    });

    it('maps an overlapping-entries archive (raw builder) to E_SECURITY with the entry name', () => {
        const archive = buildRawZip([
            { name: 'a.txt', data: te.encode('shared payload here') },
            { name: 'b.txt', data: te.encode('shared payload here'), localHeaderOffsetOverride: 0 },
        ]);
        let caught: unknown;
        try {
            openZip(archive, { validate: 'eager' });
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(ZipSecurityError);
        const mapped = mapZipError(caught, 'Failed to open archive');
        expect(mapped).toMatchObject({ code: 'E_SECURITY', exitCode: 1, zipCode: 'ZIP_ENTRY_OVERLAP' });
        expect(mapped.message).toMatch(/^Failed to open archive: zipnative: /);
        // The eager overlap table is archive-scoped (the core names no entry);
        // the caller-supplied name fills the envelope's entryName.
        const withFallback = mapZipError(caught, 'Failed to open archive', 'b.txt');
        expect(['a.txt', 'b.txt']).toContain(withFallback.entryName);
    });

    it('maps a real ZipLimitError to E_LIMIT with limit/configured/observed detail', () => {
        const archive = buildRawZip([
            { name: 'a', data: te.encode('1') },
            { name: 'b', data: te.encode('2') },
            { name: 'c', data: te.encode('3') },
        ]);
        let caught: unknown;
        try {
            const reader = openZip(archive, { limits: { maxEntries: 1 } });
            for (const _entry of reader.entries()) { /* force the CD walk */ }
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(ZipLimitError);
        const mapped = mapZipError(caught, 'Failed to list');
        expect(mapped).toMatchObject({
            code: 'E_LIMIT',
            exitCode: 1,
            zipCode: 'ZIP_LIMIT_EXCEEDED',
            detail: { limit: 'maxEntries', configured: 1, observed: 3 },
        });
    });

    it('stringifies non-finite limit values in the detail', () => {
        const err = new ZipLimitError('ZIP_LIMIT_INVALID', 'zipnative: bad limit', 'maxEntries', NaN, Infinity);
        const mapped = mapZipError(err, 'ctx');
        expect(mapped).toMatchObject({ code: 'E_USAGE', exitCode: 2, zipCode: 'ZIP_LIMIT_INVALID' });
        expect(mapped.detail).toEqual({ limit: 'maxEntries', configured: 'NaN', observed: 'Infinity' });
    });

    it('maps a ZipUnsupportedError to E_UNSUPPORTED with detail.feature', () => {
        const err = new ZipUnsupportedError('ZIP_UNSUPPORTED_METHOD', 'zipnative: method 14', 'method:14');
        const mapped = mapZipError(err, 'Failed to read entry');
        expect(mapped).toMatchObject({
            code: 'E_UNSUPPORTED',
            exitCode: 1,
            zipCode: 'ZIP_UNSUPPORTED_METHOD',
            detail: { feature: 'method:14' },
        });
        expect(mapped.entryName).toBeUndefined();
    });

    it('maps a ZipDataError with CRCs to E_DATA with entryName and CRC detail', () => {
        const err = new ZipDataError('ZIP_CRC_MISMATCH', 'zipnative: crc', 'a.txt', 0x11223344, 0xdeadbeef);
        const mapped = mapZipError(err, 'Failed to read entry');
        expect(mapped).toMatchObject({
            code: 'E_DATA',
            exitCode: 1,
            zipCode: 'ZIP_CRC_MISMATCH',
            entryName: 'a.txt',
            detail: { expectedCrc: 0x11223344, actualCrc: 0xdeadbeef },
        });
    });

    it('fills a missing CRC with null when only one side is known', () => {
        const err = new ZipDataError('ZIP_SIZE_MISMATCH', 'zipnative: size', 'a.txt', undefined, 5);
        const mapped = mapZipError(err, 'ctx');
        expect(mapped.detail).toEqual({ expectedCrc: null, actualCrc: 5 });
    });

    it('omits detail for a ZipDataError without CRCs', () => {
        const err = new ZipDataError('ZIP_DECOMPRESSION_FAILED', 'zipnative: inflate', 'x');
        const mapped = mapZipError(err, 'ctx');
        expect(mapped.detail).toBeUndefined();
        expect(mapped.entryName).toBe('x');
    });

    it('prefers the core entry name and falls back to the caller-supplied one', () => {
        const withName = new ZipSecurityError('ZIP_PATH_TRAVERSAL', 'zipnative: traversal', '../evil');
        expect(mapZipError(withName, 'ctx', 'fallback').entryName).toBe('../evil');
        const withoutName = new ZipSecurityError('ZIP_ENTRY_OVERLAP', 'zipnative: overlap');
        expect(mapZipError(withoutName, 'ctx', 'fallback').entryName).toBe('fallback');
        const formatErr = new ZipFormatError('ZIP_CD_INCONSISTENT', 'zipnative: cd');
        expect(mapZipError(formatErr, 'ctx', 'given').entryName).toBe('given');
        expect(mapZipError(formatErr, 'ctx').entryName).toBeUndefined();
    });

    it('maps entry-name format codes to E_INPUT', () => {
        const err = new ZipFormatError('ZIP_INVALID_ENTRY_NAME', 'zipnative: name');
        expect(mapZipError(err, 'ctx')).toMatchObject({ code: 'E_INPUT', exitCode: 1 });
    });

    it('maps every base code as the table says', () => {
        expect(mapZipError(new ZipError('ZIP_ENTRY_NOT_FOUND', 'm'), 'c')).toMatchObject({ code: 'E_NOT_FOUND', exitCode: 1 });
        expect(mapZipError(new ZipError('ZIP_ENTRY_EXISTS', 'm'), 'c')).toMatchObject({ code: 'E_INPUT', exitCode: 1 });
        expect(mapZipError(new ZipError('ZIP_INVALID_OPTION', 'm'), 'c')).toMatchObject({ code: 'E_USAGE', exitCode: 2 });
        expect(mapZipError(new ZipError('ZIP_STRICT_DIAGNOSTIC', 'm'), 'c')).toMatchObject({ code: 'E_CHECK_FAILED', exitCode: 1 });
        expect(mapZipError(new ZipError('ZIP_INTERNAL', 'm'), 'c')).toMatchObject({ code: 'E_RUNTIME', exitCode: 1 });
        expect(mapZipError(new ZipError('ZIP_INPUT_TOO_LARGE', 'm'), 'c')).toMatchObject({ code: 'E_LIMIT', exitCode: 1 });
    });

    it('falls back to E_RUNTIME for a ZipError with an unknown (future) code', () => {
        const err = new ZipError('ZIP_FROM_THE_FUTURE' as ZipErrorCode, 'zipnative: future');
        expect(mapZipError(err, 'ctx')).toMatchObject({ code: 'E_RUNTIME', exitCode: 1, zipCode: 'ZIP_FROM_THE_FUTURE' });
    });
});

describe('mapZipError — non-core errors', () => {
    it('maps a real ENOENT to E_IO naming the code and path', async () => {
        let caught: unknown;
        try {
            await readFile('D:/definitely/not/here/zipnative-cli-missing.bin');
        } catch (e) {
            caught = e;
        }
        const mapped = mapZipError(caught, 'Cannot read');
        expect(mapped).toMatchObject({ code: 'E_IO', exitCode: 1 });
        expect(mapped.message).toMatch(/^Cannot read: ENOENT \(/);
        expect(mapped.zipCode).toBeUndefined();
    });

    it('maps a synthetic fs error without a path', () => {
        const e = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        const mapped = mapZipError(e, 'Cannot write');
        expect(mapped).toMatchObject({ code: 'E_IO', exitCode: 1 });
        expect(mapped.message).toBe('Cannot write: EACCES: permission denied');
    });

    it('returns a CliError unchanged (same instance)', () => {
        const original = new CliError('already mapped', 2);
        expect(mapZipError(original, 'ctx')).toBe(original);
    });

    it('maps a plain Error to E_RUNTIME with the context prefix', () => {
        const mapped = mapZipError(new Error('kaboom'), 'Failed');
        expect(mapped).toMatchObject({ code: 'E_RUNTIME', exitCode: 1 });
        expect(mapped.message).toBe('Failed: kaboom');
    });

    it('stringifies a non-Error throw', () => {
        const mapped = mapZipError('oops', 'Failed');
        expect(mapped.message).toBe('Failed: oops');
        expect(mapped.code).toBe('E_RUNTIME');
        expect(mapZipError(42, 'F').message).toBe('F: 42');
    });
});

describe('guard / guardAsync', () => {
    it('return the function result on success', async () => {
        expect(guard('ctx', () => 7)).toBe(7);
        await expect(guardAsync('ctx', async () => 'ok')).resolves.toBe('ok');
    });

    it('translate a thrown core error through mapZipError', () => {
        expect(() => guard('Failed to open', () => openZip(te.encode('nope nope nope nope nope')))).toThrow(CliError);
        try {
            guard('Failed to open', () => openZip(te.encode('nope nope nope nope nope')));
        } catch (e) {
            expect(e).toMatchObject({ code: 'E_PARSE', zipCode: 'ZIP_EOCD_NOT_FOUND' });
            expect((e as CliError).message.startsWith('Failed to open: ')).toBe(true);
        }
    });

    it('forward the caller-supplied entry name', () => {
        try {
            guard('ctx', () => { throw new ZipFormatError('ZIP_SIGNATURE_MISMATCH', 'sig'); }, 'e.txt');
        } catch (e) {
            expect(e).toMatchObject({ code: 'E_PARSE', entryName: 'e.txt' });
        }
    });

    it('guardAsync translates rejections and forwards the entry name', async () => {
        const failing = async (): Promise<never> => {
            throw new ZipDataError('ZIP_CRC_MISMATCH', 'crc');
        };
        await expect(guardAsync('Read', failing, 'x.bin')).rejects.toMatchObject({
            code: 'E_DATA',
            exitCode: 1,
            zipCode: 'ZIP_CRC_MISMATCH',
            entryName: 'x.bin',
        });
    });

    it('guardAsync maps a plain rejection to E_RUNTIME', async () => {
        await expect(guardAsync('Read', async () => { throw new Error('nope'); })).rejects.toMatchObject({
            code: 'E_RUNTIME',
            message: 'Read: nope',
        });
    });
});
