import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Workflow, supply-chain and repository invariants ──────────────────
//
// None of this is visible to the type checker or to the suite proper: a
// floating action tag, a checkout that keeps the job token, a release job
// that runs dev-dependency code next to a publishing token, an npm client
// that drifts between two publishes, a required check nothing reports, an
// expression interpolated into a shell script. Each is locked here as a
// plain-text assertion on the files that carry it. Ported from pkinative-cli
// (tests/tools/workflows.test.ts).

const ROOT = process.cwd();
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const workflowFiles = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml')).sort();
// Every assertion is a regex over file text: a CRLF checkout would mismatch
// them all silently, so line endings are normalised on the way in.
const lf = (text: string): string => text.replace(/\r\n/g, '\n');
const readWorkflow = (f: string): string => lf(readFileSync(join(WORKFLOWS, f), 'utf8'));
const readText = (...parts: string[]): string => lf(readFileSync(join(ROOT, ...parts), 'utf8'));
/** The text without its YAML comment lines (an explanation may name what the code must not do). */
const code = (text: string): string => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const HARDEN_RUNNER = 'step-security/harden-runner@';

/** Every step block of every job, in order, keyed by job id. */
function jobSteps(text: string): Map<string, string[]> {
    const jobs = new Map<string, string[]>();
    const jobsAt = text.search(/^jobs:\s*$/m);
    if (jobsAt < 0) return jobs;
    let job: string | null = null;
    let steps: string[] | null = null;
    for (const line of text.slice(jobsAt).split('\n').slice(1)) {
        const jobHead = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
        if (jobHead) { job = jobHead[1] ?? null; steps = null; continue; }
        if (/^ {4}steps:\s*$/.test(line) && job !== null) { steps = []; jobs.set(job, steps); continue; }
        if (steps === null) continue;
        if (/^ {6}- /.test(line)) steps.push(line);
        else if (/^ {8,}\S/.test(line) && steps.length > 0) steps[steps.length - 1] += `\n${line}`;
    }
    return jobs;
}

/** One job's text, from its head to the next job head. */
const jobBody = (text: string, job: string): string =>
    new RegExp(`^  ${job}:\\s*\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:\\s*$|(?![\\s\\S]))`, 'm').exec(text)?.[1] ?? '';

/** Every status-check context a workflow reports (matrix names expanded). */
function reported(file: string): string[] {
    const text = readWorkflow(file);
    const out: string[] = [];
    for (const job of jobSteps(text).keys()) {
        const body = jobBody(text, job);
        const name = /^ {4}name:\s*(.+?)\s*$/m.exec(body)?.[1] ?? job;
        if (name === '${{ matrix.name }}') {
            out.push(...[...body.matchAll(/^\s+- \{ name: '?([^,']+)'?,/gm)].map((m) => m[1] ?? ''));
        } else if (name.includes('${{ matrix.os }}')) {
            const os = /os:\s*\[([^\]]+)\]/.exec(body)?.[1]?.split(',').map((s) => s.trim()) ?? [];
            out.push(...os.map((o) => name.replace('${{ matrix.os }}', o)));
        } else {
            out.push(name);
        }
    }
    return out;
}

const ruleset = JSON.parse(readText('.github', 'rulesets', 'main.json')) as {
    rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string; integration_id?: number }>; code_scanning_tools?: Array<Record<string, string>> } }>;
};
const required = ruleset.rules.find((r) => r.type === 'required_status_checks')?.parameters?.required_status_checks ?? [];

describe('every workflow', () => {
    const allFiles = workflowFiles.map((f) => ({ label: f, text: readWorkflow(f) }));

    it('is exactly the expected set of workflow files', () => {
        // A new workflow is a new holder of tokens; it arrives with its own assertions here.
        expect(workflowFiles).toEqual([
            'audit.yml', 'ci.yml', 'codeql.yml', 'dependency-review.yml', 'node-current.yml',
            'publish.yml', 'sample-regression.yml', 'scorecard.yml', 'verazip.yml',
        ]);
    });

    it('resolves every action to a single SHA across the tree, with a version comment', () => {
        const pins = new Map<string, Set<string>>();
        for (const { label, text } of allFiles) {
            for (const m of text.matchAll(/^\s*(?:- )?uses:\s*(\S+)[^\n]*$/gm)) {
                const ref = m[1] ?? '';
                expect(ref, `${label}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
                expect(m[0], `${label}: ${ref} lacks a "# vX[.Y[.Z]]" comment`).toMatch(/#\s*v\d+(?:\.\d+){0,2}\s*$/);
                const [action, sha] = ref.split('@') as [string, string];
                // The four codeql-action steps are one action: one release (#3–#7).
                const key = action.startsWith('github/codeql-action/') ? 'github/codeql-action' : action;
                pins.set(key, new Set([...(pins.get(key) ?? []), sha]));
            }
        }
        for (const [action, shas] of pins) expect([...shas], `${action} is pinned to more than one SHA`).toHaveLength(1);
    });

    it('drops the checkout credentials, grants read-only at workflow level, and times out every job', () => {
        for (const { label, text } of allFiles) {
            for (const m of text.matchAll(/uses: actions\/checkout@[^\n]*\n((?:[ \t]+[^\n]*\n)*)/g)) {
                const block = (m[1] ?? '').split('\n').filter((l) => l.trim() !== '' && !/^\s+- /.test(l));
                expect(block.some((l) => /persist-credentials:\s*false/.test(l)), `${label}: checkout keeps credentials`).toBe(true);
            }
            const top = /^permissions:[ \t]*\n((?:[ \t]+\S[^\n]*\n)*)/m.exec(text);
            expect(top, `${label}: no workflow-level permissions block`).not.toBeNull();
            for (const grant of (top?.[1] ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'))) {
                expect(grant, `${label}: workflow-level write`).toMatch(/^[a-z-]+:\s*read$/);
            }
            expect(text, `${label}: permissions: read-all`).not.toMatch(/^permissions:\s*read-all/m);
            for (const job of jobSteps(text).keys()) expect(jobBody(text, job), `${label} › ${job}`).toMatch(/timeout-minutes:\s*\d+/);
        }
    });

    it('starts every job with harden-runner: block with an allow-list, or audit with a dated reason', () => {
        for (const f of workflowFiles) {
            for (const [job, steps] of jobSteps(readWorkflow(f))) {
                const first = steps[0] ?? '';
                expect(first, `${f} › ${job}`).toContain(HARDEN_RUNNER);
                expect(first, `${f} › ${job}`).not.toMatch(/^\s+if:/m);
                if (/egress-policy:\s*block\s*$/m.test(first)) {
                    const list = /allowed-endpoints:\s*>\s*\n((?:[ \t]+[a-z0-9.-]+:\d+[ \t]*(?:\n|$))+)/.exec(first)?.[1] ?? '';
                    const endpoints = list.split('\n').map((l) => l.trim()).filter((l) => l !== '');
                    expect(endpoints.length, `${f} › ${job}`).toBeGreaterThan(0);
                    for (const e of endpoints) expect(e).toMatch(/^[a-z0-9.-]+:443$/);
                } else {
                    expect(first, `${f} › ${job}`).toMatch(/egress-policy:\s*audit\s*#\s*\d{4}-\d{2}-\d{2}:\s*\S/);
                }
            }
        }
    });

    it('installs dependencies with --ignore-scripts, everywhere', () => {
        for (const { label, text } of allFiles) {
            for (const m of text.matchAll(/\bnpm ci\b[^\n]*/g)) expect(m[0], label).toContain('--ignore-scripts');
            expect(text, `${label}: npm install outside the consumer checks`).not.toMatch(/run:\s*npm install\b/);
        }
        expect(readText('.npmrc')).toMatch(/^ignore-scripts=true$/m);
    });

    it('puts no ${{ }} expression inside a run: script (template injection)', () => {
        for (const { label, text } of allFiles) {
            for (const m of text.matchAll(/^(\s+)run:\s*\|?[^\n]*\n((?:\1\s+[^\n]*\n|\s*\n)*)/gm)) {
                const script = `${m[0]}`.split('\n').slice(0, 1).join('') + (m[2] ?? '');
                expect(script.includes('${{'), `${label}: an expression inside run:\n${script.slice(0, 200)}`).toBe(false);
            }
            for (const m of text.matchAll(/^\s+run:\s+(?!\|)([^\n]+)$/gm)) {
                expect((m[1] ?? '').includes('${{'), `${label}: ${m[1] ?? ''}`).toBe(false);
            }
        }
    });

    it('never filters by path (a filtered required check stays pending forever)', () => {
        for (const { label, text } of allFiles) expect(text, label).not.toMatch(/^\s+(paths|paths-ignore):/m);
    });
});

describe('the main ruleset', () => {
    it('requires exactly the checks the blocking workflows report, all from GitHub Actions', () => {
        const reportedContexts = new Set(['ci.yml', 'verazip.yml', 'sample-regression.yml', 'dependency-review.yml'].flatMap(reported));
        for (const r of required) {
            expect(r.integration_id, r.context).toBe(15368);
            expect(reportedContexts.has(r.context), `required "${r.context}" is reported by no workflow`).toBe(true);
        }
        const expected = ['ci (22)', 'ci (24)', 'windows (22)', 'windows (24)', 'macos (22)', 'workflow lint',
            'verazip-linux', 'verazip-windows', 'sample-regression (ubuntu-latest)', 'sample-regression (windows-latest)', 'dependency-review'];
        expect(required.map((r) => r.context).sort()).toEqual([...expected].sort());
    });

    it('requires CodeQL results and protects the default branch and the release tags', () => {
        const cs = ruleset.rules.find((r) => r.type === 'code_scanning')?.parameters?.code_scanning_tools ?? [];
        expect(cs).toEqual([{ tool: 'CodeQL', security_alerts_threshold: 'high_or_higher', alerts_threshold: 'errors' }]);
        for (const t of ['deletion', 'non_fast_forward', 'pull_request']) expect(ruleset.rules.some((r) => r.type === t), t).toBe(true);
        const tags = JSON.parse(readText('.github', 'rulesets', 'tags.json')) as { conditions: { ref_name: { include: string[] } }; rules: Array<{ type: string }> };
        expect(tags.conditions.ref_name.include).toEqual(['refs/tags/v*']);
        expect(tags.rules.map((r) => r.type).sort()).toEqual(['deletion', 'non_fast_forward', 'update']);
    });
});

describe('ci.yml', () => {
    const ci = readWorkflow('ci.yml');
    it('runs the gate once per leg with --require-all, audits once, and lists no gate step by hand', () => {
        expect(ci.match(/node scripts\/gate\.mjs --ci --require-all/g)).toHaveLength(1);
        expect(ci).toMatch(/audit: true/);
        expect(ci.match(/audit: true/g)).toHaveLength(1);
        for (const step of ['npm run typecheck', 'npm run lint', 'npm run build', 'test:coverage']) expect(ci, step).not.toContain(step);
    });

    it('lints the workflows with zizmor, a checksum-verified actionlint, and reuse', () => {
        expect(ci).toContain('zizmorcore/zizmor-action@');
        expect(ci).toMatch(/ACTIONLINT_SHA256: [0-9a-f]{64}/);
        expect(ci).toContain('sha256sum --check --strict');
        expect(ci).toMatch(/reuse lint/);
        expect(readText('REUSE.toml')).toMatch(/SPDX-License-Identifier = "MIT"/);
    });
});

describe('codeql.yml', () => {
    it('analyses the workflows and the TypeScript, without a build, with security-extended', () => {
        const text = readWorkflow('codeql.yml');
        expect(text).toContain('{ language: actions, build-mode: none }');
        expect(text).toContain('{ language: javascript-typescript, build-mode: none }');
        expect(text).toContain('queries: security-extended');
        expect(text).not.toContain('autobuild');
    });
});

describe('publish.yml', () => {
    const text = readWorkflow('publish.yml');
    const steps = jobSteps(text);

    it('starts from a published release or a manual run, never from a tag push, without an NPM_TOKEN', () => {
        expect(text).toMatch(/^on:\n {2}release:\n {4}types: \[published\]\n {2}workflow_dispatch:/m);
        expect(code(text)).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
    });

    it('runs guard → build → publish → attest, the npm-publish environment on one job, one release at a time', () => {
        expect([...steps.keys()]).toEqual(['guard', 'build', 'publish', 'attest']);
        expect(jobBody(text, 'build')).toMatch(/needs: guard/);
        expect(jobBody(text, 'publish')).toMatch(/needs: build/);
        expect(jobBody(text, 'attest')).toMatch(/needs: \[build, publish\]/);
        expect(text.match(/environment: npm-publish/g)).toHaveLength(1);
        expect(jobBody(text, 'publish')).toContain('environment: npm-publish');
        expect(text).toMatch(/concurrency:\n {2}group: publish\n {2}cancel-in-progress: false/);
    });

    it('holds id-token: write only where nothing from the dev toolchain runs', () => {
        for (const job of ['guard', 'build']) expect(code(jobBody(text, job)), job).not.toContain('id-token');
        expect(jobBody(text, 'publish')).toContain('id-token: write');
        expect(jobBody(text, 'attest')).toContain('id-token: write');
        expect(jobBody(text, 'publish')).toContain('sparse-checkout: .nvmrc');
        expect(jobBody(text, 'publish')).not.toMatch(/npm ci|npm run|scripts\//);
    });

    it('refuses a branch, a mismatched tag and a 0.x version before any approval', () => {
        const guard = jobBody(text, 'guard');
        expect(guard).not.toContain('environment:');
        expect(guard).toContain('"${GITHUB_REF_TYPE}" != "tag"');
        expect(guard).toContain('"${GITHUB_REF_NAME}" != "v${VERSION}"');
        expect(guard).toContain('"${VERSION%%.*}" = "0"');
    });

    it('restores no dependency cache in any release job, and builds on the .nvmrc line', () => {
        for (const m of text.matchAll(/uses: actions\/setup-node@[^\n]*\n((?:[ \t]+[^\n]*\n)*)/g)) {
            expect(m[1], 'setup-node in publish.yml').toContain('package-manager-cache: false');
            expect(m[1], 'setup-node in publish.yml').toContain('node-version-file: .nvmrc');
        }
        expect(text).not.toMatch(/cache: npm/);
    });

    it('runs the publish gate with --require-all, packs once and hands the tarball on with its digests', () => {
        expect(jobBody(text, 'build')).toContain('node scripts/gate.mjs --publish --require-all');
        expect(text.match(/npm pack --pack-destination/g)).toHaveLength(1);
        for (const out of ['tarball:', 'sha256:', 'integrity:']) expect(jobBody(text, 'build'), out).toContain(out);
    });

    it('uploads exactly the handed-on tarball, after both digests and its version, with a client pinned by content', () => {
        const publish = jobBody(text, 'publish');
        expect(publish).toContain('sha256sum --check --strict');
        expect(publish).toContain('openssl dgst -sha512');
        expect(publish).toContain('package/package.json');
        expect(publish).toMatch(/NPM_CLIENT_INTEGRITY: sha512-[A-Za-z0-9+/=]{88}/);
        expect(publish).toMatch(/publish "\.\/\$\{TARBALL\}" --provenance --access public/);
    });

    it('attests the bytes npm serves, with the SBOMs and the Sigstore bundle attached to the release', () => {
        const attest = jobBody(text, 'attest');
        expect(attest).toContain('npm pack "zipnative-cli@${VERSION}"');
        expect(attest).toContain('dist.integrity');
        expect(attest).toContain('npm audit signatures');
        for (const f of ['.cdx.json', '.spdx.json', '.toolchain.cdx.json', '.sigstore.json']) expect(attest, f).toContain(f);
        expect(attest).toContain('actions/attest-build-provenance@');
    });
});

describe('dependency hygiene', () => {
    it('reviews every pull request for high vulnerabilities and licences, the MPL exception named package by package', () => {
        const text = readWorkflow('dependency-review.yml');
        expect(text).toContain('fail-on-severity: high');
        expect(text).toMatch(/allow-licenses: MIT, ISC/);
        expect(text).toContain('pkg:npm/lightningcss,');
    });

    it('audits the lockfile weekly with npm audit and a pinned OSV-Scanner', () => {
        const text = readWorkflow('audit.yml');
        expect(text).toMatch(/schedule:\n\s+- cron:/);
        expect(text).toContain('npm audit --audit-level=moderate');
        expect(text).toMatch(/osv-scanner@v\d+\.\d+\.\d+/);
    });

    it('holds Dependabot back seven days, groups the actions, and lets the engine bump alone', () => {
        const text = readText('.github', 'dependabot.yml');
        expect(text.match(/cooldown:\n\s+default-days: 7/g)).toHaveLength(2);
        expect(text).toMatch(/exclude-patterns:\n\s+- "zipnative"/);
        expect(text).toMatch(/groups:\n\s+actions:/);
        expect(text).toMatch(/dependency-name: "@types\/node"\n\s+update-types: \["version-update:semver-major"\]/);
    });

    it('declares one runtime dependency, public access with provenance, a bin and no main', () => {
        const pkg = JSON.parse(readText('package.json')) as { dependencies: Record<string, string>; publishConfig: Record<string, unknown>; bin: Record<string, string>; main?: string; packageManager?: string };
        expect(Object.keys(pkg.dependencies)).toEqual(['zipnative']);
        expect(pkg.publishConfig).toEqual({ access: 'public', provenance: true });
        expect(pkg.bin).toEqual({ zipnative: './dist/cli.cjs' });
        expect(pkg.main).toBeUndefined();
        expect(pkg.packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
        expect(readText('.nvmrc').trim()).toBe(readText('.node-version').trim());
    });
});
