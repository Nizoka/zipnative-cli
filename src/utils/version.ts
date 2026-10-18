// Resolve the CLI's own version from package.json — robustly across BOTH the
// source layout (tests run `src/**/*.ts` directly) and the bundled artifact
// (tsup flattens everything into `dist/cli.cjs`, so a path relative to a
// command file no longer points where it did in source).
//
// We try a few candidate locations and accept only our own package.json
// (guarded by name), so a sibling/parent package.json can never be picked up.

import { createRequire } from 'node:module';

let cached: string | null = null;
let cachedEngine: string | null = null;
let cachedRange: string | null = null;

const CANDIDATES = ['../package.json', '../../package.json', '../../../package.json'];

interface OwnPackage {
    readonly name?: string;
    readonly version?: string;
    readonly engines?: { readonly node?: string };
}

function ownPackage(): OwnPackage | null {
    const require = createRequire(import.meta.url);
    for (const candidate of CANDIDATES) {
        try {
            const pkg = require(candidate) as OwnPackage;
            if (pkg.name === 'zipnative-cli') return pkg;
        } catch {
            // Not at this relative location — try the next candidate.
        }
    }
    return null;
}

export function cliVersion(): string {
    if (cached !== null) return cached;
    const pkg = ownPackage();
    // Should never fall back in a correctly packaged install; fail soft.
    cached = typeof pkg?.version === 'string' ? pkg.version : '0.0.0';
    return cached;
}

/** The supported Node.js range — package.json `engines.node`, the one source `doctor` checks against. */
export function nodeRange(): string {
    if (cachedRange !== null) return cachedRange;
    const pkg = ownPackage();
    cachedRange = typeof pkg?.engines?.node === 'string' ? pkg.engines.node : '>=22';
    return cachedRange;
}

/**
 * The installed `zipnative` package version, read from its package.json
 * through the exports map (`zipnative/package.json`) WITHOUT loading the
 * engine — cheap enough for `--version --json` and `doctor`.
 */
export function engineVersion(): string {
    if (cachedEngine !== null) return cachedEngine;
    try {
        const require = createRequire(import.meta.url);
        const pkg = require('zipnative/package.json') as { version?: string };
        cachedEngine = typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
        cachedEngine = 'unknown';
    }
    return cachedEngine;
}
