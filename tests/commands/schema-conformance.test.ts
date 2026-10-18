// Every JSON document the CLI emits validates against the `schema <subject>`
// it publishes (second 1.1.0 review, M-02: `inspect --summary` emitted
// `canonicalForm` that its closed schema forbade, and an error envelope with
// an applied config carried a `config` field the error schema refused). An
// agent that validates before it trusts — as AGENTS.md recommends — must
// never be broken by the CLI's own output.
//
// A minimal, test-only validator for the keywords the CLI's schemas use
// (type, required, properties, additionalProperties, items, enum, const,
// anyOf, minimum, maximum, pattern) — no dependency.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batch } from '../../src/commands/batch.js';
import { cat } from '../../src/commands/cat.js';
import { crc32 } from '../../src/commands/crc32.js';
import { create } from '../../src/commands/create.js';
import { doctor } from '../../src/commands/doctor.js';
import { extract } from '../../src/commands/extract.js';
import { govern } from '../../src/commands/govern.js';
import { inflate } from '../../src/commands/inflate.js';
import { inspect } from '../../src/commands/inspect.js';
import { list } from '../../src/commands/list.js';
import { modify } from '../../src/commands/modify.js';
import { buildSchema, type Subject } from '../../src/commands/schema.js';
import { stream } from '../../src/commands/stream.js';
import { verify } from '../../src/commands/verify.js';
import { buildErrorEnvelope } from '../../src/utils/agent.js';
import { parseArgs } from '../../src/utils/args.js';
import { setActiveConfig } from '../../src/utils/config.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { deflateRawSync } from 'node:zlib';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Schema = Record<string, unknown>;

function typeOf(v: unknown): string {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    return typeof v;
}

/** Errors of `value` against `schema` (empty = valid). */
function validate(value: unknown, schema: Schema, path = '$'): string[] {
    const errs: string[] = [];
    if (schema['anyOf'] !== undefined) {
        const ok = (schema['anyOf'] as Schema[]).some((s) => validate(value, s, path).length === 0);
        if (!ok) errs.push(`${path}: matches no anyOf branch`);
    }
    if ('const' in schema && JSON.stringify(schema['const']) !== JSON.stringify(value)) errs.push(`${path}: expected const ${JSON.stringify(schema['const'])}`);
    if (schema['enum'] !== undefined && !(schema['enum'] as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(value))) {
        errs.push(`${path}: ${JSON.stringify(value)} not in enum`);
    }
    if (schema['type'] !== undefined) {
        const types = Array.isArray(schema['type']) ? schema['type'] as string[] : [schema['type'] as string];
        const t = typeOf(value);
        if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) errs.push(`${path}: type ${t}, expected ${types.join('|')}`);
    }
    if (typeof value === 'number') {
        if (typeof schema['minimum'] === 'number' && value < schema['minimum']) errs.push(`${path}: below minimum`);
        if (typeof schema['maximum'] === 'number' && value > schema['maximum']) errs.push(`${path}: above maximum`);
    }
    if (typeof value === 'string' && typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern']).test(value)) {
        errs.push(`${path}: does not match ${schema['pattern']}`);
    }
    if (Array.isArray(value) && schema['items'] !== undefined) {
        value.forEach((item, i) => errs.push(...validate(item, schema['items'] as Schema, `${path}[${i}]`)));
    }
    if (typeOf(value) === 'object') {
        const obj = value as Record<string, unknown>;
        const props = (schema['properties'] ?? {}) as Record<string, Schema>;
        for (const r of (schema['required'] ?? []) as string[]) if (!(r in obj)) errs.push(`${path}: missing required "${r}"`);
        for (const [k, v] of Object.entries(obj)) {
            if (props[k] !== undefined) errs.push(...validate(v, props[k], `${path}.${k}`));
            else if (schema['additionalProperties'] === false) errs.push(`${path}: additional property "${k}"`);
            else if (typeof schema['additionalProperties'] === 'object') errs.push(...validate(v, schema['additionalProperties'] as Schema, `${path}.${k}`));
        }
    }
    return errs;
}

function expectValid(doc: unknown, subject: Subject): void {
    expect(validate(doc, buildSchema(subject) as Schema), subject).toEqual([]);
}

let dir = '';
let zip = '';
let out = '';
let err = '';

async function run(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
    out = '';
    err = '';
    const o = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown, ...rest: unknown[]) => {
        out += typeof c === 'string' ? c : Buffer.from(c as Uint8Array).toString('utf8');
        (rest.find((r) => typeof r === 'function') as (() => void) | undefined)?.();
        return true;
    }) as unknown as typeof process.stdout.write);
    const e = vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { err += String(c); return true; }) as unknown as typeof process.stderr.write);
    try {
        await fn();
    } finally {
        o.mockRestore();
        e.mockRestore();
    }
    return { stdout: out, stderr: err };
}

const lastJsonLine = (s: string): Json => JSON.parse(s.trim().split('\n').filter((l) => l.startsWith('{')).pop() as string) as Json;

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zipnative-schema-'));
    await writeFile(join(dir, 'a.txt'), 'alpha');
    await writeFile(join(dir, 'b.txt'), 'beta beta');
    process.env['ZIPNATIVE_JSON'] = '1';
    zip = join(dir, 'a.zip');
    await run(() => create(parseArgs([join(dir, 'a.txt'), join(dir, 'b.txt'), '--base', dir, '-o', zip, '--deterministic'])));
    expectValid(lastJsonLine(err), 'status');
});

afterEach(() => {
    setActiveConfig(undefined, []);
});

afterAll(async () => {
    delete process.env['ZIPNATIVE_JSON'];
    await rm(dir, { recursive: true, force: true });
});

describe('real output validates against the published schemas', () => {
    it('list → entries / entries-summary', async () => {
        expectValid(JSON.parse((await run(() => list(parseArgs([zip, '--long'])))).stdout), 'entries');
        expectValid(JSON.parse((await run(() => list(parseArgs([zip, '--summary'])))).stdout), 'entries-summary');
    });

    it('inspect → inspect / inspect-summary (with checks)', async () => {
        expectValid(JSON.parse((await run(() => inspect(parseArgs([zip, '--entries'])))).stdout), 'inspect');
        expectValid(JSON.parse((await run(() => inspect(parseArgs([zip, '--summary', '--check', 'deterministic'])))).stdout), 'inspect-summary');
    });

    it('verify → verify / verify-summary', async () => {
        expectValid(JSON.parse((await run(() => verify(parseArgs([zip])))).stdout), 'verify');
        expectValid(JSON.parse((await run(() => verify(parseArgs([zip, '--summary'])))).stdout), 'verify-summary');
    });

    it('stream → stream / stream-summary, and its status envelope', async () => {
        expectValid(JSON.parse((await run(() => stream(parseArgs(['--input', zip, '--format', 'json', '--quiet'])))).stdout), 'stream');
        expectValid(JSON.parse((await run(() => stream(parseArgs(['--input', zip, '--summary', '--quiet'])))).stdout), 'stream-summary');
        const r = await run(() => stream(parseArgs(['--input', zip, '-d', join(dir, 'sx'), '--quiet'])));
        expectValid(lastJsonLine(r.stderr), 'status');
    });

    it('batch (directory verify) → batch / batch-summary', async () => {
        const vdir = join(dir, 'v');
        await mkdir(vdir);
        await run(() => create(parseArgs([join(dir, 'a.txt'), '--base', dir, '-o', join(vdir, 'x.zip')])));
        expectValid(JSON.parse((await run(() => batch(parseArgs(['--input-dir', vdir, '--task', 'verify', '--quiet'])))).stdout), 'batch');
        expectValid(JSON.parse((await run(() => batch(parseArgs(['--input-dir', vdir, '--task', 'verify', '--summary', '--quiet'])))).stdout), 'batch-summary');
    });

    it('doctor, crc32 and govern verify-issue', async () => {
        expectValid(JSON.parse((await run(() => doctor(parseArgs(['--format', 'json'])))).stdout), 'doctor');
        const c = await run(() => crc32(parseArgs([join(dir, 'a.txt'), '--format', 'json'])));
        expectValid(JSON.parse(c.stdout), 'crc32');
        expectValid(lastJsonLine(c.stderr), 'status');
        expectValid(JSON.parse((await run(() => govern(parseArgs(['verify-issue', join(process.cwd(), 'samples', 'input', 'govern', 'draft-good.md'), '--format', 'json'])))).stdout), 'govern-verify');
    });

    it('the status envelopes of extract, modify, cat and inflate', async () => {
        expectValid(lastJsonLine((await run(() => extract(parseArgs([zip, '-d', join(dir, 'ex')])))).stderr), 'status');
        expectValid(lastJsonLine((await run(() => modify(parseArgs([zip, '-o', join(dir, 'm.zip'), '--remove', 'b.txt', '--compact'])))).stderr), 'status');
        expectValid(lastJsonLine((await run(() => cat(parseArgs([zip, 'a.txt', '-o', join(dir, 'a.out')])))).stderr), 'status');
        await writeFile(join(dir, 'a.deflate'), deflateRawSync(Buffer.from('alpha')));
        expectValid(lastJsonLine((await run(() => inflate(parseArgs(['--input', join(dir, 'a.deflate'), '--output', join(dir, 'a.inflated')])))).stderr), 'status');
    });

    it('the error envelope, also when a configuration file applied', () => {
        const e = new CliError('boom', 1, ErrorCode.LIMIT, { detail: { limit: 'timeout', configured: 1, observed: 2 }, remedy: '--timeout <duration>' });
        expectValid(buildErrorEnvelope('list', e), 'error');
        setActiveConfig(join(dir, '.zipnativerc.json'), ['pretty']);
        expectValid(buildErrorEnvelope('list', e), 'error');
        expectValid(buildErrorEnvelope(null, new Error('raw')), 'error');
    });
});

