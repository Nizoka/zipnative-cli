// Pre-compressed manifest entries — `create --from-manifest` entries with a
// `raw` object (zipnative 1.1 `ZipWriter.addRaw()` + `RawEntryMeta`).
//
// The engine copies such a payload verbatim and trusts its metadata ("the
// caller vouches"). The CLI does not let a manifest — data, not a trusted
// caller — vouch for anything: before the entry is added, the payload is
// decoded once through the registered codec, bounded by the declared size and
// the entry-size limit, and its size and CRC-32 must equal the declared ones
// (ZIP_SIZE_MISMATCH / ZIP_CRC_MISMATCH otherwise). A method no registered
// codec decodes is refused (ZIP_UNSUPPORTED_METHOD). So `raw` saves the
// recompression, never the verification — the `modify` / `merge` rule.

import { crc32, createInflator, DEFAULT_ZIP_LIMITS, getCodec, type RawEntryMeta } from '../core-bridge/index.js';
import { CliError, ErrorCode } from './error.js';

/** Parse a manifest `raw` object: `{ method, crc32, uncompressedSize }` (crc32 as 8 hex digits or an integer). */
export function parseRawMeta(raw: unknown, where: string): RawEntryMeta {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new CliError(`${where}: "raw" must be an object { method, crc32, uncompressedSize }.`, 1, ErrorCode.INPUT);
    }
    const r = raw as Record<string, unknown>;
    for (const key of Object.keys(r)) {
        if (key !== 'method' && key !== 'crc32' && key !== 'uncompressedSize') {
            throw new CliError(`${where}: unknown key "raw.${key}". Valid: method, crc32, uncompressedSize.`, 1, ErrorCode.INPUT);
        }
    }
    const method = r['method'];
    if (!Number.isInteger(method) || (method as number) < 0 || (method as number) > 0xffff) {
        throw new CliError(`${where}: "raw.method" must be a compression method id (0 = store, 8 = deflate, or a registered codec).`, 1, ErrorCode.INPUT);
    }
    const size = r['uncompressedSize'];
    if (!Number.isSafeInteger(size) || (size as number) < 0) {
        throw new CliError(`${where}: "raw.uncompressedSize" must be a non-negative integer.`, 1, ErrorCode.INPUT);
    }
    const c = r['crc32'];
    let crc: number;
    if (typeof c === 'string' && /^[0-9a-fA-F]{8}$/.test(c)) crc = parseInt(c, 16);
    else if (Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 0xffffffff) crc = c as number;
    else throw new CliError(`${where}: "raw.crc32" must be 8 hex digits (as list --json prints it) or an unsigned 32-bit integer.`, 1, ErrorCode.INPUT);
    return { method: method as number, crc32: crc, uncompressedSize: size as number };
}

/**
 * Decode `payload` once and prove it matches `meta` (size and CRC-32),
 * bounded by the declared size and `maxEntrySize`. Throws the CLI error
 * naming the entry; returns nothing on success.
 */
export function verifyRawPayload(name: string, payload: Uint8Array, meta: RawEntryMeta, maxEntrySize: number = DEFAULT_ZIP_LIMITS.maxEntryUncompressedSize): void {
    if (meta.uncompressedSize > maxEntrySize) {
        throw new CliError(
            `Raw entry "${name}" declares ${meta.uncompressedSize} bytes, above the ${maxEntrySize}-byte entry bound.`,
            1, ErrorCode.LIMIT,
            { entryName: name, zipCode: 'ZIP_LIMIT_EXCEEDED', detail: { limit: 'maxEntryUncompressedSize', configured: maxEntrySize, observed: meta.uncompressedSize }, remedy: '--max-entry-size <value> (raise the bound for trusted input only)' },
        );
    }
    const codec = getCodec(meta.method);
    if (codec === null || codec.decompressSync === undefined) {
        throw new CliError(
            `Raw entry "${name}" uses compression method ${meta.method}, which no registered codec decodes synchronously: it cannot be verified before it is written (register one with --codec).`,
            1, ErrorCode.UNSUPPORTED,
            { entryName: name, zipCode: 'ZIP_UNSUPPORTED_METHOD' },
        );
    }
    // Nothing may ride behind the payload: bytes after the end of a DEFLATE
    // stream (or past a stored entry's size) would be written into the entry
    // and survive every CRC check — data hidden in plain sight.
    if (meta.method === 0 && payload.length !== meta.uncompressedSize) {
        throw new CliError(
            `Raw entry "${name}": a stored payload is ${payload.length} bytes, not the declared ${meta.uncompressedSize}.`,
            1, ErrorCode.DATA,
            { entryName: name, zipCode: 'ZIP_SIZE_MISMATCH' },
        );
    }
    let decoded: Uint8Array;
    try {
        if (meta.method === 8) {
            // The resumable inflater reports what follows the stream (`leftover`).
            const inflator = createInflator(meta.uncompressedSize + 1);
            const parts = inflator.push(payload);
            inflator.end();
            if (inflator.leftover.length > 0) {
                throw new CliError(
                    `Raw entry "${name}": ${inflator.leftover.length} byte(s) follow the end of the DEFLATE stream — refused, they would be hidden inside the entry.`,
                    1, ErrorCode.DATA,
                    { entryName: name, zipCode: 'ZIP_SIZE_MISMATCH' },
                );
            }
            decoded = Buffer.concat(parts);
        } else {
            // One byte of headroom past the declared size: an over-long stream
            // is caught as a size mismatch, never decoded without bound.
            decoded = codec.decompressSync(payload, meta.uncompressedSize + 1);
        }
    } catch (e) {
        if (e instanceof CliError) throw e;
        throw new CliError(
            `Raw entry "${name}": the payload does not decode as method ${meta.method} (${e instanceof Error ? e.message : String(e)}).`,
            1, ErrorCode.DATA,
            { entryName: name, zipCode: 'ZIP_DECOMPRESSION_FAILED' },
        );
    }
    if (decoded.length !== meta.uncompressedSize) {
        throw new CliError(
            `Raw entry "${name}" decodes to ${decoded.length} bytes, not the declared ${meta.uncompressedSize}.`,
            1, ErrorCode.DATA,
            { entryName: name, zipCode: 'ZIP_SIZE_MISMATCH' },
        );
    }
    const actual = crc32(decoded);
    if (actual !== meta.crc32) {
        throw new CliError(
            `Raw entry "${name}": CRC-32 ${actual.toString(16).padStart(8, '0')} does not match the declared ${meta.crc32.toString(16).padStart(8, '0')}.`,
            1, ErrorCode.DATA,
            { entryName: name, zipCode: 'ZIP_CRC_MISMATCH', detail: { expectedCrc: meta.crc32.toString(16).padStart(8, '0'), actualCrc: actual.toString(16).padStart(8, '0') } },
        );
    }
}
