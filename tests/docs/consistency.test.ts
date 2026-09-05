// Documentation ↔ code consistency. The docs quote counts, codes, defaults and
// export names that live in the source; this suite fails when they drift so a
// doc edit (or a code edit) cannot silently desynchronise them.
//
// Sources of truth:
//   COMMANDS (completion.ts)      — the 15-command surface and its groups
//   ErrorCode (error.ts)          — the 13 stable E_* classes
//   ZIP_TO_CLI (ziperr.ts)        — the 39 ZIP_* → E_* / exit mapping
//   ZIP_DIAGNOSTIC_CODES          — the 11 diagnostic codes
//   SUBJECTS (schema.ts)          — the schema subjects
//   LIMIT_FLAGS + DEFAULT_ZIP_LIMITS — the eight --max-* bounds and their defaults
//   VERSION (core-bridge)         — the engine version the data files were derived from
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS, COMMAND_NAMES, DRY_RUN_COMMANDS } from '../../src/commands/completion.js';
import { SUBJECTS } from '../../src/commands/schema.js';
import { DEFAULT_ZIP_LIMITS, VERSION } from '../../src/core-bridge/index.js';
import { KNOWN_COMMANDS } from '../../src/utils/config.js';
import { ErrorCode } from '../../src/utils/error.js';
import { LIMIT_FLAGS } from '../../src/utils/limits.js';
import { MANIFEST_COMMANDS } from '../../src/utils/manifest.js';
import { PROJECTED_COMMANDS } from '../../src/utils/projection.js';
import { ZIP_DIAGNOSTIC_CODES, ZIP_ERROR_CODES, ZIP_TO_CLI } from '../../src/utils/ziperr.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** Files whose prose quotes the command count and the E_* vocabulary. */
const COUNTED_DOCS = [
    'README.md',
    'llms.txt',
    'AGENTS.md',
    'docs/KNOWLEDGE_BASE.md',
    'SECURITY.md',
    'CITATION.cff',
    'src/index.ts',
] as const;

const docs = Object.fromEntries(COUNTED_DOCS.map((f) => [f, read(f)])) as Record<(typeof COUNTED_DOCS)[number], string>;
const readme = docs['README.md'];
const agents = docs['AGENTS.md'];
const llms = docs['llms.txt'];
const kb = docs['docs/KNOWLEDGE_BASE.md'];

const ERROR_CODE_VALUES = new Set<string>(Object.values(ErrorCode));

/** Slice a markdown document between a heading and the next heading of the same or higher level. */
function section(text: string, heading: string): string {
    const start = text.indexOf(heading);
    expect(start, `heading not found: ${heading}`).toBeGreaterThanOrEqual(0);
    const level = /^#+/.exec(heading)?.[0].length ?? 1;
    const rest = text.slice(start + heading.length);
    const next = new RegExp(`^#{1,${level}} `, 'm').exec(rest);
    return next === null ? rest : rest.slice(0, next.index);
}

describe('command counts agree with COMMANDS', () => {
    it('COMMANDS is the 15-command surface in four groups', () => {
        expect(COMMANDS).toHaveLength(15);
        expect(new Set(COMMANDS.map((c) => c.group)).size).toBe(4);
        expect([...KNOWN_COMMANDS].sort()).toEqual([...COMMAND_NAMES].sort());
    });

    it('every "<N> commands" / "Commands (<N>)" in the docs and the USAGE equals COMMANDS.length', () => {
        let matches = 0;
        for (const [file, text] of Object.entries(docs)) {
            for (const m of text.matchAll(/\b(\d+) commands\b/g)) {
                matches++;
                expect(Number(m[1]), `${file}: "${m[0]}"`).toBe(COMMANDS.length);
            }
            for (const m of text.matchAll(/Commands \((\d+)\)/g)) {
                matches++;
                expect(Number(m[1]), `${file}: "${m[0]}"`).toBe(COMMANDS.length);
            }
        }
        expect(matches).toBeGreaterThan(0);
        expect(docs['src/index.ts']).toContain(`Commands (${COMMANDS.length})`);
    });

    it('the README command reference has one section per command and lists every group', () => {
        for (const c of COMMANDS) {
            expect(readme, c.name).toContain(`### \`zipnative ${c.name}\``);
            expect(readme, c.name).toContain(`**${c.group}**`);
        }
    });
});

describe('E_* error classes', () => {
    it('ErrorCode has 13 values', () => {
        expect(ERROR_CODE_VALUES.size).toBe(13);
    });

    it('every E_* token in the docs is a real ErrorCode value', () => {
        for (const [file, text] of Object.entries(docs)) {
            for (const m of text.matchAll(/\bE_[A-Z_]+\b/g)) {
                expect(ERROR_CODE_VALUES.has(m[0]), `${file}: unknown code ${m[0]}`).toBe(true);
            }
        }
    });

    it('every ErrorCode value is documented in AGENTS.md and llms.txt', () => {
        for (const code of ERROR_CODE_VALUES) {
            expect(agents, `AGENTS.md lacks ${code}`).toContain(`\`${code}\``);
            expect(llms, `llms.txt lacks ${code}`).toContain(code);
        }
    });
});

describe('docs/data/core-exports.json ↔ KNOWLEDGE_BASE §8 ↔ the bridge', () => {
    const data = JSON.parse(read('docs/data/core-exports.json')) as {
        zipnativeVersion: string;
        exportCount: number;
        exports: { name: string; kind: string; subpath: string }[];
    };
    const mapping = section(kb, '## 8. zipnative API Mapping');
    const bridge = read('src/core-bridge/index.ts');

    it('lists the 77 frozen exports of zipnative 1.0.0', () => {
        expect(data.exportCount).toBe(77);
        expect(data.exports).toHaveLength(77);
        expect(data.zipnativeVersion).toBe(VERSION);
        expect(data.exports.filter((e) => e.subpath === '.')).toHaveLength(72);
        expect(data.exports.filter((e) => e.subpath === './worker')).toHaveLength(5);
        for (const e of data.exports) {
            expect(['function', 'const', 'class', 'interface', 'type'], e.name).toContain(e.kind);
        }
    });

    it('maps every export name to a CLI touchpoint in §8', () => {
        for (const e of data.exports) {
            expect(mapping, `§8 lacks ${e.name}`).toContain(`\`${e.name}\``);
        }
    });

    it('every export name appears in the core bridge', () => {
        for (const e of data.exports) {
            expect(new RegExp(`\\b${e.name}\\b`).test(bridge), `bridge lacks ${e.name}`).toBe(true);
        }
    });
});

describe('docs/data/errors.json ↔ ZIP_TO_CLI ↔ AGENTS.md', () => {
    const data = JSON.parse(read('docs/data/errors.json')) as {
        zipnativeVersion: string;
        errors: { code: string; cli: { code: string; exitCode: number } }[];
        diagnostics: { code: string }[];
    };

    it('carries the 39 error codes and 11 diagnostics of zipnative 1.0.0', () => {
        expect(data.zipnativeVersion).toBe(VERSION);
        expect(data.errors).toHaveLength(39);
        expect(data.diagnostics).toHaveLength(11);
        expect(ZIP_ERROR_CODES).toHaveLength(39);
        expect(ZIP_DIAGNOSTIC_CODES).toHaveLength(11);
        expect(data.errors.map((e) => e.code).sort()).toEqual([...ZIP_ERROR_CODES].sort());
        expect(data.diagnostics.map((d) => d.code).sort()).toEqual([...ZIP_DIAGNOSTIC_CODES].sort());
    });

    it('the cli mapping of every code matches ZIP_TO_CLI', () => {
        for (const e of data.errors) {
            const [code, exitCode] = ZIP_TO_CLI[e.code as keyof typeof ZIP_TO_CLI];
            expect(e.cli, e.code).toEqual({ code, exitCode });
        }
    });

    it('every ZIP_* error and diagnostic code is documented in AGENTS.md and the knowledge base', () => {
        for (const code of [...ZIP_ERROR_CODES, ...ZIP_DIAGNOSTIC_CODES]) {
            expect(agents, `AGENTS.md lacks ${code}`).toContain(`\`${code}\``);
            expect(kb, `KNOWLEDGE_BASE.md lacks ${code}`).toContain(`\`${code}\``);
        }
    });
});

describe('README Global options ↔ LIMIT_FLAGS / DEFAULT_ZIP_LIMITS', () => {
    const globals = section(readme, '### Global options');

    it('quotes every --max-* flag with its engine default', () => {
        expect(LIMIT_FLAGS).toHaveLength(8);
        for (const spec of LIMIT_FLAGS) {
            const row = globals.split('\n').find((l) => l.includes(`\`--${spec.flag} `));
            expect(row, `README lacks --${spec.flag}`).toBeDefined();
            expect(row, `--${spec.flag} default`).toContain(`\`${DEFAULT_ZIP_LIMITS[spec.key]}\``);
            expect(row, `--${spec.flag} CWE`).toContain(spec.cwe);
        }
    });

    it('lists every dry-run command on the --dry-run row', () => {
        const row = globals.split('\n').find((l) => l.startsWith('| `--dry-run`'));
        expect(row).toBeDefined();
        for (const cmd of DRY_RUN_COMMANDS) expect(row, cmd).toContain(`\`${cmd}\``);
        expect(DRY_RUN_COMMANDS).toHaveLength(7);
    });
});

describe('README schema section ↔ SUBJECTS', () => {
    it('lists exactly the schema subjects', () => {
        const block = section(readme, '### `zipnative schema`');
        const listed = new Set<string>();
        for (const m of block.matchAll(/^zipnative schema ([a-z0-9-]+)/gm)) {
            if (m[1] !== 'list') listed.add(m[1] as string);
        }
        expect([...listed].sort()).toEqual([...SUBJECTS].sort());
        expect(listed.size).toBe(SUBJECTS.length);
        expect(SUBJECTS).toHaveLength(22);
        expect(block).toContain(`list the ${SUBJECTS.length} subjects`);
    });
});

describe('agent-surface lists', () => {
    it('AGENTS.md names every manifest command and every projected command', () => {
        expect(MANIFEST_COMMANDS.size).toBe(10);
        const batchSection = section(agents, '## 7. Recommended agent loop');
        for (const cmd of MANIFEST_COMMANDS) expect(batchSection, cmd).toContain(`\`${cmd}\``);
        const tokenSection = section(agents, '## 3. Token economy');
        for (const cmd of PROJECTED_COMMANDS) expect(tokenSection, cmd).toContain(`\`${cmd}\``);
    });

    it('llms.txt lists every dry-run command', () => {
        for (const cmd of DRY_RUN_COMMANDS) expect(llms, cmd).toContain(`\`${cmd}\``);
    });
});

// ── Phase-2 invariants (audit A-28): the docs quote flags, env vars, exit
// codes and shapes that live in the source; pin them too.

import { GLOBAL_FLAGS, PATH_FLAGS } from '../../src/commands/completion.js';
import { BOOLEAN_FLAGS } from '../../src/utils/flags.js';

const indexSrc = read('src/index.ts');

/** Every `<NAME>_USAGE` template literal in src/index.ts, keyed by command name. */
function usageBlocks(): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of indexSrc.matchAll(/const ([A-Z0-9_]+)_USAGE = `([\s\S]*?)`;/g)) {
        out.set((m[1] as string).toLowerCase(), m[2] as string);
    }
    return out;
}

function globalUsage(): string {
    return (indexSrc.match(/const GLOBAL_USAGE = `([\s\S]*?)`;/) as RegExpMatchArray)[1] as string;
}

/** `--flag` tokens that open an option definition line in a USAGE block. */
function usageFlags(block: string): Set<string> {
    const flags = new Set<string>();
    for (const m of block.matchAll(/^\s{2,}(--[a-z][a-z0-9-]*)/gm)) flags.add(m[1] as string);
    for (const m of block.matchAll(/^\s{2,}(--[a-z0-9-]+(?:\/--[a-z0-9-]+)+)/gm)) {
        for (const f of (m[1] as string).split('/')) flags.add(f);
    }
    return flags;
}

describe('USAGE strings ↔ COMMANDS ↔ flag table (A-28, A-18)', () => {
    const blocks = usageBlocks();

    it('every command has a USAGE block and every COMMANDS flag appears in it', () => {
        for (const c of COMMANDS) {
            const block = blocks.get(c.name);
            expect(block, `${c.name}: no ${c.name.toUpperCase()}_USAGE`).toBeDefined();
            const defined = usageFlags(block as string);
            for (const flag of c.flags) {
                expect(defined.has(flag) || (block as string).includes(flag), `${c.name}: USAGE lacks ${flag}`).toBe(true);
            }
        }
    });

    it('no USAGE line exceeds 80 columns', () => {
        for (const [name, block] of [...blocks, ['global', globalUsage()] as const]) {
            for (const line of block.split('\n')) {
                expect(line.length, `${name}: "${line.slice(0, 40)}" is ${line.length} columns`).toBeLessThanOrEqual(80);
            }
        }
    });

    it('a boolean flag is never shown with a <value> placeholder in its USAGE', () => {
        for (const c of COMMANDS) {
            const block = blocks.get(c.name) as string;
            for (const flag of c.flags) {
                const bare = flag.replace(/^--/, '');
                if (!BOOLEAN_FLAGS.has(bare)) continue;
                const def = block.split('\n').find((l) => new RegExp(`^\\s{2,}${flag}(?![a-z0-9-])`).test(l));
                if (def === undefined) continue;
                expect(/^\s{2,}--[a-z0-9-]+(?:,\s+-[a-zA-Z])?\s+</.test(def), `${c.name} ${flag} is boolean but USAGE shows a value`).toBe(false);
            }
        }
    });

    it('PATH_FLAGS are value flags of the surface', () => {
        const all = new Set([...GLOBAL_FLAGS, ...COMMANDS.flatMap((c) => c.flags)]);
        for (const f of PATH_FLAGS) {
            expect(all.has(f), f).toBe(true);
            expect(BOOLEAN_FLAGS.has(f.replace(/^--/, '')), `${f} is boolean`).toBe(false);
        }
    });

    it('the global USAGE documents every bound, --max-input-size, the exit codes and every environment variable read by src/', () => {
        const global = globalUsage();
        for (const spec of LIMIT_FLAGS) expect(global).toContain(`--${spec.flag}`);
        expect(global).toContain('--max-input-size');
        expect(global).toContain('Exit codes:');
        expect(global).toContain('130 / 143');
        const envVars = new Set<string>();
        for (const file of ['src/index.ts', 'src/utils/agent.ts', 'src/utils/engine.ts', 'src/utils/colors.ts']) {
            for (const m of read(file).matchAll(/process\.env\['(ZIPNATIVE_[A-Z_]+|NO_COLOR|FORCE_COLOR|TERM)'\]/g)) envVars.add(m[1] as string);
        }
        expect(envVars.size).toBeGreaterThanOrEqual(8);
        for (const v of envVars) {
            expect(global, `GLOBAL_USAGE lacks ${v}`).toContain(v);
            expect(readme, `README lacks ${v}`).toContain(v);
        }
    });
});

describe('README / knowledge-base command tables ↔ COMMANDS flags', () => {
    it('every flag of every command appears in its README section and in the knowledge base', () => {
        for (const c of COMMANDS) {
            const block = section(readme, `### \`zipnative ${c.name}\``);
            for (const flag of c.flags) {
                expect(block, `README ${c.name} lacks ${flag}`).toContain(flag);
                expect(kb, `KNOWLEDGE_BASE lacks ${flag}`).toContain(flag);
            }
        }
    });

    it('the README global options table has a --max-input-size row with its default and CWE', () => {
        const globals = section(readme, '### Global options');
        const row = globals.split('\n').find((l) => l.includes('`--max-input-size '));
        expect(row).toBeDefined();
        expect(row).toContain('4');
        expect(row).toContain('CWE-400');
    });
});

describe('status envelope ↔ emitStatus callers', () => {
    it('the status schema command enum equals the set of commands that call emitStatus()', () => {
        const callers = new Set<string>();
        for (const c of COMMANDS) {
            if (read(`src/commands/${c.name}.ts`).includes('emitStatus(')) callers.add(c.name);
        }
        const statusSchema = read('src/commands/schema.ts').split("$id: id('status')")[1] as string;
        const enumMatch = statusSchema.match(/command: \{ enum: \[([^\]]+)\] \}/) as RegExpMatchArray;
        const listed = (enumMatch[1] as string).split(',').map((x) => x.trim().replace(/'/g, ''));
        expect([...callers].sort()).toEqual([...listed].sort());
    });
});

describe('release metadata', () => {
    it('CITATION.cff and package.json agree on the version', () => {
        const pkg = JSON.parse(read('package.json')) as { version: string };
        expect(docs['CITATION.cff']).toContain(`version: ${pkg.version}`);
    });

    it('every diagnostic in docs/data/errors.json names the commands that raise it', () => {
        const data = JSON.parse(read('docs/data/errors.json')) as { diagnostics: { code: string; raisedBy?: string[] }[] };
        for (const d of data.diagnostics) {
            expect(Array.isArray(d.raisedBy) && d.raisedBy.length > 0, `${d.code} lacks raisedBy`).toBe(true);
            for (const cmd of d.raisedBy as string[]) expect([...COMMAND_NAMES, 'any-reader', 'any-writer'], `${d.code}: ${cmd}`).toContain(cmd);
        }
    });

    it('the phrase "read-side only" is gone from every document (audit B-07)', () => {
        for (const file of ['README.md', 'SECURITY.md', 'docs/KNOWLEDGE_BASE.md', 'AGENTS.md', 'llms.txt', 'CHANGELOG.md', 'release-notes/v1.0.0.md', '.github/copilot-instructions.md', 'src/index.ts', 'src/utils/codecs.ts']) {
            expect(read(file).toLowerCase(), file).not.toContain('read-side only');
        }
    });

    it('every relative path in the llms.txt Docs section is shipped in the tarball (package.json files)', () => {
        const pkg = JSON.parse(read('package.json')) as { files: string[] };
        const shipped = new Set(pkg.files.filter((f) => !f.startsWith('!')));
        const docsSection = section(llms, '## Docs');
        for (const m of docsSection.matchAll(/\]\(([^)]+)\)/g)) {
            const target = m[1] as string;
            if (/^https?:\/\//.test(target)) continue;
            const top = (target.replace(/^\.\//, '').split('#')[0] as string);
            expect(shipped.has(top) || shipped.has(top.split('/')[0] as string), `llms.txt links ${target}, not in package.json files`).toBe(true);
        }
    });
});
