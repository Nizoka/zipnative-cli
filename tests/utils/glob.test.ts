import { describe, it, expect } from 'vitest';
import { compileGlob, buildFilter, isPassThrough } from '../../src/utils/glob.js';

describe('compileGlob', () => {
    it('returns an anchored RegExp', () => {
        const re = compileGlob('a.txt');
        expect(re).toBeInstanceOf(RegExp);
        expect(re.source.startsWith('^')).toBe(true);
        expect(re.source.endsWith('$')).toBe(true);
    });

    it('*.txt matches at any depth but not across segments', () => {
        const re = compileGlob('*.txt');
        expect(re.test('a.txt')).toBe(true);
        expect(re.test('dir/a.txt')).toBe(true);
        expect(re.test('dir/sub/deep/a.txt')).toBe(true);
        expect(re.test('a.txt.bak')).toBe(false);
        expect(re.test('atxt')).toBe(false);
        expect(re.test('a.txt/x')).toBe(false);
    });

    it('data/* matches exactly one level below data', () => {
        const re = compileGlob('data/*');
        expect(re.test('data/a')).toBe(true);
        expect(re.test('data/a.bin')).toBe(true);
        expect(re.test('data/a/b')).toBe(false);
        expect(re.test('other/data/a')).toBe(false);
        expect(re.test('data')).toBe(false);
    });

    it('data/** matches the whole subtree', () => {
        const re = compileGlob('data/**');
        expect(re.test('data/a')).toBe(true);
        expect(re.test('data/a/b/c')).toBe(true);
        expect(re.test('data/')).toBe(true);
        expect(re.test('data')).toBe(false);
        expect(re.test('xdata/a')).toBe(false);
    });

    it('**/*.bin matches at the root and at any depth', () => {
        const re = compileGlob('**/*.bin');
        expect(re.test('x.bin')).toBe(true);
        expect(re.test('a/x.bin')).toBe(true);
        expect(re.test('a/b/c/x.bin')).toBe(true);
        expect(re.test('a/b/x.txt')).toBe(false);
    });

    it('** in the middle spans zero or more segments', () => {
        const re = compileGlob('src/**/test.ts');
        expect(re.test('src/test.ts')).toBe(true);
        expect(re.test('src/a/test.ts')).toBe(true);
        expect(re.test('src/a/b/test.ts')).toBe(true);
        expect(re.test('lib/a/test.ts')).toBe(false);
    });

    it('? matches exactly one non-separator character', () => {
        const re = compileGlob('a?.txt');
        expect(re.test('ab.txt')).toBe(true);
        expect(re.test('a.txt')).toBe(false);
        expect(re.test('abc.txt')).toBe(false);
        expect(re.test('a/.txt')).toBe(false);
    });

    it('[ab] character classes pass through', () => {
        const re = compileGlob('file[ab].txt');
        expect(re.test('filea.txt')).toBe(true);
        expect(re.test('fileb.txt')).toBe(true);
        expect(re.test('filec.txt')).toBe(false);
        const range = compileGlob('v[0-9].zip');
        expect(range.test('v7.zip')).toBe(true);
        expect(range.test('vx.zip')).toBe(false);
    });

    it('an unclosed [ is matched literally', () => {
        const re = compileGlob('file[.txt');
        expect(re.test('file[.txt')).toBe(true);
        expect(re.test('filea.txt')).toBe(false);
    });

    it('a trailing / matches the directory and its whole subtree', () => {
        const re = compileGlob('docs/');
        expect(re.test('docs')).toBe(true);
        expect(re.test('docs/')).toBe(true);
        expect(re.test('docs/a')).toBe(true);
        expect(re.test('docs/a/b.md')).toBe(true);
        expect(re.test('docs2/a')).toBe(false);
        expect(re.test('x/docs/a')).toBe(false);
    });

    it('is case-sensitive', () => {
        expect(compileGlob('*.TXT').test('a.txt')).toBe(false);
        expect(compileGlob('README').test('readme')).toBe(false);
    });

    it('escapes regex metacharacters in literals', () => {
        expect(compileGlob('a+b(c).txt').test('a+b(c).txt')).toBe(true);
        expect(compileGlob('a+b(c).txt').test('aab(c).txt')).toBe(false);
        expect(compileGlob('x.y').test('xzy')).toBe(false);
        expect(compileGlob('$a^b').test('$a^b')).toBe(true);
    });

    it('normalises backslashes and strips a leading ./', () => {
        expect(compileGlob('data\\*').test('data/a')).toBe(true);
        expect(compileGlob('./data/*').test('data/a')).toBe(true);
        expect(compileGlob('./*.txt').test('deep/a.txt')).toBe(true);
    });

    it('a pattern containing / is anchored at the root', () => {
        expect(compileGlob('src/a.ts').test('src/a.ts')).toBe(true);
        expect(compileGlob('src/a.ts').test('x/src/a.ts')).toBe(false);
    });
});

describe('buildFilter', () => {
    it('accepts everything when no globs are given', () => {
        const f = buildFilter([], []);
        expect(f('a')).toBe(true);
        expect(f('x/y/z')).toBe(true);
    });

    it('requires at least one include to match', () => {
        const f = buildFilter(['*.txt', '*.md'], []);
        expect(f('a.txt')).toBe(true);
        expect(f('d/b.md')).toBe(true);
        expect(f('c.bin')).toBe(false);
    });

    it('rejects anything an exclude matches', () => {
        const f = buildFilter([], ['secret*', 'tmp/']);
        expect(f('a.txt')).toBe(true);
        expect(f('secret.txt')).toBe(false);
        expect(f('x/secret-1.bin')).toBe(false);
        expect(f('tmp/a')).toBe(false);
        expect(f('tmp')).toBe(false);
    });

    it('combines includes and excludes (include AND NOT exclude)', () => {
        const f = buildFilter(['*.txt'], ['secret*']);
        expect(f('a.txt')).toBe(true);
        expect(f('secret.txt')).toBe(false);
        expect(f('a.bin')).toBe(false);
    });

    it('matches directory entries with and without the trailing slash', () => {
        const f = buildFilter(['data'], []);
        expect(f('data/')).toBe(true);
        expect(f('data')).toBe(true);
        const g = buildFilter(['data/'], []);
        expect(g('data/')).toBe(true);
        expect(g('data/x')).toBe(true);
    });

    it('normalises backslashes in the tested name', () => {
        const f = buildFilter(['data/*'], []);
        expect(f('data\\a')).toBe(true);
    });

    it('is case-sensitive', () => {
        const f = buildFilter(['*.txt'], []);
        expect(f('A.TXT')).toBe(false);
    });
});

describe('isPassThrough', () => {
    it('is true only when both lists are empty', () => {
        expect(isPassThrough([], [])).toBe(true);
        expect(isPassThrough(['*'], [])).toBe(false);
        expect(isPassThrough([], ['*'])).toBe(false);
        expect(isPassThrough(['a'], ['b'])).toBe(false);
    });
});
