import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { inspect, parseChecks, type CheckResult, type InspectReport } from '../../src/commands/inspect.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError } from '../../src/utils/error.js';
import { crc32, createZip } from '../../src/core-bridge/index.js';

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

/** Minimal raw ZIP builder (STORE only) for shapes the writer refuses to produce. */
interface RawEntry {
    readonly name: string;
    readonly data: Uint8Array;
    /** Raw name bytes (defaults to UTF-8 of `name`). */
    readonly rawName?: Uint8Array;
    readonly flags?: number;
    readonly externalAttributes?: number;
    readonly versionMadeBy?: number;
    readonly extra?: Uint8Array;
}

function u16(v: number): number[] { return [v & 0xff, (v >>> 8) & 0xff]; }
function u32(v: number): number[] { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

function buildRawZip(entries: readonly RawEntry[]): Uint8Array {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const cd: Uint8Array[] = [];
    let offset = 0;
    for (const e of entries) {
        const name = e.rawName ?? enc.encode(e.name);
        const extra = e.extra ?? new Uint8Array(0);
        const crc = crc32(e.data) >>> 0;
        const flags = e.flags ?? 0x0800;
        const lfh = Uint8Array.from([
            ...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(0), ...u16(0), ...u16(0x21),
            ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(name.length), ...u16(extra.length),
        ]);
        parts.push(lfh, name, extra, e.data);
        cd.push(Uint8Array.from([
            ...u32(0x02014b50), ...u16(e.versionMadeBy ?? ((3 << 8) | 20)), ...u16(20), ...u16(flags), ...u16(0), ...u16(0), ...u16(0x21),
            ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(name.length), ...u16(extra.length), ...u16(0),
            ...u16(0), ...u16(0), ...u32(e.externalAttributes ?? 0), ...u32(offset),
        ]), name, extra);
        offset += lfh.length + name.length + extra.length + e.data.length;
    }
    const cdLen = cd.reduce((n, c) => n + c.length, 0);
    const eocd = Uint8Array.from([
        ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
        ...u32(cdLen), ...u32(offset), ...u16(0),
    ]);
    const out = new Uint8Array(offset + cdLen + eocd.length);
    let p = 0;
    for (const x of [...parts, ...cd, eocd]) { out.set(x, p); p += x.length; }
    return out;
}

let tmp: string;
const enc = new TextEncoder();

async function save(name: string, bytes: Uint8Array): Promise<string> {
    const path = join(tmp, name);
    await writeFile(path, bytes);
    return path;
}

// Compressible payloads: the core STOREs an entry when deflate would not shrink it.
const A_TEXT = 'alpha '.repeat(20) + '\n';
const C_TEXT = 'gamma '.repeat(10) + '\n';
const DET_TOTAL = A_TEXT.length + C_TEXT.length;

/** Canonical, epoch-dated, buffered — the writer's deterministic default (2 deflated files + 1 stored dir). */
async function deterministicZip(): Promise<string> {
    const w = createZip();
    w.add('a.txt', A_TEXT);
    w.add('b/c.txt', C_TEXT);
    w.addDirectory('d');
    return save('det.zip', w.toBytes());
}

/** Files only, all deflated — for the *-only / method= gates. */
async function deflateZip(): Promise<string> {
    const w = createZip();
    w.add('a.txt', A_TEXT);
    w.add('b/c.txt', C_TEXT);
    return save('deflate.zip', w.toBytes());
}

async function storeZip(): Promise<string> {
    const w = createZip({ compression: { method: 'store' } });
    w.add('a.txt', 'alpha\n');
    return save('store.zip', w.toBytes());
}

async function nowZip(): Promise<string> {
    const w = createZip({ defaultDate: 'now', onDiagnostic: () => undefined });
    w.add('a.txt', 'alpha\n');
    return save('now.zip', w.toBytes());
}

async function insertionZip(): Promise<string> {
    const w = createZip({ order: 'insertion' });
    w.add('z.txt', 'z\n');
    w.add('a.txt', 'a\n');
    return save('insertion.zip', w.toBytes());
}

async function streamedZip(): Promise<string> {
    const w = createZip();
    w.addStream('s.txt', (async function* () { yield enc.encode('streamed content\n'); })());
    const chunks: Uint8Array[] = [];
    for await (const c of w.stream()) chunks.push(c);
    return save('streamed.zip', new Uint8Array(Buffer.concat(chunks)));
}

async function prependedZip(): Promise<string> {
    const w = createZip();
    w.add('a.txt', 'alpha\n');
    return save('prefixed.zip', new Uint8Array(Buffer.concat([Buffer.from('JUNKJUNKJUNKJUNK'), Buffer.from(w.toBytes())])));
}

async function run(argv: string[]): Promise<{ text: string; err: unknown }> {
    const out = captureStdout();
    const err = await inspect(parseArgs(argv)).then(() => undefined, (e: unknown) => e);
    return { text: out.text(), err };
}

async function runJson(argv: string[]): Promise<InspectReport> {
    const { text, err } = await run([...argv, '--format', 'json']);
    if (err !== undefined) throw err;
    return JSON.parse(text) as InspectReport;
}

/** Run `--check` and return (report, thrown error) — the report prints before the throw. */
async function check(zip: string, checks: string, extra: string[] = []): Promise<{ report: InspectReport; err: CliError | undefined }> {
    const { text, err } = await run(['--input', zip, '--check', checks, '--format', 'json', ...extra]);
    if (err !== undefined && !(err instanceof CliError)) throw err;
    return { report: JSON.parse(text) as InspectReport, err: err as CliError | undefined };
}

function expectPass(r: { report: InspectReport; err: CliError | undefined }): void {
    expect(r.err).toBeUndefined();
    expect((r.report.checks ?? []).every((c) => c.ok)).toBe(true);
}

function expectFail(r: { report: InspectReport; err: CliError | undefined }, name: string): void {
    expect(r.err).toBeInstanceOf(CliError);
    expect(r.err?.code).toBe('E_CHECK_FAILED');
    expect(r.err?.exitCode).toBe(1);
    const failed = (r.report.checks ?? []).filter((c) => !c.ok).map((c) => c.check);
    expect(failed).toContain(name);
    expect(r.err?.message).toContain(name);
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

describe('inspect', () => {
    describe('report', () => {
        it('json has archive, stats, determinism and diagnostics', async () => {
            const zip = await deterministicZip();
            const doc = await runJson(['--input', zip]);
            expect(doc.archive).toEqual({
                bytes: (await readFile(zip)).length,
                entryCount: 3,
                isZip64: false,
                comment: '',
                commentBytes: 0,
                prependedData: false,
                multipleEocd: false,
            });
            expect(doc.stats).toMatchObject({
                files: 2,
                directories: 1,
                methods: { '8': 2, '0': 1 },
                encrypted: 0,
                symlinks: 0,
                dataDescriptor: 0,
                zip64Entries: 0,
                utf8Names: 3,
                cp437Names: 0,
                duplicateNames: 0,
                unsafeNames: 0,
            });
            expect(doc.stats.uncompressedSize).toBe(DET_TOTAL);
            expect(doc.stats.ratio).toMatch(/^\d+%$/);
            expect(doc.stats.earliestDate).toBe(doc.stats.latestDate);
            expect(doc.determinism).toEqual({
                epochTimestamps: true,
                canonicalOrder: true,
                utf8Flags: true,
                noDataDescriptors: true,
                canonicalLayout: true,
                deterministic: true,
            });
            expect(doc.diagnostics).toEqual([]);
            expect(doc.entries).toBeUndefined();
            expect(doc.checks).toBeUndefined();
        });

        it('a defaultDate: now archive is not deterministic (epochTimestamps false)', async () => {
            const doc = await runJson(['--input', await nowZip()]);
            expect(doc.determinism.epochTimestamps).toBe(false);
            expect(doc.determinism.deterministic).toBe(false);
        });

        it('an insertion-ordered archive breaks canonicalOrder', async () => {
            const doc = await runJson(['--input', await insertionZip()]);
            expect(doc.determinism.canonicalOrder).toBe(false);
            expect(doc.determinism.epochTimestamps).toBe(true);
        });

        it('a streamed archive is reproducible but not canonical (data descriptors)', async () => {
            const doc = await runJson(['--input', await streamedZip()]);
            expect(doc.stats.dataDescriptor).toBe(1);
            expect(doc.determinism.noDataDescriptors).toBe(false);
            expect(doc.determinism.canonicalLayout).toBe(false);
            // The data-descriptor layout is byte-stable for identical inputs:
            // it must not falsify the reproducibility verdict.
            expect(doc.determinism.deterministic).toBe(true);
        });

        it('prependedData is true on a prefixed archive and the diagnostic is reported', async () => {
            const doc = await runJson(['--input', await prependedZip()]);
            expect(doc.archive.prependedData).toBe(true);
            expect(doc.diagnostics.map((d) => d.code)).toEqual(['ZIP_PREPENDED_DATA']);
            expect(doc.diagnostics[0]?.severity).toMatch(/^(warning|info)$/);
        });

        it('--entries adds long rows', async () => {
            const zip = await deterministicZip();
            const doc = await runJson(['--input', zip, '--entries']);
            expect(doc.entries?.map((e) => e.name)).toEqual(['a.txt', 'b/c.txt', 'd/']);
            const a = doc.entries?.[0];
            expect(a?.flags).toBeDefined();
            expect(a?.localHeaderOffset).toBe(0);
            expect(a?.extraFields).toEqual([]);
        });

        it('--entry selects a subset; a missing name is E_NOT_FOUND', async () => {
            const zip = await deterministicZip();
            const doc = await runJson(['--input', zip, '--entry', 'b/c.txt', '--entry', 'a.txt']);
            expect(doc.entries?.map((e) => e.name)).toEqual(['b/c.txt', 'a.txt']);
            await expect(inspect(parseArgs(['--input', zip, '--entry', 'nope.txt', '--format', 'json'])))
                .rejects.toMatchObject({ code: 'E_NOT_FOUND', exitCode: 1, entryName: 'nope.txt' });
        });

        it('--extra renders extra-field payloads as hex', async () => {
            // UT (0x5455) extra: flags=1 (mtime present) + 4-byte epoch seconds.
            const ut = Uint8Array.from([0x55, 0x54, 5, 0, 0x01, 0x00, 0x00, 0x00, 0x00]);
            const zip = await save('extra.zip', buildRawZip([{ name: 'a.txt', data: enc.encode('x'), extra: ut }]));
            const doc = await runJson(['--input', zip, '--entries', '--extra']);
            const fields = doc.entries?.[0]?.extraFields;
            expect(fields).toHaveLength(1);
            expect(fields?.[0]).toEqual({ id: 0x5455, idHex: '0x5455', name: 'Extended timestamp (UT)', length: 5, hex: '0100000000' });
            const without = await runJson(['--input', zip, '--entries']);
            expect(without.entries?.[0]?.extraFields?.[0]?.hex).toBeUndefined();
            const { text } = await run(['--input', zip, '--entries', '--extra']);
            expect(text).toContain('extra: 0x5455 Extended timestamp (UT) (5 bytes) 0100000000');
        });

        it('text rendering includes the archive, contents and determinism sections', async () => {
            const zip = await deterministicZip();
            const { text, err } = await run(['--input', zip, '--entries']);
            expect(err).toBeUndefined();
            expect(text).toContain(`Archive: ${zip}`);
            expect(text).toContain('Contents:');
            expect(text).toContain('Determinism: reproducible, layout canonical');
            expect(text).toMatch(/methods {9}(deflate=2, store=1|store=1, deflate=2)/);
            expect(text).toContain('Entries (3):');
            expect(text).toContain('flags 0x0800');
            expect(text).not.toContain('Diagnostics');
            const prefixed = await run(['--input', await prependedZip()]);
            expect(prefixed.text).toContain('Determinism: reproducible, layout canonical');
            expect(prefixed.text).toContain('prepended data  true');
            expect(prefixed.text).toContain('Diagnostics (1):');
            expect(prefixed.text).toContain('[ZIP_PREPENDED_DATA]');
        });

        it('--summary emits the minimal verdict (checksPassed only with --check)', async () => {
            const zip = await deterministicZip();
            const { text } = await run(['--input', zip, '--format', 'json', '--summary']);
            const doc = JSON.parse(text) as Record<string, unknown>;
            expect(doc).toEqual({
                entries: 3,
                bytes: expect.any(Number),
                uncompressedSize: DET_TOTAL,
                zip64: false,
                encrypted: 0,
                deterministic: true,
                canonicalLayout: true,
                diagnostics: 0,
            });
            const withCheck = await run(['--input', zip, '--format', 'json', '--summary', '--check', 'deterministic']);
            expect((JSON.parse(withCheck.text) as Record<string, unknown>)['checksPassed']).toBe(true);
            const failing = await run(['--input', zip, '--format', 'json', '--summary', '--check', 'zip64']);
            expect((JSON.parse(failing.text) as Record<string, unknown>)['checksPassed']).toBe(false);
            expect(failing.err).toBeInstanceOf(CliError);
        });

        it('--fields projects the json report', async () => {
            const zip = await deterministicZip();
            const { text } = await run(['--input', zip, '--format', 'json', '--fields', 'determinism.deterministic,stats.files']);
            expect(JSON.parse(text)).toEqual({ determinism: { deterministic: true }, stats: { files: 2 } });
        });

        it('compact json under ZIPNATIVE_JSON', async () => {
            process.env['ZIPNATIVE_JSON'] = '1';
            const zip = await deterministicZip();
            const { text } = await run(['--input', zip]);
            expect(text.trimEnd()).not.toContain('\n');
            expect((JSON.parse(text) as InspectReport).determinism.deterministic).toBe(true);
        });

        it('--strict escalates a diagnostic to E_CHECK_FAILED / ZIP_STRICT_DIAGNOSTIC', async () => {
            const zip = await prependedZip();
            await expect(inspect(parseArgs(['--input', zip, '--strict'])))
                .rejects.toMatchObject({ code: 'E_CHECK_FAILED', zipCode: 'ZIP_STRICT_DIAGNOSTIC' });
            process.env['ZIPNATIVE_STRICT'] = '1';
            await expect(inspect(parseArgs(['--input', zip])))
                .rejects.toMatchObject({ code: 'E_CHECK_FAILED', zipCode: 'ZIP_STRICT_DIAGNOSTIC' });
        });

        it('non-zip input is E_PARSE, a missing file is E_IO, --format bogus is exit 2', async () => {
            const bad = await save('bad.zip', enc.encode('nothing like a zip archive here'));
            await expect(inspect(parseArgs(['--input', bad]))).rejects.toMatchObject({ code: 'E_PARSE', zipCode: 'ZIP_EOCD_NOT_FOUND' });
            await expect(inspect(parseArgs(['--input', join(tmp, 'missing.zip')]))).rejects.toMatchObject({ code: 'E_IO' });
            await expect(inspect(parseArgs(['--input', bad, '--format', 'xml']))).rejects.toMatchObject({ exitCode: 2 });
        });

        it('accepts a positional archive path', async () => {
            const zip = await deterministicZip();
            const { text, err } = await run([zip]);
            expect(err).toBeUndefined();
            expect(text).toContain('Determinism:');
        });
    });

    describe('--check parsing', () => {
        it('splits comma-separated and repeated flags', () => {
            expect(parseChecks(parseArgs(['--check', 'deterministic, no-zip64', '--check', 'has=x.txt'])))
                .toEqual(['deterministic', 'no-zip64', 'has=x.txt']);
            expect(parseChecks(parseArgs([]))).toEqual([]);
        });

        it('rejects unknown checks, parametric checks without a value, and simple checks with one', () => {
            expect(() => parseChecks(parseArgs(['--check', 'bogus']))).toThrow(CliError);
            expect(() => parseChecks(parseArgs(['--check', 'max-entries']))).toThrowError(/requires a value/);
            expect(() => parseChecks(parseArgs(['--check', 'deterministic=1']))).toThrowError(/takes no value/);
            try {
                parseChecks(parseArgs(['--check', 'bogus']));
            } catch (e) {
                expect((e as CliError).exitCode).toBe(2);
                expect((e as CliError).message).toContain('Valid:');
            }
        });

        it('an unknown check reaches the command as exit 2 without reading the archive', async () => {
            await expect(inspect(parseArgs(['--input', join(tmp, 'missing.zip'), '--check', 'bogus'])))
                .rejects.toMatchObject({ exitCode: 2, code: 'E_USAGE' });
            await expect(inspect(parseArgs(['--input', join(tmp, 'missing.zip'), '--check', 'has'])))
                .rejects.toMatchObject({ exitCode: 2 });
        });
    });

    describe('--check evaluation', () => {
        it('deterministic', async () => {
            expectPass(await check(await deterministicZip(), 'deterministic'));
            expectFail(await check(await nowZip(), 'deterministic'), 'deterministic');
        });

        it('epoch-timestamps', async () => {
            expectPass(await check(await deterministicZip(), 'epoch-timestamps'));
            expectFail(await check(await nowZip(), 'epoch-timestamps'), 'epoch-timestamps');
        });

        it('canonical-order', async () => {
            expectPass(await check(await deterministicZip(), 'canonical-order'));
            expectFail(await check(await insertionZip(), 'canonical-order'), 'canonical-order');
        });

        it('utf8-names', async () => {
            expectPass(await check(await deterministicZip(), 'utf8-names'));
            // cp437 0x82 = é, no UTF-8 flag → non-ASCII name without the flag.
            const zip = await save('cp437.zip', buildRawZip([{ name: 'café.txt', rawName: Uint8Array.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74]), flags: 0, data: enc.encode('x') }]));
            const r = await check(zip, 'utf8-names');
            expectFail(r, 'utf8-names');
            expect(r.report.stats.cp437Names).toBe(1);
        });

        it('deterministic passes on a streamed archive (layout is not reproducibility)', async () => {
            expectPass(await check(await streamedZip(), 'deterministic'));
        });

        it('canonical-layout is an alias of no-data-descriptor', async () => {
            expectPass(await check(await deterministicZip(), 'canonical-layout'));
            expectFail(await check(await streamedZip(), 'canonical-layout'), 'canonical-layout');
        });

        it('no-data-descriptor', async () => {
            expectPass(await check(await deterministicZip(), 'no-data-descriptor'));
            expectFail(await check(await streamedZip(), 'no-data-descriptor'), 'no-data-descriptor');
        });

        it('no-zip64 / zip64', async () => {
            const zip = await deterministicZip();
            expectPass(await check(zip, 'no-zip64'));
            expectFail(await check(zip, 'zip64'), 'zip64');
        });

        it('no-encryption', async () => {
            expectPass(await check(await deterministicZip(), 'no-encryption'));
            const zip = await save('enc.zip', buildRawZip([{ name: 'secret.txt', flags: 0x0801, data: enc.encode('cipher bytes') }]));
            const r = await check(zip, 'no-encryption');
            expectFail(r, 'no-encryption');
            expect(r.report.stats.encrypted).toBe(1);
        });

        it('no-symlinks', async () => {
            expectPass(await check(await deterministicZip(), 'no-symlinks'));
            const zip = await save('sym.zip', buildRawZip([
                { name: 'link', data: enc.encode('target.txt'), externalAttributes: (0o120777 << 16) >>> 0 },
                { name: 'target.txt', data: enc.encode('hello') },
            ]));
            const r = await check(zip, 'no-symlinks');
            expectFail(r, 'no-symlinks');
            expect(r.report.stats.symlinks).toBe(1);
            const { text } = await run(['--input', zip, '--entries']);
            expect(text).toContain(', symlink');
        });

        it('no-duplicates', async () => {
            expectPass(await check(await deterministicZip(), 'no-duplicates'));
            const zip = await save('dup.zip', buildRawZip([
                { name: 'same.txt', data: enc.encode('one') },
                { name: 'same.txt', data: enc.encode('two') },
            ]));
            const r = await check(zip, 'no-duplicates');
            expectFail(r, 'no-duplicates');
            expect(r.report.stats.duplicateNames).toBe(1);
        });

        it('no-diagnostics', async () => {
            expectPass(await check(await deterministicZip(), 'no-diagnostics'));
            expectFail(await check(await prependedZip(), 'no-diagnostics'), 'no-diagnostics');
        });

        it('store-only / deflate-only / method=', async () => {
            const det = await deflateZip();
            const mixed = await deterministicZip();
            const store = await storeZip();
            expectPass(await check(det, 'deflate-only'));
            expectFail(await check(det, 'store-only'), 'store-only');
            expectPass(await check(store, 'store-only'));
            expectFail(await check(store, 'deflate-only'), 'deflate-only');
            // a stored directory entry breaks deflate-only on the mixed archive
            const m = await check(mixed, 'deflate-only,store-only');
            expectFail(m, 'deflate-only');
            expectFail(m, 'store-only');
            expect(m.report.checks?.[0]?.detail).toBe('methods: 0,8');
            expectPass(await check(store, 'method=store'));
            expectPass(await check(det, 'method=deflate'));
            expectPass(await check(det, 'method=8'));
            expectFail(await check(det, 'method=store'), 'method=store');
            expectFail(await check(store, 'method=0,method=deflate'), 'method=deflate');
            await expect(inspect(parseArgs(['--input', det, '--check', 'method=lzma', '--format', 'json'])))
                .rejects.toMatchObject({ exitCode: 2 });
        });

        it('max-entries / min-entries', async () => {
            const zip = await deterministicZip();
            expectPass(await check(zip, 'max-entries=3'));
            expectFail(await check(zip, 'max-entries=2'), 'max-entries=2');
            expectPass(await check(zip, 'min-entries=3'));
            expectFail(await check(zip, 'min-entries=4'), 'min-entries=4');
            await expect(inspect(parseArgs(['--input', zip, '--check', 'max-entries=lots', '--format', 'json'])))
                .rejects.toMatchObject({ exitCode: 2 });
        });

        it('max-uncompressed', async () => {
            const zip = await deterministicZip();
            expectPass(await check(zip, 'max-uncompressed=1k'));
            const r = await check(zip, 'max-uncompressed=10');
            expectFail(r, 'max-uncompressed=10');
            expect(r.report.checks?.[0]?.detail).toContain(`${DET_TOTAL} B uncompressed (max 10 B)`);
        });

        it('max-ratio', async () => {
            const w = createZip();
            w.add('zeros.bin', new Uint8Array(65536));
            const zip = await save('ratio.zip', w.toBytes());
            expectPass(await check(zip, 'max-ratio=100000'));
            const r = await check(zip, 'max-ratio=2');
            expectFail(r, 'max-ratio=2');
            expect(r.report.checks?.[0]?.detail).toMatch(/worst entry ratio \d+\.\d:1 \(max 2:1\)/);
        });

        it('has=<name>', async () => {
            const zip = await deterministicZip();
            expectPass(await check(zip, 'has=b/c.txt'));
            expectFail(await check(zip, 'has=missing.txt'), 'has=missing.txt');
        });

        it('comma-separated checks are all evaluated and every failure is listed', async () => {
            const zip = await nowZip();
            const r = await check(zip, 'deterministic,no-zip64,zip64,epoch-timestamps,has=a.txt');
            expect(r.report.checks?.map((c: CheckResult) => [c.check, c.ok])).toEqual([
                ['deterministic', false],
                ['no-zip64', true],
                ['zip64', false],
                ['epoch-timestamps', false],
                ['has=a.txt', true],
            ]);
            expect(r.err?.message).toMatch(/^3 check\(s\) failed: /);
            expect(r.err?.message).toContain('deterministic (');
            expect(r.err?.message).toContain('zip64 (');
            expect(r.err?.message).toContain('epoch-timestamps (');
        });

        it('text mode prints the Checks section before throwing with an empty message', async () => {
            const zip = await deterministicZip();
            const { text, err } = await run(['--input', zip, '--check', 'zip64,deterministic']);
            expect(text).toContain('Checks:');
            expect(text).toContain('FAIL  zip64');
            expect(text).toContain('PASS  deterministic');
            expect(err).toBeInstanceOf(CliError);
            expect((err as CliError).code).toBe('E_CHECK_FAILED');
            expect((err as CliError).message).toBe('');
        });

        it('a fully passing check set exits cleanly with checks in the report', async () => {
            const zip = await deflateZip();
            const r = await check(zip, 'deterministic,no-diagnostics,no-encryption,no-symlinks,no-duplicates,deflate-only,has=a.txt,max-entries=10,min-entries=1');
            expectPass(r);
            expect(r.report.checks).toHaveLength(9);
        });
    });
});
