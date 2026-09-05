import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    PROJECTED_COMMANDS,
    emitJsonReport,
    parseFieldList,
    selectFields,
    serializeJson,
} from '../../src/utils/projection.js';
import { parseArgs } from '../../src/utils/args.js';
import { captureStdout } from '../helpers/capture.js';

describe('PROJECTED_COMMANDS', () => {
    it('is exactly the five JSON-on-stdout commands', () => {
        expect([...PROJECTED_COMMANDS]).toEqual(['list', 'inspect', 'verify', 'stream', 'batch']);
    });
});

describe('parseFieldList', () => {
    it('splits, trims and drops empty entries', () => {
        expect(parseFieldList('a, b ,,c')).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty array for a blank string', () => {
        expect(parseFieldList('   ')).toEqual([]);
        expect(parseFieldList('')).toEqual([]);
    });

    it('keeps dot-paths intact', () => {
        expect(parseFieldList('entries.name,entries.crc32')).toEqual(['entries.name', 'entries.crc32']);
    });
});

describe('serializeJson', () => {
    const value = { a: 1, b: [2, 3] };

    it('emits compact JSON (no indentation) when pretty is false', () => {
        const out = serializeJson(value, false);
        expect(out).toBe('{"a":1,"b":[2,3]}');
        expect(out).not.toContain('\n');
    });

    it('emits 2-space pretty JSON when pretty is true', () => {
        const out = serializeJson(value, true);
        expect(out).toContain('\n');
        expect(out).toContain('  "a": 1');
    });

    it('compact is strictly smaller than pretty for the same value', () => {
        expect(serializeJson(value, false).length).toBeLessThan(serializeJson(value, true).length);
    });

    it('both forms round-trip', () => {
        expect(JSON.parse(serializeJson(value, false))).toEqual(value);
        expect(JSON.parse(serializeJson(value, true))).toEqual(value);
    });
});

describe('selectFields', () => {
    const result = {
        archive: 'a.zip',
        entryCount: 2,
        isZip64: false,
        comment: { text: 'hi', bytes: 2 },
        entries: [
            { name: 'a.txt', crc32: '00000001', method: 8, flags: { utf8: true } },
            { name: 'b.txt', crc32: '00000002', method: 0, flags: { utf8: false } },
        ],
        ok: true,
    };

    it('projects a single top-level scalar path', () => {
        expect(selectFields(result, ['entryCount'])).toEqual({ entryCount: 2 });
    });

    it('preserves nesting for a dotted path', () => {
        expect(selectFields(result, ['comment.text'])).toEqual({ comment: { text: 'hi' } });
    });

    it('maps an array segment over every element', () => {
        expect(selectFields(result, ['entries.name'])).toEqual({
            entries: [{ name: 'a.txt' }, { name: 'b.txt' }],
        });
    });

    it('walks nested objects inside array elements', () => {
        expect(selectFields(result, ['entries.flags.utf8'])).toEqual({
            entries: [{ flags: { utf8: true } }, { flags: { utf8: false } }],
        });
    });

    it('deep-merges multiple paths into one object', () => {
        expect(selectFields(result, ['ok', 'entries.name', 'entries.crc32'])).toEqual({
            ok: true,
            entries: [
                { name: 'a.txt', crc32: '00000001' },
                { name: 'b.txt', crc32: '00000002' },
            ],
        });
    });

    it('silently omits unknown paths (lenient)', () => {
        expect(selectFields(result, ['nope', 'comment.missing', 'entryCount.deeper'])).toEqual({});
    });

    it('keeps an entire subtree when the path is a container', () => {
        expect(selectFields(result, ['comment'])).toEqual({ comment: { text: 'hi', bytes: 2 } });
    });

    it('returns an empty object when no paths resolve or the list is empty', () => {
        expect(selectFields(result, [])).toEqual({});
        expect(selectFields(result, ['', ' . '])).toEqual({});
    });

    it('lets the last path win on a scalar conflict and merges a subtree with a leaf', () => {
        expect(selectFields(result, ['comment', 'comment.text'])).toEqual({ comment: { text: 'hi', bytes: 2 } });
    });

    it('projects a top-level array', () => {
        expect(selectFields([{ a: 1, b: 2 }, { a: 3 }], ['a'])).toEqual([{ a: 1 }, { a: 3 }]);
    });

    it('trims whitespace inside segments', () => {
        expect(selectFields(result, [' comment . text '])).toEqual({ comment: { text: 'hi' } });
    });
});

describe('emitJsonReport', () => {
    const full = { archive: 'a.zip', entryCount: 2, entries: [{ name: 'x' }, { name: 'y' }] };
    const summary = (): unknown => ({ entryCount: 2 });

    afterEach(() => {
        delete process.env['ZIPNATIVE_JSON'];
        vi.restoreAllMocks();
    });

    it('writes the full report pretty-printed outside json mode', () => {
        const out = captureStdout();
        emitJsonReport(parseArgs([]), full, summary);
        expect(out.text().endsWith('\n')).toBe(true);
        expect(out.text()).toContain('\n  "archive"');
        expect(JSON.parse(out.text())).toEqual(full);
    });

    it('writes compact output in json mode', () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const out = captureStdout();
        emitJsonReport(parseArgs([]), full);
        expect(out.text()).toBe(JSON.stringify(full) + '\n');
    });

    it('honours --pretty in json mode', () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const out = captureStdout();
        emitJsonReport(parseArgs(['--pretty']), full);
        expect(out.text()).toContain('\n  "archive"');
    });

    it('--summary selects the summary shape and --fields then projects it', () => {
        const out = captureStdout();
        emitJsonReport(parseArgs(['--summary', '--fields', 'entryCount']), full, summary);
        expect(JSON.parse(out.text())).toEqual({ entryCount: 2 });
    });

    it('--fields on a summary omits paths the summary does not have', () => {
        const out = captureStdout();
        emitJsonReport(parseArgs(['--summary', '--fields', 'archive']), full, summary);
        expect(JSON.parse(out.text())).toEqual({});
    });

    it('--summary without a summary function falls back to --fields / full', () => {
        const out = captureStdout();
        emitJsonReport(parseArgs(['--summary', '--fields', 'archive']), full);
        expect(JSON.parse(out.text())).toEqual({ archive: 'a.zip' });
    });

    it('--fields projects the full report', () => {
        const out = captureStdout();
        emitJsonReport(parseArgs(['--fields', 'entries.name,entryCount']), full, summary);
        expect(JSON.parse(out.text())).toEqual({ entries: [{ name: 'x' }, { name: 'y' }], entryCount: 2 });
    });

    it('writes exactly one stdout call', () => {
        const out = captureStdout();
        emitJsonReport(parseArgs([]), full);
        expect(out.calls).toBe(1);
    });
});
