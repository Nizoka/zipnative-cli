// Run control: the `--timeout` deadline and `--progress` reporting, handed to
// the engine as the 1.1 `signal` / `onProgress` options (ZipCommonOptions).
//
// Deadline: one process-wide AbortController, armed once (index.ts at start-
// up, or the first commonOptions() call for in-process tests and batch
// tasks). When the timer fires the controller aborts WITH the CLI error as
// its reason, so the engine rejects with exactly that CliError (E_LIMIT,
// detail.limit "timeout") and mapZipError passes it through untouched. The
// engine checks the signal before the first byte and between chunks and
// entries; the CLI's own byte loops (stream input, file writes, crc32,
// inflate) call checkAborted(). A synchronous engine step that is already
// running (opening or verifying a buffered archive) always completes — JS
// cannot pre-empt it — so the deadline is a bound on progress, not a kill.
//
// Progress (create --stream / --stdin-name / --parallel, extract without
// --buffered, stream, cat — where the engine measures it; the buffered
// toBytes() and extractZip() report none): engine snapshots `{ entriesDone,
// entriesTotal, bytesIn, bytesOut }` → stderr (stdout stays the artefact).
// Text mode prints one throttled line per snapshot; --json emits one NDJSON
// `{ "type": "progress", … }` object per throttled snapshot. --quiet
// silences both. Opt-in only: without --progress nothing is printed.

import { type ParsedArgs, getStringFlag, hasFlag } from './args.js';
import { isJsonMode, isQuiet } from './agent.js';
import type { ZipProgress, ZipProgressHandler } from '../core-bridge/index.js';
import { CliError, ErrorCode } from './error.js';
import { formatBytes } from './sizes.js';

/** setTimeout's own ceiling (2^31 - 1 ms, ≈ 24.8 days). */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const DURATION_RE = /^(\d+)(ms|s|m|h)?$/;
const UNIT_MS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/**
 * `--timeout <duration>`: a positive integer with an optional unit
 * `ms` (default), `s`, `m` or `h` — `500`, `500ms`, `30s`, `5m`, `1h`.
 */
export function parseDuration(raw: string, flag: string): number {
    const m = DURATION_RE.exec(raw.trim().toLowerCase());
    if (m === null) {
        throw new CliError(`--${flag} expects a duration such as 500, 500ms, 30s, 5m or 1h, got "${raw}".`, 2);
    }
    const ms = Number(m[1]) * (UNIT_MS[m[2] ?? 'ms'] ?? 1);
    if (!Number.isSafeInteger(ms) || ms <= 0 || ms > MAX_TIMEOUT_MS) {
        throw new CliError(`--${flag} must be between 1 ms and ${MAX_TIMEOUT_MS} ms (about 24.8 days), got "${raw}".`, 2);
    }
    return ms;
}

let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let armedMs: number | undefined;

/** The deadline error: the abort reason the engine rejects with. */
function timeoutError(ms: number, startedAt: number): CliError {
    const observed = Date.now() - startedAt;
    return new CliError(
        `Timed out after ${ms} ms (--timeout); the operation was stopped at the next chunk or entry boundary and the file being written was removed.`,
        1,
        ErrorCode.LIMIT,
        { detail: { limit: 'timeout', configured: ms, observed }, remedy: '--timeout <duration> (a larger deadline)' },
    );
}

/**
 * Arm the process-wide deadline from `--timeout` (idempotent: the first call
 * that finds the flag wins; later calls are no-ops).
 */
export function armTimeout(args: ParsedArgs): void {
    if (armedMs !== undefined) return;
    const raw = getStringFlag(args.flags, 'timeout');
    if (raw === undefined) return;
    const ms = parseDuration(raw, 'timeout');
    armedMs = ms;
    const startedAt = Date.now();
    const c = new AbortController();
    controller = c;
    timer = setTimeout(() => { c.abort(timeoutError(ms, startedAt)); }, ms);
    // The deadline must never keep a finished process alive.
    timer.unref();
}

/** The run's AbortSignal, or undefined when no `--timeout` was given. */
export function runSignal(): AbortSignal | undefined {
    return controller?.signal;
}

/** Throw the deadline error if the run was aborted (CLI-side byte loops). */
export function checkAborted(): void {
    const signal = controller?.signal;
    if (signal?.aborted === true) throw signal.reason;
}

/** True when `--progress` is in effect (flag or ZIPNATIVE_PROGRESS=1). */
export function isProgress(args?: ParsedArgs): boolean {
    if (process.env['ZIPNATIVE_PROGRESS'] === '1') return true;
    return args !== undefined && hasFlag(args.flags, 'progress');
}

/** Minimum interval between two printed snapshots (the last one always prints). */
const PROGRESS_INTERVAL_MS = 250;

function describe(p: ZipProgress): string {
    const entries = p.entriesTotal === null ? `${p.entriesDone} entries` : `${p.entriesDone}/${p.entriesTotal} entries`;
    return `progress: ${entries}, ${formatBytes(p.bytesIn)} in, ${formatBytes(p.bytesOut)} out`;
}

/**
 * The `onProgress` handler for `command`, or undefined when `--progress` is
 * off or `--quiet` is set. Throttled; a snapshot that completes the entry
 * count is always printed.
 */
export function progressHandler(command: string, args?: ParsedArgs): ZipProgressHandler | undefined {
    if (!isProgress(args) || isQuiet()) return undefined;
    const json = isJsonMode();
    let last = 0;
    return (p: ZipProgress): void => {
        const now = Date.now();
        const complete = p.entriesTotal !== null && p.entriesDone >= p.entriesTotal;
        if (!complete && now - last < PROGRESS_INTERVAL_MS) return;
        last = now;
        // One whole line per snapshot (never a carriage-return rewrite): the
        // stream has no reliable "last snapshot" (entriesTotal is null for the
        // forward reader), so an open line would swallow the next stderr line.
        process.stderr.write(json
            ? JSON.stringify({ type: 'progress', command, ...p }) + '\n'
            : describe(p) + '\n');
    };
}

/** Test-only: disarm the deadline and forget the controller. */
export function _resetControl(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    controller = undefined;
    armedMs = undefined;
}
