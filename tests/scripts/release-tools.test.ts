// The release tools the gate runs — bundle-check, package-files and the gate
// itself — tested on synthetic inputs, so a regression in a check is caught
// before it silently passes a bad release.

import { describe, expect, it } from 'vitest';
import { ALLOWED_EXTERNALS, ENGINE_MARKERS, externalSpecifiers, probeBundle } from '../../scripts/lib/bundle-probe.mjs';
import { FORBIDDEN, forbiddenReason, manifestEntries, roleOf, sha256 } from '../../scripts/lib/package-files.mjs';
import { STEPS, parseGateArgs, selectSteps } from '../../scripts/gate.mjs';

const SHEBANG = '#!/usr/bin/env node\n';
const GOOD = `${SHEBANG}'use strict';\nvar fs = require('fs');\nvar zn = require('zipnative');\nconst w = () => import('zipnative/worker');\n`;

describe('probeBundle (gate step bundle-check)', () => {
    it('accepts a bundle that keeps the engine external and loads only built-ins and the allow-list', () => {
        expect(probeBundle(GOOD)).toEqual([]);
        expect(externalSpecifiers(GOOD)).toEqual(['fs', 'zipnative', 'zipnative/worker']);
        expect(ALLOWED_EXTERNALS.has('zipnative/worker/zip-worker.js')).toBe(true);
    });

    it('refuses an inlined engine, a missing engine require, a stray dependency and a missing shebang', () => {
        for (const marker of ENGINE_MARKERS) {
            expect(probeBundle(`${GOOD}${marker} a, b) {}\n`).join('\n'), marker).toMatch(/engine code is inlined/);
        }
        expect(probeBundle(`${SHEBANG}var fs = require('fs');\n`).join('\n')).toMatch(/engine must stay external/);
        expect(probeBundle(`${GOOD}require('left-pad');\n`).join('\n')).toMatch(/"left-pad" is not a Node built-in/);
        expect(probeBundle(GOOD.slice(SHEBANG.length)).join('\n')).toMatch(/not the node shebang/);
        expect(probeBundle(`${GOOD}#!/usr/bin/env node\n`).join('\n')).toMatch(/second shebang/);
    });

    it('refuses stdout prints, attribution trailers and embedded binary data', () => {
        expect(probeBundle(`${GOOD}console.log("x");\n`).join('\n')).toMatch(/console\.log/);
        expect(probeBundle(`${GOOD}// Co-Authored-By: someone\n`).join('\n')).toMatch(/attribution trailers/);
        expect(probeBundle(`${GOOD}const b = "${'A'.repeat(2048)}";\n`).join('\n')).toMatch(/base64 run/);
    });
});

describe('package-files', () => {
    it('derives the role from the path', () => {
        expect(roleOf('dist/cli.cjs')).toBe('build');
        expect(roleOf('LICENSE')).toBe('legal');
        expect(roleOf('THIRD-PARTY-NOTICES.md')).toBe('legal');
        expect(roleOf('package.json')).toBe('manifest');
        expect(roleOf('docs/data/errors.json')).toBe('data');
        expect(roleOf('README.md')).toBe('doc');
    });

    it('forbids sources, tests, dotfiles, archives, maps and every document but the error catalogue', () => {
        for (const p of ['src/index.ts', 'tests/x.test.ts', 'scripts/gate.mjs', 'samples/a.sh', '.npmrc', '.github/x.yml',
            'docs/KNOWLEDGE_BASE.md', 'docs/data/core-exports.json', 'a.zip', 'dist/cli.cjs.map', 'node_modules/x/index.js']) {
            expect(forbiddenReason(p), p).not.toBeNull();
        }
        for (const p of ['dist/cli.cjs', 'docs/data/errors.json', 'README.md', 'LICENSE', 'package.json', 'llms.txt']) {
            expect(forbiddenReason(p), p).toBeNull();
        }
        expect(FORBIDDEN.length).toBeGreaterThan(5);
    });

    it('pins the sha256 of the legal texts only, sorted by path', () => {
        const entries = manifestEntries([{ path: 'README.md' }, { path: 'LICENSE' }, { path: 'dist/cli.cjs' }], (p) => (p === 'LICENSE' ? 'MIT text' : null));
        expect(entries).toEqual([
            { path: 'LICENSE', role: 'legal', sha256: sha256('MIT text') },
            { path: 'README.md', role: 'doc' },
            { path: 'dist/cli.cjs', role: 'build' },
        ]);
    });
});

describe('gate', () => {
    it('defaults to --ci, refuses unknown arguments and mutually exclusive profiles', () => {
        expect(parseGateArgs([])).toMatchObject({ profile: 'ci', requireAll: false });
        expect(parseGateArgs(['--publish', '--require-all'])).toMatchObject({ profile: 'publish', requireAll: true });
        expect(parseGateArgs(['--fast', '--ci'])).toEqual({ error: '--fast and --ci are mutually exclusive' });
        expect(parseGateArgs(['--nope'])).toEqual({ error: 'unknown argument "--nope"' });
        expect(parseGateArgs(['--only', 'nope'])).toEqual({ error: 'unknown step "nope"' });
    });

    it('builds before the coverage suite (the built-binary suites need dist/) and keeps the release-only steps out of --ci', () => {
        const ids = (p: 'fast' | 'ci' | 'publish'): string[] => selectSteps({ profile: p, only: null, from: null }).map((s) => s.id);
        const ci = ids('ci');
        expect(ci.indexOf('build')).toBeLessThan(ci.indexOf('test:coverage'));
        expect(ci).not.toContain('smoke-install');
        expect(ci).not.toContain('verazip');
        expect(ids('fast')).toEqual(['typecheck:all', 'lint', 'test']);
        const publish = ids('publish');
        for (const id of ['bundle-check', 'reproducible', 'package-files', 'samples', 'verazip', 'verazip-validate', 'smoke-install']) {
            expect(publish, id).toContain(id);
        }
        expect(new Set(STEPS.map((s) => s.id)).size).toBe(STEPS.length);
    });

    it('--only selects one step, --from starts at a step', () => {
        expect(selectSteps({ profile: 'ci', only: 'smoke', from: null }).map((s) => s.id)).toEqual(['smoke']);
        expect(selectSteps({ profile: 'ci', only: null, from: 'smoke' })[0]?.id).toBe('smoke');
    });
});
