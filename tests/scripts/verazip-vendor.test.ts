// veraZIP vendor pins — text-level guards over the conformance-gate scripts.
//
// scripts/validate-zip.mjs is a VENDORED copy of zipnative's
// scripts/validate-zip.ts (the engine does not ship scripts/ in its npm
// tarball). These tests never execute the scripts; they read them as text
// and pin:
//   - the upstream commit + blob hashes the port was taken from (bump both
//     in the same PR as a re-port);
//   - the frozen 23-id check vocabulary (`fail('<id>'` literals);
//   - the anti-circularity invariant: neither the validator nor the
//     foreign-tool helper imports `zipnative` or runs dist/cli.cjs, and the
//     corpus generator's raw writer never imports zipnative either;
//   - the level-1 tool roster;
//   - REQUIRED_NEGATIVE_CHECKS ⊆ the generator's declared `expectedCheck`
//     literals (the coverage canary can only trip on a real regression).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const validator = read('scripts/validate-zip.mjs');
const tools = read('scripts/helpers/interop-tools.mjs');
const generator = read('scripts/generate-zip-corpus.mjs');

const UPSTREAM_COMMIT = '1e2ab4216804a5936c83a94bfca10086760a6436';
const UPSTREAM_VALIDATOR_BLOB = '604321fa40ef1afba04eb9ce14f53e0c19efa474';
const UPSTREAM_TOOLS_BLOB = '2fef80f17e302384a0f6a5f57f7a0f14911401f5';

/** The frozen ISO/IEC 21320-1 + well-formedness vocabulary of the vendored validator. */
const CHECK_IDS = [
    'ISO21320-1/APPNOTE-4.3.3',
    'ISO21320-1/APPNOTE-4.3.8',
    'ISO21320-1/APPNOTE-4.3.10',
    'ISO21320-1/APPNOTE-4.3.13',
    'ISO21320-1/APPNOTE-4.4.1.5',
    'ISO21320-1/APPNOTE-4.4.3',
    'ISO21320-1/APPNOTE-4.4.4',
    'ISO21320-1/APPNOTE-4.4.5',
    'ISO21320-1/APPNOTE-NOTE-1',
    'WF/EOCD-NOT-FOUND',
    'WF/ZIP64-LOCATOR',
    'WF/ZIP64-EOCD',
    'WF/CD-OFFSET',
    'WF/CD-COUNT',
    'WF/CD-SIZE',
    'WF/LFH-SIGNATURE',
    'WF/LFH-METHOD-MISMATCH',
    'WF/LFH-NAME-MISMATCH',
    'WF/LFH-SIZE-MISMATCH',
    'WF/LFH-CRC-MISMATCH',
    'WF/DESCRIPTOR-MISMATCH',
    'WF/DESCRIPTOR-WIDTH',
    'WF/ENTRY-OVERLAP',
];

const literals = (source: string, re: RegExp): string[] =>
    Array.from(source.matchAll(re), (m) => m[1] as string);

describe('veraZIP vendored validator (scripts/validate-zip.mjs)', () => {
    it('pins the upstream commit and blob it was ported from', () => {
        expect(validator).toMatch(new RegExp(`upstream commit:\\s+${UPSTREAM_COMMIT}`));
        expect(validator).toMatch(new RegExp(`upstream blob:\\s+${UPSTREAM_VALIDATOR_BLOB}`));
        expect(validator).toMatch(/upstream file:\s+scripts\/validate-zip\.ts/);
    });

    it('emits exactly the frozen 23-id check vocabulary', () => {
        const ids = new Set(literals(validator, /\bfail\('([^']+)'/g));
        expect(CHECK_IDS).toHaveLength(23);
        expect([...ids].sort()).toEqual([...CHECK_IDS].sort());
    });

    it('never imports zipnative, src/, or drives dist/cli.cjs (anti-circularity)', () => {
        for (const source of [validator, tools]) {
            expect(source).not.toMatch(/from\s+['"]zipnative/);
            expect(source).not.toMatch(/from\s+['"][^'"]*\/src\//);
            expect(source).not.toContain('dist/cli');
            expect(source).not.toContain("'dist'");
        }
    });

    it('declares REQUIRED_NEGATIVE_CHECKS that the corpus generator actually crafts', () => {
        const block = /REQUIRED_NEGATIVE_CHECKS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(validator);
        expect(block).not.toBeNull();
        const required = literals(block![1] as string, /'([^']+)'/g);
        expect(required.length).toBeGreaterThan(0);
        const crafted = new Set(literals(generator, /expectedCheck:\s*'([^']+)'/g));
        expect([...required].sort()).toEqual([...crafted].sort());
        for (const id of required) expect(CHECK_IDS).toContain(id);
    });
});

describe('level-1 foreign tools (scripts/helpers/interop-tools.mjs)', () => {
    it('pins the upstream blob it was ported from', () => {
        expect(tools).toMatch(new RegExp(`upstream blob:\\s+${UPSTREAM_TOOLS_BLOB}`));
        expect(tools).toMatch(/upstream file:\s+tests\/helpers\/interop-tools\.ts/);
    });

    it('exposes exactly the five integrity tools, in upstream order', () => {
        expect(literals(tools, /\bid:\s*'([^']+)'/g)).toEqual(['bsdtar', 'unzip', '7z', 'python-zipfile', 'jar']);
        expect(tools).toContain('export const INTEGRITY_TOOLS');
    });
});

// Divergence guard: when an engine checkout is present (the CI audit job
// clones it; locally ../zipnative or $ZIPNATIVE_ENGINE_CHECKOUT), the pinned
// blobs must equal the upstream files at the tag of the INSTALLED engine — a
// veraZIP change upstream fails here until it is re-ported. Skipped, not
// faked, without a checkout or the tag.
const engineDir = resolve(process.env['ZIPNATIVE_ENGINE_CHECKOUT'] ?? join(ROOT, '..', 'zipnative'));
const engineVersion = (JSON.parse(read('node_modules/zipnative/package.json')) as { version: string }).version;
const gitBlob = (rev: string): string | undefined => {
    if (!existsSync(join(engineDir, '.git'))) return undefined;
    const r = spawnSync('git', ['-C', engineDir, 'rev-parse', '--verify', '--quiet', rev], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : undefined;
};
const tagged = gitBlob(`v${engineVersion}:scripts/validate-zip.ts`);

describe.skipIf(tagged === undefined)(`veraZIP in sync with the engine checkout at v${engineVersion}`, () => {
    it('the vendored validator and tool roster match the installed engine\'s upstream files', () => {
        expect(tagged, 'scripts/validate-zip.ts changed upstream: re-port it and bump the pins').toBe(UPSTREAM_VALIDATOR_BLOB);
        expect(gitBlob(`v${engineVersion}:tests/helpers/interop-tools.ts`)).toBe(UPSTREAM_TOOLS_BLOB);
        expect(gitBlob(`${UPSTREAM_COMMIT}:scripts/validate-zip.ts`)).toBe(UPSTREAM_VALIDATOR_BLOB);
    });
});

describe('corpus generator (scripts/generate-zip-corpus.mjs)', () => {
    it('never imports zipnative — its raw writer is engine-independent', () => {
        expect(generator).not.toMatch(/from\s+['"]zipnative/);
        expect(generator).not.toMatch(/from\s+['"][^'"]*\/src\//);
        expect(generator).not.toMatch(/require\(\s*['"]zipnative/);
    });

    it('drives only the built CLI (dist/cli.cjs) via process.execPath', () => {
        expect(generator).toContain("join(ROOT, 'dist', 'cli.cjs')");
        expect(generator).toContain('spawnSync(process.execPath, [CLI, ...args]');
    });
});
