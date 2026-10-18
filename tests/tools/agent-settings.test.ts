import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── The shared Claude Code settings ───────────────────────────────────
//
// `.claude/settings.json` is tracked: it is the part of the agent layer
// every contributor's Claude Code session loads. Two things in it are the
// repository's rules, not a preference, so they are pinned here: commits and
// pull requests carry no AI attribution, and the shell tools cannot perform
// a GitHub or npm write (AGENT_RULES.md: an agent drafts, a human submits).
// Per-machine allowances go in `.claude/settings.local.json`, git-ignored.

interface Settings {
    readonly attribution?: { readonly commit?: string; readonly pr?: string };
    readonly hooks?: unknown;
    readonly permissions?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
}

const ROOT = process.cwd();
const settings = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8')) as Settings;
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').replace(/\r\n/g, '\n');

/** The write families a session must never perform; each as the prefix the rule starts with. */
const HITL_DENIED = ['npm publish', 'git push', 'git tag', 'gh pr create', 'gh pr merge', 'gh issue create', 'gh release', 'gh api *--method POST'];

describe('.claude/settings.json', () => {
    it('turns attribution off for commits and pull requests', () => {
        expect(settings.attribution).toEqual({ commit: '', pr: '' });
    });

    it('declares no hook (the guard hook is a maintainer decision, ROADMAP)', () => {
        expect(settings.hooks).toBeUndefined();
    });

    it('denies every HITL write family for both shell tools', () => {
        const deny = settings.permissions?.deny ?? [];
        for (const shell of ['Bash', 'PowerShell']) {
            for (const family of HITL_DENIED) {
                const hit = deny.some((rule) => rule.startsWith(`${shell}(${family}`));
                expect(hit, `${shell}(${family}…) must be denied`).toBe(true);
            }
        }
    });

    it('allows nothing that a deny rule names', () => {
        const allow = settings.permissions?.allow ?? [];
        for (const rule of allow) {
            for (const family of HITL_DENIED) {
                expect(rule, `${rule} overlaps a denied family`).not.toContain(family);
            }
        }
    });

    it('is tracked while the per-machine file and the audit ledgers are ignored', () => {
        expect(gitignore).not.toMatch(/^\.claude\/?$/m);
        expect(gitignore).toMatch(/^\.claude\/settings\.local\.json$/m);
        expect(gitignore).toMatch(/^\.audit\/$/m);
    });
});
