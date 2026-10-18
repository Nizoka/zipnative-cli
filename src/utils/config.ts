// `.zipnativerc.json` configuration file support.
//
// Provides default flag values, discovered by walking up from the current
// working directory (or given with --config; disabled with --no-config).
// Precedence (highest first):
//
//     explicit CLI flag  >  config file  >  built-in
//
// File shape — flag names map to values; a top-level key whose name is a
// command and whose value is an object is a command-scoped section (it wins
// over the global keys for that command):
//
//     {
//       "pretty": true,
//       "list": { "format": "ndjson", "long": true },
//       "inspect": { "summary": true }
//     }
//
// SECURITY (docs/adr/0001-configuration-is-presentation-only.md): a
// configuration file is PRESENTATION ONLY. A file planted in a cloned
// repository must never change what a command reads, what it trusts, where
// it writes, which bounds protect it or which code it runs — so only the keys
// of CONFIG_KEYS are accepted and every other key, present or future
// (`overwrite`, `skip-unsafe`, `allow-symlinks`, `max-*`, `codec`, …), is
// refused with E_USAGE, naming the file. A key is applied only where the
// invoked command declares the flag, and the file that supplied defaults is
// named on stderr and in the --json envelopes (`config`). Before 1.1.0 every
// flag but `codec` was accepted from a config file.

import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { FlagValue, ParsedArgs } from './args.js';
import { CliError } from './error.js';

export const CONFIG_FILENAME = '.zipnativerc.json';
const CONFIG_SIZE_LIMIT = 1024 * 1024; // 1 MiB — config files are small.

export const KNOWN_COMMANDS: readonly string[] = [
    'create', 'list', 'inspect', 'extract', 'cat', 'verify', 'stream', 'modify',
    'crc32', 'inflate', 'batch', 'doctor', 'schema', 'completion', 'govern',
];

/**
 * The only keys a configuration file may set: how a result is SHOWN, never
 * what is read, judged, trusted or written. `strict` is allowed because it
 * can only make a run stricter.
 */
export const CONFIG_KEYS: readonly string[] = [
    'json', 'pretty', 'quiet', 'no-color', 'progress', 'strict', 'long', 'summary', 'format', 'fields',
];

/** The keys that take a value; the others are switches. */
export const CONFIG_VALUE_KEYS: readonly string[] = ['format', 'fields'];

export function isConfigKey(key: string): boolean {
    return CONFIG_KEYS.includes(key);
}

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

/** Locate the nearest `.zipnativerc.json` (a regular file) by walking up from `startDir`. */
function findConfigFile(startDir: string): string | undefined {
    let dir = resolve(startDir);
    for (;;) {
        const candidate = join(dir, CONFIG_FILENAME);
        if (isFile(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/**
 * The file's bytes, bounded before anything is read: the descriptor's own
 * size is the one checked (a device or a FIFO never passes `isFile`), so the
 * read is at most 1 MiB whatever happens to the path in between.
 */
function readBounded(path: string): Buffer {
    const fd = openSync(path, 'r');
    try {
        const st = fstatSync(fd);
        if (!st.isFile()) throw new CliError(`Config file ${path} is not a regular file.`, 2);
        if (st.size > CONFIG_SIZE_LIMIT) throw new CliError(`Config file exceeds the 1 MiB limit: ${path}`, 2);
        const buf = Buffer.alloc(st.size);
        let total = 0;
        while (total < st.size) {
            const n = readSync(fd, buf, total, st.size - total, total);
            if (n === 0) break;
            total += n;
        }
        return buf.subarray(0, total);
    } finally {
        closeSync(fd);
    }
}

/**
 * A switch takes true or false; a value key a string (or a finite number).
 * Anything else is refused, never dropped: a default that silently does not
 * apply is a configuration the user did not get. The value is never echoed.
 */
function coerce(key: string, value: unknown, path: string): FlagValue {
    if (CONFIG_VALUE_KEYS.includes(key)) {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        throw new CliError(`Config file ${path}: "${key}" takes a string.`, 2);
    }
    if (typeof value === 'boolean') return value;
    throw new CliError(`Config file ${path}: "${key}" takes true or false.`, 2);
}

function assertAllowedKey(key: string, path: string): void {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new CliError(`Config file ${path} contains the forbidden key "${key}".`, 2);
    }
    if (!isConfigKey(key)) {
        throw new CliError(
            `Config file ${path} sets "${key}", which is accepted on the command line only: a configuration file sets presentation defaults (${CONFIG_KEYS.join(', ')}), never inputs, outputs, trust, bounds or code.`,
            2,
            undefined,
            { remedy: `remove "${key}" from ${path} and pass --${key} on the command line, or run with --no-config` },
        );
    }
}

export interface LoadedConfig {
    /** The file read, when one was found. */
    readonly path?: string;
    /** Every allowed key it sets for this command (global section, then the command's section). */
    readonly defaults: Readonly<Record<string, FlagValue>>;
}

/**
 * Load the configuration defaults for `commandName`. EVERY key of EVERY
 * section is validated, applicable or not, so a file is either entirely
 * valid or refused.
 *
 * @param commandName  The command being run (selects its scoped section).
 * @param explicitPath Optional `--config` override; when set, discovery is skipped.
 * @param cwd          Directory to start discovery from (default: process cwd).
 */
export function loadConfig(
    commandName: string,
    explicitPath: string | undefined,
    cwd: string = process.cwd(),
): LoadedConfig {
    let path: string | undefined;
    if (explicitPath !== undefined) {
        path = resolve(cwd, explicitPath);
        if (!isFile(path)) throw new CliError(`Config file not found: ${explicitPath}`, 2);
    } else {
        path = findConfigFile(cwd);
        if (path === undefined) return { defaults: {} };
    }

    const raw = readBounded(path);
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.toString('utf8'));
    } catch {
        throw new CliError(`Failed to parse config file ${path}: invalid JSON.`, 2);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CliError(`Config file ${path} must contain a JSON object.`, 2);
    }

    const file = path;
    const global = Object.create(null) as Record<string, FlagValue>;
    const scoped = Object.create(null) as Record<string, FlagValue>;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (KNOWN_COMMANDS.includes(key)) {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                throw new CliError(`Config file ${file}: the section "${key}" must be an object.`, 2);
            }
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                assertAllowedKey(k, file);
                const c = coerce(k, v, file);
                if (key === commandName) scoped[k] = c;
            }
            continue;
        }
        assertAllowedKey(key, file);
        global[key] = coerce(key, value, file);
    }
    // Command-scoped values win over global ones.
    return { path: file, defaults: { ...global, ...scoped } };
}

/**
 * Fill the flags the user did not pass with the config defaults the invoked
 * command declares (`known`, bare names); a key it does not declare is
 * ignored, so a `list` default for `--long` never breaks `verify`. Returns
 * the merged args and the keys actually applied.
 */
export function applyConfigDefaults(
    args: ParsedArgs,
    defaults: Readonly<Record<string, FlagValue>>,
    known: ReadonlySet<string>,
): { args: ParsedArgs; applied: readonly string[] } {
    const merged = Object.assign(Object.create(null) as Record<string, FlagValue>, args.flags);
    const applied: string[] = [];
    for (const [key, value] of Object.entries(defaults)) {
        if (!known.has(key) || merged[key] !== undefined) continue;
        merged[key] = value;
        applied.push(key);
    }
    return { args: { flags: merged, positionals: args.positionals }, applied };
}

// The file that supplied defaults to THIS run (null when none applied),
// reported in the --json envelopes (agent.ts) — set by the dispatcher.
let _active: { readonly path: string; readonly applied: readonly string[] } | null = null;

export function setActiveConfig(path: string | undefined, applied: readonly string[]): void {
    _active = path !== undefined && applied.length > 0 ? { path, applied } : null;
}

/** `{ path, applied }` of the config that shaped this run, or null. */
export function activeConfig(): { readonly path: string; readonly applied: readonly string[] } | null {
    return _active;
}
