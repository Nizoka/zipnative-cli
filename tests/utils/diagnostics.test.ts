import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDiagnosticSink, diagnosticRows } from '../../src/utils/diagnostics.js';
import { createZip, openZip, type ZipDiagnostic } from '../../src/core-bridge/index.js';
import { captureStderr, captureStdout } from '../helpers/capture.js';

const WARN: ZipDiagnostic = {
    code: 'ZIP_DUPLICATE_NAME',
    severity: 'warning',
    message: 'duplicate name — last wins',
    entryName: 'x',
};

const INFO: ZipDiagnostic = {
    code: 'ZIP_MULTIPLE_EOCD',
    severity: 'info',
    message: 'several EOCD candidates',
};

/** A normal archive with an SFX-style stub prepended → the core emits ZIP_PREPENDED_DATA. */
function prependedArchive(): Uint8Array {
    const w = createZip();
    w.add('a.txt', 'hello');
    return new Uint8Array(Buffer.concat([Buffer.from('#!/bin/sh\n'), Buffer.from(w.toBytes())]));
}

afterEach(() => {
    delete process.env['ZIPNATIVE_JSON'];
    delete process.env['ZIPNATIVE_QUIET'];
    vi.restoreAllMocks();
});

describe('createDiagnosticSink', () => {
    it('starts empty', () => {
        const sink = createDiagnosticSink();
        expect(sink.count).toBe(0);
        expect(sink.diagnostics).toEqual([]);
        expect(sink.field()).toEqual({ diagnostics: [] });
    });

    it('collects a real core diagnostic (prepended data) when wired into openZip', () => {
        const err = captureStderr();
        const sink = createDiagnosticSink();
        const reader = openZip(prependedArchive(), { onDiagnostic: sink.onDiagnostic });
        expect(reader.entryCount).toBe(1);
        expect(sink.count).toBe(1);
        expect(sink.diagnostics[0]).toMatchObject({ code: 'ZIP_PREPENDED_DATA', severity: 'info' });
        expect(sink.diagnostics[0]?.entryName).toBeUndefined();
        expect(sink.diagnostics[0]?.message.length).toBeGreaterThan(0);
        expect(err.text()).toMatch(/^info: \[ZIP_PREPENDED_DATA\] /);
        expect(err.text().endsWith('\n')).toBe(true);
    });

    it('text mode writes "warning: [CODE] entry \'x\': msg" to stderr, never stdout', () => {
        const err = captureStderr();
        const out = captureStdout();
        const sink = createDiagnosticSink();
        sink.onDiagnostic(WARN);
        expect(err.text()).toBe("warning: [ZIP_DUPLICATE_NAME] entry 'x': duplicate name — last wins\n");
        expect(out.calls).toBe(0);
    });

    it('omits the entry clause when the diagnostic is archive-scoped', () => {
        const err = captureStderr();
        createDiagnosticSink().onDiagnostic(INFO);
        expect(err.text()).toBe('info: [ZIP_MULTIPLE_EOCD] several EOCD candidates\n');
    });

    it('dedupes by code + entryName', () => {
        const err = captureStderr();
        const sink = createDiagnosticSink();
        sink.onDiagnostic(WARN);
        sink.onDiagnostic({ ...WARN, message: 'different message, same key' });
        sink.onDiagnostic({ ...WARN, entryName: 'y' });
        sink.onDiagnostic({ ...WARN, code: 'ZIP_NAME_MISMATCH' });
        sink.onDiagnostic(INFO);
        sink.onDiagnostic(INFO);
        expect(sink.count).toBe(4);
        expect(sink.diagnostics.map((d) => `${d.code}:${d.entryName ?? ''}`)).toEqual([
            'ZIP_DUPLICATE_NAME:x',
            'ZIP_DUPLICATE_NAME:y',
            'ZIP_NAME_MISMATCH:x',
            'ZIP_MULTIPLE_EOCD:',
        ]);
        expect(sink.diagnostics[0]?.message).toBe(WARN.message); // first wins
        expect(err.calls).toBe(4);
    });

    it('json mode collects silently', () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const err = captureStderr();
        const sink = createDiagnosticSink();
        sink.onDiagnostic(WARN);
        sink.onDiagnostic(INFO);
        expect(err.calls).toBe(0);
        expect(sink.count).toBe(2);
        expect(sink.field()).toEqual({
            diagnostics: [
                { code: 'ZIP_DUPLICATE_NAME', severity: 'warning', message: WARN.message, entryName: 'x' },
                { code: 'ZIP_MULTIPLE_EOCD', severity: 'info', message: INFO.message },
            ],
        });
    });

    it('quiet mode suppresses the text line but still collects', () => {
        process.env['ZIPNATIVE_QUIET'] = '1';
        const err = captureStderr();
        const sink = createDiagnosticSink();
        sink.onDiagnostic(WARN);
        expect(err.calls).toBe(0);
        expect(sink.count).toBe(1);
    });

    it('silent=true never writes text even in text mode', () => {
        const err = captureStderr();
        const sink = createDiagnosticSink(true);
        sink.onDiagnostic(WARN);
        expect(err.calls).toBe(0);
        expect(sink.count).toBe(1);
    });

    it('field() and diagnostics expose the same live rows', () => {
        const sink = createDiagnosticSink(true);
        const rows = sink.diagnostics;
        sink.onDiagnostic(INFO);
        expect(rows).toHaveLength(1);
        expect(sink.field().diagnostics).toBe(sink.diagnostics);
    });

    it('rows never carry an undefined entryName key', () => {
        const sink = createDiagnosticSink(true);
        sink.onDiagnostic(INFO);
        expect(Object.keys(sink.diagnostics[0] as object).sort()).toEqual(['code', 'message', 'severity']);
    });
});

describe('diagnosticRows', () => {
    it('maps core diagnostics to rows without dedup', () => {
        const rows = diagnosticRows([WARN, WARN, INFO]);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toEqual({ code: 'ZIP_DUPLICATE_NAME', severity: 'warning', message: WARN.message, entryName: 'x' });
        expect(rows[2]).toEqual({ code: 'ZIP_MULTIPLE_EOCD', severity: 'info', message: INFO.message });
    });

    it('returns an empty array for no diagnostics', () => {
        expect(diagnosticRows([])).toEqual([]);
    });
});
