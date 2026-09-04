// The flag table — the single answer to "does this flag take a value?".
//
// The zero-dep parser (utils/args.ts) has no per-command schema; historically
// every `--flag` consumed the next token unless it started with `-`, so a
// boolean such as `--json` or `--long` silently swallowed the positional that
// followed it (`zipnative --json list …` printed the help and exited 0;
// `list --long a.zip` read stdin instead of a.zip). This table lists every
// BOOLEAN flag of the CLI — global and per command — so the parser never
// consumes a value for them. Every other flag takes a value.
//
// Consistency is pinned by tests/docs/consistency.test.ts: a boolean flag must
// appear in its USAGE string without a `<value>` placeholder, and a value flag
// must appear with one, so the table cannot drift from the help text.

/** Global boolean flags (accepted by every command). */
export const GLOBAL_BOOLEAN_FLAGS: readonly string[] = [
    'help', 'h', 'version', 'V', 'json', 'dry-run', 'quiet', 'q', 'no-color', 'no-config',
    'pretty', 'strict', 'pure-codecs',
];

/** Per-command boolean flags (bare names, without the leading dashes). */
export const COMMAND_BOOLEAN_FLAGS: Readonly<Record<string, readonly string[]>> = {
    create: ['dir-entries', 'follow-symlinks', 'deterministic', 'mtime', 'preserve-mode', 'stream', 'parallel'],
    modify: ['deterministic', 'compact', 'in-place'],
    list: ['long', 'summary'],
    inspect: ['entries', 'extra', 'summary'],
    cat: ['raw', 'no-verify-crc'],
    extract: ['overwrite', 'skip-unsafe', 'allow-symlinks', 'skip-symlinks', 'flat', 'buffered', 'preserve-mode', 'preserve-mtime'],
    stream: ['list', 'long', 'overwrite', 'skip-unsafe', 'skip-unsupported', 'flat', 'preserve-mtime', 'summary'],
    verify: ['summary'],
    crc32: [],
    inflate: ['sync', 'allow-trailing'],
    batch: ['fail-fast', 'continue-on-error', 'allow-codec-load', 'summary', 'deterministic'],
    doctor: [],
    schema: [],
    completion: [],
    govern: [],
};

/** Every boolean flag name the parser must never read a value for. */
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
    ...GLOBAL_BOOLEAN_FLAGS,
    ...Object.values(COMMAND_BOOLEAN_FLAGS).flat(),
]);

/** True when `name` (bare, no dashes) is a boolean flag anywhere in the CLI. */
export function isBooleanFlag(name: string): boolean {
    return BOOLEAN_FLAGS.has(name);
}
