// veraZIP vendor pins — text-level guards over the conformance-gate scripts.
//
// scripts/validate-zip.mjs is a VENDORED copy of zipnative's
// scripts/validate-zip.ts (the engine does not ship scripts/ in its npm
// tarball). These tests never execute the scripts; they read them as text
// and pin:
//   - the upstream commit + blob hashes the port was taken from (bump both
//     in the same PR as a re-port);
//   - the frozen 22-id check vocabulary (`fail('<id>'` literals);
//   - the anti-circularity invariant: neither the validator nor the
//     foreign-tool helper imports `zipnative` or runs dist/cli.cjs, and the
//     corpus generator's raw writer never imports zipnative either;
//   - the level-1 tool roster;
//   - REQUIRED_NEGATIVE_CHECKS ⊆ the generator's declared `expectedCheck`
//     literals (the coverage canary can only trip on a real regression).

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const validator = read('scripts/validate-zip.mjs');
const tools = read('scripts/helpers/interop-tools.mjs');
const generator = read('scripts/generate-zip-corpus.mjs');

const UPSTREAM_COMMIT = '4f1bc3619372e8543bccea65d2365bf0c048a10c';
const UPSTREAM_VALIDATOR_BLOB = '5ddea000a3b6a4adfb720d673a43664972118139';
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

    it('emits exactly the frozen 22-id check vocabulary', () => {
        const ids = new Set(literals(validator, /\bfail\('([^']+)'/g));
        expect(CHECK_IDS).toHaveLength(22);
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
