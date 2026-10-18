import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { streamIsTty } from './colors.js';
import { checkAborted } from './control.js';
import { CliError, ErrorCode } from './error.js';
import { clearInFlight, markInFlight } from './inflight.js';

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
    if (streamIsTty(process.stdin)) {
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
        {
            detail: { limit: 'maxInputSize', configured, observed },
            remedy: '--max-input-size <size> (trusted input only) | a streaming command (stream, crc32, inflate, create --stream)',
        },
    );
}

/**
 * Read all bytes from stdin, bounded.
 *
 * @param explicit true when the caller wrote `-` (skip the TTY guard)
 * @param maxBytes bound (E_LIMIT above it; always finite since 1.1.0)
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

/** Chunk size for a byte-counted read of a pipe or device. */
const STREAM_READ_CHUNK = 64 * 1024;

/**
 * Read a file by path, or fall back to stdin if `filePath` is undefined
 * (or is the conventional `-`). Bounded by `maxBytes` through ONE
 * descriptor, with no check-then-read window (pkinative-cli audit A-13,
 * ported):
 *
 *   • a regular file — its size is checked on the open descriptor and the
 *     read is capped at that size (a file that grows after the check is
 *     read to the checked size only), looping over short reads (one read
 *     call may return less than asked — Linux caps a call just under 2 GiB);
 *   • a pipe, FIFO, character device or socket (`<(curl …)`, /dev/stdin,
 *     /dev/zero) — read from the same descriptor and BYTE-COUNTED like
 *     stdin: past the bound the read stops with E_LIMIT, so `/dev/zero` can
 *     never exhaust memory (1.0 `stat()`ed such a path, saw size 0 and read
 *     it whole);
 *   • a directory — E_IO.
 */
export async function readFileOrStdin(filePath: string | undefined, maxBytes: number = DEFAULT_MAX_INPUT_SIZE): Promise<Buffer> {
    if (filePath === undefined || filePath === '-') {
        return readStdin(filePath === '-', maxBytes);
    }
    const handle = await open(filePath, 'r');
    try {
        const st = await handle.stat();
        if (st.isDirectory()) {
            throw new CliError(`Cannot read "${filePath}": it is a directory.`, 1, ErrorCode.IO);
        }
        if (st.isFile()) {
            if (st.size > maxBytes) throw inputTooLarge(st.size, maxBytes, `"${filePath}"`);
            const buf = Buffer.allocUnsafe(st.size);
            let total = 0;
            while (total < st.size) {
                const { bytesRead } = await handle.read(buf, total, st.size - total, total);
                if (bytesRead === 0) break; // truncated after the check: read what is there
                total += bytesRead;
            }
            return buf.subarray(0, total);
        }
        // Not a regular file: no trustworthy size — count every byte.
        // Reads fill one block at a time and only full blocks are kept, so a
        // peer that trickles 1-byte reads cannot pin a 64 KiB allocation per
        // byte: memory stays the byte count plus one block (the bound counts
        // bytes, so it bounds memory too).
        const chunks: Buffer[] = [];
        let block = Buffer.allocUnsafe(STREAM_READ_CHUNK);
        let used = 0;
        let total = 0;
        for (;;) {
            const { bytesRead } = await handle.read(block, used, STREAM_READ_CHUNK - used, null);
            if (bytesRead === 0) break;
            total += bytesRead;
            if (total > maxBytes) throw inputTooLarge(total, maxBytes, `"${filePath}"`);
            used += bytesRead;
            if (used === STREAM_READ_CHUNK) {
                chunks.push(block);
                block = Buffer.allocUnsafe(STREAM_READ_CHUNK);
                used = 0;
            }
            checkAborted();
        }
        if (used > 0) chunks.push(block.subarray(0, used));
        return Buffer.concat(chunks, total);
    } finally {
        await handle.close();
    }
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
     * true (no `--overwrite`): refuse an existing path — a regular file, a
     * directory, or a symlink (dangling ones included) — with E_IO ("pass
     * --overwrite"), then create the file exclusively (`wx`), so a file that
     * appears between the check and the open is refused too.
     *
     * false (`--overwrite`): write an exclusively created temp file in the
     * same directory, then `rename()` it over the target in one step — a
     * reader never sees a half-written file, a symlink AT the target is
     * replaced instead of followed (1.0 opened the target with `w`, which
     * truncated and wrote through a planted link), and a failed write
     * leaves the original untouched.
     *
     * Either way a failed write removes only what THIS write created; the
     * callers never unlink the target themselves.
     */
    readonly exclusive?: boolean;
}

/** The uniform refusal for an existing output file. */
export function overwriteRefused(filePath: string, entryName?: string): CliError {
    return new CliError(
        `Refusing to overwrite existing file ${filePath} (pass --overwrite).`,
        1,
        ErrorCode.IO,
        { remedy: '--overwrite', ...(entryName !== undefined ? { entryName } : {}) },
    );
}

function isEexist(err: unknown): boolean {
    return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EEXIST';
}

/** True when ANYTHING exists at `path`, a dangling symlink included (lstat, not stat). */
export async function lexists(filePath: string): Promise<boolean> {
    try {
        await lstat(filePath);
        return true;
    } catch {
        return false;
    }
}

/** An unpredictable sibling path for a temp file (same directory → same filesystem for rename()). */
export function tempPathFor(filePath: string): string {
    return join(dirname(filePath), `.${basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`);
}

/**
 * Create `filePath` exclusively and write `data`; on failure the file we
 * created is removed. O_EXCL refuses an existing path (dangling symlinks
 * included) on POSIX; Windows' CREATE_NEW follows a dangling symlink and
 * creates its target, so lstat closes that hole first (pkinative-cli,
 * ported). Signal cleanup is registered only once the open succeeded: an
 * EEXIST refusal never removes the existing file.
 */
async function writeExclusive(filePath: string, data: Uint8Array, shown: string): Promise<void> {
    if (await lexists(filePath)) throw overwriteRefused(shown);
    let handle: FileHandle;
    try {
        handle = await open(filePath, 'wx');
    } catch (e) {
        if (isEexist(e)) throw overwriteRefused(shown);
        throw e;
    }
    markInFlight(filePath);
    try {
        await handle.writeFile(data);
        await handle.close();
    } catch (e) {
        await handle.close().catch(() => undefined);
        await unlinkQuiet(filePath);
        throw e;
    } finally {
        clearInFlight(filePath);
    }
}

/**
 * Write binary data to a file path, or to stdout if `filePath` is undefined
 * (or `-`). See {@link WriteOptions} for the exclusive / overwrite contract.
 */
export async function writeOutput(data: Uint8Array, filePath: string | undefined, options: WriteOptions = {}): Promise<void> {
    if (filePath === undefined || filePath === '-') {
        await writeStdout(data);
        return;
    }
    if (options.exclusive === true) {
        await writeExclusive(filePath, data, filePath);
        return;
    }
    const tmp = tempPathFor(filePath);
    await writeExclusive(tmp, data, filePath);
    try {
        await rename(tmp, filePath);
    } catch (e) {
        await unlinkQuiet(tmp);
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
 * See {@link WriteOptions}: exclusive → lstat refusal + `wx`; overwrite →
 * an exclusive temp sibling renamed over the target once complete. A failed
 * write removes only the file THIS call created; an existing target is never
 * truncated, followed or removed.
 */
export async function writeFileStream(
    filePath: string,
    chunks: AsyncIterable<Uint8Array>,
    onChunk?: (bytes: number) => void,
    options: WriteOptions = {},
): Promise<void> {
    if (options.exclusive === true) {
        if (await lexists(filePath)) throw overwriteRefused(filePath);
        await streamIntoNewFile(filePath, filePath, chunks, onChunk);
        return;
    }
    const tmp = tempPathFor(filePath);
    await streamIntoNewFile(tmp, filePath, chunks, onChunk);
    try {
        await rename(tmp, filePath);
    } catch (e) {
        await unlinkQuiet(tmp);
        throw e;
    }
}

/** Stream into a file created exclusively (`wx`); on failure remove it if we created it. */
async function streamIntoNewFile(
    filePath: string,
    shown: string,
    chunks: AsyncIterable<Uint8Array>,
    onChunk?: (bytes: number) => void,
): Promise<void> {
    const stream = createWriteStream(filePath, { flags: 'wx' });
    let opened = false;
    // Settle only on 'close': the file descriptor is opened asynchronously, so
    // rejecting on the first pull failure (before 'open') would let the caller
    // unlink the path and then have the deferred open() recreate an empty file.
    let failure: unknown;
    await new Promise<void>((resolve, reject) => {
        // Only a file WE created is ours to remove (on SIGINT/SIGTERM, and on
        // failure below): register it once the open succeeded — an EEXIST
        // refusal never gets here.
        stream.on('open', () => { opened = true; markInFlight(filePath); });
        stream.on('error', (e: unknown) => { failure ??= e; });
        stream.on('close', () => {
            clearInFlight(filePath);
            if (failure === undefined) {
                resolve();
                return;
            }
            const err = isEexist(failure) ? overwriteRefused(shown) : failure instanceof Error ? failure : new Error('Write failed', { cause: failure });
            if (!opened) {
                reject(err);
                return;
            }
            unlinkQuiet(filePath).then(() => { reject(err); }, () => { reject(err); });
        });
        (async () => {
            for await (const chunk of chunks) {
                // The open is deferred: stop pulling as soon as it failed
                // (EEXIST under `wx`) instead of decompressing into the void.
                if (failure !== undefined || stream.destroyed) break;
                checkAborted();
                onChunk?.(chunk.length);
                const ok = stream.write(chunk);
                if (!ok) {
                    await new Promise<void>((r) => {
                        // One waiter per backpressure pause: detach the other
                        // listener, or 'close' listeners pile up per chunk.
                        const done = (): void => { stream.off('drain', done); stream.off('close', done); r(); };
                        stream.once('drain', done);
                        stream.once('close', done);
                    });
                }
            }
            if (!stream.destroyed) stream.end();
        })().catch((e: unknown) => {
            failure ??= e;
            stream.destroy();
        });
    });
}

/**
 * True when a path exists (any type, a dangling symlink included: lstat).
 * Used for the overwrite pre-checks, which must see a planted link.
 */
export async function pathExists(filePath: string): Promise<boolean> {
    return lexists(filePath);
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
        // The --timeout deadline also bounds the CLI's own input loop.
        checkAborted();
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
    // Kept as the exact function object so the restore below is identity-
    // preserving; it is never called detached from its stream.
    // eslint-disable-next-line @typescript-eslint/unbound-method
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
                {
                    detail: { limit: 'captureBytes', configured: maxBytes, observed: total },
                    remedy: 'an "output" flag on the task (the artefact goes to a file, not stdout)',
                },
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
    process.stdout.write = capture;
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
