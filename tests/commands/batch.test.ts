import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batch } from '../../src/commands/batch.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';
import { createZip, openZip, type ZipEntry } from '../../src/core-bridge/index.js';

// ── Local capture helper ──────────────────────────────────────────────

interface Run {
    readonly text: string;
    readonly err: string;
    readonly error: unknown;
}

async function run(fn: () => Promise<void>): Promise<Run> {
    const outChunks: string[] = [];
    const errChunks: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        outChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
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
    return { text: outChunks.join(''), err: errChunks.join(''), error };
}

/**
 * The batch summary is the LAST JSON document on stdout (task commands may
 * print their own reports before it). Documents start with `{` at column 0;
 * nested lines of a pretty document are indented.
 */
function lastJson(text: string): Record<string, unknown> {
    const idx = text.lastIndexOf('\n{');
    return JSON.parse(idx === -1 ? text : text.slice(idx + 1)) as Record<string, unknown>;
}

interface DirResult {
    input: string;
    output?: string;
    ok: boolean;
    error: string | null;
    code?: string;
}

interface DirEnvelope {
    ok: boolean;
    command: string;
    mode: string;
    task: string;
    dryRun?: boolean;
    total: number;
    succeeded: number;
    failed: number;
    results?: DirResult[];
}

interface TaskEntry {
    id: string;
    command: string;
    ok: boolean;
    output?: string;
    error?: { code: string; message: string; zipCode?: string };
    skipped?: true;
}

interface ManifestEnvelope {
    ok: boolean;
    command: string;
    mode: string;
    dryRun?: boolean;
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    tasks?: TaskEntry[];
}

function entriesOf(bytes: Uint8Array): ZipEntry[] {
    return [...openZip(bytes, { onDiagnostic: () => undefined }).entries()];
}

describe('batch (directory mode)', () => {
    let dir = '';

    afterEach(async () => {
        vi.restoreAllMocks();
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_DRY_RUN'];
        delete process.env['ZIPNATIVE_QUIET'];
        if (dir !== '') await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        dir = '';
    });

    /** input/alpha/{a.txt,nested/n.txt} and input/beta/b.txt (+ a stray file). */
    async function setupTree(): Promise<{ inputDir: string; outputDir: string }> {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        const inputDir = join(dir, 'input');
        await mkdir(join(inputDir, 'alpha', 'nested'), { recursive: true });
        await mkdir(join(inputDir, 'beta'), { recursive: true });
        await writeFile(join(inputDir, 'alpha', 'a.txt'), 'alpha file '.repeat(10));
        await writeFile(join(inputDir, 'alpha', 'nested', 'n.txt'), 'nested');
        await writeFile(join(inputDir, 'beta', 'b.txt'), 'beta');
        await writeFile(join(inputDir, 'stray.txt'), 'not a directory');
        return { inputDir, outputDir: join(dir, 'out') };
    }

    /** archives/{good.zip, bad.zip (payload corrupted)} */
    async function setupArchives(): Promise<string> {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        const archives = join(dir, 'archives');
        await mkdir(archives);
        const good = createZip({ compression: { method: 'store' } });
        good.add('ok.txt', 'intact-payload');
        const goodBytes = good.toBytes();
        await writeFile(join(archives, 'good.zip'), goodBytes);
        const bad = Buffer.from(goodBytes);
        const idx = bad.indexOf(Buffer.from('intact-payload'));
        bad.write('broken', idx);
        await writeFile(join(archives, 'bad.zip'), bad);
        await writeFile(join(archives, 'readme.txt'), 'ignored');
        return archives;
    }

    it('--task create archives every subdirectory with names relative to each subdirectory', async () => {
        const { inputDir, outputDir } = await setupTree();
        const r = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe('Created 2/2 archive(s), 0 failed.\n');
        const alpha = entriesOf(new Uint8Array(await readFile(join(outputDir, 'alpha.zip'))));
        expect(alpha.map((e) => e.name)).toEqual(['a.txt', 'nested/n.txt']);
        const beta = entriesOf(new Uint8Array(await readFile(join(outputDir, 'beta.zip'))));
        expect(beta.map((e) => e.name)).toEqual(['b.txt']);
        expect(existsSync(join(outputDir, 'stray.zip'))).toBe(false);
        expect(r.err).toContain('alpha/');
        expect(r.err).toContain('beta/');
    });

    it('forwards create flags (--method store --deterministic --comment) to every archive', async () => {
        const { inputDir, outputDir } = await setupTree();
        const r = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir, '--method', 'store', '--deterministic', '--comment', 'batched'])));
        expect(r.error).toBeUndefined();
        const bytes = new Uint8Array(await readFile(join(outputDir, 'alpha.zip')));
        expect(entriesOf(bytes).every((e) => e.compressionMethod === 0)).toBe(true);
        expect(Buffer.from(openZip(bytes).comment).toString()).toBe('batched');
    });

    it('--format json reports the directory-mode envelope', async () => {
        const { inputDir, outputDir } = await setupTree();
        process.env['ZIPNATIVE_QUIET'] = '1';
        const r = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        expect(r.err).toBe('');
        const doc = JSON.parse(r.text) as DirEnvelope;
        expect(doc).toMatchObject({ ok: true, command: 'batch', mode: 'directory', task: 'create', total: 2, succeeded: 2, failed: 0 });
        expect(doc.results?.map((x) => x.ok)).toEqual([true, true]);
        expect(doc.results?.[0]?.output).toBe(join(outputDir, 'alpha.zip'));
        expect(doc.results?.[0]?.error).toBeNull();
        expect(r.text).toContain('\n  ');
    });

    it('--summary drops results and --fields projects; ZIPNATIVE_JSON compacts', async () => {
        const { inputDir, outputDir } = await setupTree();
        process.env['ZIPNATIVE_QUIET'] = '1';
        const summary = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir, '--format', 'json', '--summary'])));
        expect(JSON.parse(summary.text)).toEqual({ ok: true, command: 'batch', mode: 'directory', task: 'create', total: 2, succeeded: 2, failed: 0 });
        const fields = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir, '--format', 'json', '--fields', 'total,results.ok'])));
        expect(JSON.parse(fields.text)).toEqual({ total: 2, results: [{ ok: true }, { ok: true }] });
        process.env['ZIPNATIVE_JSON'] = '1';
        const compact = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir])));
        expect(compact.text.trimEnd()).not.toContain('\n');
        expect(JSON.parse(compact.text)).toMatchObject({ total: 2 });
    });

    it('--concurrency 1 works and --concurrency 0 / junk are usage errors', async () => {
        const { inputDir, outputDir } = await setupTree();
        process.env['ZIPNATIVE_QUIET'] = '1';
        const ok = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir, '--concurrency', '1'])));
        expect(ok.error).toBeUndefined();
        const zero = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir, '--concurrency', '0'])));
        expect(zero.error).toMatchObject({ exitCode: 2 });
        const junk = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir, '--concurrency', 'many'])));
        expect(junk.error).toMatchObject({ exitCode: 2 });
    });

    it('missing --input-dir / --output-dir, bad --task and bad --format are usage errors', async () => {
        const r1 = await run(() => batch(parseArgs(['--output-dir', 'x'])));
        expect(r1.error).toMatchObject({ exitCode: 2 });
        const r2 = await run(() => batch(parseArgs(['--input-dir', 'x'])));
        expect(r2.error).toMatchObject({ exitCode: 2 });
        const r3 = await run(() => batch(parseArgs(['--input-dir', 'x', '--task', 'bogus'])));
        expect(r3.error).toMatchObject({ exitCode: 2 });
        const r4 = await run(() => batch(parseArgs(['--input-dir', 'x', '--output-dir', 'y', '--format', 'xml'])));
        expect(r4.error).toMatchObject({ exitCode: 2 });
    });

    it('an unreadable --input-dir is E_IO and one without subdirectories is E_INPUT', async () => {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        const r = await run(() => batch(parseArgs(['--input-dir', join(dir, 'absent'), '--output-dir', join(dir, 'out')])));
        expect(r.error).toMatchObject({ code: ErrorCode.IO });
        await writeFile(join(dir, 'only-a-file.txt'), 'x');
        const r2 = await run(() => batch(parseArgs(['--input-dir', dir, '--output-dir', join(dir, 'out')])));
        expect(r2.error).toMatchObject({ code: ErrorCode.INPUT, exitCode: 1 });
    });

    it('--dry-run plans the directories and creates nothing', async () => {
        const { inputDir, outputDir } = await setupTree();
        process.env['ZIPNATIVE_QUIET'] = '1';
        const r = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir, '--dry-run'])));
        expect(r.error).toBeUndefined();
        // --dry-run is forwarded: each create prints its own plan lines first.
        const lines = r.text.trim().split('\n');
        expect(lines[lines.length - 1]).toBe('Dry run: 2 directories planned, nothing written.');
        expect(lines.filter((l) => l.startsWith('plan  ')).sort()).toEqual(['plan  a.txt  110  deflate', 'plan  b.txt  4  deflate', 'plan  nested/n.txt  6  deflate']);
        expect(existsSync(outputDir)).toBe(false);
        const json = await run(() => batch(parseArgs(['--input-dir', inputDir, '--output-dir', outputDir, '--dry-run', '--format', 'json'])));
        expect(lastJson(json.text)).toMatchObject({ ok: true, dryRun: true, total: 2, succeeded: 2 });
        expect(existsSync(outputDir)).toBe(false);
    });

    it('--task verify reports per-archive verdicts and exits 1 with E_VERIFY_FAILED on a corrupt archive', async () => {
        const archives = await setupArchives();
        process.env['ZIPNATIVE_QUIET'] = '1';
        const r = await run(() => batch(parseArgs(['--input-dir', archives, '--task', 'verify', '--format', 'json'])));
        expect(r.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED, exitCode: 1 });
        const doc = JSON.parse(r.text) as DirEnvelope;
        expect(doc).toMatchObject({ ok: false, mode: 'directory', task: 'verify', total: 2, succeeded: 1, failed: 1 });
        const bad = doc.results?.find((x) => x.input.endsWith('bad.zip'));
        expect(bad).toMatchObject({ ok: false, code: ErrorCode.VERIFY_FAILED });
        expect(bad?.error).toContain('1 entries failed verification');
        expect(doc.results?.find((x) => x.input.endsWith('good.zip'))).toMatchObject({ ok: true, error: null });
        expect(doc.results?.some((x) => x.input.endsWith('readme.txt'))).toBe(false);
    });

    it('--task verify text mode and --fail-fast with --concurrency 1 stop after the first failure', async () => {
        const archives = await setupArchives();
        process.env['ZIPNATIVE_QUIET'] = '1';
        const text = await run(() => batch(parseArgs(['--input-dir', archives, '--task', 'verify'])));
        expect(text.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED });
        expect(text.text).toBe('Verified 1/2 archive(s), 1 failed.\n');
        // Sorted names: bad.zip runs first, good.zip is never scheduled.
        const fast = await run(() => batch(parseArgs(['--input-dir', archives, '--task', 'verify', '--fail-fast', '--concurrency', '1', '--format', 'json'])));
        expect(fast.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED });
        const doc = JSON.parse(fast.text) as DirEnvelope;
        expect(doc.total).toBe(1);
        expect(doc.results?.[0]?.input.endsWith('bad.zip')).toBe(true);
    });

    it('--task verify honours --max-* limits, --dry-run, and refuses a directory without archives', async () => {
        const archives = await setupArchives();
        process.env['ZIPNATIVE_QUIET'] = '1';
        const limited = await run(() => batch(parseArgs(['--input-dir', archives, '--task', 'verify', '--max-entries', '1', '--format', 'json'])));
        expect(limited.error).toMatchObject({ code: ErrorCode.VERIFY_FAILED });
        const dry = await run(() => batch(parseArgs(['--input-dir', archives, '--task', 'verify', '--dry-run'])));
        expect(dry.error).toBeUndefined();
        expect(dry.text).toBe('Dry run: 2 archive(s) planned, nothing verified.\n');
        const none = await run(() => batch(parseArgs(['--input-dir', dir, '--task', 'verify'])));
        expect(none.error).toMatchObject({ code: ErrorCode.INPUT });
    });
});

describe('batch --manifest', () => {
    let dir = '';

    afterEach(async () => {
        vi.restoreAllMocks();
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_DRY_RUN'];
        delete process.env['ZIPNATIVE_QUIET'];
        if (dir !== '') await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        dir = '';
    });

    /** Temp dir with src/{one.txt,two.txt} and the manifest written INSIDE it (relative paths anchor there). */
    async function makeManifest(manifest: unknown): Promise<string> {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        await mkdir(join(dir, 'src'));
        await writeFile(join(dir, 'src', 'one.txt'), 'one '.repeat(20));
        await writeFile(join(dir, 'src', 'two.txt'), 'two');
        const manifestPath = join(dir, 'tasks.json');
        await writeFile(manifestPath, typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
        return manifestPath;
    }

    it('runs a create → verify → extract pipeline through @id references', async () => {
        process.env['ZIPNATIVE_QUIET'] = '1';
        process.env['ZIPNATIVE_JSON'] = '1';
        const manifestPath = await makeManifest({
            version: 1,
            tasks: [
                { id: 'build', command: 'create', flags: { input: 'src', output: 'out/src.zip', method: 'store' } },
                { id: 'check', command: 'verify', flags: { input: '@build', format: 'json', summary: true } },
                { id: 'unpack', command: 'extract', flags: { input: '@build', 'output-dir': 'out/unpacked' } },
            ],
        });
        const r = await run(() => batch(parseArgs(['--manifest', manifestPath])));
        expect(r.error).toBeUndefined();
        const doc = lastJson(r.text) as unknown as ManifestEnvelope;
        expect(doc).toMatchObject({ ok: true, command: 'batch', mode: 'manifest', total: 3, succeeded: 3, failed: 0, skipped: 0 });
        expect(r.text.trim().split('\n')).toHaveLength(2);
        expect(doc.tasks?.map((t) => t.id)).toEqual(['build', 'check', 'unpack']);
        expect(doc.tasks?.every((t) => t.ok)).toBe(true);
        expect(doc.tasks?.[0]?.output).toBe(join(dir, 'out', 'src.zip'));
        // The verify task's own JSON report preceded the summary on stdout.
        const verifyLine = r.text.trim().split('\n')[0] as string;
        expect(JSON.parse(verifyLine)).toMatchObject({ ok: true, entries: 2, failed: 0 });
        const archive = entriesOf(new Uint8Array(await readFile(join(dir, 'out', 'src.zip'))));
        expect(archive.map((e) => e.name)).toEqual(['src/one.txt', 'src/two.txt']);
        expect(await readFile(join(dir, 'out', 'unpacked', 'src', 'two.txt'), 'utf8')).toBe('two');
    });

    it('text mode prints a manifest summary line', async () => {
        process.env['ZIPNATIVE_QUIET'] = '1';
        const manifestPath = await makeManifest({
            version: 1,
            tasks: [{ id: 'build', command: 'create', flags: { input: 'src', output: 'out/src.zip' } }],
        });
        const r = await run(() => batch(parseArgs(['--manifest', manifestPath])));
        expect(r.error).toBeUndefined();
        expect(r.text).toBe('Manifest: 1/1 task(s) succeeded, 0 failed, 0 skipped.\n');
    });

    it('--dry-run prints plan lines and executes nothing', async () => {
        process.env['ZIPNATIVE_QUIET'] = '1';
        const manifestPath = await makeManifest({
            version: 1,
            tasks: [
                { id: 'build', command: 'create', flags: { input: 'src', output: 'out/src.zip' } },
                { id: 'check', command: 'verify', flags: { input: '@build' } },
                { id: 'unpack', command: 'extract', flags: { input: '@build', 'output-dir': 'out/unpacked' } },
            ],
        });
        const r = await run(() => batch(parseArgs(['--manifest', manifestPath, '--dry-run'])));
        expect(r.error).toBeUndefined();
        const lines = r.text.trim().split('\n');
        expect(lines[0]).toBe(`plan [1/3] create build → ${join(dir, 'out', 'src.zip')}`);
        expect(lines[1]).toBe('plan [2/3] verify check');
        expect(lines[2]).toBe(`plan [3/3] extract unpack → ${join(dir, 'out', 'unpacked')}/`);
        expect(lines[3]).toBe('Dry run: 3 task(s) validated, nothing executed.');
        expect(existsSync(join(dir, 'out'))).toBe(false);
        const json = await run(() => batch(parseArgs(['--manifest', manifestPath, '--dry-run', '--format', 'json'])));
        const doc = JSON.parse(json.text) as ManifestEnvelope;
        expect(doc).toMatchObject({ ok: true, mode: 'manifest', dryRun: true, total: 3, succeeded: 0, failed: 0, skipped: 0 });
        expect(doc.tasks?.map((t) => t.ok)).toEqual([true, true, true]);
        expect(existsSync(join(dir, 'out'))).toBe(false);
    });

    it('fail-fast by default: a failing task aborts the rest, the exit carries its code and zipCode', async () => {
        process.env['ZIPNATIVE_QUIET'] = '1';
        const manifestPath = await makeManifest({
            version: 1,
            tasks: [
                { id: 'build', command: 'create', flags: { input: 'src', output: 'out/src.zip' } },
                { id: 'edit', command: 'modify', flags: { input: '@build', output: 'out/edited.zip', remove: 'ghost.txt' } },
                { id: 'check', command: 'verify', flags: { input: '@edit' } },
                { id: 'other', command: 'list', flags: { input: '@build', format: 'json', summary: true } },
            ],
        });
        const r = await run(() => batch(parseArgs(['--manifest', manifestPath, '--format', 'json'])));
        expect(r.error).toMatchObject({ exitCode: 1, code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
        const doc = lastJson(r.text) as unknown as ManifestEnvelope;
        expect(doc).toMatchObject({ ok: false, total: 4, succeeded: 1, failed: 1, skipped: 2 });
        expect(doc.tasks?.[1]?.error).toMatchObject({ code: ErrorCode.NOT_FOUND, zipCode: 'ZIP_ENTRY_NOT_FOUND' });
        expect(doc.tasks?.[2]?.skipped).toBe(true);
        expect(doc.tasks?.[3]?.skipped).toBe(true);
        expect(existsSync(join(dir, 'out', 'edited.zip'))).toBe(false);
    });

    it('--continue-on-error runs independent tasks but skips @-dependents of the failure', async () => {
        process.env['ZIPNATIVE_QUIET'] = '1';
        const manifestPath = await makeManifest({
            version: 1,
            tasks: [
                { id: 'build', command: 'create', flags: { input: 'src', output: 'out/src.zip' } },
                { id: 'edit', command: 'modify', flags: { input: '@build', output: 'out/edited.zip', remove: 'ghost.txt' } },
                { id: 'check', command: 'verify', flags: { input: '@edit' } },
                { id: 'other', command: 'list', flags: { input: '@build', format: 'json', summary: true } },
            ],
        });
        const r = await run(() => batch(parseArgs(['--manifest', manifestPath, '--continue-on-error', '--format', 'json'])));
        expect(r.error).toMatchObject({ exitCode: 1, code: ErrorCode.NOT_FOUND });
        const doc = lastJson(r.text) as unknown as ManifestEnvelope;
        expect(doc).toMatchObject({ ok: false, total: 4, succeeded: 2, failed: 1, skipped: 1 });
        expect(doc.tasks?.[2]?.skipped).toBe(true);
        expect(doc.tasks?.[3]?.ok).toBe(true);
    });

    it('a "codec" task flag is refused without --allow-codec-load and accepted with it', async () => {
        process.env['ZIPNATIVE_QUIET'] = '1';
        const manifestPath = await makeManifest({
            version: 1,
            tasks: [{ id: 'puff', command: 'inflate', flags: { input: 'src/one.txt', output: 'out/one.bin', codec: 'codec.mjs', method: 98 } }],
        });
        const refused = await run(() => batch(parseArgs(['--manifest', manifestPath, '--dry-run'])));
        expect(refused.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
        expect((refused.error as Error).message).toContain('--allow-codec-load');
        const allowed = await run(() => batch(parseArgs(['--manifest', manifestPath, '--dry-run', '--allow-codec-load', '--format', 'json'])));
        expect(allowed.error).toBeUndefined();
        expect(JSON.parse(allowed.text)).toMatchObject({ ok: true, dryRun: true, total: 1 });
    });

    it('--manifest is mutually exclusive with --input-dir / --output-dir (exit 2)', async () => {
        const manifestPath = await makeManifest({ version: 1, tasks: [{ id: 'a', command: 'list', flags: {} }] });
        const r = await run(() => batch(parseArgs(['--manifest', manifestPath, '--input-dir', dir])));
        expect(r.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
        const r2 = await run(() => batch(parseArgs(['--manifest', manifestPath, '--output-dir', dir])));
        expect(r2.error).toMatchObject({ exitCode: 2 });
    });

    it('invalid JSON is E_PARSE, a missing file is E_IO', async () => {
        const manifestPath = await makeManifest('{not json');
        const r = await run(() => batch(parseArgs(['--manifest', manifestPath])));
        expect(r.error).toMatchObject({ code: ErrorCode.PARSE, exitCode: 1 });
        const missing = await run(() => batch(parseArgs(['--manifest', join(dir, 'absent.json')])));
        expect(missing.error).toMatchObject({ code: ErrorCode.IO });
    });

    it.each(['govern', 'batch', 'schema', 'completion', 'doctor', 'not-a-command'])('rejects the forbidden / unknown command "%s" with E_INPUT', async (command) => {
        const manifestPath = await makeManifest({ version: 1, tasks: [{ id: 'a', command, flags: {} }] });
        const r = await run(() => batch(parseArgs(['--manifest', manifestPath])));
        expect(r.error).toMatchObject({ exitCode: 1, code: ErrorCode.INPUT });
    });

    it('structural violations are usage errors and value violations are E_INPUT', async () => {
        const structural = await makeManifest({ version: 2, tasks: [{ id: 'a', command: 'list', flags: {} }] });
        const r = await run(() => batch(parseArgs(['--manifest', structural])));
        expect(r.error).toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
        await rm(dir, { recursive: true, force: true });
        const forwardRef = await makeManifest({
            version: 1,
            tasks: [
                { id: 'first', command: 'verify', flags: { input: '@later' } },
                { id: 'later', command: 'create', flags: { input: 'src', output: 'a.zip' } },
            ],
        });
        const r2 = await run(() => batch(parseArgs(['--manifest', forwardRef])));
        expect(r2.error).toMatchObject({ exitCode: 1, code: ErrorCode.INPUT });
    });

    it('a task throwing a non-CliError is reported as E_RUNTIME', async () => {
        process.env['ZIPNATIVE_QUIET'] = '1';
        // `list` with a boolean-valued --format: getStringFlag throws a CliError,
        // so use a shape that reaches the core with an impossible option instead.
        const manifestPath = await makeManifest({
            version: 1,
            tasks: [{ id: 'oops', command: 'crc32', flags: { input: 'src/one.txt', expect: 'zz' } }],
        });
        const r = await run(() => batch(parseArgs(['--manifest', manifestPath, '--format', 'json'])));
        expect(r.error).toMatchObject({ exitCode: 1, code: ErrorCode.USAGE });
        const doc = lastJson(r.text) as unknown as ManifestEnvelope;
        expect(doc.tasks?.[0]?.error?.code).toBe(ErrorCode.USAGE);
    });
});
