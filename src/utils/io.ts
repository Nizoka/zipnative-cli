import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { CliError, ErrorCode } from './error.js';

const JSON_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

/**
 * Validate a file path against directory traversal.
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
 * Read all bytes from stdin.
 */
export function readStdin(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
        process.stdin.on('error', reject);
    });
}

/**
 * Read a file by path, or fall back to stdin if `filePath` is undefined
 * (or is the conventional `-`).
 */
export async function readFileOrStdin(filePath: string | undefined): Promise<Buffer> {
    if (filePath === undefined || filePath === '-') {
        return readStdin();
    }
    validatePath(filePath);
    return readFile(filePath);
}

/**
 * Read a binary file by path. Path-traversal validated before access.
 */
export async function readBinaryFile(filePath: string): Promise<Uint8Array> {
    validatePath(filePath);
    const buf = await readFile(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Open a readable byte stream for a file path, or stdin when `filePath` is
 * undefined / `-`. Used by the streaming entry points (`stream`, `create
 * --stream`, `inflate`, `crc32`) so a large input never materialises in memory.
 */
export function openInputStream(filePath: string | undefined): Readable {
    if (filePath === undefined || filePath === '-') return process.stdin;
    validatePath(filePath);
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

/**
 * Write binary data to a file path, or to stdout if `filePath` is undefined
 * (or `-`).
 */
export async function writeOutput(data: Uint8Array, filePath: string | undefined): Promise<void> {
    if (filePath === undefined || filePath === '-') {
        await new Promise<void>((resolve, reject) => {
            process.stdout.write(data, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        return;
    }
    validatePath(filePath);
    await writeFile(filePath, data);
}

/**
 * Pipe streaming chunks to a file or stdout with backpressure. Returns the
 * number of bytes written.
 */
export async function writeStreamingOutput(
    chunks: AsyncIterable<Uint8Array>,
    filePath: string | undefined,
): Promise<number> {
    let total = 0;
    if (filePath === undefined || filePath === '-') {
        for await (const chunk of chunks) {
            total += chunk.length;
            await new Promise<void>((resolve, reject) => {
                process.stdout.write(chunk, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        return total;
    }

    validatePath(filePath);
    await writeFileStream(filePath, chunks, (n) => { total += n; });
    return total;
}

/**
 * Stream chunks into a file (parents are NOT created — callers decide).
 * Backpressure-aware: waits for `drain` when the kernel buffer is full.
 */
export async function writeFileStream(
    filePath: string,
    chunks: AsyncIterable<Uint8Array>,
    onChunk?: (bytes: number) => void,
): Promise<void> {
    const stream = createWriteStream(filePath);
    // Settle only on 'close': the file descriptor is opened asynchronously, so
    // rejecting on the first pull failure (before 'open') would let the caller
    // unlink the path and then have the deferred open() recreate an empty file.
    let failure: unknown;
    await new Promise<void>((resolve, reject) => {
        stream.on('error', (e: unknown) => { failure ??= e; });
        stream.on('close', () => {
            if (failure !== undefined) reject(failure);
            else resolve();
        });
        (async () => {
            for await (const chunk of chunks) {
                onChunk?.(chunk.length);
                const ok = stream.write(chunk);
                if (!ok) {
                    await new Promise<void>((r) => stream.once('drain', r));
                }
            }
            stream.end();
        })().catch((e: unknown) => {
            failure ??= e;
            stream.destroy();
        });
    });
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
 * result stays inside `root`. This is the CLI's own safety belt on top of the
 * engine's `sanitizeEntryPath()`: the engine never touches the filesystem, so
 * containment of the final path is this repository's responsibility.
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
        buf = await readFileOrStdin(filePath);
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
