// The ONLY spawn-based test: drives the bundled binary (dist/cli.cjs) as a
// child process. It is the single proof that the CJS bundle boots, that the
// dispatcher wires every command, and — through `create --parallel` — that
// `zipnative/worker/zip-worker.js` resolves from the bundle at runtime.
// Skipped when the bundle is absent (run `npm run build` first).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'dist', 'cli.cjs');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string };

interface Spawned {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

function zipnative(args: readonly string[], cwd: string = ROOT): Spawned {
    const r = spawnSync(process.execPath, [BIN, ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024,
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe.skipIf(!existsSync(BIN))('integration: built binary smoke (dist/cli.cjs)', () => {
    let dir = '';

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });

    it('--help lists the 15 commands', () => {
        const r = zipnative(['--help']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('Commands (15)');
        for (const name of ['create', 'modify', 'list', 'inspect', 'cat', 'extract', 'stream', 'verify', 'crc32', 'inflate', 'batch', 'doctor', 'schema', 'completion', 'govern']) {
            expect(r.stdout).toMatch(new RegExp(`^  ${name}\\s`, 'm'));
        }
        const sub = zipnative(['stream', '--help']);
        expect(sub.status).toBe(0);
        expect(sub.stdout).toContain('TRUST CAVEAT');
    });

    it('--version matches package.json and --version --json is machine-readable', () => {
        const r = zipnative(['--version']);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe(PKG.version);
        const j = zipnative(['--version', '--json']);
        expect(j.status).toBe(0);
        const doc = JSON.parse(j.stdout) as { name: string; version: string; zipnative: string };
        expect(doc).toEqual({ name: 'zipnative-cli', version: PKG.version, zipnative: expect.stringMatching(/^\d+\.\d+\.\d+/) });
    });

    it('schema manifest exposes 15 commands from the bundle', () => {
        const r = zipnative(['schema', 'manifest']);
        expect(r.status).toBe(0);
        const doc = JSON.parse(r.stdout) as { kind: string; version: string; commands: { name: string }[]; zipErrorCodes: string[] };
        expect(doc.kind).toBe('capability-manifest');
        expect(doc.version).toBe(PKG.version);
        expect(doc.commands).toHaveLength(15);
        expect(doc.zipErrorCodes).toHaveLength(39);
    });

    it('doctor --format json passes in the bundled runtime (node-zlib tier, worker script resolvable)', () => {
        const r = zipnative(['doctor', '--format', 'json']);
        expect(r.status).toBe(0);
        const doc = JSON.parse(r.stdout) as { ok: boolean; checks: { name: string; status: string; value: string; detail: string }[] };
        expect(doc.ok).toBe(true);
        const byName = new Map(doc.checks.map((c) => [c.name, c]));
        expect(byName.get('deflate-tier')?.value).toBe('node-zlib');
        expect(byName.get('workers')?.status).toBe('ok');
        expect(byName.get('commands')?.value).toBe('15');
    });

    it('create --parallel (worker pool) then verify --format json round-trips through the bundle', async () => {
        const src = join(dir, 'src');
        await mkdir(join(src, 'nested'), { recursive: true });
        await writeFile(join(src, 'a.txt'), 'bundled parallel writer '.repeat(500));
        await writeFile(join(src, 'nested', 'b.txt'), 'second entry '.repeat(200));
        const out = join(dir, 'out.zip');
        const created = zipnative(['create', 'src', '--output', out, '--parallel', '--workers', '2', '--min-job-size', '1', '--deterministic', '--json'], dir);
        expect(created.stderr).not.toContain('"ok":false');
        expect(created.status).toBe(0);
        const env = JSON.parse(created.stderr.trim().split('\n').pop() as string) as Record<string, unknown>;
        expect(env).toMatchObject({ ok: true, command: 'create', entries: 2, parallel: { workers: 2 }, tier: 'pure-pinned' });
        expect(existsSync(out)).toBe(true);

        const verified = zipnative(['verify', '--input', out, '--format', 'json'], dir);
        expect(verified.status).toBe(0);
        const report = JSON.parse(verified.stdout) as { ok: boolean; entryCount: number; entries: { name: string; ok: boolean }[] };
        expect(report.ok).toBe(true);
        expect(report.entryCount).toBe(2);
        expect(report.entries.map((e) => e.name)).toEqual(['src/a.txt', 'src/nested/b.txt']);

        // Sequential + deterministic must match the worker output byte for byte.
        const seq = join(dir, 'seq.zip');
        expect(zipnative(['create', 'src', '--output', seq, '--deterministic'], dir).status).toBe(0);
        expect(readFileSync(out).equals(readFileSync(seq))).toBe(true);
    });

    it('failures exit non-zero with a --json error envelope carrying E_* and ZIP_* codes', () => {
        const usage = zipnative(['modify', '--input', 'x.zip']);
        expect(usage.status).toBe(2);
        expect(usage.stderr).toContain('at least one edit');
        const missing = zipnative(['list', '--input', join(dir, 'absent.zip'), '--json']);
        expect(missing.status).toBe(1);
        const env = JSON.parse(missing.stderr.trim().split('\n').pop() as string) as { ok: boolean; command: string; error: { code: string } };
        expect(env).toMatchObject({ ok: false, command: 'list', error: { code: 'E_IO' } });
        const unknown = zipnative(['frobnicate']);
        expect(unknown.status).toBe(1);
        expect(unknown.stderr).toContain('Unknown command');
    });
});
