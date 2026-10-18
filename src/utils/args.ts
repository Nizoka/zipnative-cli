import { CliError } from './error.js';
import { BOOLEAN_FLAGS } from './flags.js';

export type FlagValue = string | boolean | readonly string[];

export interface ParsedArgs {
    readonly flags: Readonly<Record<string, FlagValue>>;
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
 * The one-letter aliases, canonicalised to their flag's name by the parser
 * so that everything after it — the known-flag and single-value checks, the
 * config merge, the commands — sees ONE name per flag: `-i a.zip` IS
 * `--input a.zip` on every command that declares `--input`.
 */
export const FLAG_ALIASES: Readonly<Record<string, string>> = {
    i: 'input',
    o: 'output',
    d: 'output-dir',
    e: 'entry',
    f: 'format',
    h: 'help',
    q: 'quiet',
    V: 'version',
};

/** Names that would reach Object.prototype through a plain record. */
const FORBIDDEN_FLAG_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** `-o` for a one-letter flag, `--output` otherwise. */
function dashed(key: string): string {
    return `${key.length === 1 ? '-' : '--'}${key}`;
}

/**
 * Zero-dependency argument parser.
 *
 * Supported forms:
 *   --flag value      flags.flag = 'value'   (value-taking flags only)
 *   --flag=value      flags.flag = 'value'   (works for boolean flags too: use getBoolFlag)
 *   -f value          flags.format = 'value' (a one-letter alias, canonicalised)
 *   --flag            flags.flag = true      (boolean flags never consume the next token)
 *   --flag -          flags.flag = '-'       (a lone dash is a VALUE: stdin/stdout)
 *   --flag -1         flags.flag = '-1'      (a dash followed by a digit is a VALUE)
 *   --                stop flag parsing; rest → positionals
 *   bare token        positionals[]
 *
 * Refused with a usage error (exit 2):
 *   • combined short flags (`-lq`) — write `-l -q`;
 *   • `__proto__` / `constructor` / `prototype` and empty names (the flag
 *     record has no prototype either way);
 *   • a switch given twice, or a value flag once bare and once with a value
 *     (one occurrence would silently win).
 *
 * A value-taking flag given more than once (`--remove a --remove b`) collects
 * its values in order into a `readonly string[]` (getStringFlagAll); whether
 * the command accepts several is `assertSingleValues`' decision.
 */
export function parseArgs(argv: readonly string[], options: ParseOptions = {}): ParsedArgs {
    const booleans = options.booleans ?? BOOLEAN_FLAGS;
    const flags = Object.create(null) as Record<string, FlagValue>;
    const positionals: string[] = [];

    const setFlag = (raw: string, value: string | boolean): void => {
        if (raw === '' || FORBIDDEN_FLAG_NAMES.has(raw)) {
            throw new CliError(`Invalid flag name "${dashed(raw)}".`, 2);
        }
        const key = FLAG_ALIASES[raw] ?? raw;
        const existing = flags[key];
        if (existing === undefined) {
            flags[key] = value;
            return;
        }
        if (typeof existing === 'boolean' || typeof value === 'boolean') {
            // The values are never echoed: one may be a secret typed in the wrong place.
            throw new CliError(
                typeof existing === 'boolean' && typeof value === 'boolean'
                    ? `${dashed(key)} is given more than once; give it once.`
                    : `Flag ${dashed(key)} is given both with and without a value; give it once, with its value.`,
                2,
            );
        }
        flags[key] = typeof existing === 'string' ? [existing, value] : [...existing, value];
    };

    // A token is a VALUE (never a flag) when it is a lone `-` or a negative number.
    const isValueToken = (tok: string): boolean => tok === '-' || /^-\d/.test(tok) || !tok.startsWith('-');

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i] as string;

        if (token === '--') {
            positionals.push(...argv.slice(i + 1));
            break;
        }

        let key: string;
        if (token.startsWith('--')) {
            const eqIdx = token.indexOf('=');
            if (eqIdx !== -1) {
                // --flag=value (explicit — also the way to write `--bool=false`)
                setFlag(token.slice(2, eqIdx), token.slice(eqIdx + 1));
                continue;
            }
            key = token.slice(2);
        } else if (token.startsWith('-') && token.length > 1 && !/^-\d/.test(token)) {
            if (token.length > 2) {
                throw new CliError(
                    token[2] === '='
                        ? `A short flag takes no "=": write -${token[1] as string} <value>, or the long form --<flag>=<value>.`
                        : `Combined short flags are not supported ("${token}"): write them separately, e.g. ${Array.from(token.slice(1), (c) => `-${c}`).join(' ')}.`,
                    2,
                );
            }
            key = token.slice(1);
        } else {
            positionals.push(token);
            continue;
        }

        const canonical = FLAG_ALIASES[key] ?? key;
        const next = argv[i + 1];
        if (!booleans.has(key) && !booleans.has(canonical) && next !== undefined && isValueToken(next)) {
            setFlag(key, next);
            i++;
        } else {
            setFlag(key, true);
        }
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

// ── Invocation checks (run by the dispatcher and by batch for manifest tasks)

/**
 * Refuse a flag the invoked command does not declare: a typo (`--overwite`)
 * must never be a silent no-op, and an unknown name must never reach a
 * command (audit A2-11 of pkinative-cli, ported). `known` holds bare names.
 */
export function assertKnownFlags(flags: ParsedArgs['flags'], known: ReadonlySet<string>, command: string): void {
    for (const name of Object.keys(flags)) {
        if (!known.has(name)) {
            throw new CliError(`Unknown flag ${dashed(name)} for "${command}". Run zipnative ${command} --help.`, 2);
        }
    }
}

/**
 * Refuse a value flag given more than once when the command does not
 * declare it repeatable: the first value would otherwise win silently and a
 * verdict would depend on the order of the flags.
 */
export function assertSingleValues(flags: ParsedArgs['flags'], repeatable: ReadonlySet<string>, command: string): void {
    for (const [name, value] of Object.entries(flags)) {
        if (Array.isArray(value) && !repeatable.has(name)) {
            throw new CliError(`--${name} is given ${value.length} times for "${command}"; it takes one value.`, 2);
        }
    }
}

export interface OperandRule {
    /** Most positionals the command takes (Infinity = any number). */
    readonly max: number;
    /** A flag that stands for the first positional: giving both is refused. */
    readonly for?: string;
}

/**
 * Refuse positionals beyond what the command takes, and an operand given
 * together with the flag it stands for (`list a.zip --input b.zip`). The
 * values are never echoed: a stray positional may be a secret.
 */
export function assertOperands(args: ParsedArgs, rule: OperandRule, command: string): void {
    const n = args.positionals.length;
    if (n > rule.max) {
        const most = rule.max === 0 ? 'no arguments' : `at most ${rule.max} argument${rule.max === 1 ? '' : 's'}`;
        throw new CliError(`"${command}" takes ${most}, got ${n}. Run zipnative ${command} --help.`, 2);
    }
    if (n > 0 && rule.for !== undefined && args.flags[rule.for] !== undefined) {
        throw new CliError(`"${command}" was given --${rule.for} and an argument for it; give one or the other.`, 2);
    }
}
