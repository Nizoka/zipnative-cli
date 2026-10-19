#!/usr/bin/env node
// @ts-check
/**
 * zipnative-cli — the single definition of what "green" means. CI, the
 * release workflow, the veraZIP workflow, CONTRIBUTING.md and the agent
 * instructions point here instead of each carrying a list of commands.
 * Ported from pkinative-cli (scripts/gate.ts), in plain ESM (no tsx).
 *
 * Each step is an npm script or an inline check; its full output goes to
 * test-output/.gate/<id>.log and the gate prints one line per step. On the
 * first failure it prints the tail of that log and stops.
 *
 *   npm run gate                                   --ci (default)
 *   npm run gate:fast                              typecheck, lint, test
 *   node scripts/gate.mjs --publish --require-all  what publish.yml runs
 *   node scripts/gate.mjs --only smoke | --from build | --json
 *
 * Profiles: --fast (no build), --ci (everything but the install smoke test,
 * the samples and the veraZIP corpus), --publish (everything). --require-all
 * turns every SKIP into a FAIL and makes veraZIP fail closed without a
 * level-1 tool (VERAZIP_REQUIRED=1): a runner that lacks a tool goes red.
 *
 * Exit: 0 every step passed or skipped with a reason · 1 a step failed · 2 usage.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeBundle } from './lib/bundle-probe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = join(ROOT, 'test-output', '.gate');
const CLI = join(ROOT, 'dist', 'cli.cjs');
const PKG = /** @type {{ version: string }} */ (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')));

/** @typedef {'fast' | 'ci' | 'publish'} Profile */
/**
 * @typedef {object} Step
 * @property {string} id
 * @property {readonly Profile[]} profiles
 * @property {string} [npmScript]
 * @property {readonly string[]} [node]                 a node script + args, run with process.execPath
 * @property {Readonly<Record<string, string>>} [env]
 * @property {(requireAll: boolean) => Readonly<Record<string, string>>} [envFor]
 * @property {() => readonly string[]} [inline]          in-process check: failure lines, empty = pass
 * @property {() => string | null} [skipWhen]            a reason to skip, or null to run
 * @property {() => string | null} [note]                a figure shown next to PASS
 */

/** The command count from the built manifest (one source: src/commands/completion.ts COMMANDS). */
function runCli(/** @type {readonly string[]} */ args) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: { ...process.env, NO_COLOR: '1', ZIPNATIVE_JSON: '' } });
    return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

function distCheck() {
    if (!existsSync(CLI)) return ['dist/cli.cjs is missing'];
    /** @type {string[]} */
    const failures = [];
    for (const forbidden of ['dist/cli.js', 'dist/cli.d.ts', 'dist/cli.cjs.map']) {
        if (existsSync(join(ROOT, forbidden))) failures.push(`${forbidden} exists — the package ships the CJS bin only`);
    }
    return failures;
}

/** The command count the built --help declares ("Commands (N)"), for the smoke step's note. @type {number | null} */
let smokeCommands = null;

/** Drive the BUILT binary the way a user would (tsup flattens src/: a path that resolves in source can fail in dist/). */
function smoke() {
    if (!existsSync(CLI)) return ['dist/cli.cjs is missing (run build first)'];
    /** @type {string[]} */
    const failures = [];
    const help = runCli(['--help']);
    if (help.status !== 0) failures.push(`--help exited ${help.status}`);
    const v = runCli(['--version']);
    if (v.stdout.trim() !== PKG.version) failures.push(`--version printed "${v.stdout.trim()}", package.json says ${PKG.version}`);
    const manifest = runCli(['schema', 'manifest', '--no-config']);
    try {
        const doc = /** @type {{ commands?: Array<{ name: string }> }} */ (JSON.parse(manifest.stdout));
        // One count, two surfaces: the manifest must list what --help declares.
        const declared = /Commands \((\d+)\)/.exec(help.stdout);
        smokeCommands = declared === null ? null : Number(declared[1]);
        if (smokeCommands === null) failures.push('--help does not declare "Commands (N)"');
        else if (doc.commands?.length !== smokeCommands) failures.push(`schema manifest lists ${String(doc.commands?.length)} commands, --help declares ${smokeCommands}`);
        for (const c of doc.commands ?? []) if (!help.stdout.includes(c.name)) failures.push(`--help does not list ${c.name}`);
    } catch {
        failures.push(`schema manifest is not JSON:\n${manifest.stdout}${manifest.stderr}`);
    }
    const doctor = runCli(['doctor', '--format', 'json', '--no-config']);
    try {
        const report = /** @type {{ ok: boolean; checks: Array<{ name: string; status: string; value: string; detail: string }> }} */ (JSON.parse(doctor.stdout));
        for (const c of report.checks.filter((x) => x.status === 'error')) failures.push(`doctor: ${c.name}: ${c.detail}`);
        const tier = report.checks.find((c) => c.name === 'deflate-tier');
        if (tier?.value !== 'node-zlib') failures.push(`doctor deflate-tier is ${String(tier?.value)}, expected node-zlib (the engine must stay external)`);
    } catch {
        failures.push(`doctor --format json is not JSON:\n${doctor.stdout}${doctor.stderr}`);
    }
    const refused = runCli(['list', '--overwite', '--no-config']);
    if (refused.status !== 2) failures.push(`an unknown flag exited ${refused.status}, expected the usage refusal (2)`);
    return failures;
}

/** The bundle is byte-reproducible (the product sells byte-reproducible archives). */
function reproducible() {
    if (!existsSync(CLI)) return ['dist/cli.cjs is missing (run build first)'];
    const before = createHash('sha256').update(readFileSync(CLI)).digest('hex');
    const status = runNpmScript('build', join(LOG_DIR, 'reproducible-build.log'), {});
    if (status !== 0) return ['the second build failed'];
    const after = createHash('sha256').update(readFileSync(CLI)).digest('hex');
    return before === after ? [] : [`two builds differ: ${before} vs ${after}`];
}

/** The Node.js security floor (package.json engines.node), as the built CLI's doctor evaluates it. */
function nodeFloor() {
    if (!existsSync(CLI)) return ['dist/cli.cjs is missing (run build first)'];
    const r = spawnSync(process.execPath, [CLI, 'doctor', '--format', 'json'], { encoding: 'utf8' });
    try {
        const node = /** @type {{ checks: { name: string; status: string; detail: string }[] }} */ (JSON.parse(r.stdout)).checks.find((c) => c.name === 'node');
        return node?.status === 'ok' ? [] : [`Node.js ${process.versions.node} is below the security floor: ${node?.detail ?? 'no node check'}`];
    } catch {
        return [`doctor --format json is not JSON: ${r.stdout}${r.stderr}`];
    }
}

function bundleCheck() {
    return existsSync(CLI) ? probeBundle(readFileSync(CLI, 'utf8')) : ['dist/cli.cjs is missing (run build first)'];
}

/** veraZIP fails closed without a level-1 tool under --require-all. */
/** @param {boolean} requireAll @returns {Record<string, string>} */
const verazipEnv = (requireAll) => (requireAll ? { VERAZIP_REQUIRED: '1', VERAZIP_REPORT_DIR: 'test-output/zip/reports' } : {});

const bundleSize = () => (existsSync(CLI) ? `${(statSync(CLI).size / 1024).toFixed(0)} KiB` : null);

/** @type {readonly Step[]} */
export const STEPS = [
    { id: 'typecheck:all', npmScript: 'typecheck:all', profiles: ['fast', 'ci', 'publish'] },
    { id: 'lint', npmScript: 'lint', profiles: ['fast', 'ci', 'publish'] },
    { id: 'test', npmScript: 'test', profiles: ['fast'] },
    { id: 'build', npmScript: 'build', profiles: ['ci', 'publish'], note: bundleSize },
    { id: 'reproducible', inline: reproducible, profiles: ['ci', 'publish'] },
    { id: 'dist-check', inline: distCheck, profiles: ['ci', 'publish'] },
    { id: 'bundle-check', inline: bundleCheck, profiles: ['ci', 'publish'], note: () => 'engine external, no inlined engine code' },
    { id: 'smoke', inline: smoke, profiles: ['ci', 'publish'], note: () => (smokeCommands === null ? null : `${smokeCommands} commands`) },
    { id: 'node-floor', inline: nodeFloor, profiles: ['ci', 'publish'], note: () => `Node.js ${process.versions.node}` },
    // After `build`: the built-binary suites need dist/ and self-skip without it.
    { id: 'test:coverage', npmScript: 'test:coverage', profiles: ['ci', 'publish'] },
    { id: 'engine-data', node: ['scripts/sync-engine-data.mjs', '--check'], profiles: ['ci', 'publish'], skipWhen: () => (existsSync(join(ROOT, '..', 'zipnative', 'docs', 'data', 'errors.json')) || process.env['ZIPNATIVE_ENGINE_CHECKOUT'] !== undefined ? null : 'no zipnative checkout next to this repository (ZIPNATIVE_ENGINE_CHECKOUT)') },
    { id: 'package-files', node: ['scripts/package-files.mjs'], profiles: ['ci', 'publish'] },
    { id: 'samples', node: ['samples/run-all.js', '--clean'], profiles: ['publish'] },
    {
        id: 'verazip', npmScript: 'corpus:zip', profiles: ['publish'],
        envFor: verazipEnv,
    },
    {
        id: 'verazip-validate', node: ['scripts/validate-zip.mjs'], profiles: ['publish'],
        envFor: verazipEnv,
    },
    { id: 'smoke-install', node: ['scripts/smoke-install.mjs'], profiles: ['publish'] },
];

/** @param {string} script @param {string} logPath @param {Readonly<Record<string, string>>} extraEnv */
function runNpmScript(script, logPath, extraEnv) {
    const env = { ...process.env, ...extraEnv, NO_COLOR: '1', FORCE_COLOR: '0' };
    const fd = openSync(logPath, 'w');
    try {
        const npmCli = process.env['npm_execpath'];
        /** @type {import('node:child_process').SpawnSyncOptions} */
        const common = { cwd: ROOT, env, stdio: ['ignore', fd, fd], windowsHide: true };
        const result = npmCli !== undefined && existsSync(npmCli) && npmCli.endsWith('.js')
            ? spawnSync(process.execPath, [npmCli, 'run', script], common)
            : spawnSync('npm', ['run', script], { ...common, shell: true });
        if (result.error) throw result.error;
        return result.status ?? 1;
    } finally {
        closeSync(fd);
    }
}

/** @param {readonly string[]} argv @param {string} logPath @param {Readonly<Record<string, string>>} extraEnv */
function runNode(argv, logPath, extraEnv) {
    const fd = openSync(logPath, 'w');
    try {
        const r = spawnSync(process.execPath, [...argv], { cwd: ROOT, env: { ...process.env, ...extraEnv, NO_COLOR: '1' }, stdio: ['ignore', fd, fd], windowsHide: true });
        if (r.error) throw r.error;
        return r.status ?? 1;
    } finally {
        closeSync(fd);
    }
}

/** @param {() => readonly string[]} check @param {string} logPath */
function runInline(check, logPath) {
    const failures = check();
    const fd = openSync(logPath, 'a');
    try {
        writeSync(fd, failures.length === 0 ? 'ok\n' : `${failures.join('\n')}\n`);
    } finally {
        closeSync(fd);
    }
    return failures.length === 0 ? 0 : 1;
}

/** @param {string} file @param {number} lines */
function tail(file, lines) {
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n').slice(-lines);
}

/**
 * @param {readonly string[]} argv
 * @returns {{ profile: Profile; only: string | null; from: string | null; json: boolean; requireAll: boolean } | { error: string }}
 */
export function parseGateArgs(argv) {
    /** @type {Profile | null} */
    let profile = null;
    /** @type {string | null} */
    let only = null;
    /** @type {string | null} */
    let from = null;
    let json = false;
    let requireAll = false;
    const ids = new Set(STEPS.map((s) => s.id));
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--fast' || a === '--ci' || a === '--publish') {
            const p = /** @type {Profile} */ (a.slice(2));
            if (profile !== null && profile !== p) return { error: `--${profile} and ${a} are mutually exclusive` };
            profile = p;
        } else if (a === '--only' || a === '--from') {
            const id = argv[i + 1];
            if (id === undefined || id.startsWith('--')) return { error: `${a} needs a step id` };
            if (!ids.has(id)) return { error: `unknown step "${id}"` };
            if (a === '--only') only = id;
            else from = id;
            i++;
        } else if (a === '--json') {
            json = true;
        } else if (a === '--require-all') {
            requireAll = true;
        } else {
            return { error: `unknown argument "${String(a)}"` };
        }
    }
    return { profile: profile ?? 'ci', only, from, json, requireAll };
}

/** @param {{ profile: Profile; only: string | null; from: string | null }} opts */
export function selectSteps(opts) {
    if (opts.only !== null) return STEPS.filter((s) => s.id === opts.only);
    let selected = STEPS.filter((s) => s.profiles.includes(opts.profile));
    if (opts.from !== null) {
        const full = STEPS.findIndex((s) => s.id === opts.from);
        selected = selected.filter((s) => STEPS.indexOf(s) >= full);
    }
    return selected;
}

function main() {
    const parsed = parseGateArgs(process.argv.slice(2));
    if ('error' in parsed) {
        process.stderr.write(`gate: ${parsed.error}\nusage: node scripts/gate.mjs [--fast | --ci | --publish] [--only <id>] [--from <id>] [--require-all] [--json]\nsteps: ${STEPS.map((s) => s.id).join(', ')}\n`);
        return 2;
    }
    const opts = parsed;
    const steps = selectSteps(opts);
    const width = Math.max(...STEPS.map((s) => s.id.length));
    const say = (/** @type {string} */ line) => {
        if (!opts.json) process.stdout.write(`${line}\n`);
    };
    mkdirSync(LOG_DIR, { recursive: true });
    /** @type {Array<{ id: string; status: 'pass' | 'fail' | 'skip'; seconds: number; note: string | null }>} */
    const outcomes = [];
    const startedAt = Date.now();
    say(`gate --${opts.profile}${opts.requireAll ? ' --require-all' : ''}: ${steps.length} step(s)`);

    /** @type {string | null} */
    let failedAt = null;
    for (const step of steps) {
        const reason = step.skipWhen?.() ?? null;
        if (reason !== null) {
            // A missing engine checkout is a contributor convenience, never a
            // release blocker: the data files are also pinned by the docs tests.
            if (opts.requireAll && step.id !== 'engine-data') {
                const note = `required by --require-all: ${reason}`;
                outcomes.push({ id: step.id, status: 'fail', seconds: 0, note });
                say(`FAIL  ${step.id.padEnd(width)}           ${note}`);
                failedAt = step.id;
                break;
            }
            outcomes.push({ id: step.id, status: 'skip', seconds: 0, note: reason });
            say(`SKIP  ${step.id.padEnd(width)}           (${reason})`);
            continue;
        }
        const logPath = join(LOG_DIR, `${step.id.replace(/[^a-z0-9-]/gi, '-')}.log`);
        const env = { ...(step.env ?? {}), ...(step.envFor?.(opts.requireAll) ?? {}) };
        const t0 = Date.now();
        let status;
        if (step.inline !== undefined) {
            closeSync(openSync(logPath, 'w'));
            status = runInline(step.inline, logPath);
        } else if (step.node !== undefined) {
            status = runNode(step.node, logPath, env);
        } else {
            status = runNpmScript(step.npmScript ?? step.id, logPath, env);
        }
        const seconds = (Date.now() - t0) / 1000;
        const clock = `${seconds.toFixed(1)}s`.padStart(8);
        if (status === 0) {
            const note = step.note?.() ?? null;
            outcomes.push({ id: step.id, status: 'pass', seconds, note });
            say(`PASS  ${step.id.padEnd(width)}  ${clock}${note !== null ? `  ${note}` : ''}`);
            continue;
        }
        const rel = relative(ROOT, logPath).replace(/\\/g, '/');
        outcomes.push({ id: step.id, status: 'fail', seconds, note: `exit ${status}; log: ${rel}` });
        say(`FAIL  ${step.id.padEnd(width)}  ${clock}  exit ${status}`);
        for (const line of tail(logPath, 15)) say(`      ${line}`);
        say(`      (full log: ${rel})`);
        failedAt = step.id;
        break;
    }

    const total = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ok: failedAt === null, profile: opts.profile, requireAll: opts.requireAll, steps: outcomes }, null, 2)}\n`);
    } else if (failedAt !== null) {
        process.stdout.write(`gate: failed at ${failedAt}\n`);
    } else {
        const passed = outcomes.filter((o) => o.status === 'pass').length;
        const skipped = outcomes.filter((o) => o.status === 'skip').length;
        process.stdout.write(`gate: ${passed} passed, ${skipped} skipped in ${total} s\n`);
    }
    return failedAt === null ? 0 : 1;
}

// Only when run directly, so tests can import STEPS, parseGateArgs and selectSteps.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main();
}
