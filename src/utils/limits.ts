// `--max-*` flags → `Partial<ZipLimits>`.
//
// Nine individual flags (one per `ZipLimits` key) rather than a JSON blob:
// they complete in every shell, they are flat keys in `.zipnativerc.json`
// (global or command-scoped), and PowerShell quoting of JSON on argv is
// hostile. Values are pre-validated so `ZIP_LIMIT_INVALID` is unreachable
// from the CLI. Every bound is a positive, finite integer: the 1.0 `none`
// (Infinity) form is refused since 1.1.0 (docs/adr/0002), and a
// configuration file can no longer set one (ADR 0001).

import type { ParsedArgs } from './args.js';
import { getStringFlag } from './args.js';
import { DEFAULT_ZIP_LIMITS, type ZipLimits } from '../core-bridge/index.js';
import { CliError } from './error.js';
import { parseByteSize, parseCount, formatBytes } from './sizes.js';

export type LimitKind = 'size' | 'count' | 'ratio';

export interface LimitFlag {
    readonly flag: string;
    readonly key: keyof ZipLimits;
    readonly kind: LimitKind;
    readonly cwe: string;
    readonly description: string;
}

/** The nine limit flags, in `ZipLimits` declaration order (one per key since 1.1.0 `--range`). */
export const LIMIT_FLAGS: readonly LimitFlag[] = [
    { flag: 'max-entries', key: 'maxEntries', kind: 'count', cwe: 'CWE-400', description: 'Maximum central-directory entry count' },
    { flag: 'max-entry-size', key: 'maxEntryUncompressedSize', kind: 'size', cwe: 'CWE-400', description: 'Maximum decompressed size of a single entry' },
    { flag: 'max-entry-compressed-size', key: 'maxEntryCompressedSize', kind: 'size', cwe: 'CWE-770', description: 'Maximum compressed size of a single entry fetched by the byte-range reader (--range)' },
    { flag: 'max-total-size', key: 'maxTotalUncompressedSize', kind: 'size', cwe: 'CWE-400', description: 'Maximum total decompressed size across an extraction' },
    { flag: 'max-ratio', key: 'maxCompressionRatio', kind: 'ratio', cwe: 'CWE-409', description: 'Maximum uncompressed/compressed ratio (entries ≥ 1 KiB compressed)' },
    { flag: 'max-name-bytes', key: 'maxNameBytes', kind: 'size', cwe: 'CWE-400', description: 'Maximum entry-name length in bytes' },
    { flag: 'max-extra-bytes', key: 'maxExtraFieldBytes', kind: 'size', cwe: 'CWE-400', description: 'Maximum extra-field block length in bytes' },
    { flag: 'max-comment-bytes', key: 'maxCommentBytes', kind: 'size', cwe: 'CWE-400', description: 'Maximum comment length in bytes' },
    { flag: 'max-cd-bytes', key: 'maxCentralDirectoryBytes', kind: 'size', cwe: 'CWE-400', description: 'Maximum central-directory size in bytes' },
];

/**
 * A `ZipLimits` key the CLI would report without a flag. Empty since 1.1.0:
 * `maxEntryCompressedSize` gained `--max-entry-compressed-size` when `--range`
 * made the byte-range reader reachable (docs/adr/0011, superseding 0007). Kept
 * so a future engine bound without a CLI surface has its place.
 */
export interface EngineOnlyLimit {
    readonly key: keyof ZipLimits;
    readonly kind: LimitKind;
    readonly cwe: string;
    readonly description: string;
    /** Why the CLI exposes no flag for it. */
    readonly reason: string;
}

export const ENGINE_ONLY_LIMITS: readonly EngineOnlyLimit[] = [];

/** Every `ZipLimits` key, in the engine's declaration order (flagged and engine-only). */
export const LIMIT_KEYS: readonly (keyof ZipLimits)[] = Object.keys(DEFAULT_ZIP_LIMITS) as (keyof ZipLimits)[];

/** `--max-*` flag names (with dashes) for completion / manifest tables. */
export const LIMIT_FLAG_NAMES: readonly string[] = LIMIT_FLAGS.map((l) => `--${l.flag}`);

/**
 * Parse every `--max-*` flag present in `args`. Returns `undefined` when none
 * is set (so the core's defaults apply untouched).
 *
 * Throws `E_USAGE` (exit 2) on malformed values or a zero bound.
 */
export function parseLimitFlags(args: ParsedArgs): Partial<ZipLimits> | undefined {
    const out: Record<string, number> = {};
    let any = false;
    for (const spec of LIMIT_FLAGS) {
        const raw = getStringFlag(args.flags, spec.flag);
        if (raw === undefined) continue;
        const value = spec.kind === 'size' ? parseByteSize(raw, spec.flag) : parseCount(raw, spec.flag);
        if (value === 0) {
            throw new CliError(`--${spec.flag} must be a positive bound, got "${raw}".`, 2);
        }
        out[spec.key] = value;
        any = true;
    }
    return any ? out : undefined;
}

/**
 * `--max-input-size <size>` — the bound on a BUFFERED archive read (stdin or
 * a file loaded whole by list/inspect/cat/extract/verify/modify, buffered
 * stdin for create, `inflate --sync`). Not a `ZipLimits` key: the engine
 * never sees the buffer; the CLI owns it. Default 4 GiB; always finite.
 */
export const MAX_INPUT_SIZE_FLAG = 'max-input-size';
export const DEFAULT_MAX_INPUT_SIZE = 4 * 1024 ** 3;

export function parseInputSizeFlag(args: ParsedArgs): number {
    const raw = getStringFlag(args.flags, MAX_INPUT_SIZE_FLAG);
    if (raw === undefined) return DEFAULT_MAX_INPUT_SIZE;
    const value = parseByteSize(raw, MAX_INPUT_SIZE_FLAG);
    if (value === 0) {
        throw new CliError(`--${MAX_INPUT_SIZE_FLAG} must be a positive bound, got "${raw}".`, 2);
    }
    return value;
}

/** Effective limits (defaults merged with overrides) for `doctor` / help text. */
export function effectiveLimits(overrides: Partial<ZipLimits> | undefined): ZipLimits {
    return { ...DEFAULT_ZIP_LIMITS, ...(overrides ?? {}) };
}

/** Human rendering of one limit value for text output. */
export function formatLimitValue(spec: { readonly kind: LimitKind }, value: number): string {
    if (spec.kind === 'size') return `${value} (${formatBytes(value)})`;
    if (spec.kind === 'ratio') return `${value}:1`;
    return String(value);
}
