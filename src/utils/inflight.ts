// In-flight output tracking for signal cleanup.
//
// A file the CLI is currently writing (an archive, an extracted entry, the
// `modify --in-place` temp file, a `cat -o` target) is registered here while
// its stream is open. On SIGINT / SIGTERM the handler removes exactly those
// paths — never a completed output, never the original of `--in-place` — and
// exits with the conventional 128 + signal number (130 / 143), so a half
// written file is not left behind looking like a finished artefact.
//
// Registration is a plain Set: `writeOutput` / `writeFileStream` (utils/io.ts)
// mark a path before opening it and clear it once the write has settled.

import { rmSync } from 'node:fs';

const inFlight = new Set<string>();
let installed = false;

/** Register `path` as being written right now. */
export function markInFlight(path: string): void {
    inFlight.add(path);
}

/** The write has settled (success or failure) — the path is no longer ours to remove. */
export function clearInFlight(path: string): void {
    inFlight.delete(path);
}

/** Paths currently registered (for tests and diagnostics). */
export function inFlightPaths(): readonly string[] {
    return [...inFlight];
}

/** Remove every in-flight path (best effort, synchronous — runs inside a signal handler). */
export function removeInFlight(): string[] {
    const removed: string[] = [];
    for (const p of inFlight) {
        try {
            rmSync(p, { force: true });
            removed.push(p);
        } catch { /* best effort */ }
    }
    inFlight.clear();
    return removed;
}

const SIGNAL_EXIT: Readonly<Record<'SIGINT' | 'SIGTERM', number>> = { SIGINT: 130, SIGTERM: 143 };

/**
 * Install the SIGINT / SIGTERM handlers once (called by `main()`). The
 * handler is deliberately minimal: remove the in-flight files, then exit
 * with 128 + signal — the shell convention every CI runner understands.
 */
export function installSignalCleanup(): void {
    if (installed) return;
    installed = true;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.on(signal, () => {
            removeInFlight();
            process.exit(SIGNAL_EXIT[signal]);
        });
    }
}
