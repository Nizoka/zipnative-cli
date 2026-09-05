import { describe, it, expect, vi, afterEach } from 'vitest';
import { schema, buildSchema, SUBJECTS, type Subject } from '../../src/commands/schema.js';
import { parseArgs } from '../../src/utils/args.js';
import { ErrorCode } from '../../src/utils/error.js';
import { cliVersion, engineVersion } from '../../src/utils/version.js';
import { ZIP_ERROR_CODES, ZIP_DIAGNOSTIC_CODES } from '../../src/utils/ziperr.js';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const EXPECTED_SUBJECTS = [
    'create-manifest', 'modify-manifest', 'batch-manifest',
    'entries', 'entries-summary', 'inspect', 'inspect-summary', 'verify', 'verify-summary',
    'stream', 'stream-summary', 'batch', 'batch-summary', 'doctor', 'govern-verify', 'crc32',
    'status', 'error', 'errors', 'limits', 'diagnostics', 'manifest',
];

const E_CODES = [
    'E_USAGE', 'E_INPUT', 'E_PARSE', 'E_IO', 'E_SECURITY', 'E_DATA', 'E_LIMIT', 'E_UNSUPPORTED',
    'E_NOT_FOUND', 'E_VERIFY_FAILED', 'E_CHECK_FAILED', 'E_POLICY', 'E_RUNTIME',
];

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

interface Manifest {
    kind: string;
    name: string;
    version: string;
    zipnative: string;
    contract: { stdout: string; stderr: string; exitCodes: Record<string, string>; network: string };
    globalFlags: string[];
    dryRunCommands: string[];
    projectedCommands: string[];
    manifestCommands: string[];
    errorCodes: string[];
    zipErrorCodes: string[];
    diagnosticCodes: string[];
    limits: { flag: string; key: string; default: number; cwe: string }[];
    schemas: string[];
    commands: { name: string; group: string; summary: string; flags: string[] }[];
}

describe('schema', () => {
    afterEach(() => vi.restoreAllMocks());

    it('exposes exactly the 22 documented subjects', () => {
        expect([...SUBJECTS]).toEqual(EXPECTED_SUBJECTS);
        expect(SUBJECTS).toHaveLength(22);
    });

    it.each(EXPECTED_SUBJECTS)('builds "%s" with a versioned $id', (subject) => {
        const doc = buildSchema(subject as Subject) as Record<string, unknown>;
        const re = new RegExp(`^https://zipnative\\.dev/schema/cli/\\d+\\.\\d+\\.\\d+/${subject}(\\.schema)?\\.json$`);
        expect(doc['$id']).toMatch(re);
        expect(String(doc['$id'])).toContain(`/${cliVersion()}/`);
        if (subject === 'manifest' || subject === 'errors') {
            expect(doc['$schema']).toBeUndefined();
            expect(doc['kind']).toBe(subject === 'manifest' ? 'capability-manifest' : 'error-codes');
        } else {
            expect(doc['$schema']).toBe(DRAFT);
            expect(typeof doc['title']).toBe('string');
            expect(doc['type']).toBe('object');
        }
    });

    it.each(EXPECTED_SUBJECTS)('prints "%s" through the command as valid JSON', async (subject) => {
        const out = await capture(() => schema(parseArgs([subject])));
        const doc = JSON.parse(out) as Record<string, unknown>;
        expect(doc['$id']).toBe((buildSchema(subject as Subject) as Record<string, unknown>)['$id']);
        expect(out).toContain('\n  ');
    });

    it('defaults to the create-manifest input schema when no subject is given', async () => {
        const doc = JSON.parse(await capture(() => schema(parseArgs([])))) as Record<string, unknown>;
        expect(doc['title']).toBe('zipnative-cli create manifest');
        expect(doc['$schema']).toBe(DRAFT);
        expect((doc['required'] as string[])).toEqual(['entries']);
    });

    it('"list" enumerates the subjects', async () => {
        const doc = JSON.parse(await capture(() => schema(parseArgs(['list'])))) as { subjects: string[] };
        expect(doc.subjects).toEqual(EXPECTED_SUBJECTS);
    });

    it('rejects an unknown subject with a usage error (exit 2)', async () => {
        await expect(schema(parseArgs(['bogus']))).rejects.toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });

    it('"manifest" is a capability manifest that mirrors the command surface', async () => {
        const doc = JSON.parse(await capture(() => schema(parseArgs(['manifest'])))) as Manifest;
        expect(doc.kind).toBe('capability-manifest');
        expect(doc.name).toBe('zipnative-cli');
        expect(doc.version).toBe(cliVersion());
        expect(doc.zipnative).toBe(engineVersion());
        expect(doc.contract.network).toContain('none');
        expect(doc.contract.exitCodes).toEqual({ '0': 'success', '1': 'runtime/check failure', '2': 'usage error' });
        expect(doc.commands).toHaveLength(15);
        expect(doc.commands.map((c) => c.name)).toEqual([
            'create', 'modify', 'list', 'inspect', 'cat', 'extract', 'stream', 'verify', 'crc32', 'inflate',
            'batch', 'doctor', 'schema', 'completion', 'govern',
        ]);
        for (const c of doc.commands) {
            expect(typeof c.summary).toBe('string');
            expect(['Create & modify', 'Read & extract', 'Integrity & codecs', 'Automation & meta']).toContain(c.group);
            expect(Array.isArray(c.flags)).toBe(true);
        }
        expect(doc.errorCodes).toEqual(E_CODES);
        expect(doc.zipErrorCodes).toHaveLength(39);
        expect(doc.zipErrorCodes).toEqual([...ZIP_ERROR_CODES]);
        expect(doc.diagnosticCodes).toHaveLength(11);
        expect(doc.diagnosticCodes).toEqual([...ZIP_DIAGNOSTIC_CODES]);
        expect(doc.limits).toHaveLength(8);
        expect(doc.limits[0]).toEqual({ flag: '--max-entries', key: 'maxEntries', default: 100000, cwe: 'CWE-400' });
        expect(doc.manifestCommands).toHaveLength(10);
        expect(doc.manifestCommands).not.toContain('batch');
        expect(doc.dryRunCommands).toEqual(expect.arrayContaining(['create', 'extract', 'modify']));
        expect(doc.projectedCommands).toEqual(['list', 'inspect', 'verify', 'stream', 'batch']);
        expect(doc.globalFlags).toEqual(expect.arrayContaining(['--json', '--dry-run', '--codec', '--max-entries', '--max-cd-bytes']));
        expect(doc.schemas).toEqual(EXPECTED_SUBJECTS);
    });

    it('"errors" maps all 39 ZIP_* codes to E_* classes with exit codes', async () => {
        const doc = JSON.parse(await capture(() => schema(parseArgs(['errors'])))) as {
            kind: string;
            cli: { code: string; exitCode: number }[];
            zipnativeToCli: Record<string, { code: string; exitCode: number }>;
            diagnostics: string[];
        };
        expect(doc.kind).toBe('error-codes');
        expect(Object.keys(doc.zipnativeToCli)).toHaveLength(39);
        expect(doc.zipnativeToCli['ZIP_PATH_TRAVERSAL']).toEqual({ code: 'E_SECURITY', exitCode: 1, remedy: '--skip-unsafe (extract, stream)' });
        expect(doc.zipnativeToCli['ZIP_ENTRY_OVERLAP']).toEqual({ code: 'E_SECURITY', exitCode: 1 });
        expect(doc.zipnativeToCli['ZIP_INVALID_OPTION']).toEqual({ code: 'E_USAGE', exitCode: 2 });
        expect(doc.zipnativeToCli['ZIP_LIMIT_EXCEEDED']).toEqual({ code: 'E_LIMIT', exitCode: 1, remedy: '--max-<bound> <size> (the bound is named in detail.limit; trusted input only)' });
        expect(doc.cli.map((c) => c.code)).toEqual(E_CODES);
        expect(doc.cli.find((c) => c.code === 'E_USAGE')?.exitCode).toBe(2);
        expect(doc.cli.filter((c) => c.code !== 'E_USAGE').every((c) => c.exitCode === 1)).toBe(true);
        expect(doc.diagnostics).toHaveLength(11);
    });

    it('the error envelope schema enumerates every E_* and ZIP_* code', () => {
        const doc = buildSchema('error') as { properties: { error: { properties: { code: { enum: string[] }; zipCode: { enum: string[] } } } } };
        expect(doc.properties.error.properties.code.enum).toEqual(E_CODES);
        expect(doc.properties.error.properties.zipCode.enum).toHaveLength(39);
    });

    it('the limits schema carries the eight bounds with engine defaults', () => {
        const doc = buildSchema('limits') as { properties: Record<string, { default: number; description: string }> };
        expect(Object.keys(doc.properties)).toEqual([
            'maxEntries', 'maxEntryUncompressedSize', 'maxTotalUncompressedSize', 'maxCompressionRatio',
            'maxNameBytes', 'maxExtraFieldBytes', 'maxCommentBytes', 'maxCentralDirectoryBytes',
        ]);
        expect(doc.properties['maxEntries']?.default).toBe(100000);
        expect(doc.properties['maxCompressionRatio']?.description).toContain('--max-ratio');
    });

    it('the diagnostics schema enumerates the eleven codes and the doctor schema the ten checks', () => {
        const diag = buildSchema('diagnostics') as { properties: { code: { enum: string[] } } };
        expect(diag.properties.code.enum).toHaveLength(11);
        const doc = buildSchema('doctor') as { properties: { checks: { items: { properties: { name: { enum: string[] } } } } } };
        expect(doc.properties.checks.items.properties.name.enum).toHaveLength(10);
    });

    it('the stream schema pins the trust constant and the batch-manifest schema the whitelist', () => {
        const stream = buildSchema('stream') as { properties: { trust: { const: string }; mode: { const: string } } };
        expect(stream.properties.trust.const).toBe('local-headers-only');
        expect(stream.properties.mode.const).toBe('list');
        const bm = buildSchema('batch-manifest') as { properties: { tasks: { items: { properties: { command: { enum: string[] } } } } } };
        expect(bm.properties.tasks.items.properties.command.enum).toHaveLength(10);
    });
});
