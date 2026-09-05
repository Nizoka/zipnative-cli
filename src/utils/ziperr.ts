// zipnative error → CLI error mapping — the ONLY place that reads `err.code`.
//
// Every core call in a command is wrapped as
//     try { … } catch (e) { throw mapZipError(e, 'Failed to read archive'); }
// so an autonomous caller always gets:
//   • a stable CLASS   (`error.code`    = E_*),
//   • the exact CAUSE  (`error.zipCode` = zipnative's frozen ZIP_* code, verbatim),
//   • the entry name and code-specific detail when the core knows them,
//   • the core's own message (which names the remedy) after a short context.
//
// The table is typed `satisfies Record<ZipErrorCode, …>`: a core minor bump
// that adds a code fails `tsc` here instead of leaking as E_RUNTIME.

import {
    ZipDataError,
    ZipError,
    ZipLimitError,
    ZipSecurityError,
    ZipUnsupportedError,
    type ZipErrorCode,
} from '../core-bridge/index.js';
import { CliError, ErrorCode, type ErrorCodeValue, type ErrorDetail } from './error.js';

type Mapping = readonly [code: ErrorCodeValue, exitCode: number];

const USAGE: Mapping = [ErrorCode.USAGE, 2];
const INPUT: Mapping = [ErrorCode.INPUT, 1];
const PARSE: Mapping = [ErrorCode.PARSE, 1];
const SECURITY: Mapping = [ErrorCode.SECURITY, 1];
const DATA: Mapping = [ErrorCode.DATA, 1];
const LIMIT: Mapping = [ErrorCode.LIMIT, 1];
const UNSUPPORTED: Mapping = [ErrorCode.UNSUPPORTED, 1];
const NOT_FOUND: Mapping = [ErrorCode.NOT_FOUND, 1];
const CHECK: Mapping = [ErrorCode.CHECK_FAILED, 1];
const RUNTIME: Mapping = [ErrorCode.RUNTIME, 1];

/** The 39 frozen zipnative codes → CLI class + exit code. */
export const ZIP_TO_CLI = {
    // ── base (7)
    ZIP_INVALID_OPTION: USAGE,
    ZIP_INPUT_TOO_LARGE: LIMIT,
    ZIP_ENTRY_NOT_FOUND: NOT_FOUND,
    ZIP_ENTRY_EXISTS: INPUT,
    ZIP_API_MISUSE: RUNTIME,
    ZIP_STRICT_DIAGNOSTIC: CHECK,
    ZIP_INTERNAL: RUNTIME,
    // ── format (13)
    ZIP_EOCD_NOT_FOUND: PARSE,
    ZIP_EOCD_INCONSISTENT: PARSE,
    ZIP_ZIP64_LOCATOR_MISSING: PARSE,
    ZIP_ZIP64_EOCD_MISPLACED: PARSE,
    ZIP_CD_INCONSISTENT: PARSE,
    ZIP_RECORD_TRUNCATED: PARSE,
    ZIP_SIGNATURE_MISMATCH: PARSE,
    ZIP_STREAM_TRUNCATED: PARSE,
    ZIP_VALUE_UNREPRESENTABLE: PARSE,
    ZIP_INVALID_ENTRY_NAME: INPUT,
    ZIP_DUPLICATE_ENTRY_NAME: INPUT,
    ZIP_DEFLATE_TRUNCATED: PARSE,
    ZIP_DEFLATE_CORRUPT: PARSE,
    // ── security (6)
    ZIP_ENTRY_OVERLAP: SECURITY,
    ZIP_CD_LFH_MISMATCH: SECURITY,
    ZIP_ZIP64_CONTRADICTION: SECURITY,
    ZIP_PATH_TRAVERSAL: SECURITY,
    ZIP_SYMLINK_REJECTED: SECURITY,
    ZIP_EXTRACT_DUPLICATE_PATH: SECURITY,
    // ── data (5)
    ZIP_CRC_MISMATCH: DATA,
    ZIP_SIZE_MISMATCH: DATA,
    ZIP_INFLATE_OUTPUT_OVERFLOW: DATA,
    ZIP_DESCRIPTOR_MISMATCH: DATA,
    ZIP_DECOMPRESSION_FAILED: DATA,
    // ── limits (2)
    ZIP_LIMIT_EXCEEDED: LIMIT,
    ZIP_LIMIT_INVALID: USAGE,
    // ── unsupported (6)
    ZIP_UNSUPPORTED_ENCRYPTION: UNSUPPORTED,
    ZIP_UNSUPPORTED_METHOD: UNSUPPORTED,
    ZIP_UNSUPPORTED_MULTI_DISK: UNSUPPORTED,
    ZIP_UNSUPPORTED_ZIP64_STREAMING: UNSUPPORTED,
    ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR: UNSUPPORTED,
    ZIP_UNSUPPORTED_CODEC_MODE: UNSUPPORTED,
} as const satisfies Record<ZipErrorCode, Mapping>;

/** Every frozen `ZIP_*` code (39), in table order. */
export const ZIP_ERROR_CODES: readonly ZipErrorCode[] = Object.keys(ZIP_TO_CLI) as ZipErrorCode[];

/** Every core diagnostic code (11) — informational, never thrown unless `--strict`. */
export const ZIP_DIAGNOSTIC_CODES = [
    'ZIP_PREPENDED_DATA',
    'ZIP_MULTIPLE_EOCD',
    'ZIP_NAME_MISMATCH',
    'ZIP_UNICODE_PATH_CONFLICT',
    'ZIP_INVALID_UTF8_NAME',
    'ZIP_DUPLICATE_NAME',
    'ZIP_EXTRA_FIELD_MALFORMED',
    'ZIP_ZIP64_EXTRA_IGNORED',
    'ZIP_TIMESTAMP_NOT_PINNED',
    'ZIP_NONDETERMINISTIC_CODEC',
    'ZIP_DEAD_BYTES_RATIO',
] as const;

const FS_ERROR_CODES = new Set([
    'ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'ENOSPC', 'EPIPE', 'EEXIST',
    'EMFILE', 'ENFILE', 'EBUSY', 'EROFS', 'ELOOP', 'ENAMETOOLONG', 'EIO', 'EINVAL',
]);

/**
 * node:zlib errors that reach the CLI unwrapped. The engine's `node-zlib`
 * tier calls `inflateRawSync` directly, so a corrupt or truncated raw
 * stream on the sync path (`inflate --sync`, `readEntry`) surfaces zlib's
 * own Error (`code: Z_DATA_ERROR` / `Z_BUF_ERROR`) instead of a `ZipError`.
 * They are the same two conditions the pure tier reports as
 * `ZIP_DEFLATE_CORRUPT` / `ZIP_DEFLATE_TRUNCATED`, so map them identically —
 * the class an agent sees must not depend on the codec tier.
 */
const ZLIB_TO_ZIP: Readonly<Record<string, ZipErrorCode>> = {
    Z_DATA_ERROR: 'ZIP_DEFLATE_CORRUPT',
    Z_NEED_DICT: 'ZIP_DEFLATE_CORRUPT',
    Z_BUF_ERROR: 'ZIP_DEFLATE_TRUNCATED',
};

function zlibCodeOf(err: unknown): ZipErrorCode | undefined {
    if (!(err instanceof Error)) return undefined;
    const code = (err as NodeJS.ErrnoException).code;
    return typeof code === 'string' ? ZLIB_TO_ZIP[code] : undefined;
}

/** True when `err` is a Node filesystem/stream error (has a known `code`). */
export function isFsError(err: unknown): err is NodeJS.ErrnoException {
    return (
        err instanceof Error
        && typeof (err as NodeJS.ErrnoException).code === 'string'
        && FS_ERROR_CODES.has((err as NodeJS.ErrnoException).code as string)
    );
}

function detailOf(err: ZipError): ErrorDetail | undefined {
    if (err instanceof ZipLimitError) {
        return {
            limit: String(err.limit),
            configured: Number.isFinite(err.configured) ? err.configured : String(err.configured),
            observed: Number.isFinite(err.observed) ? err.observed : String(err.observed),
        };
    }
    if (err instanceof ZipUnsupportedError) {
        return { feature: err.feature };
    }
    if (err instanceof ZipDataError && (err.expectedCrc !== undefined || err.actualCrc !== undefined)) {
        return {
            expectedCrc: err.expectedCrc ?? null,
            actualCrc: err.actualCrc ?? null,
        };
    }
    return undefined;
}

function entryNameOf(err: ZipError): string | undefined {
    if (err instanceof ZipSecurityError || err instanceof ZipDataError) return err.entryName;
    return undefined;
}

/**
 * Convert any thrown value into a `CliError` with the right class, exit code
 * and pass-through cause. `CliError`s are returned unchanged.
 *
 * @param err      the caught value
 * @param context  short human prefix, e.g. `'Failed to open archive'`
 * @param entryName optional entry the operation was about (used when the
 *                  core error carries none)
 */
export function mapZipError(err: unknown, context: string, entryName?: string): CliError {
    if (err instanceof CliError) return err;
    if (err instanceof ZipError) {
        const [code, exitCode] = ZIP_TO_CLI[err.code] ?? RUNTIME;
        const name = entryNameOf(err) ?? entryName;
        const detail = detailOf(err);
        return new CliError(`${context}: ${err.message}`, exitCode, code, {
            zipCode: err.code,
            ...(name !== undefined ? { entryName: name } : {}),
            ...(detail !== undefined ? { detail } : {}),
        });
    }
    if (isFsError(err)) {
        const path = err.path !== undefined ? ` (${err.path})` : '';
        return new CliError(`${context}: ${err.code}${path}: ${err.message}`, 1, ErrorCode.IO);
    }
    const zlibCode = zlibCodeOf(err);
    if (zlibCode !== undefined) {
        const [code, exitCode] = ZIP_TO_CLI[zlibCode];
        return new CliError(`${context}: ${(err as Error).message}`, exitCode, code, {
            zipCode: zlibCode,
            ...(entryName !== undefined ? { entryName } : {}),
        });
    }
    const message = err instanceof Error ? err.message : String(err);
    return new CliError(`${context}: ${message}`, 1, ErrorCode.RUNTIME);
}

/** Run `fn` and translate any failure through {@link mapZipError}. */
export function guard<T>(context: string, fn: () => T, entryName?: string): T {
    try {
        return fn();
    } catch (e) {
        throw mapZipError(e, context, entryName);
    }
}
