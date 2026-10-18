// @ts-check
// What the built bundle (dist/cli.cjs) must and must not contain — the gate
// step `bundle-check`, ported from pkinative-cli (scripts/lib/bundle-probe.ts).
// It catches the engine inlined (even in part), a debug print on stdout, an
// attribution trailer, embedded binary data, or a module package.json does
// not declare. Pure, so tests feed it synthetic bundles.

import { isBuiltin } from 'node:module';

/** The only non-built-in modules the bundle may load (static or dynamic). */
export const ALLOWED_EXTERNALS = new Set(['zipnative', 'zipnative/worker', 'zipnative/package.json', 'zipnative/worker/zip-worker.js']);

/** The engine stays external, never inlined (tsup.config.ts `noExternal: []`). */
export const REQUIRED_EXTERNALS = ['zipnative'];

/**
 * Definitions that exist only inside the engine's own build — one per layer
 * (EOCD location, central directory, local-header cross-check, DOS time, the
 * writer). The CLI calls the engine and never defines these, so any of them in
 * the bundle means engine code was inlined.
 */
export const ENGINE_MARKERS = [
    'function locateEocd(',
    'function parseCentralDirectory(',
    'function crossCheckLocalHeader(',
    'function dateToDosDateTime(',
    'function createZip(',
];

const REQUIRE_RE = /require\((['"])([^'"]+)\1\)/g;
const IMPORT_RE = /import\((['"])([^'"]+)\1\)/g;
const BASE64_RUN = /[A-Za-z0-9+/]{2048,}/;

/** Every bare module specifier the bundle loads (relative paths excluded). */
export function externalSpecifiers(/** @type {string} */ code) {
    const out = new Set();
    for (const re of [REQUIRE_RE, IMPORT_RE]) {
        for (const m of code.matchAll(re)) {
            const spec = m[2] ?? '';
            if (spec.startsWith('.') || spec.startsWith('/')) continue;
            out.add(spec);
        }
    }
    return [...out].sort();
}

/**
 * Built-ins that open sockets or resolve names. "Offline, always" (CLAUDE.md):
 * the bundle must never load one, with or without the `node:` prefix.
 */
export const DENIED_BUILTINS = new Set(['net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'dns/promises']);

/**
 * The failure lines for `code`; empty when the bundle is what it should be.
 * @param {string} code
 * @returns {string[]}
 */
export function probeBundle(code) {
    /** @type {string[]} */
    const failures = [];
    const lines = code.split('\n');
    if (!(lines[0] ?? '').startsWith('#!/usr/bin/env node')) failures.push('the first line is not the node shebang');
    lines.forEach((line, i) => {
        if (i > 0 && line.startsWith('#!')) failures.push(`line ${i + 1} is a second shebang`);
    });
    for (const marker of ENGINE_MARKERS) {
        if (code.includes(marker)) failures.push(`engine marker ${JSON.stringify(marker)} found — engine code is inlined`);
    }
    if (BASE64_RUN.test(code)) failures.push('a base64 run of 2048+ characters found — embedded binary data');
    if (code.includes('Co-Authored-By')) failures.push('"Co-Authored-By" found — attribution trailers never ship');
    if (code.includes('console.log(')) failures.push('console.log( found — stdout is reserved for the artefact');
    if (code.includes('\u0000')) failures.push('a NUL byte found in the bundle');
    const externals = externalSpecifiers(code);
    for (const spec of externals) {
        if (DENIED_BUILTINS.has(spec.replace(/^node:/, ''))) failures.push(`require("${spec}") found — a network module; no command may open a socket`);
        else if (!ALLOWED_EXTERNALS.has(spec) && !isBuiltin(spec)) failures.push(`external "${spec}" is not a Node built-in and not on the allow list`);
    }
    for (const required of REQUIRED_EXTERNALS) {
        if (!externals.includes(required)) failures.push(`require("${required}") is missing — the engine must stay external`);
    }
    return failures;
}
