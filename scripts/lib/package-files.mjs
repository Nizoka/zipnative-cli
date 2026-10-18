// @ts-check
// What `npm pack` may put in the tarball — shared by scripts/package-files.mjs
// (which compares `npm pack --dry-run --json` with docs/data/package-files.json)
// and its tests. Ported from pkinative-cli (scripts/lib/package-files.ts).
//
// Pinned per file: the path, the role derived from the path, and the sha256 of
// the legal texts only. The bundle is held by bundle-check (scripts/lib/
// bundle-probe.mjs), the documents by the docs tests, and package.json changes
// with every bump. The executable bit is not pinned: a Windows checkout never
// reports one, and npm sets it on the bin at install — scripts/smoke-install.mjs
// proves it by running the installed bin.

import { createHash } from 'node:crypto';

export const PACKAGE_FILES_MANIFEST = 'docs/data/package-files.json';
export const PACKAGE_FILES_COMMAND = 'node scripts/package-files.mjs --update';

/** The texts a redistributor ships verbatim: a change to either is a decision. */
export const LEGAL_FILES = ['LICENSE', 'THIRD-PARTY-NOTICES.md'];

/** Never in the tarball, whatever the manifest says, so regenerating it cannot bless a leak. */
export const FORBIDDEN = [
    { pattern: /^(src|tests?|scripts|samples|examples|fuzz)\//, why: 'a source, test, sample or tooling directory' },
    { pattern: /^docs\/(?!data\/errors\.json$)/, why: 'a document other than the shipped error catalogue' },
    { pattern: /(^|\/)\./, why: 'a dotfile (.env, .npmrc, .github, .claude, an editor config)' },
    { pattern: /(^|\/)(node_modules|coverage|test-output|fixtures)\//, why: 'a dependency, report or fixture directory' },
    { pattern: /\.(zip|jar|epub|tgz|gz|bin|log)$/i, why: 'an archive, a binary blob or a log' },
    { pattern: /\.(test|spec|bench)\.[cm]?[jt]s$/, why: 'a test or benchmark file' },
    { pattern: /\.(ts|map|tsbuildinfo)$/, why: 'a TypeScript source, a source map or a build cache (the CLI ships no types)' },
];

/** @typedef {'build' | 'legal' | 'doc' | 'data' | 'manifest'} PackageFileRole */
/** @typedef {{ path: string; role: PackageFileRole; sha256?: string }} PackageFile */

/** @param {string} path @returns {PackageFileRole} */
export function roleOf(path) {
    if (path.startsWith('dist/')) return 'build';
    if (LEGAL_FILES.includes(path)) return 'legal';
    if (path === 'package.json') return 'manifest';
    if (path.startsWith('docs/data/')) return 'data';
    return 'doc';
}

/** @param {Uint8Array | string} bytes */
export function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} path @returns {string | null} */
export function forbiddenReason(path) {
    return FORBIDDEN.find((f) => f.pattern.test(path))?.why ?? null;
}

/**
 * Manifest entries for a packed list, sorted by path; `readBytes` supplies each legal file.
 * @param {ReadonlyArray<{ path: string }>} packed
 * @param {(path: string) => Uint8Array | string | null} readBytes
 * @returns {PackageFile[]}
 */
export function manifestEntries(packed, readBytes) {
    return packed
        .map(({ path }) => path)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((path) => {
            const role = roleOf(path);
            if (role !== 'legal') return { path, role };
            const bytes = readBytes(path);
            return bytes === null ? { path, role } : { path, role, sha256: sha256(bytes) };
        });
}
