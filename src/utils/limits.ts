// `--max-*` flags → `Partial<ZipLimits>`.
//
// Eight individual flags (one per CLI-reachable `ZipLimits` key — see
// ENGINE_ONLY_LIMITS for the one 1.1 bound without a flag) rather than a JSON blob:
// they complete in every shell, they are flat keys in `.zipnativerc.json`
// (global or command-scoped), and PowerShell quoting of JSON on argv is
// hostile. Values are pre-validated so `ZIP_LIMIT_INVALID` is unreachable
// from the CLI; `none` disables a bound (Infinity) with a visible warning.

import type { ParsedArgs } from './args.js';
import { getStringFlag } from './args.js';
import { progress } from './agent.js';
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

/** The eight limit flags, in `ZipLimits` declaration order (engine-only keys skipped). */
export const LIMIT_FLAGS: readonly LimitFlag[] = [
    { flag: 'max-entries', key: 'maxEntries', kind: 'count', cwe: 'CWE-400', description: 'Maximum central-directory entry count' },
    { flag: 'max-entry-size', key: 'maxEntryUncompressedSize', kind: 'size', cwe: 'CWE-400', description: 'Maximum decompressed size of a single entry' },
    { flag: 'max-total-size', key: 'maxTotalUncompressedSize', kind: 'size', cwe: 'CWE-400', description: 'Maximum total decompressed size across an extraction' },
    { flag: 'max-ratio', key: 'maxCompressionRatio', kind: 'ratio', cwe: 'CWE-409', description: 'Maximum uncompressed/compressed ratio (entries ≥ 1 KiB compressed)' },
    { flag: 'max-name-bytes', key: 'maxNameBytes', kind: 'size', cwe: 'CWE-400', description: 'Maximum entry-name length in bytes' },
    { flag: 'max-extra-bytes', key: 'maxExtraFieldBytes', kind: 'size', cwe: 'CWE-400', description: 'Maximum extra-field block length in bytes' },
    { flag: 'max-comment-bytes', key: 'maxCommentBytes', kind: 'size', cwe: 'CWE-400', description: 'Maximum comment length in bytes' },
    { flag: 'max-cd-bytes', key: 'maxCentralDirectoryBytes', kind: 'size', cwe: 'CWE-400', description: 'Maximum central-directory size in bytes' },
];

/**
 * A `ZipLimits` key the CLI reports but deliberately exposes no flag for.
 * `maxEntryCompressedSize` (zipnative 1.1, CWE-770) is consulted only by the
 * byte-range reader (`openZipRange`), which no 1.1.0 command reads through:
 * a `--max-*` flag for it would be accepted and have no effect — a report
 * that lies (docs/adr/0007). `doctor` and `schema limits` still show it.
 */
export interface EngineOnlyLimit {
    readonly key: keyof ZipLimits;
    readonly kind: LimitKind;
    readonly cwe: string;
    readonly description: string;
    /** Why the CLI exposes no flag for it. */
    readonly reason: string;
}

export const ENGINE_ONLY_LIMITS: readonly EngineOnlyLimit[] = [
    {
        key: 'maxEntryCompressedSize',
        kind: 'size',
        cwe: 'CWE-770',
        description: 'Maximum compressed size of a single entry fetched by the byte-range reader',
        reason: 'consulted only by openZipRange(), which no zipnative-cli 1.1 command reads through',
    },
];

/** Every `ZipLimits` key, in the engine's declaration order (flagged and engine-only). */
export const LIMIT_KEYS: readonly (keyof ZipLimits)[] = Object.keys(DEFAULT_ZIP_LIMITS) as (keyof ZipLimits)[];

/** `--max-*` flag names (with dashes) for completion / manifest tables. */
export const LIMIT_FLAG_NAMES: readonly string[] = LIMIT_FLAGS.map((l) => `--${l.flag}`);

let _warnedDisabled = false;

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
            throw new CliError(
                `--${spec.flag} must be positive (use "none" to disable the bound), got "${raw}".`,
                2,
            );
        }
        if (value === Infinity && !_warnedDisabled) {
            _warnedDisabled = true;
            progress(`warning: --${spec.flag} none disables a security bound — not recommended for untrusted input.`);
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
 * never sees the buffer; the CLI owns it. Default 4 GiB; `none` disables.
 */
export const MAX_INPUT_SIZE_FLAG = 'max-input-size';
export const DEFAULT_MAX_INPUT_SIZE = 4 * 1024 ** 3;

export function parseInputSizeFlag(args: ParsedArgs): number {
    const raw = getStringFlag(args.flags, MAX_INPUT_SIZE_FLAG);
    if (raw === undefined) return DEFAULT_MAX_INPUT_SIZE;
    const value = parseByteSize(raw, MAX_INPUT_SIZE_FLAG);
    if (value === 0) {
        throw new CliError(`--${MAX_INPUT_SIZE_FLAG} must be positive (use "none" to disable the bound), got "${raw}".`, 2);
    }
    if (value === Infinity && !_warnedDisabled) {
        _warnedDisabled = true;
        progress(`warning: --${MAX_INPUT_SIZE_FLAG} none disables a security bound — not recommended for untrusted input.`);
    }
    return value;
}

/** Effective limits (defaults merged with overrides) for `doctor` / help text. */
export function effectiveLimits(overrides: Partial<ZipLimits> | undefined): ZipLimits {
    return { ...DEFAULT_ZIP_LIMITS, ...(overrides ?? {}) };
}

/** Human rendering of one limit value for text output. */
export function formatLimitValue(spec: { readonly kind: LimitKind }, value: number): string {
    if (!Number.isFinite(value)) return 'unlimited';
    if (spec.kind === 'size') return `${value} (${formatBytes(value)})`;
    if (spec.kind === 'ratio') return `${value}:1`;
    return String(value);
}

/** Test-only: reset the one-shot "disabled bound" warning. */
export function _resetLimitWarnings(): void {
    _warnedDisabled = false;
}
