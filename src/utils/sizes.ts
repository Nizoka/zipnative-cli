// Byte-size and count parsing for CLI flags. Zero-dep, pure.
//
// `<size>` grammar: a decimal integer with an optional binary suffix
// `k | m | g | t` (case-insensitive), optionally followed by `i`, `b` or `ib`
// (`512m`, `1GiB`, `4gb` are all binary multiples). Every value is a finite,
// exactly representable integer: since 1.1.0 there is no unbounded form —
// `none` / `inf` / `infinity` are refused with a remedy naming an explicit
// value (docs/adr/0002-every-bound-is-finite.md).

import { CliError } from './error.js';

const UNITS: Readonly<Record<string, number>> = {
    '': 1,
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
};

const SIZE_RE = /^(\d+)\s*([kmgt])?(?:i?b)?$/i;

const UNBOUNDED = new Set(['none', 'inf', 'infinity']);

/** The 1.0 "disabled bound" words: refused, with the migration in the message. */
function refuseUnbounded(raw: string, flag: string, example: string): CliError {
    return new CliError(
        `--${flag} "${raw.trim()}" is no longer accepted: since 1.1.0 every bound is finite. Pass an explicit, larger value for trusted input (e.g. --${flag} ${example}).`,
        2,
        undefined,
        { remedy: `--${flag} ${example} (an explicit bound; trusted input only)` },
    );
}

/**
 * Parse a byte size (a finite, safe integer). Throws a usage error (exit 2)
 * on a malformed value, an unrepresentable one, or the 1.0 `none` word.
 */
export function parseByteSize(raw: string, flag: string): number {
    const v = raw.trim().toLowerCase();
    if (UNBOUNDED.has(v)) throw refuseUnbounded(raw, flag, '64g');
    const m = SIZE_RE.exec(v);
    if (m === null) {
        throw new CliError(
            `--${flag} expects a byte size such as 65536, 512k, 1m or 8g, got "${raw}".`,
            2,
        );
    }
    const n = Number(m[1]);
    const unit = UNITS[(m[2] ?? '').toLowerCase()] ?? 1;
    const bytes = n * unit;
    if (!Number.isSafeInteger(bytes)) {
        throw new CliError(`--${flag} value "${raw}" is too large to represent exactly.`, 2);
    }
    return bytes;
}

/** Parse a non-negative integer count (finite; the 1.0 `none` word is refused). */
export function parseCount(raw: string, flag: string): number {
    const v = raw.trim().toLowerCase();
    if (UNBOUNDED.has(v)) throw refuseUnbounded(raw, flag, '10000000');
    if (!/^\d+$/.test(v)) {
        throw new CliError(`--${flag} expects a non-negative integer, got "${raw}".`, 2);
    }
    const n = Number(v);
    if (!Number.isSafeInteger(n)) {
        throw new CliError(`--${flag} value "${raw}" is too large to represent exactly.`, 2);
    }
    return n;
}

/** Parse a strictly positive integer. */
export function parsePositiveInt(raw: string, flag: string): number {
    const n = parseCount(raw, flag);
    if (n <= 0) {
        throw new CliError(`--${flag} expects a positive integer, got "${raw}".`, 2);
    }
    return n;
}

/** Human-readable byte count (binary units, one decimal). */
export function formatBytes(n: number): string {
    if (!Number.isFinite(n)) return 'unlimited';
    if (n < 1024) return `${n} B`;
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let v = n;
    let i = -1;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Compression ratio as a percentage string (`compressed / uncompressed`). */
export function formatRatio(compressed: number, uncompressed: number): string {
    if (uncompressed === 0) return '0%';
    const saved = 100 - (compressed / uncompressed) * 100;
    return `${Math.max(0, Math.round(saved))}%`;
}
