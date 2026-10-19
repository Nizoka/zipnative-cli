// Source hygiene: no tracked text file may carry a raw NUL, a C0 control
// other than TAB / LF / CR, a C1 control, or a Unicode bidi control. A NUL
// makes git and review tools treat a source as binary (an unreviewable
// diff); a bidi override makes code read differently from how it compiles
// (Trojan Source, CVE-2021-42574). Write such characters as escapes
// (`\u0000`, `\u202e`) — src/utils/sanitize.ts and src/utils/diagnostics.ts do.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const BINARY = /\.(zip|bin|png|jpg|jpeg|gif|ico|pdf|woff2?|gz|tgz|jar|epub|docx|xlsx|odt)$/i;

function trackedTextFiles(): string[] {
    const r = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) return [];
    return r.stdout.split('\0').filter((f) => f.length > 0 && !BINARY.test(f) && !f.startsWith('samples/input/binary/'));
}

function isForbidden(cp: number): boolean {
    return (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d)
        || (cp >= 0x7f && cp <= 0x9f)
        || cp === 0x061c || cp === 0x200e || cp === 0x200f
        || (cp >= 0x202a && cp <= 0x202e)
        || (cp >= 0x2066 && cp <= 0x2069);
}

describe('source hygiene (Trojan Source / NUL guard)', () => {
    const files = trackedTextFiles();

    it.skipIf(files.length === 0)('no tracked text file carries a raw control or bidi character', () => {
        const offenders: string[] = [];
        for (const f of files) {
            let text: string;
            try {
                text = readFileSync(join(ROOT, f), 'utf8');
            } catch {
                continue; // deleted in the working tree
            }
            let line = 1;
            for (const ch of text) {
                const cp = ch.codePointAt(0) as number;
                if (cp === 0x0a) line++;
                if (isForbidden(cp)) {
                    offenders.push(`${f}:${line} U+${cp.toString(16).padStart(4, '0')}`);
                    break;
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
