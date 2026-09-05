import { CliError } from './error.js';
import { BOOLEAN_FLAGS } from './flags.js';

export interface ParsedArgs {
    readonly flags: Record<string, string | boolean | readonly string[]>;
    readonly positionals: readonly string[];
}

export interface ParseOptions {
    /**
     * Flags that never take a value (bare names). Defaults to the CLI's own
     * table (utils/flags.ts) so `--json list` and `list --long a.zip` keep the
     * positional. Pass an empty set to get the value-greedy legacy behaviour.
     */
    readonly booleans?: ReadonlySet<string>;
}

/**
 * Zero-dependency argument parser.
 *
 * Supported forms:
 *   --flag value      flags.flag = 'value'   (value-taking flags only)
 *   --flag=value      flags.flag = 'value'   (works for boolean flags too: use getBoolFlag)
 *   -f value          flags.f   = 'value'
 *   --flag            flags.flag = true      (boolean flags never consume the next token)
 *   --flag -          flags.flag = '-'       (a lone dash is a VALUE: stdin/stdout)
 *   --flag -1         flags.flag = '-1'      (a dash followed by a digit is a VALUE)
 *   --                stop flag parsing; rest → positionals
 *   bare token        positionals[]
 *
 * Combined short flags (`-lq`) are refused with a usage error — write `-l -q`.
 * When the same value-taking flag is provided more than once
 * (e.g. `--remove a.txt --remove b.txt`), values are collected into a
 * `readonly string[]`. Use `getStringFlagAll()` to retrieve them.
 */
export function parseArgs(argv: readonly string[], options: ParseOptions = {}): ParsedArgs {
    const booleans = options.booleans ?? BOOLEAN_FLAGS;
    const flags: Record<string, string | boolean | string[]> = {};
    const positionals: string[] = [];
    let i = 0;

    const setFlag = (key: string, value: string | boolean): void => {
        const existing = flags[key];
        if (existing === undefined || typeof existing === 'boolean') {
            flags[key] = value;
            return;
        }
        if (typeof value === 'boolean') {
            // `--flag value --flag` — keep the existing string array/value
            return;
        }
        // Both old and new are strings → collect into array
        if (typeof existing === 'string') {
            flags[key] = [existing, value];
        } else {
            existing.push(value);
        }
    };

    // A token is a VALUE (never a flag) when it is a lone `-` or a negative number.
    const isValueToken = (tok: string): boolean => tok === '-' || /^-\d/.test(tok) || !tok.startsWith('-');

    while (i < argv.length) {
        const token = argv[i] as string;

        if (token === '--') {
            // Everything after -- goes into positionals
            i++;
            while (i < argv.length) {
                positionals.push(argv[i] as string);
                i++;
            }
            break;
        }

        if (token.startsWith('--')) {
            const eqIdx = token.indexOf('=');
            if (eqIdx !== -1) {
                // --flag=value (explicit — also the way to write `--bool=false`)
                const key = token.slice(2, eqIdx);
                const value = token.slice(eqIdx + 1);
                setFlag(key, value);
            } else {
                const key = token.slice(2);
                const next = argv[i + 1];
                if (!booleans.has(key) && next !== undefined && isValueToken(next)) {
                    // --flag value
                    setFlag(key, next);
                    i++;
                } else {
                    // --flag (boolean, or a value flag with nothing usable after it)
                    setFlag(key, true);
                }
            }
        } else if (token.startsWith('-') && token.length > 1 && !/^-\d/.test(token)) {
            if (token.length > 2) {
                throw new CliError(
                    `Combined short flags are not supported ("${token}"): write them separately, e.g. ${Array.from(token.slice(1), (c) => `-${c}`).join(' ')}.`,
                    2,
                );
            }
            // -f value
            const key = token.slice(1);
            const next = argv[i + 1];
            if (!booleans.has(key) && next !== undefined && isValueToken(next)) {
                setFlag(key, next);
                i++;
            } else {
                setFlag(key, true);
            }
        } else {
            positionals.push(token);
        }

        i++;
    }

    return { flags, positionals };
}

/**
 * Return the string value of the first matching flag name, or undefined.
 * Throws CliError if the flag is present but its value is a boolean (i.e. no value provided).
 * If the flag was provided multiple times, returns the FIRST value; use {@link getStringFlagAll}
 * to retrieve every occurrence.
 */
export function getStringFlag(
    flags: ParsedArgs['flags'],
    ...names: string[]
): string | undefined {
    for (const name of names) {
        const value = flags[name];
        if (value === undefined) continue;
        if (typeof value === 'boolean') {
            throw new CliError(`Flag --${name} requires a value.`, 2);
        }
        if (typeof value === 'string') return value;
        return value[0];
    }
    return undefined;
}

/**
 * Return every string value provided for any of the named flags (in order).
 * Returns an empty array if no value was provided. Throws CliError if a name
 * is present as a boolean flag (i.e. `--flag` without a value).
 */
export function getStringFlagAll(
    flags: ParsedArgs['flags'],
    ...names: string[]
): readonly string[] {
    const out: string[] = [];
    for (const name of names) {
        const value = flags[name];
        if (value === undefined) continue;
        if (typeof value === 'boolean') {
            throw new CliError(`Flag --${name} requires a value.`, 2);
        }
        if (typeof value === 'string') {
            out.push(value);
        } else {
            out.push(...value);
        }
    }
    return out;
}

/**
 * Return true if any of the given flag names is present AND not explicitly
 * negated (`--flag=false|0|no|off`). A boolean flag written `--flag=false` is
 * therefore treated as absent by every `hasFlag` caller.
 */
export function hasFlag(flags: ParsedArgs['flags'], ...names: string[]): boolean {
    return names.some((n) => {
        const value = flags[n];
        if (value === undefined) return false;
        if (typeof value === 'string') return !isNegation(value);
        return true;
    });
}

function isNegation(raw: string): boolean {
    const v = raw.trim().toLowerCase();
    return v === 'false' || v === '0' || v === 'no' || v === 'off';
}

/**
 * Resolve a tri-state boolean flag.
 *
 * Returns `undefined` when the flag is absent (caller applies its default),
 * `true` for a bare `--flag` or `--flag=true|1|yes|on`, and `false` for
 * `--flag=false|0|no|off`. Throws CliError on any other value so typos are
 * surfaced rather than silently coerced.
 */
export function getBoolFlag(
    flags: ParsedArgs['flags'],
    ...names: string[]
): boolean | undefined {
    for (const name of names) {
        const value = flags[name];
        if (value === undefined) continue;
        if (typeof value === 'boolean') return value;
        const v = (typeof value === 'string' ? value : (value[0] ?? '')).trim().toLowerCase();
        if (v === '' || v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
        if (isNegation(v)) return false;
        throw new CliError(`Flag --${name} expects a boolean (true/false), got "${typeof value === 'string' ? value : value.join(',')}".`, 2);
    }
    return undefined;
}
