// Start-up guard for the built binary (review Q4-P2-6). Two properties:
//   1. the bundle's shape — the worker bundle is reachable only through the
//      lazy import() in core-bridge (never a hoisted require), and the only
//      hoisted externals are Node built-ins plus the engine itself (that
//      single top-level `require('zipnative')` is the known ≈10 ms of
//      ROADMAP A-11 — esbuild hoists the bridge's re-exports);
//   2. the CLI's own start-up overhead stays within a budget measured
//      RELATIVE to bare Node on the same machine (min of three runs), so a
//      slow CI runner does not flap the test but an accidental eager import
//      that doubles the cost does.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'dist', 'cli.cjs');

function timed(args: readonly string[]): number {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 20000 });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(r.status, `${args.join(' ')}\n${r.stderr}`).toBe(0);
    return ms;
}

function minOf(n: number, args: readonly string[]): number {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) best = Math.min(best, timed(args));
    return best;
}

describe.skipIf(!existsSync(BIN))('integration: start-up budget (dist/cli.cjs)', () => {
    it('the bundle reaches the worker only through a lazy import(); the engine is its single top-level external', () => {
        const bundle = readFileSync(BIN, 'utf8');
        // No eager require of the worker anywhere (esbuild would hoist one).
        expect(bundle).not.toMatch(/require\(\s*['"]zipnative\/worker/);
        // Exactly one lazy path to it — loadParallelZip() in core-bridge.
        expect(bundle.match(/import\(\s*['"]zipnative\/worker['"]\s*\)/g)).toHaveLength(1);
        // The hoisted externals are Node built-ins plus the engine, nothing else.
        const externals = [...bundle.matchAll(/^var \w+ = require\(['"]([^'"]+)['"]\);$/gm)].map((m) => m[1] as string);
        expect(externals.length).toBeGreaterThan(0);
        for (const e of externals) expect(e === 'zipnative' || isBuiltin(e), e).toBe(true);
        expect(externals.filter((e) => e === 'zipnative')).toHaveLength(1);
        // And the metadata probe never reaches the API: --version is served by version.ts.
        const r = spawnSync(process.execPath, [BIN, '--version', '--json'], { cwd: ROOT, encoding: 'utf8' });
        expect(r.status).toBe(0);
        expect(JSON.parse(r.stdout)).toMatchObject({ name: 'zipnative-cli' });
    });

    it('start-up overhead over bare Node stays within budget (min of 3 runs)', () => {
        timed([BIN, '--version']); // warm the OS file cache
        const baseline = minOf(3, ['-e', '0']);
        const cli = minOf(3, [BIN, '--version']);
        const overhead = cli - baseline;
        // Measured 2026-09-05: ≈ 40 ms on Windows 11 / Node 22 (205 ms vs 165 ms).
        expect(overhead, `cli ${cli.toFixed(0)} ms − node ${baseline.toFixed(0)} ms`).toBeLessThanOrEqual(250);
        expect(cli).toBeLessThanOrEqual(1500);
    });
});
