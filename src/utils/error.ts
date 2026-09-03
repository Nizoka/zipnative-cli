/**
 * Stable, machine-readable error codes surfaced in the agent JSON envelope
 * (see {@link ../utils/agent.ts}). These are part of the CLI's public contract:
 * they let autonomous callers branch on a failure CLASS without parsing the
 * human-readable message. The exact CAUSE — zipnative's frozen `ZIP_*` code —
 * travels alongside as `zipCode` (see {@link ./ziperr.ts}). Numeric exit codes
 * (0/1/2) are unchanged in every mode.
 */
export const ErrorCode = {
    /** Usage error — missing/invalid flag or argument (exit 2). */
    USAGE: 'E_USAGE',
    /** User-supplied payload, entry name or manifest failed validation, or a conflict (entry exists). */
    INPUT: 'E_INPUT',
    /** The bytes are not a valid ZIP / DEFLATE stream / JSON document (structural). */
    PARSE: 'E_PARSE',
    /** Filesystem or stream I/O failure. */
    IO: 'E_IO',
    /** Hostile archive shape (zip-slip, overlap, symlink, duplicate path…) or the CLI sink guard tripped. */
    SECURITY: 'E_SECURITY',
    /** Integrity failure: CRC / size / data-descriptor mismatch, decompression failure. */
    DATA: 'E_DATA',
    /** A named security bound (`ZipLimits`) was exceeded. */
    LIMIT: 'E_LIMIT',
    /** Encryption, unknown method, multi-disk, zip64 streaming, CD-less descriptor, codec mode. */
    UNSUPPORTED: 'E_UNSUPPORTED',
    /** A named entry does not exist in the archive. */
    NOT_FOUND: 'E_NOT_FOUND',
    /** `verify` verdict is negative. */
    VERIFY_FAILED: 'E_VERIFY_FAILED',
    /** `inspect --check`, `crc32 --expect`, or a `--strict` diagnostic escalation failed. */
    CHECK_FAILED: 'E_CHECK_FAILED',
    /** `govern verify-issue` found an AI-governance policy violation. */
    POLICY: 'E_POLICY',
    /** Catch-all runtime error (exit 1). */
    RUNTIME: 'E_RUNTIME',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Structured, code-specific detail carried in the agent envelope. */
export type ErrorDetail = Readonly<Record<string, string | number | boolean | null>>;

export interface CliErrorOptions {
    /** zipnative's frozen `ZIP_*` code, verbatim. */
    readonly zipCode?: string;
    /** The entry the failure is about, when known. */
    readonly entryName?: string;
    /** Code-specific structured detail (limit/configured/observed, feature, CRCs…). */
    readonly detail?: ErrorDetail;
}

/**
 * CLI Error — thrown by commands when a user-facing error occurs.
 *
 * Exit code conventions:
 *   1 = runtime error (invalid input, I/O failure, hostile archive, …)
 *   2 = usage error  (missing required argument)
 *
 * The optional `code` is a stable {@link ErrorCode} string used by the agent
 * JSON envelope. When omitted it defaults from the exit code (2 → `E_USAGE`,
 * otherwise `E_RUNTIME`), so existing call sites keep a sensible code for free.
 */
export class CliError extends Error {
    public readonly exitCode: number;
    public readonly code: ErrorCodeValue;
    public readonly zipCode: string | undefined;
    public readonly entryName: string | undefined;
    public readonly detail: ErrorDetail | undefined;

    constructor(message: string, exitCode = 1, code?: ErrorCodeValue, options?: CliErrorOptions) {
        super(message);
        this.name = 'CliError';
        this.exitCode = exitCode;
        this.code = code ?? (exitCode === 2 ? ErrorCode.USAGE : ErrorCode.RUNTIME);
        this.zipCode = options?.zipCode;
        this.entryName = options?.entryName;
        this.detail = options?.detail;
    }
}

/**
 * Print a message to stderr and terminate the process.
 * Never returns — declared as `never` for type narrowing.
 */
export function die(message: string, exitCode = 1): never {
    process.stderr.write(message + '\n');
    process.exit(exitCode);
}

/**
 * Emit a single deprecation warning to stderr.
 * Idempotent per (name) within a process — repeated calls produce one line.
 */
const _deprecateSeen = new Set<string>();
export function deprecate(name: string, replacement: string): void {
    if (_deprecateSeen.has(name)) return;
    _deprecateSeen.add(name);
    process.stderr.write(`warning: --${name} is deprecated; use ${replacement} instead.\n`);
}
