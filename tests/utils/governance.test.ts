import { describe, it, expect } from 'vitest';
import {
    validateGovernanceDraft,
    AI_GOVERNANCE_POLICY,
    AGENT_RULES_TEXT,
} from '../../src/utils/governance.js';

const REPRO = '\n\n```\nrepro\n```\n';

describe('validateGovernanceDraft', () => {
    const goodDraft = `# Bug: extraction fails

## Environment
Node 22, Windows 11, zipnative-cli 1.0.0.

## Expected behavior
It should extract.

## Reproduction
\`\`\`sh
zipnative extract a.zip -d out
\`\`\`
`;

    it('passes a compliant draft with no warnings', () => {
        const r = validateGovernanceDraft(goodDraft);
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
        expect(r.warnings).toHaveLength(0);
    });

    it('fails when a runtime dependency is proposed', () => {
        const r = validateGovernanceDraft('Please run `npm install lodash`.' + REPRO);
        expect(r.ok).toBe(false);
        expect(r.errors).toHaveLength(1);
        expect(r.errors.join(' ')).toMatch(/zero-dependency/i);
    });

    it.each([
        'npm i yauzl',
        'npm add adm-zip',
        'yarn add left-pad',
        'pnpm add chalk',
        'pnpm install fflate',
        'bun add zod',
        'add `axios` to the runtime dependencies',
        'add "fflate" to dependencies',
        '"dependencies": { "fflate": "^0.8.0" }',
    ])('flags dependency phrasing %j', (line) => {
        const r = validateGovernanceDraft(`${line}${REPRO}`);
        expect(r.ok).toBe(false);
    });

    it('does not flag npm install with only flags, or devDependencies talk without a block', () => {
        expect(validateGovernanceDraft('run `npm install --frozen-lockfile`' + REPRO).ok).toBe(true);
        expect(validateGovernanceDraft('npm install' + REPRO).ok).toBe(true);
    });

    it('reports the dependency error only once even when several patterns match', () => {
        const r = validateGovernanceDraft('npm install a\nyarn add b\npnpm add c' + REPRO);
        expect(r.errors.filter((e) => /zero-dependency/.test(e))).toHaveLength(1);
    });

    it('fails when no reproduction code block is present', () => {
        const r = validateGovernanceDraft('A bug with expected behaviour on node 22.');
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/reproduction code block/i);
    });

    it('collects both errors at once', () => {
        const r = validateGovernanceDraft('yarn add x — no block here');
        expect(r.errors).toHaveLength(2);
    });

    it('warns about each missing recommended field', () => {
        const r = validateGovernanceDraft('```\nrepro here\n```');
        expect(r.ok).toBe(true);
        // "repro" satisfies minimal_reproduction; environment and expected are missing.
        expect(r.warnings.filter((w) => /Recommended field/.test(w)).sort()).toEqual([
            'Recommended field appears to be missing: environment.',
            'Recommended field appears to be missing: expected_behavior.',
        ]);
    });

    it('warns about minimal_reproduction when the word never appears', () => {
        const r = validateGovernanceDraft('```\nx\n```\nexpected on node');
        expect(r.warnings).toContain('Recommended field appears to be missing: minimal_reproduction.');
    });

    describe('anti-goal warnings (advisory, never errors)', () => {
        it.each([
            ['add AES password support', 'encryption'],
            ['implement zipcrypto decryption', 'encryption'],
            ['please support encrypt on write', 'encryption'],
            ['add support for 7z output', 'other archive formats'],
            ['implement tar and gzip', 'other archive formats'],
            ['support zstd entries', 'other archive formats'],
            ['handle multi-disk archives', 'multi-disk archives'],
            ['spanned archives should open', 'multi-disk archives'],
            ['split archive support', 'multi-disk archives'],
            ['repair a corrupt archive', 'archive repair'],
            ['when the archive is damaged, attempt a repair', 'archive repair'],
        ])('warns for %j as %s', (line, key) => {
            const r = validateGovernanceDraft(`${goodDraft}\n${line}\n`);
            expect(r.ok).toBe(true);
            expect(r.errors).toHaveLength(0);
            const hit = r.warnings.find((w) => w.includes(`anti-goal (${key})`));
            expect(hit, r.warnings.join(' | ')).toBeDefined();
            expect(hit).toMatch(/What zipnative will NOT do/);
        });

        it('does not warn about anti-goals for a neutral draft', () => {
            const r = validateGovernanceDraft(goodDraft);
            expect(r.warnings.filter((w) => /anti-goal/.test(w))).toEqual([]);
        });

        it('can surface several anti-goals at once', () => {
            const r = validateGovernanceDraft(`${goodDraft}\nadd AES password support and multi-disk archives\n`);
            const keys = r.warnings.filter((w) => /anti-goal/.test(w));
            expect(keys.length).toBe(2);
        });
    });

    it('returns readonly-shaped results with stable keys', () => {
        const r = validateGovernanceDraft(goodDraft);
        expect(Object.keys(r).sort()).toEqual(['errors', 'ok', 'warnings']);
    });
});

describe('governance constants', () => {
    it('applies to the whole zipnative ecosystem', () => {
        expect([...AI_GOVERNANCE_POLICY.applies_to]).toEqual(['zipnative', 'zipnative-cli', 'zipnative-mcp']);
    });

    it('exposes the HITL and zero-dependency policy', () => {
        expect(AI_GOVERNANCE_POLICY.policy.human_in_the_loop_mandatory).toBe(true);
        expect(AI_GOVERNANCE_POLICY.policy.runtime_dependencies_allowed).toBe(false);
        expect(AI_GOVERNANCE_POLICY.policy.automatic_issue_reporting).toBe(false);
        expect(AI_GOVERNANCE_POLICY.policy.autonomous_github_writes_allowed).toBe(false);
        expect(AI_GOVERNANCE_POLICY.policy.security_default_weakening_requires_human).toBe(true);
        expect(AI_GOVERNANCE_POLICY.policy.deterministic_bytes_are_semver_major).toBe(true);
        expect([...AI_GOVERNANCE_POLICY.policy.required_issue_fields]).toEqual([
            'minimal_reproduction', 'environment', 'expected_behavior',
        ]);
    });

    it('lists the documented anti-goals and the verification command', () => {
        expect(AI_GOVERNANCE_POLICY.anti_goals.some((g) => /encryption/.test(g))).toBe(true);
        expect(AI_GOVERNANCE_POLICY.anti_goals.some((g) => /multi-disk/.test(g))).toBe(true);
        expect(AI_GOVERNANCE_POLICY.anti_goals.some((g) => /repair/.test(g))).toBe(true);
        expect(AI_GOVERNANCE_POLICY.verification.command).toBe('zipnative govern verify-issue <draft.md>');
        expect(AI_GOVERNANCE_POLICY.verification.blocks_submission_on_failure).toBe(true);
        expect(AI_GOVERNANCE_POLICY.human_in_the_loop.role_of_agent).toBe('draftsman');
        expect(AI_GOVERNANCE_POLICY.version).toBe('1.0.0');
    });

    it('is frozen', () => {
        expect(Object.isFrozen(AI_GOVERNANCE_POLICY)).toBe(true);
    });

    it('documents the draftsman role and the verify command in the rules text', () => {
        expect(AGENT_RULES_TEXT).toMatch(/DRAFTSMAN/);
        expect(AGENT_RULES_TEXT).toMatch(/zipnative govern verify-issue/);
        expect(AGENT_RULES_TEXT).toMatch(/Zero runtime dependencies/);
        expect(AGENT_RULES_TEXT).toMatch(/Human-in-the-loop gate/);
        expect(AGENT_RULES_TEXT).toMatch(/No anti-goals/);
    });
});
