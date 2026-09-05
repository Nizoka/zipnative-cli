// `error.remedy` — the machine-actionable counterpart of an error message:
// the CLI flag(s) or command that lift the refusal. Engine messages name
// library options; the envelope names the flag.

import { describe, it, expect } from 'vitest';
import { ZIP_REMEDY, buildErrorEnvelope, remedyFor } from '../../src/utils/agent.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { overwriteRefused } from '../../src/utils/io.js';
import { LIMIT_FLAGS } from '../../src/utils/limits.js';
import { ZIP_ERROR_CODES, mapZipError } from '../../src/utils/ziperr.js';
import { ZipLimitError, ZipSecurityError } from '../../src/core-bridge/index.js';

describe('ZIP_REMEDY', () => {
    it('every key is a frozen ZIP_* code and every value names a flag or a command', () => {
        for (const [code, remedy] of Object.entries(ZIP_REMEDY)) {
            expect(ZIP_ERROR_CODES, code).toContain(code);
            expect(remedy).toMatch(/--[a-z-]+|zipnative |modify |cat \/ extract|create without|unique entry names|a plain relative name|drop --strict/);
        }
    });

    it('structural refusals and corrupt data have no remedy (nothing lifts them)', () => {
        for (const code of ['ZIP_ENTRY_OVERLAP', 'ZIP_CD_LFH_MISMATCH', 'ZIP_CRC_MISMATCH', 'ZIP_EOCD_NOT_FOUND', 'ZIP_UNSUPPORTED_MULTI_DISK', 'ZIP_INTERNAL']) {
            expect(ZIP_REMEDY, code).not.toHaveProperty(code);
        }
    });
});

describe('remedyFor / buildErrorEnvelope', () => {
    it('carries the table remedy when the zipCode is known', () => {
        const err = new CliError('refused', 1, ErrorCode.SECURITY, { zipCode: 'ZIP_PATH_TRAVERSAL', entryName: '../evil' });
        expect(remedyFor(err)).toBe('--skip-unsafe (extract, stream)');
        const env = buildErrorEnvelope('extract', err);
        expect(env.error).toEqual({ code: 'E_SECURITY', message: 'refused', zipCode: 'ZIP_PATH_TRAVERSAL', entryName: '../evil', remedy: '--skip-unsafe (extract, stream)' });
    });

    it('prefers an explicit CliError remedy over the table', () => {
        const err = new CliError('x', 1, ErrorCode.SECURITY, { zipCode: 'ZIP_PATH_TRAVERSAL', remedy: 'custom' });
        expect(buildErrorEnvelope('x', err).error.remedy).toBe('custom');
    });

    it('omits remedy for a structural refusal and for an unknown zipCode', () => {
        expect(buildErrorEnvelope('list', new CliError('o', 1, ErrorCode.SECURITY, { zipCode: 'ZIP_ENTRY_OVERLAP' })).error).not.toHaveProperty('remedy');
        expect(buildErrorEnvelope('list', new CliError('u', 2)).error).not.toHaveProperty('remedy');
    });

    it('the overwrite refusal names --overwrite', () => {
        expect(remedyFor(overwriteRefused('/x/out.zip'))).toBe('--overwrite');
        expect(buildErrorEnvelope('create', overwriteRefused('/x/out.zip', 'a.txt')).error).toMatchObject({ code: 'E_IO', entryName: 'a.txt', remedy: '--overwrite' });
    });

    it('a ZipLimitError maps to the exact --max-* flag of its bound', () => {
        const spec = LIMIT_FLAGS.find((l) => l.key === 'maxEntries');
        expect(spec).toBeDefined();
        const engineErr = new ZipLimitError('ZIP_LIMIT_EXCEEDED', 'too many entries', 'maxEntries', 1, 2);
        const mapped = mapZipError(engineErr, 'Failed');
        expect(mapped).toMatchObject({ code: 'E_LIMIT', zipCode: 'ZIP_LIMIT_EXCEEDED', detail: { limit: 'maxEntries', configured: 1, observed: 2 } });
        expect(mapped.remedy).toMatch(/^--max-entries <value>/);
        expect(buildErrorEnvelope('list', mapped).error.remedy).toBe(mapped.remedy);
    });

    it('a ZipSecurityError keeps the engine message and gets the CLI-flag remedy', () => {
        const engineErr = new ZipSecurityError('ZIP_PATH_TRAVERSAL', "entry '../x' escapes the extraction root (pass rejectTraversal: false to skip such entries instead)", '../x');
        const mapped = mapZipError(engineErr, 'Failed to extract');
        expect(mapped.message).toContain('rejectTraversal: false');
        expect(buildErrorEnvelope('extract', mapped).error.remedy).toBe('--skip-unsafe (extract, stream)');
    });
});
