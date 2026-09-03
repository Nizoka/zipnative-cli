// AI-governance / Human-in-the-Loop (HITL) contract.
//
// The zipnative ecosystem (core, CLI, MCP) is built under a governance policy
// in which AI coding agents act as *draftsmen*, never autonomous submitters.
// Every issue / PR / release must be reviewed and triggered by a human, no
// runtime dependency may be added, no security default may be weakened
// without a recorded human decision, and a local reproduction must accompany
// any bug report.
//
// This module makes that contract a first-class CLI capability: agents driving
// `zipnative-cli` can emit the policy, print the human/agent rules, and — most
// importantly — validate a draft issue/PR against the policy BEFORE a human
// reviews and submits it. The validation logic is a pure, zero-dependency
// port of zipnative's `scripts/verify-issue.mjs`.

/** Machine-readable governance policy (mirrors `.github/ai-governance.json`). */
export const AI_GOVERNANCE_POLICY = Object.freeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'zipnative AI Governance Configuration',
    description:
        'Machine-readable contract governing how AI coding agents may propose issues, '
        + 'contributions, and changes across the zipnative ecosystem. Agents that scan '
        + 'repository configuration on initialization MUST honour this file.',
    version: '1.0.0',
    applies_to: ['zipnative', 'zipnative-cli', 'zipnative-mcp'],
    policy: {
        automatic_issue_reporting: false,
        runtime_dependencies_allowed: false,
        human_in_the_loop_mandatory: true,
        autonomous_github_writes_allowed: false,
        security_default_weakening_requires_human: true,
        deterministic_bytes_are_semver_major: true,
        required_issue_fields: ['minimal_reproduction', 'environment', 'expected_behavior'],
    },
    anti_goals: [
        'encryption (read or write) in 1.x',
        'other archive formats or exotic codecs shipped by the engine',
        'multi-disk / spanned archives',
        'archive repair',
        'filesystem or network I/O inside the engine',
    ],
    human_in_the_loop: {
        role_of_agent: 'draftsman',
        gate:
            'A human MUST explicitly review, sign off on, and trigger any GitHub issue, '
            + 'comment, PR, or release. The agent\'s authority ends at producing a local '
            + 'draft plus a compliance report.',
        identity_integrity:
            'Any issue or PR is published under the human user\'s GitHub identity. The '
            + 'agent MUST remind the user of their shared responsibility for the content '
            + 'before submission.',
        draft_location: '.github/drafts/',
    },
    pre_issue_checklist: [
        'no_duplicate_open_or_closed_issue',
        'zero_runtime_dependency_preserved',
        'no_anti_goal_proposed',
        'no_security_default_weakened',
        'local_minimal_reproduction_executed',
        'expected_vs_actual_documented',
        'environment_captured',
    ],
    compliance_report: {
        required_fields: [
            'zero_dependency_confirmed',
            'reproduction_command',
            'reproduction_result',
            'duplicate_search_performed',
            'affected_packages',
            'identity_reminder_shown',
        ],
    },
    verification: {
        command: 'zipnative govern verify-issue <draft.md>',
        blocks_submission_on_failure: true,
    },
} as const);

/** Human-and-agent-readable protocol (mirrors `.github/AGENT_RULES.md`). */
export const AGENT_RULES_TEXT = `\
# AI Agent Rules for the zipnative ecosystem

You are an AI assistant helping a user develop or fix zipnative (or its CLI
or MCP packages). You act as a DRAFTSMAN, never as an autonomous submitter.

## Mandatory pre-issue rules

1. Zero runtime dependencies. Never suggest, add, or import an external npm
   package for a runtime feature. This is a non-negotiable blocker.
2. No duplicates. Search open AND closed issues/PRs before proposing anything.
3. Local validation & reproduction. Create and EXECUTE a minimal reproduction
   locally (an archive, or a script that crafts one). If it does not fail, do
   not propose an issue.
4. Byte-identity awareness. Bytes written under \`deterministic: true\` are a
   frozen semver contract; any intentional byte change is a MAJOR bump.
5. Never weaken a security default. rejectTraversal, rejectSymlinks,
   onDuplicate, every ZipLimits bound, and the CLI's extraction-sink
   containment stay as they are unless a human records the decision.
6. No anti-goals. Do not propose encryption, other archive formats,
   multi-disk archives, archive repair, or filesystem/network I/O inside the
   engine — these are documented non-goals.
7. Human-in-the-loop gate (ethics). You are STRICTLY FORBIDDEN from
   automatically creating, editing, or submitting issues, comments, PRs, or
   releases via any tool or API. Produce a local markdown draft and present it
   to the user with a compliance report. The user must explicitly approve and
   trigger any submission.
8. Identity integrity. Remind the user that anything submitted is published
   under THEIR GitHub identity and that they share responsibility for it.

## Validate a draft before presenting it

    zipnative govern verify-issue ./draft.md

A passing check is NECESSARY BUT NOT SUFFICIENT — the human review gate above
always applies.

## What agents must NOT do

- Add a runtime dependency.
- Weaken a security default or change deterministic bytes silently.
- Open, edit, label, close, or comment on issues/PRs autonomously.
- Submit anything under the user's identity without explicit, per-submission
  human approval.
- Bypass local validation or duplicate checks.
`;

/** Result of validating a draft issue/PR against the governance policy. */
export interface GovernanceValidation {
    readonly ok: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
}

/** Patterns that indicate an external runtime dependency is being proposed. */
const DEPENDENCY_PATTERNS: readonly RegExp[] = [
    /\bnpm\s+(install|i|add)\s+(?!--)[a-z@]/i,
    /\b(yarn|pnpm|bun)\s+add\s+/i,
    /\bpnpm\s+install\s+[a-z@]/i,
    /add\s+[`"']?[\w@/-]+[`"']?\s+to\s+(the\s+)?(runtime\s+)?dependencies\b/i,
    /"dependencies"\s*:\s*\{[^}]*[\w-]+[^}]*\}/i,
];

/** Anti-goal proposals (advisory — surfaced as warnings). */
const ANTI_GOAL_PATTERNS: readonly { key: string; re: RegExp }[] = [
    { key: 'encryption', re: /\b(add|implement|support)\b[^.\n]{0,60}\b(aes|zipcrypto|password|encrypt)/i },
    { key: 'other archive formats', re: /\b(add|implement|support)\b[^.\n]{0,60}\b(7z|rar|tar|gzip|zstd|bzip2|xz)\b/i },
    { key: 'multi-disk archives', re: /\b(multi-?disk|spanned|split archive)/i },
    { key: 'archive repair', re: /\brepair\b[^.\n]{0,40}\barchive|\barchive\b[^.\n]{0,40}\brepair\b/i },
];

/** Required issue fields (advisory — surfaced as warnings when missing). */
const REQUIRED_FIELDS: readonly { key: string; re: RegExp }[] = [
    { key: 'minimal_reproduction', re: /repro|reproduc/i },
    { key: 'environment', re: /environment|version|node|os\b/i },
    { key: 'expected_behavior', re: /expected/i },
];

/**
 * Validate a draft issue/PR markdown against the AI-governance policy.
 *
 * Errors (fail): proposing an external runtime dependency, or missing a
 * reproduction code block. Warnings (advisory): a recommended field appears
 * to be missing, or the draft reads like an anti-goal proposal. A pure
 * function — no filesystem access — so it is trivially testable and reusable.
 */
export function validateGovernanceDraft(content: string): GovernanceValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const re of DEPENDENCY_PATTERNS) {
        if (re.test(content)) {
            errors.push('Proposing an external dependency violates the zero-dependency policy.');
            break;
        }
    }

    if (!/```[\s\S]*?```/.test(content)) {
        errors.push('No reproduction code block found — include a minimal repro inside a fenced ``` block.');
    }

    for (const field of REQUIRED_FIELDS) {
        if (!field.re.test(content)) {
            warnings.push(`Recommended field appears to be missing: ${field.key}.`);
        }
    }

    for (const goal of ANTI_GOAL_PATTERNS) {
        if (goal.re.test(content)) {
            warnings.push(`Draft appears to propose a documented anti-goal (${goal.key}) — see zipnative README "What zipnative will NOT do".`);
        }
    }

    return { ok: errors.length === 0, errors, warnings };
}
