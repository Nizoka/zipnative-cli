// The governance contract exists twice by design — once for agents that scan
// the repository (`.github/ai-governance.json`, `.github/AGENT_RULES.md`) and
// once inside the CLI (`govern policy` / `govern rules`). These tests pin the
// two copies to each other so neither can drift silently.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_GOVERNANCE_POLICY, AGENT_RULES_TEXT } from '../../src/utils/governance.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('governance sync', () => {
    it('AI_GOVERNANCE_POLICY deep-equals .github/ai-governance.json', () => {
        const file = JSON.parse(readFileSync(join(ROOT, '.github', 'ai-governance.json'), 'utf8')) as unknown;
        expect(JSON.parse(JSON.stringify(AI_GOVERNANCE_POLICY))).toEqual(file);
    });

    it('every numbered rule and every "must NOT" bullet of AGENT_RULES_TEXT appears verbatim in .github/AGENT_RULES.md', () => {
        const md = readFileSync(join(ROOT, '.github', 'AGENT_RULES.md'), 'utf8').replace(/\r\n/g, '\n');
        const section = (text: string, heading: string): string => {
            const start = text.indexOf(heading);
            expect(start, heading).toBeGreaterThanOrEqual(0);
            const rest = text.slice(start + heading.length);
            const next = rest.search(/\n## /);
            return (next === -1 ? rest : rest.slice(0, next)).trim();
        };
        // Rules 1–8 (multi-line items) and the must-not bullets, line by line.
        const rules = section(AGENT_RULES_TEXT, '## Mandatory pre-issue rules');
        const mustNot = section(AGENT_RULES_TEXT, '## What agents must NOT do');
        expect(rules.match(/^\d+\. /gm)).toHaveLength(8);
        expect(mustNot.match(/^- /gm)?.length).toBeGreaterThanOrEqual(5);
        for (const line of [...rules.split('\n'), ...mustNot.split('\n')]) {
            if (line.trim().length === 0) continue;
            expect(md, line).toContain(line);
        }
        // The markdown keeps the same sections, in the same order.
        expect(md.indexOf('## Mandatory pre-issue rules')).toBeLessThan(md.indexOf('## What agents must NOT do'));
        expect(md).toContain('zipnative govern verify-issue');
    });

    it('the capability manifest names files that exist in this repository', () => {
        for (const source of AI_GOVERNANCE_POLICY.capability_manifest.sources) {
            expect(() => readFileSync(join(ROOT, source)), source).not.toThrow();
        }
    });
});
