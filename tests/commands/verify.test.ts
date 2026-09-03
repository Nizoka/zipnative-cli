import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { verify, type VerifyReport } from '../../src/commands/verify.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError } from '../../src/utils/error.js';
import { createZip, openZip, type ZipEntry } from '../../src/core-bridge/index.js';

// ── Local helpers ────────────────────────────────────────────────────

const ENV_KEYS = ['ZIPNATIVE_JSON', 'ZIPNATIVE_DRY_RUN', 'ZIPNATIVE_QUIET', 'ZIPNATIVE_STRICT'] as const;
const savedEnv: Record<string, string | undefined> = {};

interface Capture {
    text(): string;
}

function mockWrite(stream: NodeJS.WriteStream): Capture {
    const chunks: Buffer[] = [];
    const impl = (chunk: unknown, enc?: unknown, cb?: unknown): boolean => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
        const done = typeof enc === 'function' ? enc : cb;
        if (typeof done === 'function') (done as () => void)();
        return true;
    };
    vi.spyOn(stream, 'write').mockImplementation(impl as typeof stream.write);
    return { text: () => Buffer.concat(chunks).toString('utf8') };
}

const captureStdout = (): Capture => mockWrite(process.stdout);

let tmp: string;

async function save(name: string, bytes: Uint8Array): Promise<string> {
    const path = join(tmp, name);
    await writeFile(path, bytes);
    return path;
}

async function goodZip(): Promise<string> {
    const w = createZip();
    w.add('a.txt', 'alpha alpha alpha alpha\n');
    w.add('b/c.txt', 'gamma\n');
    w.addDirectory('d');
    return save('good.zip', w.toBytes());
}

/** STORE archive with one payload byte flipped inside `a.txt`. */
async function corruptZip(): Promise<string> {
    const w = createZip({ compression: { method: 'store' } });
    w.add('a.txt', 'hello world, stored verbatim\n');
    w.add('b.txt', 'untouched\n');
    const bytes = w.toBytes();
    const entry = openZip(bytes).getEntry('a.txt') as ZipEntry;
    const dataOffset = entry.localHeaderOffset + 30 + entry.rawName.length;
    const copy = new Uint8Array(bytes);
    copy[dataOffset + 1] = (bytes[dataOffset + 1] as number) ^ 0xff;
    return save('corrupt.zip', copy);
}

async function prependedZip(): Promise<string> {
    const w = createZip();
    w.add('a.txt', 'alpha\n');
    return save('prefixed.zip', new Uint8Array(Buffer.concat([Buffer.from('JUNKJUNKJUNKJUNK'), Buffer.from(w.toBytes())])));
}

async function run(argv: string[]): Promise<{ text: string; err: CliError | undefined }> {
    const out = captureStdout();
    const err = await verify(parseArgs(argv)).then(() => undefined, (e: unknown) => e);
    if (err !== undefined && !(err instanceof CliError)) throw err;
    return { text: out.text(), err: err as CliError | undefined };
}

async function runJson(argv: string[]): Promise<{ report: VerifyReport; err: CliError | undefined }> {
    const { text, err } = await run([...argv, '--format', 'json']);
    return { report: JSON.parse(text) as VerifyReport, err };
}

beforeEach(async () => {
    for (const k of ENV_KEYS) {
        savedEnv[k] = process.env[k];
        delete process.env[k];
    }
    tmp = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
});

afterEach(async () => {
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
    await rm(tmp, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────

describe('verify', () => {
    it('reports ok for an intact archive (json)', async () => {
        const zip = await goodZip();
        const { report, err } = await runJson(['--input', zip]);
        expect(err).toBeUndefined();
        expect(report).toEqual({
            ok: true,
            error: null,
            entryCount: 3,
            entries: [
                { name: 'a.txt', ok: true, crcMatch: true, sizeMatch: true, localHeaderMatch: true },
                { name: 'b/c.txt', ok: true, crcMatch: true, sizeMatch: true, localHeaderMatch: true },
                { name: 'd/', ok: true, crcMatch: true, sizeMatch: true, localHeaderMatch: true },
            ],
            diagnostics: [],
            failed: 0,
            skipped: 0,
            strict: false,
        });
    });

    it('text output lists every entry and an OK verdict', async () => {
        const zip = await goodZip();
        const { text, err } = await run(['--input', zip]);
        expect(err).toBeUndefined();
        expect(text).toContain(`Verify: ${zip}`);
        expect(text).toContain('  ok    a.txt');
        expect(text).toContain('  ok    b/c.txt');
        expect(text).toContain('  ok    d/');
        expect(text.trimEnd().endsWith('OK: 3 entries, 0 skipped, 0 diagnostics')).toBe(true);
    });

    it('accepts a positional archive path', async () => {
        const zip = await goodZip();
        const { text, err } = await run([zip]);
        expect(err).toBeUndefined();
        expect(text).toContain('OK:');
    });

    it('a corrupted STORED payload fails the CRC and throws E_VERIFY_FAILED after the report', async () => {
        const zip = await corruptZip();
        const { report, err } = await runJson(['--input', zip]);
        expect(report.ok).toBe(false);
        expect(report.error).toBeNull();
        expect(report.failed).toBe(1);
        expect(report.entries[0]).toMatchObject({ name: 'a.txt', ok: false, crcMatch: false, sizeMatch: true, localHeaderMatch: true });
        expect(report.entries[1]).toMatchObject({ name: 'b.txt', ok: true });
        expect(err).toBeInstanceOf(CliError);
        expect(err?.code).toBe('E_VERIFY_FAILED');
        expect(err?.exitCode).toBe(1);
        expect(err?.zipCode).toBeUndefined();
        expect(err?.message).toBe('1 of 2 entries failed verification');
    });

    it('text output marks the failing entry and a FAILED verdict', async () => {
        const zip = await corruptZip();
        const { text, err } = await run(['--input', zip]);
        expect(text).toContain('  FAIL  a.txt  (crc)');
        expect(text).toContain('  ok    b.txt');
        expect(text).toContain('FAILED: 1 failed of 2 entries');
        expect(err?.code).toBe('E_VERIFY_FAILED');
        // text mode: the verdict is already on stdout, the error carries no message
        expect(err?.message).toBe('');
    });

    it('a non-zip file lands in report.error and throws with zipCode ZIP_EOCD_NOT_FOUND', async () => {
        const bad = await save('bad.zip', new TextEncoder().encode('this is definitely not a zip archive'));
        const { report, err } = await runJson(['--input', bad]);
        expect(report.ok).toBe(false);
        expect(report.error?.code).toBe('ZIP_EOCD_NOT_FOUND');
        expect(report.entryCount).toBe(0);
        expect(report.entries).toEqual([]);
        expect(err?.code).toBe('E_VERIFY_FAILED');
        expect(err?.zipCode).toBe('ZIP_EOCD_NOT_FOUND');
        expect(err?.message).toBe(report.error?.message);

        const { text } = await run(['--input', bad]);
        expect(text).toContain('STRUCTURE  ZIP_EOCD_NOT_FOUND:');
        expect(text).toContain('FAILED: 0 failed of 0 entries (ZIP_EOCD_NOT_FOUND)');
    });

    it('diagnostics are reported but do not fail the archive without --strict', async () => {
        const zip = await prependedZip();
        const { report, err } = await runJson(['--input', zip]);
        expect(err).toBeUndefined();
        expect(report.ok).toBe(true);
        expect(report.diagnostics.map((d) => d.code)).toEqual(['ZIP_PREPENDED_DATA']);
        const { text } = await run(['--input', zip]);
        expect(text).toContain('[ZIP_PREPENDED_DATA]');
        expect(text).toContain('1 diagnostics');
    });

    it('--strict fails an archive with a diagnostic (E_VERIFY_FAILED, no zipCode)', async () => {
        const zip = await prependedZip();
        const { report, err } = await runJson(['--input', zip, '--strict']);
        expect(report.ok).toBe(false);
        expect(report.strict).toBe(true);
        expect(report.error).toBeNull();
        expect(report.failed).toBe(0);
        expect(err?.code).toBe('E_VERIFY_FAILED');
        expect(err?.zipCode).toBeUndefined();
        expect(err?.message).toContain('1 diagnostic(s) under --strict: ZIP_PREPENDED_DATA');

        process.env['ZIPNATIVE_STRICT'] = '1';
        const viaEnv = await runJson(['--input', zip]);
        expect(viaEnv.report.strict).toBe(true);
        expect(viaEnv.err?.code).toBe('E_VERIFY_FAILED');

        // strict + intact archive without diagnostics still passes
        const good = await runJson(['--input', await goodZip()]);
        expect(good.err).toBeUndefined();
        expect(good.report.strict).toBe(true);
    });

    it('--summary emits the minimal verdict', async () => {
        const zip = await goodZip();
        const { text, err } = await run(['--input', zip, '--format', 'json', '--summary']);
        expect(err).toBeUndefined();
        expect(JSON.parse(text)).toEqual({ ok: true, entries: 3, failed: 0, skipped: 0, diagnostics: 0 });

        const bad = await save('bad.zip', new TextEncoder().encode('this is definitely not a zip archive'));
        const failing = await run(['--input', bad, '--format', 'json', '--summary']);
        expect(JSON.parse(failing.text)).toEqual({ ok: false, entries: 0, failed: 0, skipped: 0, diagnostics: 0, error: 'ZIP_EOCD_NOT_FOUND' });
    });

    it('--fields projects the report', async () => {
        const zip = await corruptZip();
        const { text, err } = await run(['--input', zip, '--format', 'json', '--fields', 'ok,entries.name,entries.crcMatch']);
        expect(err?.code).toBe('E_VERIFY_FAILED');
        expect(JSON.parse(text)).toEqual({
            ok: false,
            entries: [{ name: 'a.txt', crcMatch: false }, { name: 'b.txt', crcMatch: true }],
        });
    });

    it('defaults to compact json under ZIPNATIVE_JSON', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const zip = await goodZip();
        const { text, err } = await run(['--input', zip]);
        expect(err).toBeUndefined();
        expect(text.trimEnd()).not.toContain('\n');
        expect((JSON.parse(text) as VerifyReport).ok).toBe(true);
    });

    it('--max-* limits are forwarded to verifyZip', async () => {
        const zip = await goodZip();
        const { report, err } = await runJson(['--input', zip, '--max-entry-size', '1']);
        expect(report.ok).toBe(false);
        expect(err?.code).toBe('E_VERIFY_FAILED');
        await expect(verify(parseArgs(['--input', zip, '--max-entries', 'many']))).rejects.toMatchObject({ exitCode: 2 });
    });

    it('--format bogus is a usage error and a missing archive is E_IO', async () => {
        const zip = await goodZip();
        await expect(verify(parseArgs(['--input', zip, '--format', 'xml']))).rejects.toMatchObject({ exitCode: 2 });
        await expect(verify(parseArgs(['--input', join(tmp, 'missing.zip')]))).rejects.toMatchObject({ code: 'E_IO' });
    });

    it('the corrupted fixture really differs from the intact bytes in exactly one byte', async () => {
        const zip = await corruptZip();
        const bytes = await readFile(zip);
        const w = createZip({ compression: { method: 'store' } });
        w.add('a.txt', 'hello world, stored verbatim\n');
        w.add('b.txt', 'untouched\n');
        const intact = Buffer.from(w.toBytes());
        expect(bytes.length).toBe(intact.length);
        let diff = 0;
        for (let i = 0; i < bytes.length; i++) if (bytes[i] !== intact[i]) diff++;
        expect(diff).toBe(1);
    });
});
