// Agent output projection layer.
//
// A thin, dependency-free abstraction that lets autonomous AI agents (and CI)
// shrink the JSON the CLI emits on stdout — typically by ~90 % — without losing
// the information they actually branch on. Three composable levers:
//
//   1. Compact serialization   — `serializeJson(value, pretty=false)` drops the
//      2-space indentation agents never read (smaller, still valid JSON).
//   2. `--fields a,b.c`        — `selectFields` projects a result down to a set
//      of dot-paths; an array segment maps over every element.
//   3. (canonical summaries live in each command — they feed this layer.)
//
// Everything here is pure data manipulation: no I/O, no globals, no deps.

import { type ParsedArgs, getStringFlag, hasFlag } from './args.js';
import { isJsonMode } from './agent.js';

/** Commands whose stdout JSON honours `--summary` / `--fields` / `--pretty`. */
export const PROJECTED_COMMANDS: readonly string[] = ['list', 'inspect', 'verify', 'stream', 'batch'];

/** Parse a comma-separated `--fields` value into trimmed, non-empty dot-paths. */
export function parseFieldList(csv: string): string[] {
    return csv
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

/**
 * Serialize a value as JSON. Agents get compact output (no indentation); humans
 * get pretty 2-space output. The compact form is byte-for-byte smaller while
 * remaining valid JSON, which is the bulk of the token saving.
 */
export function serializeJson(value: unknown, pretty: boolean): string {
    return JSON.stringify(value, null, pretty ? 2 : 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Project a value down to a single dot-path, preserving its nesting.
 * - An empty path returns the whole subtree (leaf).
 * - On an array, the remaining path is mapped over every element.
 * - A missing/typed-out path yields `undefined` (the caller omits it).
 */
function pick(value: unknown, segments: readonly string[]): unknown {
    if (segments.length === 0) return value;
    if (Array.isArray(value)) {
        return value.map((el) => pick(el, segments));
    }
    if (isPlainObject(value)) {
        const [head, ...rest] = segments;
        if (head === undefined || !(head in value)) return undefined;
        const picked = pick(value[head], rest);
        if (picked === undefined) return undefined;
        return { [head]: picked };
    }
    // A primitive with path left to walk → the path does not exist.
    return undefined;
}

/** Deep-merge two projections so multiple `--fields` paths combine into one. */
function deepMerge(a: unknown, b: unknown): unknown {
    if (b === undefined) return a;
    if (a === undefined) return b;
    if (Array.isArray(a) && Array.isArray(b)) {
        const len = Math.max(a.length, b.length);
        const out: unknown[] = [];
        for (let i = 0; i < len; i++) out.push(deepMerge(a[i], b[i]));
        return out;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const out: Record<string, unknown> = { ...a };
        for (const [k, v] of Object.entries(b)) {
            out[k] = k in out ? deepMerge(out[k], v) : v;
        }
        return out;
    }
    return b; // scalar conflict: last path wins
}

/**
 * Build a pruned projection of `value` containing only the requested dot-paths.
 *
 * - Paths are dot-separated; a segment landing on an array maps over its items
 *   (e.g. `entries.name` → `{ entries: [{ name }, …] }`).
 * - Unknown or non-existent paths are silently omitted (lenient by design, so an
 *   agent never crashes the CLI by asking for a field that is conditionally absent).
 * - Multiple paths are deep-merged into a single object.
 */
export function selectFields(value: unknown, paths: readonly string[]): unknown {
    let result: unknown;
    for (const path of paths) {
        const segments = path
            .split('.')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        if (segments.length === 0) continue;
        result = deepMerge(result, pick(value, segments));
    }
    return result === undefined ? {} : result;
}

/**
 * Emit a JSON report on stdout honouring the token-economy flags:
 * `--summary` (caller supplies the canonical minimal shape), then `--fields`
 * (applied to whichever document is being emitted), then compact-vs-pretty.
 * Shared by every JSON-on-stdout command.
 */
export function emitJsonReport(
    args: ParsedArgs,
    full: unknown,
    summary?: () => unknown,
): void {
    let out: unknown = full;
    if (summary !== undefined && hasFlag(args.flags, 'summary')) {
        out = summary();
    }
    const fields = getStringFlag(args.flags, 'fields');
    if (fields !== undefined) out = selectFields(out, parseFieldList(fields));
    const pretty = hasFlag(args.flags, 'pretty') || !isJsonMode();
    process.stdout.write(serializeJson(out, pretty) + '\n');
}
