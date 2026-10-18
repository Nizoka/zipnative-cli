// The ONLY spawn-based test: drives the bundled binary (dist/cli.cjs) as a
// child process. It is the single proof that the CJS bundle boots, that the
// dispatcher wires every command, and — through `create --parallel` — that
// `zipnative/worker/zip-worker.js` resolves from the bundle at runtime.
// Skipped when the bundle is absent (run `npm run build` first).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
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

    it('--help lists the 17 commands', () => {
        const r = zipnative(['--help']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('Commands (17)');
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

    it('schema manifest exposes 17 commands from the bundle', () => {
        const r = zipnative(['schema', 'manifest']);
        expect(r.status).toBe(0);
        const doc = JSON.parse(r.stdout) as { kind: string; version: string; commands: { name: string }[]; zipErrorCodes: string[] };
        expect(doc.kind).toBe('capability-manifest');
        expect(doc.version).toBe(PKG.version);
        expect(doc.commands).toHaveLength(17);
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
        expect(byName.get('commands')?.value).toBe('17');
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
        const unknown = zipnative(['frobnicate', '--json']);
        expect(unknown.status).toBe(2);
        expect(JSON.parse(unknown.stderr.trim().split('\n').pop() as string)).toMatchObject({ ok: false, error: { code: 'E_USAGE' } });
        expect(unknown.stderr).toContain('Unknown command');
    });

    it('global flags before the command and booleans before positionals are order-independent (A-01)', async () => {
        const first = zipnative(['--json', 'list', '--input', join(dir, 'absent.zip')]);
        expect(first.status).toBe(1);
        expect(JSON.parse(first.stderr.trim().split('\n').pop() as string)).toMatchObject({ ok: false, command: 'list', error: { code: 'E_IO' } });

        await mkdir(join(dir, 'src'));
        await writeFile(join(dir, 'src', 'a.txt'), 'hello');
        const created = zipnative(['create', '--deterministic', join(dir, 'src'), '-o', join(dir, 'a.zip')]);
        expect(created.status).toBe(0);
        const listed = zipnative(['list', '--long', join(dir, 'a.zip')]);
        expect(listed.status).toBe(0);
        expect(listed.stdout).toContain('src/a.txt');

        const noCommand = zipnative(['--frob']);
        expect(noCommand.status).toBe(2);
        expect(noCommand.stdout).toBe('');
        expect(noCommand.stderr).toContain('No command given');
    });

    it('a downstream pipe closing early (EPIPE) ends the process quietly with exit 0 (A-03)', async () => {
        await mkdir(join(dir, 'big'));
        await writeFile(join(dir, 'big', 'big.bin'), Buffer.alloc(6 * 1024 * 1024, 7));
        expect(zipnative(['create', join(dir, 'big'), '--method', 'store', '-o', join(dir, 'big.zip')]).status).toBe(0);
        for (const extra of [[], ['--json']]) {
            const { spawn } = await import('node:child_process');
            const child = spawn(process.execPath, [BIN, 'cat', join(dir, 'big.zip'), 'big/big.bin', ...extra], {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, NO_COLOR: '1' },
            });
            let stderr = '';
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (d: string) => { stderr += d; });
            let seen = 0;
            child.stdout.on('data', (chunk: Buffer) => {
                seen += chunk.length;
                if (seen >= 10) child.stdout.destroy();
            });
            const status = await new Promise<number | null>((resolveExit) => child.on('close', (code) => resolveExit(code)));
            expect(status, stderr).toBe(0);
            expect(stderr).not.toContain('Unhandled');
            expect(stderr).not.toContain('EPIPE');
        }
    });
    it.skipIf(process.platform === 'win32')('SIGINT during a write removes the in-flight output and exits 130 (A-38)', async () => {
        // Windows has no POSIX signals for child processes; the handler is
        // exercised on Linux/macOS only. `--stream` opens the output at once
        // and stdin never ends, so the archive is in flight when the signal lands.
        const { spawn } = await import('node:child_process');
        const out = join(dir, 'interrupted.zip');
        const child = spawn(process.execPath, [BIN, 'create', '--stdin-name', 'endless.bin', '--stream', '-o', out], {
            cwd: ROOT,
            env: { ...process.env, NO_COLOR: '1' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stdin.write(Buffer.alloc(64 * 1024));
        await new Promise((r) => setTimeout(r, 400));
        expect(existsSync(out)).toBe(true);
        child.kill('SIGINT');
        const code = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
        expect(code).toBe(130);
        expect(existsSync(out)).toBe(false);
    });

    // ── 1.1.0 dispatcher hardening: the invocation contract and the
    // presentation-only configuration (only the real process runs main()).

    it('refuses an unknown flag, a repeated switch, a repeated single-value flag and a stray operand (exit 2, E_USAGE)', () => {
        for (const argv of [
            ['list', 'a.zip', '--overwite'],
            ['list', 'a.zip', '--long', '--long'],
            ['list', '--input', 'a.zip', '--input', 'b.zip'],
            ['list', 'a.zip', 'b.zip'],
            ['list', 'a.zip', '--input', 'b.zip'],
            ['doctor', 'extra'],
            ['list', '--constructor', 'x'],
            ['batch', '-f', 'json', '-f', 'text'],
        ]) {
            const r = zipnative([...argv, '--json']);
            expect(r.status, argv.join(' ')).toBe(2);
            const env = JSON.parse(r.stderr.trim().split('\n').pop() as string) as { error: { code: string } };
            expect(env.error.code, argv.join(' ')).toBe('E_USAGE');
        }
        // An alias means its flag on every command that declares it.
        const e = zipnative(['inspect', join(dir, 'missing.zip'), '-e', 'x', '--json']);
        expect(e.status).toBe(1); // E_IO for the missing archive — the flag itself was accepted
    });

    it('a text-mode error leads with its class and engine cause', () => {
        const r = zipnative(['list', '--overwite']);
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/^error E_USAGE: Unknown flag --overwite for "list"/m);
    });

    it('a planted .zipnativerc.json can only change presentation: any other key is E_USAGE naming the file', async () => {
        const repo = join(dir, 'cloned-repo');
        await mkdir(repo);
        const zip = join(repo, 'a.zip');
        expect(zipnative(['create', join(ROOT, 'package.json'), '-o', zip, '--no-config']).status).toBe(0);
        await writeFile(join(repo, '.zipnativerc.json'), JSON.stringify({ extract: { overwrite: true, 'skip-unsafe': true } }));
        const refused = zipnative(['list', zip, '--json'], repo);
        expect(refused.status).toBe(2);
        const env = JSON.parse(refused.stderr.trim().split('\n').pop() as string) as { error: { code: string; message: string; remedy: string } };
        expect(env.error.code).toBe('E_USAGE');
        expect(env.error.message).toContain('.zipnativerc.json');
        expect(env.error.message).toContain('"overwrite"');
        expect(env.error.remedy).toContain('--no-config');
        // --no-config is always the escape hatch.
        expect(zipnative(['list', zip, '--no-config'], repo).status).toBe(0);

        // A presentation default applies, is announced on stderr and named in the envelope.
        await writeFile(join(repo, '.zipnativerc.json'), JSON.stringify({ list: { format: 'json' } }));
        const applied = zipnative(['list', zip], repo);
        expect(applied.status).toBe(0);
        expect(JSON.parse(applied.stdout)).toHaveProperty('entries');
        expect(applied.stderr).toMatch(/^info: defaults from .*\.zipnativerc\.json: format$/m);
        const out = join(repo, 'b.zip');
        const created = zipnative(['create', join(ROOT, 'package.json'), '-o', out, '--json'], repo);
        expect(created.status).toBe(0);
        // `format` is not a create flag: nothing applied, so no `config` field.
        expect(JSON.parse(created.stderr.trim().split('\n').pop() as string)).not.toHaveProperty('config');
        await writeFile(join(repo, '.zipnativerc.json'), JSON.stringify({ pretty: true }));
        const v = zipnative(['verify', zip, '--json'], repo);
        expect(v.status).toBe(0);
        expect(v.stdout).toContain('\n  "ok": true');
    });

    it('--max-* none is refused with an explicit-value remedy (every bound is finite since 1.1.0)', () => {
        const r = zipnative(['list', join(ROOT, 'package.json'), '--max-entries', 'none', '--json']);
        expect(r.status).toBe(2);
        const env = JSON.parse(r.stderr.trim().split('\n').pop() as string) as { error: { code: string; remedy: string } };
        expect(env.error.code).toBe('E_USAGE');
        expect(env.error.remedy).toMatch(/^--max-entries \d+/);
    });

    it.skipIf(process.platform === 'win32')('a device (/dev/zero) is byte-counted and refused at --max-input-size, never read whole', () => {
        const r = zipnative(['list', '/dev/zero', '--max-input-size', '1m', '--json']);
        expect(r.status).toBe(1);
        const env = JSON.parse(r.stderr.trim().split('\n').pop() as string) as { error: { code: string; detail: { limit: string } } };
        expect(env.error).toMatchObject({ code: 'E_LIMIT', detail: { limit: 'maxInputSize' } });
    });

    it('--timeout firing mid-entry: stream, stream --cat and extract fail E_LIMIT and leave no partial file (1.1.0 review)', async () => {
        // 64 MiB at a ratio under 1024:1: decompression outlasts the deadline.
        // zipnative 1.1's forward reader, given the signal, left the pending
        // entry read unsettled — the loop drained and the run exited 0 with a
        // truncated file. Only a child process shows that.
        const big = Buffer.alloc(64 * 1024 * 1024);
        for (let i = 0; i < big.length; i += 97) big[i] = i & 255;
        await writeFile(join(dir, 'big.bin'), big);
        const zip = join(dir, 'big.zip');
        expect(zipnative(['create', join(dir, 'big.bin'), '--base', dir, '-o', zip, '--quiet']).status).toBe(0);
        for (const args of [
            ['stream', zip, '-d', join(dir, 'sx'), '--timeout', '60ms', '--json'],
            ['stream', zip, '--cat', 'big.bin', '--timeout', '60ms', '--json'],
            ['extract', zip, '-d', join(dir, 'ex'), '--timeout', '60ms', '--json'],
        ]) {
            const r = zipnative(args);
            expect(r.status, args.join(' ')).toBe(1);
            const env = JSON.parse(r.stderr.trim().split('\n').pop() as string) as { error: { code: string; detail?: { limit: string } } };
            expect(env.error, args.join(' ')).toMatchObject({ code: 'E_LIMIT', detail: { limit: 'timeout' } });
            expect(r.stderr).not.toContain('MaxListenersExceededWarning');
        }
        expect(existsSync(join(dir, 'sx', 'big.bin'))).toBe(false);
        expect(existsSync(join(dir, 'ex', 'big.bin'))).toBe(false);
    });

    it('--timeout fires while stdin is stalled: list, crc32 and stream end E_LIMIT instead of waiting forever (1.1.0 review M-03)', async () => {
        for (const args of [['list', '-'], ['crc32'], ['stream', '--list']]) {
            const child = spawn(process.execPath, [BIN, ...args, '--timeout', '300ms', '--json'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
            let stderr = '';
            child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
            child.stdout.resume();
            child.stdin.write(Buffer.from('PK\u0003\u0004'));
            // stdin stays open: the peer stalls.
            const code = await new Promise<number | null>((done) => {
                const kill = setTimeout(() => { child.kill(); done(null); }, 5000);
                child.on('exit', (c) => { clearTimeout(kill); done(c); });
            });
            child.stdin.destroy();
            expect(code, args.join(' ')).toBe(1);
            const env = JSON.parse(stderr.trim().split('\n').pop() as string) as { error: { code: string; detail?: { limit: string } } };
            expect(env.error, args.join(' ')).toMatchObject({ code: 'E_LIMIT', detail: { limit: 'timeout' } });
        }
    });

    it('--json after -- is an operand, not agent mode (1.1.0 review)', () => {
        const r = zipnative(['cat', join(ROOT, 'package.json'), 'x', '--', '--json']);
        expect(r.status).not.toBe(0);
        expect(r.stderr).toMatch(/^error E_/m);
        expect(r.stderr).not.toContain('"ok":false');
    });

    it('a planted config key cannot reach the terminal raw through the remedy line (1.1.0 review)', async () => {
        const repo = join(dir, 'cfg-esc');
        await mkdir(repo);
        const ESC = String.fromCharCode(27);
        const BEL = String.fromCharCode(7);
        await writeFile(join(repo, '.zipnativerc.json'), JSON.stringify({ [`${ESC}]0;PWNED${BEL}${ESC}[2Jx`]: true }));
        const r = zipnative(['doctor'], repo);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('remedy:');
        expect(r.stderr).not.toContain(ESC);
        expect(r.stderr).not.toContain(BEL);
    });

    it('a false in .zipnativerc.json never turns a switch on (1.1.0 review)', async () => {
        const repo = join(dir, 'cfg-false');
        await mkdir(repo);
        const zip = join(repo, 'a.zip');
        expect(zipnative(['create', join(ROOT, 'package.json'), '-o', zip, '--quiet', '--no-config'], repo).status).toBe(0);
        await writeFile(join(repo, '.zipnativerc.json'), JSON.stringify({ json: false, quiet: false, long: false }));
        const r = zipnative(['list', zip], repo);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('Length');
        expect(r.stdout.trimStart().startsWith('{')).toBe(false);
    });

    it('a misspelt ZIPNATIVE_* switch is refused in the mode argv asked for (audit V-01)', () => {
        const r = spawnSync(process.execPath, [BIN, 'list', join(ROOT, 'package.json'), '--json'], {
            encoding: 'utf8',
            env: { ...process.env, NO_COLOR: '1', ZIPNATIVE_DRY_RUN: 'maybe' },
            timeout: 15000,
        });
        expect(r.status).toBe(2);
        const line = r.stderr.trim().split('\n').pop() as string;
        expect(line.startsWith('{')).toBe(true);
        const env = JSON.parse(line) as { ok: boolean; error: { code: string; message: string } };
        expect(env.ok).toBe(false);
        expect(env.error.code).toBe('E_USAGE');
        expect(env.error.message).toContain('ZIPNATIVE_DRY_RUN');
        expect(env.error.message).not.toContain('maybe');
    });

});
