// Seeded fuzzing of the CLI-owned parsers (ROADMAP A-25, docs/adr/0010).
//
// The engine fuzzes the ZIP parser; the CLI owns argv, sizes, globs, field
// projections, manifests, the configuration file, durations, name encodings
// and the terminal escaper. For each, a seeded PRNG drives thousands of
// hostile inputs and checks ONE invariant: the parser returns, or throws a
// CliError (a usage / input refusal). Any other throw — a TypeError, a
// RangeError, a stack overflow — would reach the user as E_RUNTIME, which is
// a bug by definition. Deterministic: the seed is fixed, so a failure
// reproduces; FUZZ_SEED and FUZZ_RUNS override it (FUZZ_RUNS=20000 locally
// for a longer campaign). No dependency: the PRNG is the raw builder's.

import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertInvocation, COMMAND_NAMES } from '../../src/commands/completion.js';
import { parseArgs } from '../../src/utils/args.js';
import { loadConfig } from '../../src/utils/config.js';
import { parseDuration } from '../../src/utils/control.js';
import { CliError } from '../../src/utils/error.js';
import { buildFilter, compileGlob } from '../../src/utils/glob.js';
import { parseManifest } from '../../src/utils/manifest.js';
import { parseFieldList, selectFields } from '../../src/utils/projection.js';
import { escapeTerminal, hasTerminalControls } from '../../src/utils/sanitize.js';
import { parseByteSize, parseCount } from '../../src/utils/sizes.js';
import { parseNameEncoding } from '../../src/utils/zipops.js';
import { seededRandom } from '../helpers/raw-zip-builder.js';

const SEED = Number(process.env['FUZZ_SEED'] ?? 0x5eed1110);
const RUNS = Number(process.env['FUZZ_RUNS'] ?? 1500);

/** Runs `fn`; returns normally or throws only a CliError — anything else fails the property. */
function onlyCliErrors(label: string, input: unknown, fn: () => unknown): void {
    try {
        fn();
    } catch (e) {
        if (e instanceof CliError) {
            expect([1, 2], `${label}: exit code for ${JSON.stringify(input)}`).toContain(e.exitCode);
            return;
        }
        throw new Error(`${label}: non-CliError ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)} for input ${JSON.stringify(input)}`);
    }
}

function gen(seed: number) {
    const rnd = seededRandom(seed);
    const int = (n: number): number => Math.floor(rnd() * n);
    const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T;
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789-_=./\\*?[]{}!@#$%^&()+,;:\'" \t\u0000\u001b\u202eé日😀';
    const str = (max: number): string => Array.from({ length: int(max + 1) }, () => ALPHABET[int(ALPHABET.length)]).join('');
    const FLAGS = ['--json', '--input', '-i', '--output', '-o', '--long', '--max-entries', '--include', '--entry', '-e', '-f', '--format',
        '--__proto__', '--constructor', '--', '-', '-1', '--x=', '--=', '-lq', '-o=', '--timeout', '--name-encoding', '--check', '--overwrite'];
    const token = (): string => (rnd() < 0.5 ? pick(FLAGS) : str(12));
    return { rnd, int, pick, str, token };
}

let tmp = '';
afterEach(() => {
    if (tmp !== '') rmSync(tmp, { recursive: true, force: true });
    tmp = '';
});

describe(`fuzz (seed 0x${SEED.toString(16)}, ${RUNS} runs per target)`, () => {
    it('parseArgs + assertInvocation: any argv parses or is a usage refusal', () => {
        const g = gen(SEED);
        for (let i = 0; i < RUNS; i++) {
            const argv = Array.from({ length: g.int(9) }, g.token);
            onlyCliErrors('parseArgs', argv, () => {
                const args = parseArgs(argv);
                expect(Object.getPrototypeOf(args.flags)).toBeNull();
                assertInvocation(g.pick(COMMAND_NAMES), args);
            });
        }
    });

    it('parseByteSize / parseCount / parseDuration: never a non-CliError, never a non-finite or unsafe number', () => {
        const g = gen(SEED + 1);
        const shapes = ['', ' ', 'none', 'inf', '0', '-1', '1e9', '9007199254740993', '512k', '1GiB', '8g', '1.5m', '99999999999t', '10ms', '5m', '1h', '25d'];
        for (let i = 0; i < RUNS; i++) {
            const raw = g.rnd() < 0.4 ? g.pick(shapes) : g.str(10);
            for (const [label, fn] of [['size', parseByteSize], ['count', parseCount], ['duration', parseDuration]] as const) {
                onlyCliErrors(label, raw, () => {
                    const n = fn(raw, 'fuzz');
                    expect(Number.isSafeInteger(n), `${label} ${raw} → ${n}`).toBe(true);
                });
            }
        }
    });

    it('compileGlob / buildFilter: compile or refuse, and match in bounded time (no catastrophic backtracking)', () => {
        const g = gen(SEED + 2);
        for (let i = 0; i < RUNS; i++) {
            const pattern = g.str(16);
            onlyCliErrors('glob', pattern, () => {
                const re = compileGlob(pattern);
                const t0 = Date.now();
                re.test('a/'.repeat(40) + 'x'.repeat(40));
                expect(Date.now() - t0, `glob ${JSON.stringify(pattern)} is slow`).toBeLessThan(200);
                buildFilter([pattern], [g.str(6)])(g.str(30));
            });
        }
    });

    it('parseFieldList / selectFields: any projection of any document returns', () => {
        const g = gen(SEED + 3);
        const doc = { archive: { bytes: 1, entries: [{ name: 'a', crc32: 'x' }] }, determinism: { deterministic: true }, ['__proto__']: { polluted: true } };
        for (let i = 0; i < RUNS; i++) {
            const csv = Array.from({ length: g.int(4) }, () => g.pick(['archive', 'bytes', 'entries', '__proto__', 'constructor', 'name', g.str(5)])).join(g.pick(['.', ',', '..', '']));
            onlyCliErrors('fields', csv, () => {
                const fields = parseFieldList(csv);
                selectFields(doc, fields);
            });
        }
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('parseManifest: any JSON-ish text is a plan or a refusal', () => {
        const g = gen(SEED + 4);
        const values = (): unknown => g.pick<unknown>([null, true, 1, -1, 1.5, 'x', '@a', '../x', [], ['a', 1], {}, { a: 1 }, g.str(6)]);
        for (let i = 0; i < Math.ceil(RUNS / 3); i++) {
            const tasks = Array.from({ length: g.int(4) }, (_, n) => {
                const flags: Record<string, unknown> = {};
                for (let k = 0; k < g.int(4); k++) flags[g.pick(['input', 'output', 'o', 'd', 'codec', '__proto__', 'constructor', g.str(6)])] = values();
                return { id: g.pick([`t${n}`, '', 'bad id', g.str(4)]), command: g.pick([...COMMAND_NAMES, 'nope', g.str(5)]), flags: g.rnd() < 0.1 ? values() : flags };
            });
            const text = g.rnd() < 0.15 ? g.str(20) : JSON.stringify({ version: g.pick([1, 1, 2, '1']), tasks: g.rnd() < 0.1 ? values() : tasks });
            onlyCliErrors('manifest', text, () => parseManifest(text, tmpdir()));
        }
    });

    it('loadConfig: any .zipnativerc.json content is defaults or a usage refusal', () => {
        const g = gen(SEED + 5);
        tmp = mkdtempSync(join(tmpdir(), 'zipnative-fuzz-'));
        const keys = ['pretty', 'format', 'fields', 'long', 'list', 'extract', 'overwrite', 'max-entries', 'codec', '__proto__', 'constructor'];
        for (let i = 0; i < Math.ceil(RUNS / 5); i++) {
            const obj: Record<string, unknown> = {};
            for (let k = 0; k < g.int(4); k++) {
                const v = g.pick<unknown>([true, false, 'json', 3, null, [], { format: 'json' }, { overwrite: true }, g.str(4)]);
                obj[g.pick(keys)] = v;
            }
            const text = g.rnd() < 0.1 ? g.str(15) : JSON.stringify(obj);
            writeFileSync(join(tmp, '.zipnativerc.json'), text);
            onlyCliErrors('config', text, () => loadConfig(g.pick(COMMAND_NAMES), undefined, tmp));
        }
    });

    it('parseNameEncoding: any label is a decoder, the default, or a usage refusal', () => {
        const g = gen(SEED + 6);
        const labels = ['cp437', 'utf-8', 'shift_jis', 'gbk', 'latin1', 'windows-1252', 'ibm866', 'utf-16le', 'x-user-defined', ''];
        for (let i = 0; i < RUNS; i++) {
            const label = g.rnd() < 0.5 ? g.pick(labels) : g.str(8);
            onlyCliErrors('name-encoding', label, () => {
                const decode = parseNameEncoding(parseArgs(['--name-encoding', label]));
                if (decode !== undefined) expect(typeof decode(new Uint8Array([0x93, 0xfa, 0xff, 0x00]))).toBe('string');
            });
        }
    });

    it('escapeTerminal: the output never carries a control or bidi character, and escaping is stable', () => {
        const g = gen(SEED + 7);
        for (let i = 0; i < RUNS; i++) {
            const s = g.str(40) + String.fromCharCode(g.int(0x2100));
            const out = escapeTerminal(s);
            expect(hasTerminalControls(out), JSON.stringify(s)).toBe(false);
            expect(escapeTerminal(out)).toBe(out);
        }
    });
});
