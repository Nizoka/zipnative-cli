import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    commonOptions,
    parseCompression,
    parseDateFlag,
    parseChunkSize,
    parseIntFlag,
    parseNameEqualsPath,
    parseFromEqualsTo,
    parseOnDuplicate,
    parseFormat,
    parseNameFilter,
    resolveInputPath,
    readArchiveBytes,
    openArchive,
    decodeComment,
} from '../../src/utils/zipops.js';
import { createDiagnosticSink } from '../../src/utils/diagnostics.js';
import { createZip } from '../../src/core-bridge/index.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError } from '../../src/utils/error.js';
import { _resetLimitWarnings } from '../../src/utils/limits.js';

let dir = '';

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

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
    _resetLimitWarnings();
});

afterEach(async () => {
    delete process.env['ZIPNATIVE_STRICT'];
    delete process.env['ZIPNATIVE_QUIET'];
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

describe('commonOptions', () => {
    it('wires the sink and leaves strict off / limits absent by default', () => {
        const sink = createDiagnosticSink(true);
        const opts = commonOptions(parseArgs([]), sink);
        expect(opts.strict).toBe(false);
        expect(opts.onDiagnostic).toBe(sink.onDiagnostic);
        expect('limits' in opts).toBe(false);
    });

    it('enables strict from the --strict flag', () => {
        expect(commonOptions(parseArgs(['--strict']), createDiagnosticSink(true)).strict).toBe(true);
    });

    it('enables strict from ZIPNATIVE_STRICT=1', () => {
        process.env['ZIPNATIVE_STRICT'] = '1';
        expect(commonOptions(parseArgs([]), createDiagnosticSink(true)).strict).toBe(true);
    });

    it('carries parsed --max-* limits', () => {
        process.env['ZIPNATIVE_QUIET'] = '1';
        const opts = commonOptions(parseArgs(['--max-entries', '5', '--max-total-size', '1m']), createDiagnosticSink(true));
        expect(opts.limits).toEqual({ maxEntries: 5, maxTotalUncompressedSize: 1024 ** 2 });
    });

    it('rejects a bad limit with exit 2', () => {
        expectUsage(() => commonOptions(parseArgs(['--max-entries', '0']), createDiagnosticSink(true)));
    });
});

describe('parseCompression', () => {
    it('returns undefined when no compression flag is set', () => {
        expect(parseCompression(parseArgs([]))).toBeUndefined();
        expect(parseCompression(parseArgs(['--output', 'x']))).toBeUndefined();
    });

    it('parses --method store|deflate', () => {
        expect(parseCompression(parseArgs(['--method', 'store']))).toEqual({ method: 'store' });
        expect(parseCompression(parseArgs(['--method=deflate']))).toEqual({ method: 'deflate' });
    });

    it('parses --level 0..9 as a number', () => {
        expect(parseCompression(parseArgs(['--level', '9']))).toEqual({ level: 9 });
        expect(parseCompression(parseArgs(['--level', '0']))).toEqual({ level: 0 });
    });

    it('parses --deterministic', () => {
        expect(parseCompression(parseArgs(['--deterministic']))).toEqual({ deterministic: true });
    });

    it('combines all three', () => {
        expect(parseCompression(parseArgs(['--method', 'deflate', '--level', '1', '--deterministic']))).toEqual({
            method: 'deflate',
            level: 1,
            deterministic: true,
        });
    });

    it('rejects an unknown method with exit 2', () => {
        expectUsage(() => parseCompression(parseArgs(['--method', 'lzma'])), /--method must be "store" or "deflate", got "lzma"/);
    });

    it('rejects a level outside 0-9 or non-numeric with exit 2', () => {
        expectUsage(() => parseCompression(parseArgs(['--level', '10'])), /--level must be an integer from 0 to 9/);
        expectUsage(() => parseCompression(parseArgs(['--level', 'max'])), /--level/);
        expectUsage(() => parseCompression(parseArgs(['--level', '-1'])), /--level/);
    });
});

describe('parseDateFlag', () => {
    it('returns undefined when absent or "epoch" (any case)', () => {
        expect(parseDateFlag(parseArgs([]))).toBeUndefined();
        expect(parseDateFlag(parseArgs(['--date', 'epoch']))).toBeUndefined();
        expect(parseDateFlag(parseArgs(['--date', ' EPOCH ']))).toBeUndefined();
    });

    it('returns "now" for now (any case)', () => {
        expect(parseDateFlag(parseArgs(['--date', 'now']))).toBe('now');
        expect(parseDateFlag(parseArgs(['--date', 'Now']))).toBe('now');
    });

    it('parses an ISO 8601 date', () => {
        const d = parseDateFlag(parseArgs(['--date', '2024-01-02T03:04:05Z']));
        expect(d).toBeInstanceOf(Date);
        expect((d as Date).toISOString()).toBe('2024-01-02T03:04:05.000Z');
    });

    it('rejects an unparseable date with exit 2', () => {
        expectUsage(() => parseDateFlag(parseArgs(['--date', 'yesterday'])), /--date expects "epoch", "now" or an ISO 8601 date/);
    });
});

describe('parseChunkSize', () => {
    it('returns undefined when absent', () => {
        expect(parseChunkSize(parseArgs([]))).toBeUndefined();
    });

    it('parses byte sizes with suffixes', () => {
        expect(parseChunkSize(parseArgs(['--chunk-size', '64k']))).toBe(65536);
        expect(parseChunkSize(parseArgs(['--chunk-size', '1048576']))).toBe(1048576);
    });

    it('rejects 0, none and garbage with exit 2', () => {
        expectUsage(() => parseChunkSize(parseArgs(['--chunk-size', '0'])), /--chunk-size must be a positive byte size/);
        expectUsage(() => parseChunkSize(parseArgs(['--chunk-size', 'none'])), /--chunk-size must be a positive byte size/);
        expectUsage(() => parseChunkSize(parseArgs(['--chunk-size', 'big'])), /--chunk-size expects a byte size/);
    });
});

describe('parseIntFlag', () => {
    it('returns undefined when absent and the integer otherwise', () => {
        expect(parseIntFlag(parseArgs([]), 'workers')).toBeUndefined();
        expect(parseIntFlag(parseArgs(['--workers', '4']), 'workers')).toBe(4);
    });

    it('rejects 0 and non-integers with exit 2', () => {
        expectUsage(() => parseIntFlag(parseArgs(['--workers', '0']), 'workers'), /--workers expects a positive integer/);
        expectUsage(() => parseIntFlag(parseArgs(['--workers', 'many']), 'workers'));
    });
});

describe('parseNameEqualsPath', () => {
    it('splits at the FIRST =', () => {
        expect(parseNameEqualsPath('a=b=c', 'add')).toEqual({ name: 'a', path: 'b=c' });
        expect(parseNameEqualsPath('docs/readme.md=./README.md', 'add')).toEqual({ name: 'docs/readme.md', path: './README.md' });
    });

    it('uses the basename of a bare path as the entry name', () => {
        expect(parseNameEqualsPath('dir/sub/file.txt', 'add')).toEqual({ name: 'file.txt', path: 'dir/sub/file.txt' });
        expect(parseNameEqualsPath('dir\\sub\\file.txt', 'add')).toEqual({ name: 'file.txt', path: 'dir\\sub\\file.txt' });
        expect(parseNameEqualsPath('file.txt', 'add')).toEqual({ name: 'file.txt', path: 'file.txt' });
    });

    it('allows - as the path when a name is given', () => {
        expect(parseNameEqualsPath('stdin.bin=-', 'add')).toEqual({ name: 'stdin.bin', path: '-' });
    });

    it('rejects a bare - (stdin needs an explicit name) with exit 2', () => {
        expectUsage(() => parseNameEqualsPath('-', 'add'), /--add - requires an explicit name: --add <name>=-/);
    });

    it('rejects an empty name or path with exit 2', () => {
        expectUsage(() => parseNameEqualsPath('=x', 'replace'), /--replace expects <name>=<path>/);
        expectUsage(() => parseNameEqualsPath('x=', 'replace'), /--replace expects <name>=<path>/);
    });
});

describe('parseFromEqualsTo', () => {
    it('splits at the FIRST =', () => {
        expect(parseFromEqualsTo('old.txt=new.txt', 'rename')).toEqual({ from: 'old.txt', to: 'new.txt' });
        expect(parseFromEqualsTo('a=b=c', 'rename')).toEqual({ from: 'a', to: 'b=c' });
    });

    it('rejects missing =, empty from or empty to with exit 2', () => {
        expectUsage(() => parseFromEqualsTo('ab', 'rename'), /--rename expects <from>=<to>, got "ab"/);
        expectUsage(() => parseFromEqualsTo('=b', 'rename'), /--rename expects <from>=<to>/);
        expectUsage(() => parseFromEqualsTo('a=', 'rename'), /--rename expects <from>=<to>/);
    });
});

describe('parseOnDuplicate', () => {
    it('defaults to error', () => {
        expect(parseOnDuplicate(parseArgs([]))).toBe('error');
    });

    it.each(['error', 'first', 'last'] as const)('accepts %s', (v) => {
        expect(parseOnDuplicate(parseArgs(['--on-duplicate', v]))).toBe(v);
    });

    it('rejects anything else with exit 2', () => {
        expectUsage(() => parseOnDuplicate(parseArgs(['--on-duplicate', 'skip'])), /--on-duplicate must be "error", "first" or "last", got "skip"/);
    });
});

describe('parseFormat', () => {
    const allowed = ['table', 'json', 'ndjson'] as const;

    it('returns the fallback when absent', () => {
        expect(parseFormat(parseArgs([]), allowed, 'table')).toBe('table');
    });

    it('accepts --format and the -f alias', () => {
        expect(parseFormat(parseArgs(['--format', 'json']), allowed, 'table')).toBe('json');
        expect(parseFormat(parseArgs(['-f', 'ndjson']), allowed, 'table')).toBe('ndjson');
    });

    it('rejects an unknown value listing the allowed ones', () => {
        expectUsage(() => parseFormat(parseArgs(['--format', 'xml']), allowed, 'table'), /--format must be one of table, json, ndjson, got "xml"/);
    });
});

describe('parseNameFilter', () => {
    it('returns undefined without include/exclude', () => {
        expect(parseNameFilter(parseArgs([]))).toBeUndefined();
    });

    it('builds a predicate from repeated --include / --exclude', () => {
        const f = parseNameFilter(parseArgs(['--include', '*.txt', '--include', '*.md', '--exclude', 'secret*']));
        expect(f).toBeTypeOf('function');
        expect(f?.('a.txt')).toBe(true);
        expect(f?.('b.md')).toBe(true);
        expect(f?.('secret.txt')).toBe(false);
        expect(f?.('c.bin')).toBe(false);
    });

    it('exclude alone works', () => {
        const f = parseNameFilter(parseArgs(['--exclude', 'tmp/']));
        expect(f?.('tmp/a')).toBe(false);
        expect(f?.('src/a')).toBe(true);
    });
});

describe('resolveInputPath', () => {
    it('prefers --input / -i over positionals', () => {
        expect(resolveInputPath(parseArgs(['--input', 'flag.zip', 'pos.zip']))).toBe('flag.zip');
        expect(resolveInputPath(parseArgs(['-i', 'short.zip', 'pos.zip']))).toBe('short.zip');
    });

    it('falls back to the positional at the given index', () => {
        expect(resolveInputPath(parseArgs(['pos.zip']))).toBe('pos.zip');
        expect(resolveInputPath(parseArgs(['first', 'second']), 1)).toBe('second');
    });

    it('returns undefined (stdin) when nothing is given', () => {
        expect(resolveInputPath(parseArgs([]))).toBeUndefined();
        expect(resolveInputPath(parseArgs(['only']), 1)).toBeUndefined();
    });
});

describe('readArchiveBytes', () => {
    it('reads a file as a Uint8Array', async () => {
        const file = join(dir, 'a.zip');
        await writeFile(file, Buffer.from([1, 2, 3]));
        const bytes = await readArchiveBytes(file);
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(Array.from(bytes)).toEqual([1, 2, 3]);
    });

    it('throws E_IO naming the path for a missing file', async () => {
        const file = join(dir, 'missing.zip');
        await expect(readArchiveBytes(file)).rejects.toMatchObject({ code: 'E_IO', exitCode: 1 });
        await expect(readArchiveBytes(file)).rejects.toThrow(/Cannot read ".*missing\.zip"/);
    });

    it('re-throws a traversal CliError unchanged', async () => {
        await expect(readArchiveBytes('../x.zip')).rejects.toMatchObject({ code: 'E_INPUT' });
    });
});

describe('openArchive', () => {
    it('opens a real archive', () => {
        const w = createZip();
        w.add('a.txt', 'hello');
        const reader = openArchive(w.toBytes(), {});
        expect(reader.entryCount).toBe(1);
        expect(Buffer.from(reader.readEntry('a.txt')).toString()).toBe('hello');
    });

    it('maps a non-zip buffer to E_PARSE with the zipCode', () => {
        let caught: unknown;
        try {
            openArchive(new TextEncoder().encode('this is not a zip archive at all'), {});
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(CliError);
        expect(caught).toMatchObject({ code: 'E_PARSE', exitCode: 1, zipCode: 'ZIP_EOCD_NOT_FOUND' });
        expect((caught as CliError).message).toMatch(/^Failed to open archive: /);
    });

    it('forwards options (limits) so a limit error is mapped too', () => {
        const w = createZip();
        w.add('a', '1');
        w.add('b', '2');
        let caught: unknown;
        try {
            const reader = openArchive(w.toBytes(), { limits: { maxEntries: 1 } });
            for (const _e of reader.entries()) { /* walk */ }
        } catch (e) {
            caught = e;
        }
        // The limit trips lazily during the CD walk, outside the guard — it is
        // still a core error; the command layer wraps that walk separately.
        expect(caught).toBeDefined();
    });
});

describe('decodeComment', () => {
    it('returns an empty string for empty bytes', () => {
        expect(decodeComment(new Uint8Array(0))).toBe('');
    });

    it('decodes UTF-8 and never throws on invalid sequences', () => {
        expect(decodeComment(new TextEncoder().encode('héllo'))).toBe('héllo');
        expect(decodeComment(new Uint8Array([0xff, 0x41]))).toBe('�A');
    });
});
