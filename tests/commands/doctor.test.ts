import { describe, it, expect, vi, afterEach } from 'vitest';
import { doctor } from '../../src/commands/doctor.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';
import { DEFAULT_ZIP_LIMITS } from '../../src/core-bridge/index.js';

interface Check {
    name: string;
    status: 'ok' | 'warn' | 'error';
    value: string;
    detail: string;
}

interface DoctorReport {
    ok: boolean;
    checks: Check[];
}

const CHECK_NAMES = ['cli', 'node', 'zipnative', 'deflate-tier', 'deflate-pinned', 'web-streams', 'workers', 'codecs', 'limits', 'commands'];

async function capture(fn: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
    }) as unknown as typeof process.stdout.write);
    try {
        await fn();
    } finally {
        spy.mockRestore();
    }
    return chunks.join('');
}

describe('doctor', () => {
    const origExit = process.exitCode;

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = origExit;
        delete process.env['ZIPNATIVE_JSON'];
        delete process.env['ZIPNATIVE_QUIET'];
    });

    it('prints a text report listing every check', async () => {
        const text = await capture(() => doctor(parseArgs([])));
        expect(text).toContain('zipnative-cli doctor');
        for (const name of CHECK_NAMES) expect(text).toContain(name);
        expect(text).toContain('All checks passed.');
        expect(process.exitCode ?? 0).toBe(0);
    });

    it('--format json emits { ok: true, checks: [...] } with the ten named checks in order', async () => {
        const doc = JSON.parse(await capture(() => doctor(parseArgs(['--format', 'json'])))) as DoctorReport;
        expect(doc.ok).toBe(true);
        expect(doc.checks.map((c) => c.name)).toEqual(CHECK_NAMES);
        for (const c of doc.checks) {
            expect(['ok', 'warn', 'error']).toContain(c.status);
            expect(typeof c.value).toBe('string');
            expect(typeof c.detail).toBe('string');
        }
        expect(doc.checks.every((c) => c.status !== 'error')).toBe(true);
    });

    it('reports the CLI version, Node >= 22, the engine and the registered command count', async () => {
        const doc = JSON.parse(await capture(() => doctor(parseArgs(['--format', 'json'])))) as DoctorReport;
        const byName = new Map(doc.checks.map((c) => [c.name, c]));
        expect(byName.get('cli')?.value).toMatch(/^\d+\.\d+\.\d+/);
        expect(byName.get('node')?.value).toBe(`v${process.versions.node}`);
        expect(byName.get('node')?.status).toBe('ok');
        expect(byName.get('zipnative')?.status).toBe('ok');
        expect(byName.get('zipnative')?.value).toMatch(/^\d+\.\d+\.\d+/);
        expect(byName.get('commands')?.value).toBe('15');
        expect(byName.get('web-streams')).toMatchObject({ status: 'ok', value: 'available' });
        expect(byName.get('workers')?.status).toBe('ok');
        expect(byName.get('workers')?.detail).toContain('zip-worker.js');
        expect(byName.get('codecs')).toMatchObject({ status: 'ok', value: '2' });
        expect(byName.get('codecs')?.detail).toContain('0=store');
        expect(byName.get('codecs')?.detail).toContain('8=deflate');
    });

    it('the default bootstrap yields the node-zlib tier and the pure-pinned deterministic tier', async () => {
        const doc = JSON.parse(await capture(() => doctor(parseArgs(['--format', 'json'])))) as DoctorReport;
        const byName = new Map(doc.checks.map((c) => [c.name, c]));
        expect(byName.get('deflate-tier')).toMatchObject({ status: 'ok', value: 'node-zlib' });
        expect(byName.get('deflate-pinned')).toMatchObject({ status: 'ok', value: 'pure-pinned' });
    });

    it('--pure-codecs is reflected in the tier detail', async () => {
        const doc = JSON.parse(await capture(() => doctor(parseArgs(['--format', 'json', '--pure-codecs'])))) as DoctorReport;
        const tier = doc.checks.find((c) => c.name === 'deflate-tier');
        expect(tier?.status).toBe('ok');
        expect(tier?.detail).toContain('--pure-codecs');
    });

    it('limits report defaults, and --max-* overrides are counted', async () => {
        const defaults = JSON.parse(await capture(() => doctor(parseArgs(['--format', 'json'])))) as DoctorReport;
        const limits = defaults.checks.find((c) => c.name === 'limits');
        expect(limits?.value).toBe('defaults');
        expect(limits?.detail).toContain(`maxEntries=${DEFAULT_ZIP_LIMITS.maxEntries}`);
        expect(limits?.detail).toContain('maxCompressionRatio=1024:1');
        const overridden = JSON.parse(await capture(() => doctor(parseArgs(['--format', 'json', '--max-entries', '5'])))) as DoctorReport;
        const o = overridden.checks.find((c) => c.name === 'limits');
        expect(o?.value).toBe('1 override(s)');
        expect(o?.detail).toContain('maxEntries=5');
        const two = JSON.parse(await capture(() => doctor(parseArgs(['--format', 'json', '--max-entries', '5', '--max-ratio', 'none'])))) as DoctorReport;
        const t = two.checks.find((c) => c.name === 'limits');
        expect(t?.value).toBe('2 override(s)');
        expect(t?.detail).toContain('maxCompressionRatio=unlimited');
    });

    it('ZIPNATIVE_JSON=1 emits compact JSON; --pretty restores indentation; --json flag also switches', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const compact = await capture(() => doctor(parseArgs([])));
        expect(compact.trimEnd()).not.toContain('\n');
        expect((JSON.parse(compact) as DoctorReport).ok).toBe(true);
        const pretty = await capture(() => doctor(parseArgs(['--pretty'])));
        expect(pretty).toContain('\n  ');
        delete process.env['ZIPNATIVE_JSON'];
        const flag = await capture(() => doctor(parseArgs(['--json'])));
        expect((JSON.parse(flag) as DoctorReport).checks).toHaveLength(10);
    });

    it('rejects an unknown --format (exit 2) and a zero --max-* bound', async () => {
        await expect(doctor(parseArgs(['--format', 'xml']))).rejects.toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
        await expect(capture(() => doctor(parseArgs(['--format', 'json', '--max-entries', '0'])))).rejects.toMatchObject({ exitCode: 2 });
    });

});
