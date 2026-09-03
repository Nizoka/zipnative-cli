import { describe, it, expect, vi, afterEach } from 'vitest';
import { CliError, ErrorCode, deprecate, die } from '../../src/utils/error.js';
import { captureStderr } from '../helpers/capture.js';

/** The frozen public error-class vocabulary (13). Adding or renaming one is a contract change. */
const FROZEN_CODES = [
    'E_USAGE',
    'E_INPUT',
    'E_PARSE',
    'E_IO',
    'E_SECURITY',
    'E_DATA',
    'E_LIMIT',
    'E_UNSUPPORTED',
    'E_NOT_FOUND',
    'E_VERIFY_FAILED',
    'E_CHECK_FAILED',
    'E_POLICY',
    'E_RUNTIME',
] as const;

describe('ErrorCode', () => {
    it('has exactly the 13 frozen codes', () => {
        const values = Object.values(ErrorCode);
        expect(values).toHaveLength(13);
        expect([...values].sort()).toEqual([...FROZEN_CODES].sort());
    });

    it('maps each key to a distinct E_* value', () => {
        const values = Object.values(ErrorCode);
        expect(new Set(values).size).toBe(values.length);
        expect(values.every((v) => v.startsWith('E_'))).toBe(true);
    });

    it('exposes the codes under the expected keys', () => {
        expect(ErrorCode.USAGE).toBe('E_USAGE');
        expect(ErrorCode.INPUT).toBe('E_INPUT');
        expect(ErrorCode.PARSE).toBe('E_PARSE');
        expect(ErrorCode.IO).toBe('E_IO');
        expect(ErrorCode.SECURITY).toBe('E_SECURITY');
        expect(ErrorCode.DATA).toBe('E_DATA');
        expect(ErrorCode.LIMIT).toBe('E_LIMIT');
        expect(ErrorCode.UNSUPPORTED).toBe('E_UNSUPPORTED');
        expect(ErrorCode.NOT_FOUND).toBe('E_NOT_FOUND');
        expect(ErrorCode.VERIFY_FAILED).toBe('E_VERIFY_FAILED');
        expect(ErrorCode.CHECK_FAILED).toBe('E_CHECK_FAILED');
        expect(ErrorCode.POLICY).toBe('E_POLICY');
        expect(ErrorCode.RUNTIME).toBe('E_RUNTIME');
    });
});

describe('CliError', () => {
    it('defaults exitCode to 1 and code to E_RUNTIME', () => {
        const err = new CliError('boom');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(CliError);
        expect(err.name).toBe('CliError');
        expect(err.message).toBe('boom');
        expect(err.exitCode).toBe(1);
        expect(err.code).toBe(ErrorCode.RUNTIME);
    });

    it('derives E_USAGE from exit code 2 when no code is given', () => {
        const err = new CliError('missing flag', 2);
        expect(err.exitCode).toBe(2);
        expect(err.code).toBe(ErrorCode.USAGE);
    });

    it('keeps E_RUNTIME for non-2 exit codes when no code is given', () => {
        expect(new CliError('io', 1).code).toBe(ErrorCode.RUNTIME);
        expect(new CliError('io', 3).code).toBe(ErrorCode.RUNTIME);
    });

    it('honours an explicit code over the exit-code default', () => {
        const err = new CliError('bad zip', 1, ErrorCode.PARSE);
        expect(err.exitCode).toBe(1);
        expect(err.code).toBe(ErrorCode.PARSE);
    });

    it('allows an explicit code that disagrees with the exit code', () => {
        const err = new CliError('reserved', 2, ErrorCode.UNSUPPORTED);
        expect(err.exitCode).toBe(2);
        expect(err.code).toBe(ErrorCode.UNSUPPORTED);
    });

    it('leaves zipCode / entryName / detail undefined when no options are given', () => {
        const err = new CliError('x', 1, ErrorCode.DATA);
        expect(err.zipCode).toBeUndefined();
        expect(err.entryName).toBeUndefined();
        expect(err.detail).toBeUndefined();
    });

    it('carries zipCode, entryName and detail from options', () => {
        const detail = { limit: 'maxEntries', configured: 1, observed: 3, flag: true, none: null };
        const err = new CliError('limit', 1, ErrorCode.LIMIT, {
            zipCode: 'ZIP_LIMIT_EXCEEDED',
            entryName: 'a.txt',
            detail,
        });
        expect(err.zipCode).toBe('ZIP_LIMIT_EXCEEDED');
        expect(err.entryName).toBe('a.txt');
        expect(err.detail).toEqual(detail);
    });

    it('accepts partial options', () => {
        const err = new CliError('sec', 1, ErrorCode.SECURITY, { entryName: '../x' });
        expect(err.entryName).toBe('../x');
        expect(err.zipCode).toBeUndefined();
        expect(err.detail).toBeUndefined();
    });

    it('is catchable as a rejected promise with toMatchObject', async () => {
        const fn = async (): Promise<void> => {
            throw new CliError('bad', 1, ErrorCode.INPUT);
        };
        await expect(fn()).rejects.toMatchObject({ code: 'E_INPUT', exitCode: 1 });
    });
});

describe('deprecate', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('writes one warning line naming the flag and its replacement', () => {
        const err = captureStderr();
        deprecate('old-flag-a', '--new-flag-a');
        expect(err.text()).toBe('warning: --old-flag-a is deprecated; use --new-flag-a instead.\n');
    });

    it('is idempotent per flag name within a process', () => {
        const err = captureStderr();
        deprecate('old-flag-b', '--new-flag-b');
        deprecate('old-flag-b', '--new-flag-b');
        deprecate('old-flag-b', '--other');
        expect(err.calls).toBe(1);
    });

    it('warns separately for distinct names', () => {
        const err = captureStderr();
        deprecate('old-flag-c', '--c');
        deprecate('old-flag-d', '--d');
        expect(err.text().split('\n').filter((l) => l.length > 0)).toHaveLength(2);
    });
});

describe('die', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('writes the message to stderr and exits with the given code', () => {
        const err = captureStderr();
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
            throw new Error(`exit ${code}`);
        }) as typeof process.exit);
        expect(() => die('fatal', 2)).toThrow('exit 2');
        expect(err.text()).toBe('fatal\n');
        expect(exit).toHaveBeenCalledWith(2);
    });

    it('defaults the exit code to 1', () => {
        captureStderr();
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
            throw new Error(`exit ${code}`);
        }) as typeof process.exit);
        expect(() => die('fatal')).toThrow('exit 1');
        expect(exit).toHaveBeenCalledWith(1);
    });
});
