// Selective re-exports from zipnative — the ONLY import point of the engine.
// All ZIP logic lives in zipnative; commands and utils import from here and
// never from 'zipnative' / 'zipnative/worker' directly (CLAUDE.md rule 2).
//
// Grouped exactly like the core's own src/index.ts so the bridge doubles as a
// coverage ledger of the frozen 1.0 surface (77 exports):
// docs/KNOWLEDGE_BASE.md §8 maps every one of them to a CLI touchpoint.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { initNodeZipCodecs as _initNodeZipCodecs } from 'zipnative';
import type { createParallelZip as CreateParallelZipFn } from 'zipnative/worker';

// ── 1. Reading: open, random access, streams ─────────────────────────
export { openZip } from 'zipnative';
export type { OpenZipOptions, ReadEntryOptions, ZipReader } from 'zipnative';

// ── 2. Forward streaming: CD-less iteration over pipes ───────────────
export { iterateZipEntries } from 'zipnative';
export type { IterateZipOptions, StreamedZipEntry, StreamedZipHeader } from 'zipnative';

// ── 3. Extraction: secure by default, in memory ──────────────────────
export { extractZip, extractZipStream, sanitizeEntryPath } from 'zipnative';
export type { ExtractedEntry, ExtractedStreamEntry, ExtractOptions } from 'zipnative';

// ── 3b. Writing: deterministic archives, buffered and streaming ───────
export { createZip } from 'zipnative';
export type {
    AddEntryOptions,
    CreateZipOptions,
    StreamOptions,
    ZipCompressionOptions,
    ZipWriter,
} from 'zipnative';

// ── 3c. Verifying: one-call deep validation ──────────────────────────
export { verifyZip } from 'zipnative';
export type { VerifiedEntry, VerifyZipOptions, ZipVerificationReport } from 'zipnative';

// ── 4. Modifying: incremental save / compact rewrite ─────────────────
export { createZipModifier } from 'zipnative';
export type { ZipModifier, ZipModifierOptions } from 'zipnative';

// ── 4b. Entry attributes ─────────────────────────────────────────────
export { getUnixMode, isSymlinkEntry } from 'zipnative';

// ── 4c. Byte sources for the streaming entry points ──────────────────
export type { ByteSource } from 'zipnative';

// ── 5. Entries and shared types ──────────────────────────────────────
export type {
    EntryVerification,
    ZipCommonOptions,
    ZipDiagnostic,
    ZipDiagnosticCode,
    ZipDiagnosticHandler,
    ZipEntry,
    ZipExtraField,
    ZipLimits,
} from 'zipnative';

// ── 6. Errors ────────────────────────────────────────────────────────
export {
    ZipDataError,
    ZipError,
    ZipFormatError,
    ZipLimitError,
    ZipSecurityError,
    ZipUnsupportedError,
} from 'zipnative';
export type {
    ZipBaseErrorCode,
    ZipDataErrorCode,
    ZipErrorCode,
    ZipFormatErrorCode,
    ZipLimitErrorCode,
    ZipSecurityErrorCode,
    ZipUnsupportedErrorCode,
    ZipUnsupportedFeature,
} from 'zipnative';

// ── 7. Security limits ───────────────────────────────────────────────
export { DEFAULT_ZIP_LIMITS } from 'zipnative';

// ── 8. Codecs: registry, facades, checksums ──────────────────────────
export {
    activeDeflateTier,
    crc32,
    createInflator,
    getCodec,
    initNodeZipCodecs,
    METHOD_DEFLATE,
    METHOD_STORE,
    registerCodec,
    setDeflateImpl,
    setInflateImpl,
} from 'zipnative';
export type { CodecCompressOptions, DeflateTier, Inflator, ZipCodec } from 'zipnative';
export {
    FLAG_DATA_DESCRIPTOR,
    FLAG_ENCRYPTED,
    FLAG_STRONG_ENCRYPTION,
    FLAG_UTF8,
} from 'zipnative';

// ── 9. Package metadata ──────────────────────────────────────────────
export { VERSION } from 'zipnative';

// ── 10. Parallel writer (zipnative/worker) — lazy, never on the startup path
export type { ParallelZipOptions, ParallelZipWriter } from 'zipnative/worker';
// The worker subpath re-declares the two streaming types; aliased so a
// caller can name the worker-side shape explicitly (structurally identical
// to the root `ByteSource` / `StreamOptions`).
export type { ByteSource as WorkerByteSource, StreamOptions as WorkerStreamOptions } from 'zipnative/worker';

/**
 * Memoised engine bootstrap: resolve `node:zlib` once so every sync codec
 * path (createZip, readEntry, verifyZip, createZipModifier) runs on the
 * `node-zlib` tier. Without this call a CJS bundle silently runs the
 * pure-TS tier (the core's probe cannot see `require` in CJS scope).
 */
let _codecsReady: Promise<void> | null = null;
export function ensureCodecsReady(): Promise<void> {
    if (_codecsReady === null) _codecsReady = _initNodeZipCodecs();
    return _codecsReady;
}

export interface ParallelZipModule {
    readonly createParallelZip: typeof CreateParallelZipFn;
    /** Explicit worker-script URL, resolved through the package exports map. */
    readonly workerUrl: URL;
}

/**
 * Load the `zipnative/worker` subpath on demand (`create --parallel`).
 *
 * The subpath stays EXTERNAL in the tsup bundle: its own `import.meta.url`
 * shim resolves `./zip-worker.js` next to `node_modules/zipnative/dist/worker/`.
 * We still hand the core an explicit `workerUrl` resolved through the exports
 * map so a packager that flattens node_modules fails loudly here instead of
 * silently degrading to main-thread compression.
 */
export async function loadParallelZip(): Promise<ParallelZipModule> {
    const m = await import('zipnative/worker');
    const require = createRequire(import.meta.url);
    const workerUrl = pathToFileURL(require.resolve('zipnative/worker/zip-worker.js'));
    return { createParallelZip: m.createParallelZip, workerUrl };
}
