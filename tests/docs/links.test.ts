// Documentation integrity (ROADMAP "verify-docs"): every relative Markdown
// link in a tracked document resolves to a tracked path, every `#anchor`
// names a heading (GitHub slug rules) or an explicit `<a id>` of the target,
// and no tracked text file is stored with CRLF line endings (.gitattributes
// pins `eol=lf`; a CRLF sample or fixture silently changes archive bytes).
// Offline: external URLs are never fetched.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function git(args: readonly string[]): string {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : '';
}

const tracked = git(['ls-files', '-z']).split('\0').filter((f) => f.length > 0);
const trackedSet = new Set(tracked);
const trackedDirs = new Set(tracked.flatMap((f) => f.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
const markdown = tracked.filter((f) => f.endsWith('.md'));

/** Markdown with fenced blocks and inline code spans blanked (links there are examples). */
function prose(text: string): string {
    return text
        .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
        .replace(/`[^`\n]*`/g, '');
}

/** GitHub heading slug: lowercased rendered text, punctuation dropped, spaces → '-'. */
function slug(heading: string): string {
    const text = heading
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/[`*]/g, '')
        .trim()
        .toLowerCase();
    return text.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
}

const anchorCache = new Map<string, Set<string>>();
function anchorsOf(file: string): Set<string> {
    const cached = anchorCache.get(file);
    if (cached) return cached;
    const text = readFileSync(join(ROOT, file), 'utf8').replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
    const seen = new Map<string, number>();
    const out = new Set<string>();
    for (const m of text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm)) {
        const base = slug(m[1] as string);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        out.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const m of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1] as string);
    anchorCache.set(file, out);
    return out;
}

interface Link { readonly from: string; readonly target: string }

function relativeLinks(file: string): Link[] {
    const text = prose(readFileSync(join(ROOT, file), 'utf8'));
    const out: Link[] = [];
    const push = (raw: string): void => {
        const target = raw.trim().replace(/^<|>$/g, '').split(/\s+/)[0] ?? '';
        if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return;
        out.push({ from: file, target });
    };
    for (const m of text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) push(m[1] as string);
    for (const m of text.matchAll(/^\s*\[[^\]\n]+\]:\s*(\S+)/gm)) push(m[1] as string);
    for (const m of text.matchAll(/<a\s[^>]*href="([^"]+)"/g)) push(m[1] as string);
    return out;
}

function resolveLink(link: Link): string | undefined {
    const [pathPart = '', anchor] = link.target.split('#', 2) as [string, string | undefined];
    const decoded = decodeURI(pathPart);
    const file = decoded === '' ? link.from : normalize(join(dirname(link.from), decoded)).replace(/\\/g, '/').replace(/\/$/, '');
    if (file.startsWith('..')) return `${link.target}: escapes the repository`;
    // Tracked, or on disk (a new document not yet added); a CI checkout holds only tracked files.
    const isFile = trackedSet.has(file) || (existsSync(join(ROOT, file)) && statSync(join(ROOT, file)).isFile());
    if (!isFile && !trackedDirs.has(file) && file !== '.' && !existsSync(join(ROOT, file))) {
        return `${link.target}: ${file} does not exist`;
    }
    if (anchor !== undefined && anchor !== '' && isFile && file.endsWith('.md')) {
        if (!anchorsOf(file).has(decodeURIComponent(anchor).toLowerCase())) return `${link.target}: no heading or <a id> '#${anchor}' in ${file}`;
    }
    return undefined;
}

describe('documentation links (verify-docs)', () => {
    it('finds the tracked Markdown documents', () => {
        expect(markdown.length).toBeGreaterThan(20);
    });

    it('every relative link and anchor in a tracked .md resolves', () => {
        const broken = markdown.flatMap((f) => relativeLinks(f).map((l) => {
            const why = resolveLink(l);
            return why === undefined ? undefined : `${relative(ROOT, join(ROOT, l.from)).replace(/\\/g, '/')}: ${why}`;
        })).filter((x): x is string => x !== undefined);
        expect(broken).toEqual([]);
    });

    it('the slugger follows GitHub: punctuation dropped, spaces dashed, duplicates suffixed', () => {
        expect(slug('§4 — Command reference (`list`)')).toBe('4--command-reference-list');
        expect(slug('[Unreleased]')).toBe('unreleased');
        expect(slug('1.1.0 — 2026-10-18')).toBe('110--2026-10-18');
    });
});

describe('line endings', () => {
    it('no tracked text file is stored with CRLF in the index (.gitattributes eol=lf)', () => {
        const crlf = git(['ls-files', '--eol']).split('\n')
            .filter((l) => /^i\/(crlf|mixed)\b/.test(l))
            .map((l) => l.split('\t').pop());
        expect(crlf).toEqual([]);
    });
});
