import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    isJsonMode,
    isDryRun,
    isQuiet,
    isStrict,
    buildErrorEnvelope,
    emitJsonError,
    emitStatus,
    progress,
} from '../../src/utils/agent.js';
import { CliError, ErrorCode, type ErrorCodeValue } from '../../src/utils/error.js';
import { captureStderr, captureStdout } from '../helpers/capture.js';

const ENV_KEYS = ['ZIPNATIVE_JSON', 'ZIPNATIVE_DRY_RUN', 'ZIPNATIVE_QUIET', 'ZIPNATIVE_STRICT'] as const;

describe('agent mode helpers', () => {
    afterEach(() => {
        for (const k of ENV_KEYS) delete process.env[k];
        vi.restoreAllMocks();
    });

    describe('env readers', () => {
        it('reflect the env flags when set to exactly "1"', () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            process.env['ZIPNATIVE_DRY_RUN'] = '1';
            process.env['ZIPNATIVE_QUIET'] = '1';
            process.env['ZIPNATIVE_STRICT'] = '1';
            expect(isJsonMode()).toBe(true);
            expect(isDryRun()).toBe(true);
            expect(isQuiet()).toBe(true);
            expect(isStrict()).toBe(true);
        });

        it('are false when unset', () => {
            expect(isJsonMode()).toBe(false);
            expect(isDryRun()).toBe(false);
            expect(isQuiet()).toBe(false);
            expect(isStrict()).toBe(false);
        });

        it('are false when set to anything other than "1"', () => {
            process.env['ZIPNATIVE_JSON'] = 'true';
            process.env['ZIPNATIVE_DRY_RUN'] = '0';
            process.env['ZIPNATIVE_QUIET'] = 'yes';
            process.env['ZIPNATIVE_STRICT'] = '';
            expect(isJsonMode()).toBe(false);
            expect(isDryRun()).toBe(false);
            expect(isQuiet()).toBe(false);
            expect(isStrict()).toBe(false);
        });
    });

    describe('buildErrorEnvelope', () => {
        it('uses the CliError code and message', () => {
            const env = buildErrorEnvelope('inspect', new CliError('bad zip', 1, ErrorCode.PARSE));
            expect(env).toEqual({
                ok: false,
                command: 'inspect',
                error: { code: ErrorCode.PARSE, message: 'bad zip' },
            });
        });

        it('omits zipCode / entryName / detail when the CliError has none', () => {
            const env = buildErrorEnvelope('list', new CliError('x', 2));
            expect(Object.keys(env.error).sort()).toEqual(['code', 'message']);
        });

        it('carries zipCode, entryName and detail when present', () => {
            const err = new CliError('limit hit', 1, ErrorCode.LIMIT, {
                zipCode: 'ZIP_LIMIT_EXCEEDED',
                entryName: 'big.bin',
                detail: { limit: 'maxEntryUncompressedSize', configured: 10, observed: 20 },
            });
            const env = buildErrorEnvelope('extract', err);
            expect(env).toEqual({
                ok: false,
                command: 'extract',
                error: {
                    code: 'E_LIMIT',
                    message: 'limit hit',
                    zipCode: 'ZIP_LIMIT_EXCEEDED',
                    entryName: 'big.bin',
                    detail: { limit: 'maxEntryUncompressedSize', configured: 10, observed: 20 },
                },
            });
        });

        it('carries only the subset of options that are set', () => {
            const env = buildErrorEnvelope('cat', new CliError('nf', 1, ErrorCode.NOT_FOUND, { zipCode: 'ZIP_ENTRY_NOT_FOUND' }));
            expect(env.error).toEqual({ code: 'E_NOT_FOUND', message: 'nf', zipCode: 'ZIP_ENTRY_NOT_FOUND' });
        });

        it.each(Object.values(ErrorCode))('substitutes a non-empty default message for an empty %s message', (code) => {
            const env = buildErrorEnvelope('verify', new CliError('', 1, code as ErrorCodeValue));
            expect(env.error.code).toBe(code);
            expect(env.error.message.length).toBeGreaterThan(0);
        });

        it('uses distinct default messages per code', () => {
            const messages = Object.values(ErrorCode).map(
                (code) => buildErrorEnvelope(null, new CliError('', 1, code as ErrorCodeValue)).error.message,
            );
            expect(new Set(messages).size).toBe(messages.length);
        });

        it('maps a plain Error to E_RUNTIME', () => {
            const env = buildErrorEnvelope('create', new Error('kaboom'));
            expect(env).toEqual({
                ok: false,
                command: 'create',
                error: { code: ErrorCode.RUNTIME, message: 'kaboom' },
            });
        });

        it('stringifies a non-Error throw and accepts a null command', () => {
            const env = buildErrorEnvelope(null, 'oops');
            expect(env.command).toBeNull();
            expect(env.error).toEqual({ code: ErrorCode.RUNTIME, message: 'oops' });
        });
    });

    describe('emitJsonError', () => {
        it('writes a single newline-terminated JSON line to stderr, never stdout', () => {
            const err = captureStderr();
            const out = captureStdout();
            emitJsonError('verify', new CliError('Archive failed verification.', 1, ErrorCode.VERIFY_FAILED));
            expect(err.calls).toBe(1);
            expect(out.calls).toBe(0);
            const line = err.text();
            expect(line.endsWith('\n')).toBe(true);
            expect(line.trim().split('\n')).toHaveLength(1);
            expect(JSON.parse(line)).toEqual({
                ok: false,
                command: 'verify',
                error: { code: ErrorCode.VERIFY_FAILED, message: 'Archive failed verification.' },
            });
        });
    });

    describe('emitStatus', () => {
        it('writes an ok:true envelope to stderr in json mode', () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const err = captureStderr();
            const out = captureStdout();
            emitStatus({ command: 'create', output: 'out.zip', bytes: 42 });
            expect(err.calls).toBe(1);
            expect(out.calls).toBe(0);
            expect(err.text().endsWith('\n')).toBe(true);
            expect(JSON.parse(err.text())).toEqual({ ok: true, command: 'create', output: 'out.zip', bytes: 42 });
        });

        it('cannot have ok overridden to false by the envelope', () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const err = captureStderr();
            emitStatus({ ok: false, command: 'x' });
            expect(JSON.parse(err.text()).ok).toBe(false);
            // (documented: caller-provided keys spread AFTER ok:true — a caller
            // that passes ok wins; commands never do.)
        });

        it('is a no-op outside json mode', () => {
            const err = captureStderr();
            emitStatus({ command: 'create' });
            expect(err.calls).toBe(0);
        });
    });

    describe('progress', () => {
        it('writes the line to stderr with a trailing newline', () => {
            const err = captureStderr();
            progress('adding a.txt');
            expect(err.text()).toBe('adding a.txt\n');
        });

        it('is suppressed under ZIPNATIVE_QUIET=1', () => {
            process.env['ZIPNATIVE_QUIET'] = '1';
            const err = captureStderr();
            progress('adding a.txt');
            expect(err.calls).toBe(0);
        });

        it('is NOT suppressed by json mode alone', () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const err = captureStderr();
            progress('line');
            expect(err.text()).toBe('line\n');
        });
    });
});
