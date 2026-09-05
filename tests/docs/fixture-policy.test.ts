// Guards the rules in tests/fixtures/README.md: every committed archive has
// foreign provenance recorded in the ledger, the corpus stays tiny, and no
// adversarial (CLI- or engine-buildable) archive is ever committed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures');
const MAX_FIXTURE_BYTES = 20 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024;

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            out.push(...walk(path));
        } else {
            out.push(path);
        }
    }
    return out;
}

describe('fixture policy (tests/fixtures/README.md)', () => {
    const files = walk(FIXTURES_ROOT).filter((p) => !p.endsWith('README.md') && !p.endsWith('.gitkeep'));
    const archives = files.filter((p) => p.toLowerCase().endsWith('.zip'));
    const ledger = readFileSync(join(FIXTURES_ROOT, 'README.md'), 'utf8');

    it('ships the two foreign interop archives', () => {
        const names = archives.map((p) => p.split(/[\\/]/).pop() as string).sort();
        expect(names).toEqual(['bsdtar-basic.zip', 'powershell-compress-archive-basic.zip']);
    });

    it('every committed fixture stays under the 20 KB budget', () => {
        for (const file of files) {
            expect(statSync(file).size, `${file} exceeds the fixture budget`).toBeLessThanOrEqual(MAX_FIXTURE_BYTES);
        }
    });

    it('the whole corpus stays within 20 KB in total', () => {
        const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
        expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    });

    it('every committed archive is listed in the provenance ledger', () => {
        for (const file of archives) {
            const basename = file.split(/[\\/]/).pop() as string;
            expect(ledger.includes(basename), `${file} is missing from the provenance ledger`).toBe(true);
        }
    });

    it('only ZIP archives are committed as binary fixtures', () => {
        const others = files.filter((p) => !p.toLowerCase().endsWith('.zip'));
        expect(others).toEqual([]);
    });

    it('no adversarial directory holds committed files (generated-only policy)', () => {
        const adversarial = files.filter((p) => /[\\/]adversarial[\\/]/.test(p));
        expect(adversarial).toEqual([]);
    });

    it('the ledger states the foreign-provenance rule and the generated-only rule', () => {
        expect(ledger).toMatch(/provenance is foreign/i);
        expect(ledger).toMatch(/raw-zip-builder/);
        expect(ledger).toMatch(/never committed/i);
    });
});
