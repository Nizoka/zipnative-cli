#!/usr/bin/env node
// @ts-check
/**
 * zipnative-cli — install smoke test (gate step `smoke-install`, publish
 * profile). Packs the tarball, installs it into an EMPTY project the way a
 * user would (`npm install <tgz> --ignore-scripts`), then:
 *
 *   • the installed tree holds exactly two packages: zipnative-cli and its one
 *     runtime dependency, zipnative (no extra runtime dependency slipped in);
 *   • the installed bin runs (npm set its executable bit) and reports the
 *     packed version, and `doctor --json` passes (the engine resolves, the
 *     worker script resolves through the exports map);
 *   • a create → verify round trip works from the installed package.
 *
 * Needs the npm registry (zipnative is fetched like any dependency); the CLI
 * itself still opens no socket. Exit: 0 ok · 1 failure · 2 npm unavailable.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = /** @type {{ version: string }} */ (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))).version;

/** @param {string[]} args @param {string} cwd */
function npm(args, cwd) {
    const npmCli = process.env['npm_execpath'];
    return npmCli !== undefined && existsSync(npmCli) && npmCli.endsWith('.js')
        ? spawnSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8' })
        : spawnSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
}

/** @param {string} msg */
function fail(msg, code = 1) {
    process.stderr.write(`smoke-install: ${msg}\n`);
    process.exit(code);
}

const work = mkdtempSync(join(tmpdir(), 'zipnative-cli-install-'));
try {
    const pack = npm(['pack', '--pack-destination', work, '--ignore-scripts', '--silent'], ROOT);
    if (pack.status !== 0) fail(`npm pack failed\n${pack.stderr}`, 2);
    const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'));
    if (tgz === undefined) fail('npm pack produced no tarball');
    const project = join(work, 'project');
    spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(project)})`]);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'smoke', private: true }) + '\n');
    const install = npm(['install', join(work, /** @type {string} */ (tgz)), '--ignore-scripts', '--no-audit', '--no-fund'], project);
    if (install.status !== 0) fail(`npm install of the tarball failed\n${install.stderr}`);

    // Exactly zipnative-cli + zipnative, nothing else (the runtime closure).
    const ls = npm(['ls', '--all', '--json', '--omit=dev'], project);
    /** @type {{ dependencies?: Record<string, { version: string; dependencies?: Record<string, unknown> }> }} */
    const tree = JSON.parse(ls.stdout || '{}');
    const top = Object.keys(tree.dependencies ?? {});
    if (top.length !== 1 || top[0] !== 'zipnative-cli') fail(`the project resolved ${JSON.stringify(top)}, expected only zipnative-cli`);
    const cli = (tree.dependencies ?? {})['zipnative-cli'];
    if (cli?.version !== VERSION) fail(`installed zipnative-cli ${String(cli?.version)}, packed ${VERSION}`);
    const runtime = Object.keys(cli.dependencies ?? {});
    if (runtime.length !== 1 || runtime[0] !== 'zipnative') fail(`zipnative-cli pulled ${JSON.stringify(runtime)} at runtime, expected only zipnative`);

    const bin = join(project, 'node_modules', 'zipnative-cli', 'dist', 'cli.cjs');
    /** @param {string[]} args */
    const run = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    const v = run(['--version']);
    if (v.stdout.trim() !== VERSION) fail(`the installed bin printed "${v.stdout.trim()}", expected ${VERSION}`);
    const shim = npm(['exec', '--offline', '--no', '--', 'zipnative', '--version'], project);
    if (shim.stdout.trim() !== VERSION) fail(`npm exec zipnative printed "${shim.stdout.trim()}" (${shim.stderr.trim()})`);
    const doctor = run(['doctor', '--format', 'json', '--no-config']);
    if (doctor.status !== 0) fail(`doctor failed from the installed package\n${doctor.stdout}${doctor.stderr}`);

    writeFileSync(join(project, 'hello.txt'), 'installed and working\n');
    const zip = join(project, 'hello.zip');
    const c = run(['create', join(project, 'hello.txt'), '-o', zip, '--deterministic', '--no-config']);
    if (c.status !== 0) fail(`create failed from the installed package\n${c.stderr}`);
    const ver = run(['verify', zip, '--no-config']);
    if (ver.status !== 0) fail(`verify failed from the installed package\n${ver.stdout}${ver.stderr}`);
    process.stdout.write(`smoke-install: ${tgz} installs alone with zipnative, runs, and round-trips\n`);
} finally {
    rmSync(work, { recursive: true, force: true });
}
