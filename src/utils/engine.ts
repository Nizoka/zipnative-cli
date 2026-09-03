// Engine bootstrap — called first thing by every core-touching command.
//
//   1. `--codec <module>` modules are loaded and registered (argv only).
//   2. Unless `--pure-codecs`, `node:zlib` is resolved once so every sync
//      codec path runs on the `node-zlib` tier. In a CJS bundle the core's own
//      probe cannot see `require`, so skipping this call silently runs the
//      pure-TS tier — `doctor` makes the active tier visible.
//
// Idempotent: batch tasks run in-process and call it again as a no-op.

import { type ParsedArgs, getStringFlagAll, hasFlag } from './args.js';
import { ensureCodecsReady } from '../core-bridge/index.js';
import { loadCodecModule } from './codecs.js';

const _loadedPaths = new Set<string>();
let _ready = false;

/** True when `--pure-codecs` is in effect (set by index.ts or a flag). */
export function isPureCodecs(args?: ParsedArgs): boolean {
    if (process.env['ZIPNATIVE_PURE_CODECS'] === '1') return true;
    return args !== undefined && hasFlag(args.flags, 'pure-codecs');
}

export async function prepareEngine(args: ParsedArgs): Promise<void> {
    for (const modulePath of getStringFlagAll(args.flags, 'codec')) {
        if (_loadedPaths.has(modulePath)) continue;
        await loadCodecModule(modulePath);
        _loadedPaths.add(modulePath);
    }
    if (!isPureCodecs(args) && !_ready) {
        await ensureCodecsReady();
        _ready = true;
    }
}
