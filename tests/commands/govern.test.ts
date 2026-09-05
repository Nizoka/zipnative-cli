import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { govern } from '../../src/commands/govern.js';
import { parseArgs } from '../../src/utils/args.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';

interface Run {
    readonly text: string;
    readonly err: string;
    readonly error: unknown;
}

async function run(fn: () => Promise<void>): Promise<Run> {
    const outChunks: string[] = [];
    const errChunks: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
        outChunks.push(String(chunk));
        return true;
    }) as unknown as typeof process.stdout.write);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        errChunks.push(String(chunk));
        return true;
    }) as unknown as typeof process.stderr.write);
    let error: unknown;
    try {
        await fn();
    } catch (e) {
        error = e;
    } finally {
        outSpy.mockRestore();
        errSpy.mockRestore();
    }
    return { text: outChunks.join(''), err: errChunks.join(''), error };
}

const originalStdin = process.stdin;

const GOOD_DRAFT = `# Bug: verify mis-reports a CRC

## Environment
node v22, zipnative-cli 1.0.0, Windows 11

## Reproduction
\`\`\`
zipnative verify --input sample.zip
\`\`\`

## Expected
Exit 0 — the archive is intact.
`;

interface Verdict {
    ok: boolean;
    errors: string[];
    warnings: string[];
}

describe('govern', () => {
    let dir = '';

    afterEach(async () => {
        vi.restoreAllMocks();
        Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
        delete process.env['ZIPNATIVE_JSON'];
        if (dir !== '') await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        dir = '';
    });

    async function draft(content: string): Promise<string> {
        dir = await mkdtemp(join(tmpdir(), 'zipnative-cli-'));
        const p = join(dir, 'draft.md');
        await writeFile(p, content, 'utf8');
        return p;
    }

    it('rules: prints the human/agent protocol for zipnative', async () => {
        const r = await run(() => govern(parseArgs(['rules'])));
        expect(r.error).toBeUndefined();
        expect(r.text).toContain('zipnative');
        expect(r.text).toMatch(/draftsman/i);
        expect(r.text).toContain('zipnative govern verify-issue ./draft.md');
        expect(r.text).toContain('Zero runtime dependencies');
    });

    it('policy: prints the machine-readable policy as JSON (pretty by default, compact under --json)', async () => {
        const r = await run(() => govern(parseArgs(['policy'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as { applies_to: string[]; policy: Record<string, unknown>; verification: { command: string } };
        expect(doc.applies_to).toContain('zipnative-cli');
        expect(doc.applies_to).toContain('zipnative');
        expect(doc.policy['human_in_the_loop_mandatory']).toBe(true);
        expect(doc.policy['runtime_dependencies_allowed']).toBe(false);
        expect(doc.verification.command).toBe('zipnative govern verify-issue <draft.md>');
        expect(r.text).toContain('\n  ');
        process.env['ZIPNATIVE_JSON'] = '1';
        const compact = await run(() => govern(parseArgs(['policy'])));
        expect(compact.text.trimEnd()).not.toContain('\n');
        const pretty = await run(() => govern(parseArgs(['policy', '--pretty'])));
        expect(pretty.text).toContain('\n  ');
    });

    it('verify-issue: passes a compliant draft (fenced repro, environment, expected)', async () => {
        const p = await draft(GOOD_DRAFT);
        const text = await run(() => govern(parseArgs(['verify-issue', p])));
        expect(text.error).toBeUndefined();
        expect(text.text).toContain('Draft validation PASSED');
        expect(text.text).toContain('HUMAN');
        expect(text.err).toBe('');
        const json = await run(() => govern(parseArgs(['verify-issue', p, '--format', 'json'])));
        expect(json.error).toBeUndefined();
        expect(JSON.parse(json.text) as Verdict).toEqual({ ok: true, errors: [], warnings: [] });
    });

    it('verify-issue: accepts --input / -i and stdin (-)', async () => {
        const p = await draft(GOOD_DRAFT);
        const flag = await run(() => govern(parseArgs(['verify-issue', '--input', p, '--format', 'json'])));
        expect((JSON.parse(flag.text) as Verdict).ok).toBe(true);
        Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from(GOOD_DRAFT)]), configurable: true });
        const stdin = await run(() => govern(parseArgs(['verify-issue', '-', '--format', 'json'])));
        expect(stdin.error).toBeUndefined();
        expect((JSON.parse(stdin.text) as Verdict).ok).toBe(true);
    });

    it('verify-issue: a draft proposing `npm install foo` is E_POLICY (exit 1)', async () => {
        const p = await draft('Run `npm install foo` to fix it.\n\n```\nrepro\n```\n');
        const r = await run(() => govern(parseArgs(['verify-issue', p, '--format', 'json'])));
        expect(r.error).toBeInstanceOf(CliError);
        expect(r.error).toMatchObject({ code: ErrorCode.POLICY, exitCode: 1 });
        expect((r.error as CliError).message).toContain('zero-dependency');
        const doc = JSON.parse(r.text) as Verdict;
        expect(doc.ok).toBe(false);
        expect(doc.errors[0]).toContain('external dependency');
        // Text mode: the errors land on stderr and the CliError message is empty.
        const text = await run(() => govern(parseArgs(['verify-issue', p])));
        expect(text.error).toMatchObject({ code: ErrorCode.POLICY });
        expect((text.error as CliError).message).toBe('');
        expect(text.err).toContain('error: Proposing an external dependency');
        expect(text.text).toBe('');
    });

    it('verify-issue: a draft without a fenced reproduction fails, warnings go to stderr in text mode', async () => {
        const p = await draft('Something is broken. Expected it to work on node.\n');
        const r = await run(() => govern(parseArgs(['verify-issue', p])));
        expect(r.error).toMatchObject({ code: ErrorCode.POLICY, exitCode: 1 });
        expect(r.err).toContain('error: No reproduction code block found');
        expect(r.err).toContain('warning: Recommended field appears to be missing: minimal_reproduction');
    });

    it('verify-issue: anti-goal proposals surface as warnings without failing', async () => {
        const p = await draft('Please add support for AES encryption.\n\nRepro on node, expected behaviour differs:\n\n```\nrepro\n```\n');
        const r = await run(() => govern(parseArgs(['verify-issue', p, '--format', 'json'])));
        expect(r.error).toBeUndefined();
        const doc = JSON.parse(r.text) as Verdict;
        expect(doc.ok).toBe(true);
        expect(doc.warnings.some((w) => w.includes('anti-goal (encryption)'))).toBe(true);
    });

    it('verify-issue: ZIPNATIVE_JSON forces the JSON report', async () => {
        process.env['ZIPNATIVE_JSON'] = '1';
        const p = await draft(GOOD_DRAFT);
        const r = await run(() => govern(parseArgs(['verify-issue', p])));
        expect(r.error).toBeUndefined();
        expect((JSON.parse(r.text) as Verdict).ok).toBe(true);
        expect(r.text.trimEnd()).not.toContain('\n');
    });

    it('verify-issue: a missing draft path is a usage error (exit 2)', async () => {
        await expect(govern(parseArgs(['verify-issue']))).rejects.toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });

    it('rejects an unknown subcommand and requires one (exit 2)', async () => {
        await expect(govern(parseArgs(['bogus']))).rejects.toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
        await expect(govern(parseArgs([]))).rejects.toMatchObject({ exitCode: 2, code: ErrorCode.USAGE });
    });
});
