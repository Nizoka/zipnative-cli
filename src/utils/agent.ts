// Agent-mode helpers — the cross-cutting "machine contract" that lets an
// autonomous caller (an AI agent, a CI step, another program) drive the CLI
// deterministically.
//
// Contract (see docs/KNOWLEDGE_BASE.md → "Agent automation contract"):
//   • stdout carries the primary artifact (archive bytes, entry bytes, JSON
//     report, schema, script).
//   • stderr carries ALL diagnostics, including the agent envelopes below.
//   • Global `--json` sets ZIPNATIVE_JSON=1 (done in index.ts). In that mode:
//       – on any failure, a single JSON object is written to stderr:
//           { "ok": false, "command": <name|null>,
//             "error": { "code": "E_*", "message": "…",
//                        "zipCode"?: "ZIP_*", "entryName"?: "…", "detail"?: {…} } }
//       – write commands emit a success status envelope to stderr:
//           { "ok": true, "command": "create", … }
//   • Numeric exit codes (0/1/2) are unchanged in every mode.
//
// This module is intentionally tiny and dependency-free: agent mode is a thin
// presentation layer over the existing dispatch, never a separate runtime.

import type { ZipErrorCode } from '../core-bridge/index.js';
import { activeConfig } from './config.js';
import { escapeLine } from './sanitize.js';
import { CliError, ErrorCode, type ErrorCodeValue, type ErrorDetail } from './error.js';

/**
 * The CLI flag(s) or command that LIFT an engine refusal — the machine-
 * actionable counterpart of the engine's message, which names library
 * options (`rejectTraversal: false`, `onDuplicate: 'first'`) that do not exist
 * on the command line. Absent = nothing lifts it (structural refusals,
 * corrupt data, usage errors). Type-only import of the code union: this
 * module sits on the start-up path and must not load the engine.
 */
export const ZIP_REMEDY = {
    ZIP_PATH_TRAVERSAL: '--skip-unsafe (extract, stream)',
    ZIP_SYMLINK_REJECTED: '--allow-symlinks (target text as data) | --skip-symlinks (extract)',
    ZIP_EXTRACT_DUPLICATE_PATH: '--on-duplicate first|last (extract, stream)',
    ZIP_LIMIT_EXCEEDED: '--max-<bound> <size> (the bound is named in detail.limit; trusted input only)',
    ZIP_UNSUPPORTED_ENCRYPTION: '--skip-unsupported (extract, stream); no password support in 1.x',
    ZIP_UNSUPPORTED_METHOD: '--codec <module> | --skip-unsupported (extract, stream)',
    ZIP_UNSUPPORTED_CODEC_MODE: 'cat / extract --codec <module> on the complete file | --skip-unsupported (stream) | a codec module exposing createDecompressor (stream)',
    ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR: 'cat / extract on the complete file (random access)',
    ZIP_UNSUPPORTED_ZIP64_STREAMING: 'create --stream --zip64 (Zip64 streamed entries) | create without --stream (buffered entries are fully Zip64)',
    ZIP_ENTRY_NOT_FOUND: 'zipnative list <archive> (names are case-sensitive)',
    ZIP_ENTRY_EXISTS: 'modify --replace <name>=<path>',
    ZIP_STRICT_DIAGNOSTIC: 'drop --strict, or fix the producer named by the diagnostic',
    ZIP_INVALID_ENTRY_NAME: 'a plain relative name (no .., no drive, no device name)',
    ZIP_DUPLICATE_ENTRY_NAME: 'unique entry names',
} as const satisfies Partial<Record<ZipErrorCode, string>>;

/** The remedy for a CliError: an explicit one wins, else the ZIP_* table. */
export function remedyFor(err: CliError): string | undefined {
    if (err.remedy !== undefined) return err.remedy;
    if (err.zipCode !== undefined && Object.hasOwn(ZIP_REMEDY, err.zipCode)) {
        return ZIP_REMEDY[err.zipCode as keyof typeof ZIP_REMEDY];
    }
    return undefined;
}

/** True when the caller passed the global `--json` flag (agent mode). */
/** The environment switches the CLI reads (each mirrors a global flag). */
export const ENV_SWITCHES: readonly string[] = [
    'ZIPNATIVE_JSON', 'ZIPNATIVE_DRY_RUN', 'ZIPNATIVE_QUIET', 'ZIPNATIVE_STRICT',
    'ZIPNATIVE_PURE_CODECS', 'ZIPNATIVE_PROGRESS', 'ZIPNATIVE_DEBUG',
];

/**
 * Normalise the environment switches once, at start-up: `true|1|yes|on` →
 * `1`, `false|0|no|off` or empty → unset; any other value is a usage error
 * (exit 2). Before 1.1.0 only `1` counted, so `ZIPNATIVE_DRY_RUN=true` was
 * silently OFF and the run wrote its output — the env twin of the
 * `--overwrite=flase` typo (second 1.1.0 review). The value is not echoed.
 */
export function normalizeEnvSwitches(env: NodeJS.ProcessEnv = process.env): void {
    for (const name of ENV_SWITCHES) {
        const raw = env[name];
        if (raw === undefined) continue;
        const v = raw.trim().toLowerCase();
        if (v === '1' || v === 'true' || v === 'yes' || v === 'on') env[name] = '1';
        else if (v === '' || v === '0' || v === 'false' || v === 'no' || v === 'off') Reflect.deleteProperty(env, name);
        else throw new CliError(`${name} is a switch: set it to 1 / true / yes / on, or 0 / false / no / off.`, 2);
    }
}

export function isJsonMode(): boolean {
    return process.env['ZIPNATIVE_JSON'] === '1';
}

/** True when `--dry-run` is in effect (set by index.ts for the active command). */
export function isDryRun(): boolean {
    return process.env['ZIPNATIVE_DRY_RUN'] === '1';
}

/** True when `--quiet` is in effect (progress lines and text diagnostics suppressed). */
export function isQuiet(): boolean {
    return process.env['ZIPNATIVE_QUIET'] === '1';
}

/** True when `--strict` is in effect (first core diagnostic escalates to an error). */
export function isStrict(): boolean {
    return process.env['ZIPNATIVE_STRICT'] === '1';
}

/** The config file that supplied defaults to this run, as the envelopes carry it. */
export interface ConfigField {
    readonly path: string;
    readonly applied: readonly string[];
}

function configField(): { readonly config?: ConfigField } {
    const c = activeConfig();
    return c === null ? {} : { config: { path: c.path, applied: c.applied } };
}

export interface AgentErrorEnvelope {
    readonly ok: false;
    readonly command: string | null;
    /** Present when a `.zipnativerc.json` supplied defaults to this run. */
    readonly config?: ConfigField;
    readonly error: {
        readonly code: ErrorCodeValue;
        readonly message: string;
        readonly zipCode?: string;
        readonly entryName?: string;
        readonly detail?: ErrorDetail;
        /** CLI flag(s) or command that lift the refusal; absent when nothing does. */
        readonly remedy?: string;
    };
}

const DEFAULT_MESSAGE: Readonly<Record<ErrorCodeValue, string>> = {
    [ErrorCode.USAGE]: 'usage error',
    [ErrorCode.INPUT]: 'invalid input',
    [ErrorCode.PARSE]: 'failed to parse input',
    [ErrorCode.IO]: 'I/O error',
    [ErrorCode.SECURITY]: 'hostile archive shape refused',
    [ErrorCode.DATA]: 'integrity failure',
    [ErrorCode.LIMIT]: 'a security limit was exceeded',
    [ErrorCode.UNSUPPORTED]: 'unsupported archive feature',
    [ErrorCode.NOT_FOUND]: 'entry not found',
    [ErrorCode.VERIFY_FAILED]: 'archive failed verification',
    [ErrorCode.CHECK_FAILED]: 'one or more checks failed',
    [ErrorCode.POLICY]: 'AI-governance policy violation',
    [ErrorCode.RUNTIME]: 'runtime error',
};

/** Build the machine-readable error envelope for any thrown value. */
export function buildErrorEnvelope(command: string | null, err: unknown): AgentErrorEnvelope {
    if (err instanceof CliError) {
        const message = err.message.length > 0 ? err.message : DEFAULT_MESSAGE[err.code];
        const remedy = remedyFor(err);
        return {
            ok: false,
            command,
            ...configField(),
            error: {
                code: err.code,
                message,
                ...(err.zipCode !== undefined ? { zipCode: err.zipCode } : {}),
                ...(err.entryName !== undefined ? { entryName: err.entryName } : {}),
                ...(err.detail !== undefined ? { detail: err.detail } : {}),
                ...(remedy !== undefined ? { remedy } : {}),
            },
        };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, command, ...configField(), error: { code: ErrorCode.RUNTIME, message } };
}

/** Write the JSON error envelope to stderr (single line, newline-terminated). */
export function emitJsonError(command: string | null, err: unknown): void {
    process.stderr.write(JSON.stringify(buildErrorEnvelope(command, err)) + '\n');
}

/**
 * Emit a success status envelope to stderr when in agent (`--json`) mode.
 * No-op otherwise, so commands can call it unconditionally. stdout is never
 * touched here — it stays reserved for the primary artifact.
 */
export function emitStatus(envelope: Readonly<Record<string, unknown>>): void {
    if (!isJsonMode()) return;
    process.stderr.write(JSON.stringify({ ok: true, ...envelope, ...configField() }) + '\n');
}

/**
 * Write a progress / informational line to stderr unless `--quiet` is set.
 * Never used for envelopes or errors (those are never suppressed).
 */
export function progress(line: string): void {
    if (isQuiet()) return;
    // Progress lines quote entry names (skipped, warnings): display-escaped.
    process.stderr.write(escapeLine(line) + '\n');
}
