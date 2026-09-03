// Shared flag parsing for the archive commands — one place for every
// flag → core-option translation so `create`, `modify`, `extract`, `list`,
// `inspect`, `cat`, `verify` and `stream` agree byte-for-byte.

import { basename } from 'node:path';
import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from './args.js';
import { isStrict } from './agent.js';
import type {
    OpenZipOptions,
    ZipCommonOptions,
    ZipCompressionOptions,
    ZipReader,
} from '../core-bridge/index.js';
import { openZip } from '../core-bridge/index.js';
import type { DiagnosticSink } from './diagnostics.js';
import { CliError, ErrorCode } from './error.js';
import { buildFilter, isPassThrough, type NameFilter } from './glob.js';
import { readFileOrStdin } from './io.js';
import { parseLimitFlags } from './limits.js';
import { parseByteSize, parsePositiveInt } from './sizes.js';
import { guard } from './ziperr.js';

/** `{ strict, onDiagnostic, limits }` for any core entry point. */
export function commonOptions(args: ParsedArgs, sink: DiagnosticSink): ZipCommonOptions {
    const limits = parseLimitFlags(args);
    return {
        strict: isStrict() || hasFlag(args.flags, 'strict'),
        onDiagnostic: sink.onDiagnostic,
        ...(limits !== undefined ? { limits } : {}),
    };
}

/** `--method`, `--level`, `--deterministic` → `ZipCompressionOptions` (or undefined). */
export function parseCompression(args: ParsedArgs): ZipCompressionOptions | undefined {
    const out: { method?: 'store' | 'deflate'; level?: number; deterministic?: boolean } = {};
    const method = getStringFlag(args.flags, 'method');
    if (method !== undefined) {
        if (method !== 'store' && method !== 'deflate') {
            throw new CliError(`--method must be "store" or "deflate", got "${method}".`, 2);
        }
        out.method = method;
    }
    const level = getStringFlag(args.flags, 'level');
    if (level !== undefined) {
        if (!/^\d$/.test(level.trim())) {
            throw new CliError(`--level must be an integer from 0 to 9, got "${level}".`, 2);
        }
        out.level = Number(level);
    }
    if (hasFlag(args.flags, 'deterministic')) out.deterministic = true;
    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * `--date epoch|now|<ISO-8601>` → `Date | 'now' | undefined`
 * (`undefined` = omit → the core's DOS-epoch default).
 */
export function parseDateFlag(args: ParsedArgs): Date | 'now' | undefined {
    const raw = getStringFlag(args.flags, 'date');
    if (raw === undefined) return undefined;
    const v = raw.trim().toLowerCase();
    if (v === 'epoch') return undefined;
    if (v === 'now') return 'now';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
        throw new CliError(`--date expects "epoch", "now" or an ISO 8601 date, got "${raw}".`, 2);
    }
    return d;
}

/** `--chunk-size <size>` (default 65536). */
export function parseChunkSize(args: ParsedArgs): number | undefined {
    const raw = getStringFlag(args.flags, 'chunk-size');
    if (raw === undefined) return undefined;
    const n = parseByteSize(raw, 'chunk-size');
    if (!Number.isFinite(n) || n <= 0) {
        throw new CliError(`--chunk-size must be a positive byte size, got "${raw}".`, 2);
    }
    return n;
}

/** `--workers <n>` style positive integers. */
export function parseIntFlag(args: ParsedArgs, flag: string): number | undefined {
    const raw = getStringFlag(args.flags, flag);
    if (raw === undefined) return undefined;
    return parsePositiveInt(raw, flag);
}

/**
 * `name=path` split at the FIRST `=`; a bare `path` uses its basename as the
 * entry name; `path` may be `-` (stdin).
 */
export function parseNameEqualsPath(raw: string, flag: string): { name: string; path: string } {
    const idx = raw.indexOf('=');
    if (idx === -1) {
        const path = raw;
        if (path === '-') throw new CliError(`--${flag} - requires an explicit name: --${flag} <name>=-`, 2);
        return { name: basename(path.replace(/\\/g, '/')), path };
    }
    const name = raw.slice(0, idx);
    const path = raw.slice(idx + 1);
    if (name.length === 0 || path.length === 0) {
        throw new CliError(`--${flag} expects <name>=<path>, got "${raw}".`, 2);
    }
    return { name, path };
}

/** `from=to` split at the FIRST `=` (both non-empty). */
export function parseFromEqualsTo(raw: string, flag: string): { from: string; to: string } {
    const idx = raw.indexOf('=');
    if (idx <= 0 || idx === raw.length - 1) {
        throw new CliError(`--${flag} expects <from>=<to>, got "${raw}".`, 2);
    }
    return { from: raw.slice(0, idx), to: raw.slice(idx + 1) };
}

export type OnDuplicate = 'error' | 'first' | 'last';

/** `--on-duplicate error|first|last` (default error). */
export function parseOnDuplicate(args: ParsedArgs): OnDuplicate {
    const raw = getStringFlag(args.flags, 'on-duplicate');
    if (raw === undefined) return 'error';
    if (raw === 'error' || raw === 'first' || raw === 'last') return raw;
    throw new CliError(`--on-duplicate must be "error", "first" or "last", got "${raw}".`, 2);
}

/** `--format <one of allowed>` with a default; usage error otherwise. */
export function parseFormat<T extends string>(
    args: ParsedArgs,
    allowed: readonly T[],
    fallback: T,
): T {
    const raw = getStringFlag(args.flags, 'format', 'f');
    if (raw === undefined) return fallback;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    throw new CliError(`--format must be one of ${allowed.join(', ')}, got "${raw}".`, 2);
}

/** `--include` / `--exclude` globs → predicate (or undefined when unset). */
export function parseNameFilter(args: ParsedArgs): NameFilter | undefined {
    const includes = getStringFlagAll(args.flags, 'include');
    const excludes = getStringFlagAll(args.flags, 'exclude');
    if (isPassThrough(includes, excludes)) return undefined;
    return buildFilter(includes, excludes);
}

/**
 * Resolve the archive input path: `--input/-i`, else the positional at
 * `positionalIndex`, else stdin (`undefined`).
 */
export function resolveInputPath(args: ParsedArgs, positionalIndex = 0): string | undefined {
    const flag = getStringFlag(args.flags, 'input', 'i');
    if (flag !== undefined) return flag;
    return args.positionals[positionalIndex];
}

/** Read the whole archive (file or stdin) as a `Uint8Array`. */
export async function readArchiveBytes(path: string | undefined): Promise<Uint8Array> {
    let buf: Buffer;
    try {
        buf = await readFileOrStdin(path);
    } catch (e) {
        if (e instanceof CliError) throw e;
        const message = e instanceof Error ? e.message : String(e);
        throw new CliError(`Cannot read ${path === undefined || path === '-' ? 'stdin' : `"${path}"`}: ${message}`, 1, ErrorCode.IO);
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** `openZip` wrapped with the error mapper. */
export function openArchive(bytes: Uint8Array, options: OpenZipOptions): ZipReader {
    return guard('Failed to open archive', () => openZip(bytes, options));
}

/** Decode raw comment bytes as UTF-8 (lossy), for JSON/text output. */
export function decodeComment(raw: Uint8Array): string {
    if (raw.length === 0) return '';
    return new TextDecoder('utf-8', { fatal: false }).decode(raw);
}
