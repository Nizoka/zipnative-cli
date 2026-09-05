// Contract fixes that the documentation audit surfaced (findings D-03, D-04,
// D-05, D-12): the docs stated the intended contract and the code follows.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { govern } from '../../src/commands/govern.js';
import { inflate } from '../../src/commands/inflate.js';
import { stream } from '../../src/commands/stream.js';
import { verify } from '../../src/commands/verify.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';
import { mapZipError } from '../../src/utils/ziperr.js';
import { createZip } from '../../src/core-bridge/index.js';

interface Run {
    readonly text: string;
    readonly err: string;
    readonly error: unknown;
}

async function run(fn: () => Promise<void>): Promise<Run> {
    const outChunks: Buffer[] = [];
    const errChunks: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        outChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
        const cb = rest.find((r) => typeof r === 'function') as ((err?: Error | null) => void) | undefined;
        if (cb !== undefined) cb();
        return true;
    }) as unknown as typeof process.stdout.write);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        errChunks.push(String(chunk));
        return true;
    }) as unknown as typeof process.stderr.write);
    let error: unknown;
    try {
        await fn();
    } catch (e) {
        error = e;
    } finally {
        outSpy.mockRestore();
        errSpy.mockRestore();
    }
    return { text: Buffer.concat(outChunks).toString('utf8'), err: errChunks.join(''), error };
}

let dir = '';
let archive = '';

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-docfix-'));
    const w = createZip();
    w.add('a.txt', 'alpha\n');
    w.add('b.txt', 'bravo\n');
    archive = join(dir, 'in.zip');
    await writeFile(archive, w.toBytes());
});

afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env['ZIPNATIVE_JSON'];
    delete process.env['ZIPNATIVE_PURE_CODECS'];
    await rm(dir, { recursive: true, force: true });
});

describe('govern verify-issue honours --max-input-size (D-03)', () => {
    it('refuses a draft above the bound with E_LIMIT maxInputSize', async () => {
        const draft = join(dir, 'draft.md');
        await writeFile(draft, '# Draft\n\n```\nnode -e 1\n```\n');
        const r = await run(() => govern(parseArgs(['verify-issue', draft, '--max-input-size', '10'])));
        expect(r.error).toMatchObject({ code: ErrorCode.LIMIT, detail: { limit: 'maxInputSize', configured: 10 } });
        const ok = await run(() => govern(parseArgs(['verify-issue', draft, '--format', 'json'])));
        expect(ok.error).toBeUndefined();
        expect(JSON.parse(ok.text)).toMatchObject({ ok: true });
    });
});

describe('unwrapped node:zlib errors map to the deflate classes (D-04)', () => {
    it('mapZipError: Z_DATA_ERROR → E_PARSE ZIP_DEFLATE_CORRUPT, Z_BUF_ERROR → E_PARSE ZIP_DEFLATE_TRUNCATED', () => {
        const data = Object.assign(new Error('invalid distance too far back'), { code: 'Z_DATA_ERROR' });
        expect(mapZipError(data, 'Inflate failed', 'x.bin')).toMatchObject({ code: ErrorCode.PARSE, exitCode: 1, zipCode: 'ZIP_DEFLATE_CORRUPT', entryName: 'x.bin' });
        const buf = Object.assign(new Error('unexpected end of file'), { code: 'Z_BUF_ERROR' });
        expect(mapZipError(buf, 'Inflate failed')).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_DEFLATE_TRUNCATED' });
        const other = Object.assign(new Error('nope'), { code: 'Z_STREAM_ERROR' });
        expect(mapZipError(other, 'ctx').code).toBe(ErrorCode.RUNTIME);
    });

    it('inflate --sync on the node-zlib tier: corrupt → E_PARSE / ZIP_DEFLATE_CORRUPT, truncated → ZIP_DEFLATE_TRUNCATED', async () => {
        const corrupt = join(dir, 'corrupt.deflate');
        await writeFile(corrupt, Buffer.from('this is not a deflate stream at all, not even close to one'));
        const r = await run(() => inflate(parseArgs(['--input', corrupt, '--sync', '--output', join(dir, 'o1.bin')])));
        expect(r.error).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_DEFLATE_CORRUPT' });
        const whole = deflateRawSync(Buffer.from('truncate me '.repeat(200)));
        const truncated = join(dir, 'truncated.deflate');
        await writeFile(truncated, whole.subarray(0, Math.floor(whole.length / 2)));
        const t = await run(() => inflate(parseArgs(['--input', truncated, '--sync', '--output', join(dir, 'o2.bin')])));
        expect(t.error).toMatchObject({ code: ErrorCode.PARSE, zipCode: 'ZIP_DEFLATE_TRUNCATED' });
    });
});

describe('stream --json --summary selects the json report (D-05)', () => {
    it('prints the summary document, not NDJSON rows; explicit --format ndjson keeps the rows', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const r = await run(() => stream(parseArgs([archive, '--summary'])));
        expect(r.error).toBeUndefined();
        expect(JSON.parse(r.text)).toEqual({ entries: 2, bytes: 12, descriptorEntries: 0, bytesKnown: true, trust: 'local-headers-only' });
        const f = await run(() => stream(parseArgs([archive, '--fields', 'entries.name'])));
        expect(JSON.parse(f.text)).toEqual({ entries: [{ name: 'a.txt' }, { name: 'b.txt' }] });
        const nd = await run(() => stream(parseArgs([archive, '--format', 'ndjson', '--summary'])));
        expect(nd.text.trim().split('\n')).toHaveLength(2);
    });
});

describe('verify --entry names the remedy (D-12)', () => {
    it('E_NOT_FOUND message points at zipnative list', async () => {
        const r = await run(() => verify(parseArgs([archive, '-e', 'nope', '--format', 'json'])));
        expect(r.error).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND', entryName: 'nope' });
        expect((r.error as Error).message).toMatch(/run `zipnative list`/);
    });
});
