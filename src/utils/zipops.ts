// Shared flag parsing for the archive commands — one place for every
// flag → core-option translation so `create`, `modify`, `extract`, `list`,
// `inspect`, `cat`, `verify` and `stream` agree byte-for-byte.

import { basename } from 'node:path';
import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from './args.js';
import { isStrict, progress } from './agent.js';
import type {
    OpenZipOptions,
    ZipCommonOptions,
    ZipCompressionOptions,
    ZipExtraField,
    ZipReader,
} from '../core-bridge/index.js';
import { openZip } from '../core-bridge/index.js';
import type { DiagnosticSink } from './diagnostics.js';
import { CliError, ErrorCode } from './error.js';
import { buildFilter, isPassThrough, type NameFilter } from './glob.js';
import { readFileOrStdin } from './io.js';
import { parseInputSizeFlag, parseLimitFlags } from './limits.js';
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

const DOS_YEAR_MIN = 1980;
const DOS_YEAR_MAX = 2107;
const ZONE_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse an ISO 8601 date as **UTC wall-clock time**.
 *
 * ZIP stores DOS timestamps: local wall-clock fields, no zone. The engine
 * encodes a `Date` through its LOCAL getters, so handing it an instant would
 * make the stored fields depend on the invoking host's TZ — and a
 * `--deterministic` build would hash differently in CI and on a laptop.
 * The CLI therefore normalises every explicit date to its UTC components and
 * builds a local `Date` carrying exactly those fields: the archive stores the
 * UTC wall-clock on every machine. A string without a zone designator is
 * read as UTC too (`2020-06-01T12:00:00` ≡ `2020-06-01T12:00:00Z`).
 *
 * Warns (stderr, suppressed by --quiet) when the year falls outside the DOS
 * range 1980–2107 (the engine clamps) or the seconds are odd (2-second
 * resolution: floored).
 *
 * @throws CliError exit 2 (`usage` = true) or E_INPUT (manifest values)
 */
export function parseIsoDateUtc(raw: string, where: string, usage = true): Date {
    let s = raw.trim();
    if (DATE_ONLY_RE.test(s)) s += 'T00:00:00Z';
    else if (!ZONE_RE.test(s)) s += 'Z';
    const instant = new Date(s);
    if (Number.isNaN(instant.getTime())) {
        throw usage
            ? new CliError(`${where} expects "epoch", "now" or an ISO 8601 date, got "${raw}".`, 2)
            : new CliError(`${where}: "date" must be "epoch", "now" or an ISO 8601 string.`, 1, ErrorCode.INPUT);
    }
    const year = instant.getUTCFullYear();
    if (year < DOS_YEAR_MIN || year > DOS_YEAR_MAX) {
        progress(`warning: ${where} ${raw} is outside the DOS timestamp range ${DOS_YEAR_MIN}-01-01 .. ${DOS_YEAR_MAX}-12-31 and will be clamped by the engine.`);
    }
    if (instant.getUTCSeconds() % 2 === 1) {
        progress(`warning: ${where} ${raw}: DOS timestamps have 2-second resolution; the odd second is floored.`);
    }
    return new Date(
        year,
        instant.getUTCMonth(),
        instant.getUTCDate(),
        instant.getUTCHours(),
        instant.getUTCMinutes(),
        instant.getUTCSeconds(),
    );
}

/**
 * `--date epoch|now|<ISO-8601>` → `Date | 'now' | undefined`
 * (`undefined` = omit → the core's DOS-epoch default). ISO dates are UTC
 * wall-clock (see {@link parseIsoDateUtc}).
 */
export function parseDateFlag(args: ParsedArgs): Date | 'now' | undefined {
    const raw = getStringFlag(args.flags, 'date');
    if (raw === undefined) return undefined;
    const v = raw.trim().toLowerCase();
    if (v === 'epoch') return undefined;
    if (v === 'now') return 'now';
    return parseIsoDateUtc(raw, '--date');
}

const CHUNK_MIN = 1024;
const CHUNK_MAX = 16 * 1024 * 1024;

/** `--chunk-size <size>` (default 65536; the engine clamps to 1 KiB … 16 MiB — warned). */
export function parseChunkSize(args: ParsedArgs): number | undefined {
    const raw = getStringFlag(args.flags, 'chunk-size');
    if (raw === undefined) return undefined;
    const n = parseByteSize(raw, 'chunk-size');
    if (!Number.isFinite(n) || n <= 0) {
        throw new CliError(`--chunk-size must be a positive byte size, got "${raw}".`, 2);
    }
    if (n < CHUNK_MIN || n > CHUNK_MAX) {
        progress(`warning: --chunk-size ${raw} is outside 1 KiB .. 16 MiB and will be clamped by the engine.`);
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

/**
 * Read the whole archive (file or stdin) as a `Uint8Array`, bounded by
 * `--max-input-size` (pass the parsed args; default 4 GiB).
 */
export async function readArchiveBytes(path: string | undefined, args?: ParsedArgs): Promise<Uint8Array> {
    let buf: Buffer;
    try {
        buf = await readFileOrStdin(path, args !== undefined ? parseInputSizeFlag(args) : undefined);
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

// ── Entry attributes, extra fields and comments shared by create / modify ──

const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const DOS_ATTR_DIRECTORY = 0x10;

/** External-attributes word for a POSIX mode (setuid/setgid/sticky never propagate). */
export function externalAttributesFor(mode: number, isDirectory: boolean): number {
    const perm = mode & 0o777;
    if (isDirectory) return (((S_IFDIR | perm) << 16) >>> 0) | DOS_ATTR_DIRECTORY;
    return ((S_IFREG | perm) << 16) >>> 0;
}

/** Manifest `mode`: an octal string ("0644") or an integer ≤ 0o7777. */
export function parseMode(raw: unknown, where: string): number {
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 0o7777) return raw;
    if (typeof raw === 'string' && /^0?[0-7]{3,4}$/.test(raw)) return Number.parseInt(raw, 8);
    throw new CliError(`${where}: "mode" must be an octal string like "0644" or "0755".`, 1, ErrorCode.INPUT);
}

/** Largest extra-field payload: the 16-bit length minus the 4-byte header. */
const MAX_EXTRA_FIELD_DATA = 0xffff - 4;

/**
 * Manifest `extraFields`: `[{ id, hex | base64 }]` → the engine's
 * `ZipExtraField[]` (raw, preserved verbatim by the writer). `id` is an
 * integer 0–65535 or a `"0x5455"` string; exactly one of `hex` / `base64`.
 */
export function parseExtraFields(raw: unknown, where: string): ZipExtraField[] {
    if (!Array.isArray(raw)) {
        throw new CliError(`${where}: "extraFields" must be an array of { id, hex | base64 }.`, 1, ErrorCode.INPUT);
    }
    return raw.map((item, i) => {
        const at = `${where}.extraFields[${i}]`;
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
            throw new CliError(`${at}: must be an object { id, hex | base64 }.`, 1, ErrorCode.INPUT);
        }
        const f = item as Record<string, unknown>;
        for (const key of Object.keys(f)) {
            if (key !== 'id' && key !== 'hex' && key !== 'base64') {
                throw new CliError(`${at}: unknown key "${key}". Valid: id, hex, base64.`, 1, ErrorCode.INPUT);
            }
        }
        let id: number;
        if (typeof f['id'] === 'number' && Number.isInteger(f['id'])) id = f['id'];
        else if (typeof f['id'] === 'string' && /^0x[0-9a-fA-F]{1,4}$/.test(f['id'])) id = Number.parseInt(f['id'].slice(2), 16);
        else throw new CliError(`${at}: "id" must be an integer 0-65535 or a hex string like "0x5455".`, 1, ErrorCode.INPUT);
        if (id < 0 || id > 0xffff) throw new CliError(`${at}: "id" must be 0-65535.`, 1, ErrorCode.INPUT);
        const hex = f['hex'];
        const base64 = f['base64'];
        if ((hex === undefined) === (base64 === undefined)) {
            throw new CliError(`${at}: exactly one of "hex" or "base64" is required.`, 1, ErrorCode.INPUT);
        }
        let data: Uint8Array;
        if (hex !== undefined) {
            if (typeof hex !== 'string' || !/^([0-9a-fA-F]{2})*$/.test(hex)) {
                throw new CliError(`${at}: "hex" must be an even-length hexadecimal string.`, 1, ErrorCode.INPUT);
            }
            data = new Uint8Array(Buffer.from(hex, 'hex'));
        } else {
            if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
                throw new CliError(`${at}: "base64" must be a base64 string.`, 1, ErrorCode.INPUT);
            }
            data = new Uint8Array(Buffer.from(base64, 'base64'));
        }
        if (data.length > MAX_EXTRA_FIELD_DATA) {
            throw new CliError(`${at}: extra-field data is ${data.length} bytes; the format allows at most ${MAX_EXTRA_FIELD_DATA}.`, 1, ErrorCode.INPUT);
        }
        return { id, data };
    });
}

/** The ZIP format caps the archive comment at a 16-bit length. */
export const MAX_COMMENT_BYTES = 0xffff;

/**
 * `--comment <text>` | `--comment-file <path>` (raw bytes, `-` = stdin):
 * mutually exclusive; the file form is how a binary or non-UTF-8 comment
 * reaches `setComment(Uint8Array)`.
 */
export async function parseArchiveComment(args: ParsedArgs): Promise<string | Uint8Array | undefined> {
    const text = getStringFlag(args.flags, 'comment');
    const file = getStringFlag(args.flags, 'comment-file');
    if (text !== undefined && file !== undefined) {
        throw new CliError('--comment and --comment-file are mutually exclusive.', 2);
    }
    if (file === undefined) return text;
    let buf: Buffer;
    try {
        buf = await readFileOrStdin(file, MAX_COMMENT_BYTES + 1);
    } catch (e) {
        if (e instanceof CliError) {
            if (e.code === ErrorCode.LIMIT) {
                throw new CliError(`--comment-file ${file} exceeds the ${MAX_COMMENT_BYTES}-byte archive-comment limit.`, 1, ErrorCode.INPUT);
            }
            throw e;
        }
        throw new CliError(`Cannot read --comment-file ${file}: ${e instanceof Error ? e.message : String(e)}`, 1, ErrorCode.IO);
    }
    if (buf.length > MAX_COMMENT_BYTES) {
        throw new CliError(`--comment-file ${file} exceeds the ${MAX_COMMENT_BYTES}-byte archive-comment limit.`, 1, ErrorCode.INPUT);
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Manifest `comment` (string) | `commentBase64` (raw bytes): mutually exclusive. */
export function parseManifestComment(m: Record<string, unknown>, where: string): string | Uint8Array | undefined {
    const text = m['comment'];
    const b64 = m['commentBase64'];
    if (text !== undefined && b64 !== undefined) {
        throw new CliError(`${where}: "comment" and "commentBase64" are mutually exclusive.`, 1, ErrorCode.INPUT);
    }
    if (text !== undefined) {
        if (typeof text !== 'string') throw new CliError(`${where}: "comment" must be a string.`, 1, ErrorCode.INPUT);
        return text;
    }
    if (b64 === undefined) return undefined;
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
        throw new CliError(`${where}: "commentBase64" must be a base64 string.`, 1, ErrorCode.INPUT);
    }
    const data = new Uint8Array(Buffer.from(b64, 'base64'));
    if (data.length > MAX_COMMENT_BYTES) {
        throw new CliError(`${where}: "commentBase64" decodes to ${data.length} bytes; the format allows at most ${MAX_COMMENT_BYTES}.`, 1, ErrorCode.INPUT);
    }
    return data;
}

/** Lower-case hex of raw bytes (names, comments) for forensic output. */
export function bytesToHex(raw: Uint8Array): string {
    return Buffer.from(raw).toString('hex');
}

/** Human label for an applied comment edit (a binary comment is described, not dumped). */
export function describeComment(comment: string | Uint8Array): string {
    return typeof comment === 'string' ? comment : `<${comment.length} bytes>`;
}
