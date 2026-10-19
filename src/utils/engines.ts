// A minimal evaluator for the version ranges this package states: `^x.y.z`,
// `>=x.y.z` (a bare major `>=22` is `>=22.0.0`), `x.y.z`, joined by `||`.
// Enough for `engines.node`; anything else is refused rather than guessed.
// Ported from pkinative-cli (src/utils/engines.ts).

type Version = readonly [number, number, number];

export function parseVersion(text: string): Version | undefined {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text.trim());
    if (m === null) return undefined;
    return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function compare(a: Version, b: Version): number {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function satisfiesOne(v: Version, clause: string): boolean {
    const c = clause.trim();
    const base = parseVersion(c.replace(/^(\^|>=)/, ''));
    if (base === undefined) throw new Error(`Unsupported version range clause "${c}".`);
    if (c.startsWith('>=')) return compare(v, base) >= 0;
    if (c.startsWith('^')) {
        if (compare(v, base) < 0) return false;
        // ^0.y.z pins the minor; ^x.y.z (x > 0) pins the major.
        return base[0] === 0 ? v[0] === 0 && v[1] === base[1] : v[0] === base[0];
    }
    return compare(v, base) === 0;
}

/** True when `version` satisfies `range` (`>=22`, `^22.11.0 || >=24`). */
export function satisfies(version: string, range: string): boolean {
    const v = parseVersion(version);
    if (v === undefined) return false;
    return range.split('||').some((clause) => satisfiesOne(v, clause));
}
