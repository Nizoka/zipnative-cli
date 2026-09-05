import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { CliError, ErrorCode } from './error.js';

const JSON_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

/** Default bound for a buffered archive read (stdin or file): 4 GiB. */
export const DEFAULT_MAX_INPUT_SIZE = 4 * 1024 ** 3;

/**
 * Validate a MANIFEST-supplied path against directory traversal.
 *
 * Paths typed on the command line are the user's own filesystem authority
 * (`zipnative list ../a.zip` is ordinary shell usage) and are NOT validated.
 * Values that arrive through a manifest file (batch tasks, create/modify
 * entry paths) are, because a manifest is data, not the invoking user.
 * Throws CliError if the path contains `../` or `..\\` sequences.
 */
export function validatePath(filePath: string): void {
    // Normalise backslashes for Windows paths and check for traversal
    const normalised = filePath.replace(/\\/g, '/');
    if (normalised.includes('../') || normalised === '..') {
        throw new CliError(`Path traversal detected in path: ${filePath}`, 1, ErrorCode.INPUT);
    }
}

/**
 * Refuse to wait for stdin when nothing is piped: an interactive terminal
 * with no `--input` would otherwise block forever. An explicit `-` is the
 * caller saying "yes, stdin" and is never guarded.
 */
export function assertStdinNotTty(): void {
    if (process.stdin.isTTY === true) {
        throw new CliError(
            'No input: pass --input <file> (or a positional path), or pipe data on stdin.',
            2,
        );
    }
}

function inputTooLarge(observed: number, configured: number, what: string): CliError {
    return new CliError(
        `${what} exceeds --max-input-size (${configured} bytes; observed ${observed}). Raise the bound only for trusted input, or use a streaming command (stream, crc32, inflate, create --stream).`,
        1,
        ErrorCode.LIMIT,
        { detail: { limit: 'maxInputSize', configured, observed } },
    );
}

/**
 * Read all bytes from stdin, bounded.
 *
 * @param explicit true when the caller wrote `-` (skip the TTY guard)
 * @param maxBytes bound (E_LIMIT above it; `Infinity` disables)
 */
export function readStdin(explicit = false, maxBytes: number = DEFAULT_MAX_INPUT_SIZE): Promise<Buffer> {
    if (!explicit) assertStdinNotTty();
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const onData = (chunk: Buffer): void => {
            total += chunk.length;
            if (total > maxBytes) {
                process.stdin.off('data', onData);
                process.stdin.destroy();
                reject(inputTooLarge(total, maxBytes, 'stdin'));
                return;
            }
            chunks.push(chunk);
        };
        process.stdin.on('data', onData);
        process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
        process.stdin.on('error', reject);
    });
}

/**
 * Read a file by path, or fall back to stdin if `filePath` is undefined
 * (or is the conventional `-`). Bounded by `maxBytes` (file size checked
 * before reading).
 */
export async function readFileOrStdin(filePath: string | undefined, maxBytes: number = DEFAULT_MAX_INPUT_SIZE): Promise<Buffer> {
    if (filePath === undefined || filePath === '-') {
        return readStdin(filePath === '-', maxBytes);
    }
    if (Number.isFinite(maxBytes)) {
        const st = await stat(filePath);
        if (st.size > maxBytes) throw inputTooLarge(st.size, maxBytes, `"${filePath}"`);
    }
    return readFile(filePath);
}

/**
 * Install the process-wide stdout/stderr guards once: a closed pipe
 * (`| head`) is routine, so EPIPE ends the process quietly with exit 0
 * instead of an unhandled 'error' event; every other stream error is
 * rethrown so it surfaces as before.
 */
let _epipeGuardInstalled = false;
export function installEpipeGuard(): void {
    if (_epipeGuardInstalled) return;
    _epipeGuardInstalled = true;
    const onError = (err: NodeJS.ErrnoException): void => {
        if (err.code === 'EPIPE') process.exit(0);
        throw err;
    };
    process.stdout.on('error', onError);
    process.stderr.on('error', onError);
}

/** Write to stdout, resolving on completion; EPIPE ends the process quietly (exit 0). */
function writeStdout(data: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        process.stdout.write(data, (err) => {
            if (err) {
                if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Open a readable byte stream for a file path, or stdin when `filePath` is
 * undefined / `-`. Used by the streaming entry points (`stream`, `create
 * --stream`, `inflate`, `crc32`) so a large input never materialises in memory.
 */
export function openInputStream(filePath: string | undefined): Readable {
    if (filePath === undefined || filePath === '-') {
        if (filePath === undefined) assertStdinNotTty();
        return process.stdin;
    }
    return createReadStream(filePath);
}

/**
 * Enforce the 50 MB JSON input size limit on a buffer.
 * Throws CliError if the buffer exceeds the limit.
 */
export function assertJsonSizeLimit(buf: Uint8Array): void {
    if (buf.length > JSON_SIZE_LIMIT) {
        throw new CliError(
            `JSON input exceeds the 50 MB limit (got ${(buf.length / 1024 / 1024).toFixed(1)} MB).`,
            1,
            ErrorCode.INPUT,
        );
    }
}

export interface WriteOptions {
    /**
     * Open the file exclusively (`wx`): an existing file is refused with E_IO
     * ("pass --overwrite"), and a file that appears between the caller's
     * check and the open is refused too (no TOCTOU window).
     */
    readonly exclusive?: boolean;
}

/** The uniform refusal for an existing output file. */
export function overwriteRefused(filePath: string, entryName?: string): CliError {
    return new CliError(
        `Refusing to overwrite existing file ${filePath} (pass --overwrite).`,
        1,
        ErrorCode.IO,
        entryName !== undefined ? { entryName } : undefined,
    );
}

function isEexist(err: unknown): boolean {
    return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EEXIST';
}

/**
 * Write binary data to a file path, or to stdout if `filePath` is undefined
 * (or `-`).
 */
export async function writeOutput(data: Uint8Array, filePath: string | undefined, options: WriteOptions = {}): Promise<void> {
    if (filePath === undefined || filePath === '-') {
        await writeStdout(data);
        return;
    }
    try {
        await writeFile(filePath, data, { flag: options.exclusive === true ? 'wx' : 'w' });
    } catch (e) {
        if (isEexist(e)) throw overwriteRefused(filePath);
        throw e;
    }
}

/**
 * Pipe streaming chunks to a file or stdout with backpressure. Returns the
 * number of bytes written.
 */
export async function writeStreamingOutput(
    chunks: AsyncIterable<Uint8Array>,
    filePath: string | undefined,
    options: WriteOptions = {},
): Promise<number> {
    let total = 0;
    if (filePath === undefined || filePath === '-') {
        for await (const chunk of chunks) {
            total += chunk.length;
            await writeStdout(chunk);
        }
        return total;
    }
    await writeFileStream(filePath, chunks, (n) => { total += n; }, options);
    return total;
}

/**
 * Stream chunks into a file (parents are NOT created — callers decide).
 * Backpressure-aware: waits for `drain` when the kernel buffer is full.
 * With `exclusive`, the file is opened `wx` and EEXIST becomes the uniform
 * overwrite refusal.
 */
export async function writeFileStream(
    filePath: string,
    chunks: AsyncIterable<Uint8Array>,
    onChunk?: (bytes: number) => void,
    options: WriteOptions = {},
): Promise<void> {
    const stream = createWriteStream(filePath, { flags: options.exclusive === true ? 'wx' : 'w' });
    // Settle only on 'close': the file descriptor is opened asynchronously, so
    // rejecting on the first pull failure (before 'open') would let the caller
    // unlink the path and then have the deferred open() recreate an empty file.
    let failure: unknown;
    await new Promise<void>((resolve, reject) => {
        stream.on('error', (e: unknown) => { failure ??= e; });
        stream.on('close', () => {
            if (failure !== undefined) reject(isEexist(failure) ? overwriteRefused(filePath) : failure);
            else resolve();
        });
        (async () => {
            for await (const chunk of chunks) {
                // The open is deferred: stop pulling as soon as it failed
                // (EEXIST under `wx`) instead of decompressing into the void.
                if (failure !== undefined || stream.destroyed) break;
                onChunk?.(chunk.length);
                const ok = stream.write(chunk);
                if (!ok) {
                    await new Promise<void>((r) => { stream.once('drain', r); stream.once('close', r); });
                }
            }
            if (!stream.destroyed) stream.end();
        })().catch((e: unknown) => {
            failure ??= e;
            stream.destroy();
        });
    });
}

/** True when a path exists (any type). */
export async function pathExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

/** Create a directory (and parents) — idempotent. */
export async function ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
}

/** Best-effort removal of a partially written file; never throws. */
export async function unlinkQuiet(filePath: string): Promise<void> {
    try {
        await rm(filePath, { force: true });
    } catch {
        // ignore
    }
}

/**
 * Join an already-sanitised relative archive path under `root` and prove the
 * result stays inside `root` LEXICALLY. This is the CLI's first safety belt
 * on top of the engine's `sanitizeEntryPath()`; the sink (utils/sink.ts) adds
 * the physical (realpath) check after the parent directory exists.
 *
 * Throws `E_SECURITY` when the resolved path escapes the root.
 */
export function safeJoin(root: string, relPath: string): string {
    const base = resolvePath(root);
    const target = resolvePath(base, relPath);
    const rel = relative(base, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
        throw new CliError(
            `Refusing to write outside the output directory: ${relPath}`,
            1,
            ErrorCode.SECURITY,
            { entryName: relPath },
        );
    }
    return target;
}

/** Directory of a file path (helper for parent creation). */
export function parentDir(filePath: string): string {
    return dirname(filePath);
}

/**
 * Read and parse a JSON file (or stdin with `-`), enforcing the 50 MB cap.
 * Throws `E_IO` on read failure and `E_PARSE` on invalid JSON.
 */
export async function readJsonInput(filePath: string, what: string): Promise<unknown> {
    let buf: Buffer;
    try {
        buf = await readFileOrStdin(filePath, JSON_SIZE_LIMIT + 1);
    } catch (e) {
        if (e instanceof CliError) throw e;
        const message = e instanceof Error ? e.message : String(e);
        throw new CliError(`Cannot read ${what} "${filePath}": ${message}`, 1, ErrorCode.IO);
    }
    assertJsonSizeLimit(buf);
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(buf)) as unknown;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new CliError(`Failed to parse ${what} "${filePath}": ${message}`, 1, ErrorCode.PARSE);
    }
}

/**
 * Adapt a Node `Readable` (file stream, stdin) to the engine's `ByteSource`
 * (`AsyncIterable<Uint8Array>`). Buffers ARE Uint8Arrays; this only fixes the
 * static type and guarantees the chunks are byte chunks.
 */
export async function* readableToByteSource(stream: Readable): AsyncGenerator<Uint8Array, void, undefined> {
    for await (const chunk of stream) {
        yield typeof chunk === 'string' ? new TextEncoder().encode(chunk) : (chunk as Uint8Array);
    }
}

/** Default cap on a captured task stdout (`batch --manifest --json`): 64 MiB. */
export const DEFAULT_CAPTURE_BYTES = 64 * 1024 * 1024;

export interface Captured<T> {
    readonly result: T;
    readonly bytes: Buffer;
}

/**
 * Run `fn` with `process.stdout.write` redirected into a buffer, so a
 * nested command's artefact never interleaves with the caller's own stdout
 * document (`batch --manifest --json`). Not re-entrant (batch never nests);
 * the original writer is restored in `finally`, including when `fn` throws.
 * Exceeding `maxBytes` aborts with E_LIMIT `{ limit: 'captureBytes' }`.
 */
export async function captureStdout<T>(fn: () => Promise<T>, maxBytes: number = DEFAULT_CAPTURE_BYTES): Promise<Captured<T>> {
    const original = process.stdout.write;
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow: CliError | undefined;
    const capture = (chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
        const buf = typeof chunk === 'string'
            ? Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8')
            : Buffer.from(chunk as Uint8Array);
        total += buf.length;
        if (total > maxBytes) {
            overflow ??= new CliError(
                `Captured task output exceeds ${maxBytes} bytes; give the task an --output file instead of writing its artefact to stdout.`,
                1,
                ErrorCode.LIMIT,
                { detail: { limit: 'captureBytes', configured: maxBytes, observed: total } },
            );
            const done = typeof encoding === 'function' ? encoding : cb;
            if (typeof done === 'function') (done as (e: Error) => void)(overflow);
            return false;
        }
        chunks.push(buf);
        const done = typeof encoding === 'function' ? encoding : cb;
        if (typeof done === 'function') (done as () => void)();
        return true;
    };
    process.stdout.write = capture as typeof process.stdout.write;
    try {
        const result = await fn();
        if (overflow !== undefined) throw overflow;
        return { result, bytes: Buffer.concat(chunks) };
    } catch (e) {
        throw overflow ?? e;
    } finally {
        process.stdout.write = original;
    }
}
