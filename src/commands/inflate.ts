// `zipnative inflate` — decompress a raw DEFLATE (RFC 1951) stream, or any
// registered codec's stream, with a MANDATORY output bound.
//
// Default path: zipnative's resumable `createInflator(maxOutput)` fed chunk by
// chunk — constant memory, exact `bytesConsumed`, and the trailing bytes after
// the stream are reported as `leftover` (a warning unless --allow-trailing).
// `--sync` buffers the whole input and calls the registered codec's
// `decompressSync` (node:zlib tier when initialised). `--method <n>` selects
// a codec loaded with `--codec`; `--method 0` is a bounded pass-through.

import { type ParsedArgs, getStringFlag, hasFlag } from '../utils/args.js';
import { emitStatus, isDryRun, progress } from '../utils/agent.js';
import {
    METHOD_DEFLATE,
    METHOD_STORE,
    activeDeflateTier,
    createInflator,
    getCodec,
} from '../core-bridge/index.js';
import { prepareEngine } from '../utils/engine.js';
import { methodName } from '../utils/entryfmt.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { openInputStream, readFileOrStdin, unlinkQuiet, validatePath, writeOutput, writeStreamingOutput } from '../utils/io.js';
import { parseLimitFlags, effectiveLimits } from '../utils/limits.js';
import { parseByteSize } from '../utils/sizes.js';
import { mapZipError } from '../utils/ziperr.js';

export async function inflate(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const inputPath = getStringFlag(args.flags, 'input', 'i') ?? args.positionals[0];
    const outputPath = getStringFlag(args.flags, 'output', 'o');
    if (outputPath !== undefined) validatePath(outputPath);
    const methodRaw = getStringFlag(args.flags, 'method');
    let method = METHOD_DEFLATE;
    if (methodRaw !== undefined) {
        if (methodRaw === 'deflate') method = METHOD_DEFLATE;
        else if (methodRaw === 'store') method = METHOD_STORE;
        else if (/^\d+$/.test(methodRaw)) method = Number(methodRaw);
        else throw new CliError(`--method expects "deflate", "store" or a numeric method id, got "${methodRaw}".`, 2);
    }
    const sync = hasFlag(args.flags, 'sync');
    const allowTrailing = hasFlag(args.flags, 'allow-trailing');
    const maxRaw = getStringFlag(args.flags, 'max-output');
    const maxOutput = maxRaw !== undefined
        ? parseByteSize(maxRaw, 'max-output')
        : effectiveLimits(parseLimitFlags(args)).maxEntryUncompressedSize;
    if (maxOutput !== Infinity && maxOutput <= 0) throw new CliError('--max-output must be positive.', 2);
    const bound = Number.isFinite(maxOutput) ? maxOutput : Number.MAX_SAFE_INTEGER;
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();

    if (dryRun) {
        emitStatus({ command: 'inflate', dryRun: true, method, methodName: methodName(method), maxOutput: bound, sync, output: outputPath ?? '-' });
        return;
    }

    let bytesIn = 0;
    let bytesOut = 0;
    let leftover = 0;

    try {
        if (method === METHOD_DEFLATE && !sync) {
            const inflator = createInflator(bound);
            async function* pieces(): AsyncGenerator<Uint8Array, void, undefined> {
                for await (const chunk of openInputStream(inputPath)) {
                    const u8 = chunk as Uint8Array;
                    bytesIn += u8.length;
                    if (inflator.finished) {
                        leftover += u8.length;
                        continue;
                    }
                    for (const piece of inflator.push(u8)) {
                        bytesOut += piece.length;
                        yield piece;
                    }
                    if (inflator.finished) leftover += inflator.leftover.length;
                }
                inflator.end();
            }
            await writeStreamingOutput(pieces(), outputPath);
        } else {
            const buf = await readFileOrStdin(inputPath);
            const input = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            bytesIn = input.length;
            let out: Uint8Array;
            if (method === METHOD_STORE) {
                if (input.length > bound) {
                    throw new CliError(`Input (${input.length} bytes) exceeds --max-output (${bound}).`, 1, ErrorCode.DATA);
                }
                out = input;
            } else {
                const codec = getCodec(method);
                if (codec === null) {
                    throw new CliError(`No codec registered for method ${method} (load one with --codec <module>).`, 1, ErrorCode.UNSUPPORTED, { zipCode: 'ZIP_UNSUPPORTED_METHOD', detail: { feature: `method:${method}` } });
                }
                if (codec.decompressSync !== undefined) {
                    out = codec.decompressSync(input, bound);
                } else if (codec.decompressStream !== undefined) {
                    const chunks: Uint8Array[] = [];
                    for await (const c of codec.decompressStream(input, bound)) chunks.push(c);
                    out = Buffer.concat(chunks);
                } else {
                    throw new CliError(`Codec "${codec.name}" (method ${method}) cannot decompress.`, 1, ErrorCode.UNSUPPORTED, { zipCode: 'ZIP_UNSUPPORTED_CODEC_MODE', detail: { feature: `method:${method}` } });
                }
            }
            bytesOut = out.length;
            await writeOutput(out, outputPath);
        }
    } catch (e) {
        if (outputPath !== undefined) await unlinkQuiet(outputPath);
        throw mapZipError(e, 'Inflate failed');
    }

    if (leftover > 0 && !allowTrailing) {
        progress(`warning: ${leftover} trailing byte(s) after the end of the deflate stream were ignored (pass --allow-trailing to silence).`);
    }

    emitStatus({
        command: 'inflate',
        dryRun: false,
        output: outputPath ?? '-',
        method,
        methodName: methodName(method),
        bytesIn,
        bytesOut,
        leftover,
        maxOutput: bound,
        sync: sync || method !== METHOD_DEFLATE,
        tier: activeDeflateTier(false),
    });
}
