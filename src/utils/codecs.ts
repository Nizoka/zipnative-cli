// `--codec <module>` — load a user-supplied ESM module and register its codecs.
//
// This is the CLI's ONLY dynamic import of user code and a stated trust
// boundary (same trust as `node -r`): the module runs with the invoking
// user's privileges. Therefore:
//   (a) it is only honoured from argv — `.zipnativerc.json` refuses the key
//       (utils/config.ts), so a hostile repository cannot run code when you
//       type `zipnative list` inside it;
//   (b) a batch manifest task carrying `codec` is refused unless the batch
//       invocation itself passes `--allow-codec-load`;
//   (c) registered codecs are READ-SIDE only — the writer knows store/deflate.
//
// Module contract:
//   export const codecs: ZipCodec[]            (or `export default ZipCodec[]`)
//   export const inflateImpl?: (data, maxOutput) => Uint8Array
//   export const deflateImpl?: (data, level) => Uint8Array

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    registerCodec,
    setDeflateImpl,
    setInflateImpl,
    type ZipCodec,
} from '../core-bridge/index.js';
import { CliError, ErrorCode } from './error.js';
import { validatePath } from './io.js';

export interface LoadedCodecModule {
    readonly path: string;
    readonly codecs: readonly { readonly method: number; readonly name: string }[];
    readonly inflateImpl: boolean;
    readonly deflateImpl: boolean;
}

const _loaded: LoadedCodecModule[] = [];

/** Codec modules loaded so far (for `doctor` and envelopes). */
export function loadedCodecModules(): readonly LoadedCodecModule[] {
    return _loaded;
}

function isCodec(value: unknown): value is ZipCodec {
    if (value === null || typeof value !== 'object') return false;
    const c = value as Record<string, unknown>;
    if (!Number.isInteger(c['method']) || (c['method'] as number) < 0 || (c['method'] as number) > 0xffff) return false;
    if (typeof c['name'] !== 'string' || c['name'].length === 0) return false;
    const fns = ['compressSync', 'decompressSync', 'decompressStream'];
    const present = fns.filter((f) => typeof c[f] === 'function');
    const invalid = fns.filter((f) => c[f] !== undefined && typeof c[f] !== 'function');
    return present.length > 0 && invalid.length === 0;
}

/**
 * Import `modulePath`, validate its exports and register everything it
 * declares. Throws `E_INPUT` when the module does not honour the contract.
 */
export async function loadCodecModule(modulePath: string): Promise<LoadedCodecModule> {
    validatePath(modulePath);
    const abs = resolve(modulePath);
    let mod: Record<string, unknown>;
    try {
        mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new CliError(`Cannot load codec module "${modulePath}": ${message}`, 1, ErrorCode.INPUT);
    }

    const raw = mod['codecs'] ?? mod['default'];
    const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    const codecs: { method: number; name: string }[] = [];
    for (const item of list) {
        if (!isCodec(item)) {
            throw new CliError(
                `Codec module "${modulePath}" exports an invalid codec: expected { method: 0-65535, name, `
                + 'and at least one of compressSync/decompressSync/decompressStream }.',
                1,
                ErrorCode.INPUT,
            );
        }
        registerCodec(item);
        codecs.push({ method: item.method, name: item.name });
    }

    let inflateImpl = false;
    let deflateImpl = false;
    const inflate = mod['inflateImpl'];
    if (inflate !== undefined) {
        if (typeof inflate !== 'function') {
            throw new CliError(`Codec module "${modulePath}": inflateImpl must be a function.`, 1, ErrorCode.INPUT);
        }
        setInflateImpl(inflate as (data: Uint8Array, maxOutput: number) => Uint8Array);
        inflateImpl = true;
    }
    const deflate = mod['deflateImpl'];
    if (deflate !== undefined) {
        if (typeof deflate !== 'function') {
            throw new CliError(`Codec module "${modulePath}": deflateImpl must be a function.`, 1, ErrorCode.INPUT);
        }
        setDeflateImpl(deflate as (data: Uint8Array, level: number) => Uint8Array);
        deflateImpl = true;
    }

    if (codecs.length === 0 && !inflateImpl && !deflateImpl) {
        throw new CliError(
            `Codec module "${modulePath}" exports nothing usable: expected \`codecs\`, \`inflateImpl\` or \`deflateImpl\`.`,
            1,
            ErrorCode.INPUT,
        );
    }

    const loaded: LoadedCodecModule = { path: abs, codecs, inflateImpl, deflateImpl };
    _loaded.push(loaded);
    return loaded;
}
