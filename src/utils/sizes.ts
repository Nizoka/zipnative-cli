// Byte-size and count parsing for CLI flags. Zero-dep, pure.
//
// `<size>` grammar: a decimal integer with an optional binary suffix
// `k | m | g | t` (case-insensitive), optionally followed by `i`, `b` or `ib`
// (`512m`, `1GiB`, `4gb` are all binary multiples). The words `none`, `inf`,
// `infinity` (and `0` for limits) resolve to `Infinity` — a disabled bound.

import { CliError } from './error.js';

const UNITS: Readonly<Record<string, number>> = {
    '': 1,
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
};

const SIZE_RE = /^(\d+)\s*([kmgt])?(?:i?b)?$/i;

/**
 * Parse a byte size. Returns `Infinity` for `none|inf|infinity`.
 * Throws a usage error (exit 2) on any other malformed value.
 */
export function parseByteSize(raw: string, flag: string): number {
    const v = raw.trim().toLowerCase();
    if (v === 'none' || v === 'inf' || v === 'infinity') return Infinity;
    const m = SIZE_RE.exec(v);
    if (m === null) {
        throw new CliError(
            `--${flag} expects a byte size such as 65536, 512k, 1m, 8g or "none", got "${raw}".`,
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

/** Parse a non-negative integer count (or `none` → Infinity). */
export function parseCount(raw: string, flag: string): number {
    const v = raw.trim().toLowerCase();
    if (v === 'none' || v === 'inf' || v === 'infinity') return Infinity;
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
    if (n === Infinity || n <= 0) {
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
