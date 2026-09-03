// Minimal, dependency-free glob matcher for archive entry names.
//
// Names are `/`-separated (archive convention). Supported syntax:
//   **      any number of segments (also matches zero segments when written `**/`)
//   *       any run of characters within a segment
//   ?       exactly one character within a segment
//   [abc]   character class (passed through to the regex)
// Everything else is matched literally. A pattern without `/` matches at any
// depth (`*.txt` ≡ `**/*.txt`); a pattern ending in `/` matches the whole
// subtree of that directory. Matching is case-sensitive.

const RE_SPECIAL = /[.+^${}()|\\]/g;

function escapeLiteral(s: string): string {
    return s.replace(RE_SPECIAL, '\\$&');
}

/** Compile a glob pattern into an anchored RegExp over `/`-separated names. */
export function compileGlob(pattern: string): RegExp {
    let p = pattern.replace(/\\/g, '/');
    if (p.startsWith('./')) p = p.slice(2);
    let source = '';
    let anyDepth = !p.includes('/');
    if (p.endsWith('/')) {
        p = p.slice(0, -1);
        source = '(?:/.*)?';
        anyDepth = false;
    }
    let body = '';
    for (let i = 0; i < p.length; i++) {
        const c = p[i] as string;
        if (c === '*') {
            if (p[i + 1] === '*') {
                // `**` — optionally followed by `/`
                i++;
                if (p[i + 1] === '/') {
                    i++;
                    body += '(?:.*/)?';
                } else {
                    body += '.*';
                }
            } else {
                body += '[^/]*';
            }
        } else if (c === '?') {
            body += '[^/]';
        } else if (c === '[') {
            const end = p.indexOf(']', i + 1);
            if (end === -1) {
                body += '\\[';
            } else {
                body += p.slice(i, end + 1);
                i = end;
            }
        } else {
            body += escapeLiteral(c);
        }
    }
    const prefix = anyDepth ? '(?:.*/)?' : '';
    return new RegExp(`^${prefix}${body}${source}$`);
}

export type NameFilter = (name: string) => boolean;

/**
 * Build a predicate from include/exclude globs:
 *   (no includes OR any include matches) AND no exclude matches.
 * Directory entries (`dir/`) are matched with and without the trailing slash.
 */
export function buildFilter(includes: readonly string[], excludes: readonly string[]): NameFilter {
    const inc = includes.map(compileGlob);
    const exc = excludes.map(compileGlob);
    return (name: string): boolean => {
        const n = name.replace(/\\/g, '/');
        const bare = n.endsWith('/') ? n.slice(0, -1) : n;
        const test = (re: RegExp): boolean => re.test(n) || re.test(bare);
        if (inc.length > 0 && !inc.some(test)) return false;
        if (exc.some(test)) return false;
        return true;
    };
}

/** True when neither includes nor excludes are set (fast path for callers). */
export function isPassThrough(includes: readonly string[], excludes: readonly string[]): boolean {
    return includes.length === 0 && excludes.length === 0;
}
