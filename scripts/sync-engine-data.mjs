#!/usr/bin/env node
// @ts-check
/**
 * zipnative-cli — engine data sync (the "bump the engine" step).
 *
 * `docs/data/errors.json` and `docs/data/core-exports.json` are COPIES of the
 * engine's own registries (`zipnative/docs/data/errors.json`,
 * `zipnative/docs/assets/api.json`, neither shipped in the npm tarball)
 * enriched with CLI-only fields: the `cli` mapping and `raisedBy` per code,
 * `reach` / `via` per export. This script re-derives the engine half from a
 * zipnative checkout and keeps the CLI half, so a bump is one command plus a
 * human review of what is new.
 *
 * Usage:
 *   node scripts/sync-engine-data.mjs [--engine <zipnative checkout>] [--check]
 *
 *   --engine  path to a zipnative checkout at the tag the CLI pins
 *             (default: $ZIPNATIVE_ENGINE_CHECKOUT, else ../zipnative — the
 *             ecosystem's sibling layout; CI clones the pinned tag there)
 *   --check   compare only; exit 1 when a file would change (CI-friendly)
 *
 * A NEW engine code or export cannot be completed mechanically — its CLI
 * mapping, `raisedBy` commands or `via` touchpoint is a design decision. The
 * script writes the row with `null` there, names it on stderr and exits 1;
 * tests/docs/consistency.test.ts fails until a human fills it in.
 *
 * Offline: it reads two local directories, runs the built CLI once
 * (`schema errors`, for the derived "cli" mapping) and writes two local files.
 *
 * Exit codes: 0 in sync / written · 1 drift (--check) or rows to complete ·
 * 2 usage / missing engine checkout.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} msg */
function fail(msg, code = 2) {
    process.stderr.write(`sync-engine-data: ${msg}\n`);
    process.exit(code);
}

const argv = process.argv.slice(2);
let engineDir = resolve(process.env['ZIPNATIVE_ENGINE_CHECKOUT'] ?? join(ROOT, '..', 'zipnative'));
let check = false;
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') check = true;
    else if (a === '--engine') {
        const v = argv[++i];
        if (v === undefined) fail('--engine requires a path');
        engineDir = resolve(v);
    } else fail(`unknown argument ${String(a)}`);
}

/** @param {string} p */
const readJson = (p) => /** @type {any} */ (JSON.parse(readFileSync(p, 'utf8')));

const engineErrorsPath = join(engineDir, 'docs', 'data', 'errors.json');
const engineApiPath = join(engineDir, 'docs', 'assets', 'api.json');
const enginePkgPath = join(engineDir, 'package.json');
for (const p of [engineErrorsPath, engineApiPath, enginePkgPath]) {
    if (!existsSync(p)) fail(`not a zipnative checkout: ${p} is missing (pass --engine <dir>)`);
}
const enginePkg = readJson(enginePkgPath);
if (enginePkg.name !== 'zipnative') fail(`${enginePkgPath} is not the zipnative package`);
const installed = readJson(join(ROOT, 'node_modules', 'zipnative', 'package.json'));
if (installed.version !== enginePkg.version) {
    fail(`the checkout is zipnative ${enginePkg.version} but node_modules has ${installed.version}: check out the tag the CLI pins`);
}

/** @type {string[]} */
const todo = [];

// ── docs/data/errors.json ────────────────────────────────────────────
const errorsPath = join(ROOT, 'docs', 'data', 'errors.json');
const cliErrors = readJson(errorsPath);
const engErrors = readJson(engineErrorsPath);

// The `cli` half (E_* class, exit code, remedy) is DERIVED, never hand-copied:
// the built CLI's `schema errors` prints ZIP_TO_CLI + ZIP_REMEDY verbatim
// (src/utils/ziperr.ts, src/utils/agent.ts). Without a build the prior
// mapping is kept and the run says so.
const cliBin = join(ROOT, 'dist', 'cli.cjs');
/** @type {Record<string, any> | null} */
let derivedCli = null;
if (existsSync(cliBin)) {
    const r = spawnSync(process.execPath, [cliBin, 'schema', 'errors', '--no-config'], { encoding: 'utf8' });
    if (r.status !== 0) fail(`\`zipnative schema errors\` failed: ${r.stderr}`);
    derivedCli = JSON.parse(r.stdout).zipnativeToCli;
} else {
    process.stderr.write('sync-engine-data: dist/cli.cjs missing (run npm run build) — keeping the prior "cli" mappings\n');
}
const errors = engErrors.errors.map((/** @type {any} */ e) => {
    const prior = cliErrors.errors.find((/** @type {any} */ c) => c.code === e.code);
    const cli = derivedCli !== null ? (derivedCli[e.code] ?? null) : (prior?.cli ?? null);
    if (cli === null) todo.push(`errors.json: error ${e.code} needs its "cli" mapping (ZIP_TO_CLI in src/utils/ziperr.ts)`);
    return { ...e, cli };
});
const diagnostics = engErrors.diagnostics.map((/** @type {any} */ d) => {
    const prior = cliErrors.diagnostics.find((/** @type {any} */ c) => c.code === d.code);
    if ((prior?.raisedBy ?? null) === null) todo.push(`errors.json: diagnostic ${d.code} needs "raisedBy" (the commands whose engine paths emit it)`);
    return {
        ...d,
        raisedBy: prior?.raisedBy ?? null,
        ...(prior?.raisedByNote !== undefined ? { raisedByNote: prior.raisedByNote } : {}),
    };
});
const nextErrors = {
    $comment: cliErrors.$comment,
    package: cliErrors.package,
    zipnativeVersion: enginePkg.version,
    verifiedOn: engErrors.verifiedOn,
    errors,
    diagnostics,
    sink: { ...engErrors.sink, cli: cliErrors.sink.cli },
};

// ── docs/data/core-exports.json ──────────────────────────────────────
const exportsPath = join(ROOT, 'docs', 'data', 'core-exports.json');
const cliExports = readJson(exportsPath);
const engApi = readJson(engineApiPath);

/** `export [async] <kind> …` → interface | type | const | class | function. */
function kindOf(/** @type {string} */ signature) {
    const m = /^export\s+(?:declare\s+)?(?:async\s+)?(interface|type|const|class|function)\b/.exec(signature);
    if (m === null) fail(`cannot derive a kind from signature: ${signature}`);
    return /** @type {RegExpExecArray} */ (m)[1];
}

const rows = [...engApi.exports]
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.subpath === b.subpath ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.subpath < b.subpath ? -1 : 1))
    .map((/** @type {any} */ e) => {
        const prior = cliExports.exports.find((/** @type {any} */ c) => c.name === e.name && c.subpath === e.subpath);
        if ((prior?.via ?? null) === null || (prior?.reach ?? null) === null) todo.push(`core-exports.json: export ${e.name} (${e.subpath}) needs "reach" and "via" (its CLI touchpoint, or why it is not exposed)`);
        return {
            name: e.name,
            kind: kindOf(e.signature),
            subpath: e.subpath,
            reach: prior?.reach ?? null,
            via: prior?.via ?? null,
        };
    });
const nextExports = {
    $comment: cliExports.$comment.replace(/\(\d+\.\d+\.\d+\)/, `(${enginePkg.version})`).replace(/the \d+\.\d+\.\d+ coverage audit/, `the ${enginePkg.version} coverage audit`),
    zipnativeVersion: enginePkg.version,
    exportCount: rows.length,
    exports: rows,
    // The day the CLI mapping was last re-verified: kept while the engine
    // version is unchanged (so --check is stable), stamped on a bump.
    verifiedOn: cliExports.zipnativeVersion === enginePkg.version
        ? cliExports.verifiedOn
        : new Date().toISOString().slice(0, 10),
};

// ── write / check ────────────────────────────────────────────────────
const outputs = [
    [errorsPath, JSON.stringify(nextErrors, null, 2) + '\n'],
    [exportsPath, JSON.stringify(nextExports, null, 2) + '\n'],
];
let drift = false;
for (const [path, text] of outputs) {
    const current = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    if (current === text) continue;
    drift = true;
    if (check) process.stderr.write(`sync-engine-data: ${path} is out of sync with zipnative ${enginePkg.version}\n`);
    else writeFileSync(path, text);
}
for (const t of todo) process.stderr.write(`sync-engine-data: TODO ${t}\n`);
if (check && drift) process.exit(1);
if (todo.length > 0) process.exit(1);
process.stdout.write(check ? `sync-engine-data: in sync with zipnative ${enginePkg.version}\n` : `sync-engine-data: ${drift ? 'updated' : 'already in sync'} (zipnative ${enginePkg.version}, ${rows.length} exports, ${errors.length} errors, ${diagnostics.length} diagnostics)\n`);
