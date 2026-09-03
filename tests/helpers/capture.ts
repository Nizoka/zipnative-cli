// Shared stdout / stderr capture for in-process tests.
//
// `process.stdout.write` / `process.stderr.write` are replaced with a spy that
// collects every chunk (string or bytes) and honours the optional completion
// callback (`writeOutput` in src/utils/io.ts awaits it). Restore with
// `capture.restore()` or `vi.restoreAllMocks()` in `afterEach`.

import { vi } from 'vitest';

export interface Capture {
    /** Everything written so far, decoded as UTF-8. */
    text(): string;
    /** Everything written so far, as raw bytes. */
    bytes(): Buffer;
    /** Number of `write()` calls observed. */
    readonly calls: number;
    /** Put the original `write` back. */
    restore(): void;
}

function install(stream: NodeJS.WriteStream): Capture {
    const chunks: Buffer[] = [];
    let calls = 0;
    const spy = vi
        .spyOn(stream, 'write')
        .mockImplementation((chunk: Uint8Array | string, encoding?: unknown, cb?: unknown): boolean => {
            calls++;
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
            const done = typeof encoding === 'function' ? encoding : cb;
            if (typeof done === 'function') (done as () => void)();
            return true;
        });
    return {
        text: (): string => Buffer.concat(chunks).toString('utf8'),
        bytes: (): Buffer => Buffer.concat(chunks),
        get calls(): number {
            return calls;
        },
        restore: (): void => {
            spy.mockRestore();
        },
    };
}

/** Capture everything written to `process.stdout` until restored. */
export function captureStdout(): Capture {
    return install(process.stdout);
}

/** Capture everything written to `process.stderr` until restored. */
export function captureStderr(): Capture {
    return install(process.stderr);
}
