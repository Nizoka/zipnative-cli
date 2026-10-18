// Regression tests for the findings of the 1.1.0 branch review:
//   1. `stream` under --timeout mid-entry — needs a child process (the hang
//      drained the event loop): tests/integration/built-binary-smoke.test.ts;
//   2. an abort that reaches a decompressor is the deadline (E_LIMIT), not
//      ZIP_DECOMPRESSION_FAILED;
//   3. a `false` in .zipnativerc.json never turns a switch on;
//   4. `batch` directory mode accepts the create flags it forwards;
//   5. a manifest task cannot carry `timeout` (one deadline per process);
// and of the security review: terminal-safe fields (LF, invisible
// characters), manifest `comment-file` anchoring, the FIFO read blocks.

import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertInvocation } from '../../src/commands/completion.js';
import { createZip, openZip } from '../../src/core-bridge/index.js';
import { parseArgs } from '../../src/utils/args.js';
import { applyConfigDefaults } from '../../src/utils/config.js';
import { _resetControl, armTimeout } from '../../src/utils/control.js';
import { CliError, ErrorCode } from '../../src/utils/error.js';
import { parseManifest } from '../../src/utils/manifest.js';
import { mapZipError } from '../../src/utils/ziperr.js';
import { readFileOrStdin } from '../../src/utils/io.js';
import { escapeLine, escapeTerminal, hasTerminalControls } from '../../src/utils/sanitize.js';
import { renderTable, rowFromEntry } from '../../src/utils/entryfmt.js';

afterEach(() => {
    _resetControl();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('mapZipError after the deadline (review finding 2)', () => {
    it('returns the deadline error whatever the engine wrapped it in', async () => {
        armTimeout(parseArgs(['--timeout', '1']));
        await sleep(15);
        const wrapped = mapZipError(new Error('failed to decompress (Timed out …) — the data is corrupt or hostile'), 'Failed to extract');
        expect(wrapped).toMatchObject({ code: ErrorCode.LIMIT, detail: { limit: 'timeout' } });
    });

    it('maps normally when no deadline was armed', () => {
        expect(mapZipError(new Error('boom'), 'ctx').code).toBe(ErrorCode.RUNTIME);
    });
});

describe('config booleans (review finding 3)', () => {
    it('false never turns a switch on; it is not reported as applied', () => {
        const known = new Set(['json', 'long', 'strict', 'format']);
        const { args, applied } = applyConfigDefaults(parseArgs([]), { json: false, strict: false, long: true }, known);
        expect(args.flags['json']).toBeUndefined();
        expect(args.flags['strict']).toBeUndefined();
        expect(args.flags['long']).toBe(true);
        expect(applied).toEqual(['long']);
    });
});

describe('batch directory mode flags (review finding 4)', () => {
    it('accepts every create flag it forwards, repeatable filters included', () => {
        expect(() => {
            assertInvocation('batch', parseArgs([
                '--input-dir', 'in', '--output-dir', 'out', '--exclude', '*.log', '--exclude', '*.tmp', '--include', '**',
                '--dir-entries', '--store-ext', 'png', '--mtime', '--stream', '--zip64', '--prefix', 'p/', '--preserve-mode',
            ]));
        }).not.toThrow();
    });

    it('still refuses what create would refuse to receive from batch (an input or an output)', () => {
        expect(() => { assertInvocation('batch', parseArgs(['--input-dir', 'in', '--stdin-name', 'x'])); }).toThrow(CliError);
    });
});

describe('manifest task timeout (review finding 5)', () => {
    it('is refused: the deadline is one per process', () => {
        const text = JSON.stringify({ version: 1, tasks: [{ id: 'a', command: 'list', flags: { input: 'a.zip', timeout: '200ms' } }] });
        expect(() => parseManifest(text, tmpdir())).toThrow(/"timeout" is not a task flag/);
    });
});

// ── Security review findings ────────────────────────────────────────────

describe('terminal-safe fields (security review 3, 4)', () => {
    const cp = (n: number): string => String.fromCodePoint(n);

    it('escapeLine escapes TAB and LF, so a name cannot forge a row or a remedy line', () => {
        const forged = `readme.txt${cp(10)}          5  2026-01-01 00:00  safe.txt`;
        expect(escapeLine(forged)).not.toContain(cp(10));
        expect(escapeLine(forged)).toContain('readme.txt\\x0a');
        expect(escapeLine(`a${cp(9)}b`)).toBe('a\\x09b');
        // A report keeps its own lines.
        expect(escapeTerminal(`a${cp(10)}b`)).toBe(`a${cp(10)}b`);
    });

    it('escapes the invisible look-alike characters, keeps ZWJ / ZWNJ and variation selectors', () => {
        for (const n of [0x00ad, 0x115f, 0x1160, 0x200b, 0x2028, 0x2029, 0x2060, 0x2064, 0x3164, 0xfeff, 0xffa0, 0xe0041]) {
            const out = escapeTerminal(`x${cp(n)}y`);
            expect(out, n.toString(16)).not.toContain(cp(n));
            expect(hasTerminalControls(`x${cp(n)}y`), n.toString(16)).toBe(true);
        }
        expect(escapeTerminal(cp(0xe0041))).toBe('\\u{e0041}');
        for (const n of [0x200c, 0x200d, 0xfe0f]) expect(escapeTerminal(`x${cp(n)}y`)).toBe(`x${cp(n)}y`);
    });

    it('list renders a name with an LF as ONE row', async () => {
        const zip = createZip();
        zip.add(`readme.txt${cp(10)}   5  safe.txt`, new TextEncoder().encode('x'));
        const rows = [...openZip(zip.toBytes()).entries()].map((e) => rowFromEntry(e));
        const table = renderTable(rows, false);
        expect(table.split(cp(10)).filter((l) => l.includes('safe.txt'))).toHaveLength(1);
        expect(table).toContain('readme.txt\\x0a');
    });
});

describe('manifest comment-file (security review 6)', () => {
    it('is anchored to the manifest directory and refused on ..', () => {
        const dir = join(tmpdir(), 'mf');
        const ok = parseManifest(JSON.stringify({ version: 1, tasks: [{ id: 'a', command: 'create', flags: { input: 'x', output: 'o.zip', 'comment-file': 'c.txt' } }] }), dir);
        expect(ok.tasks[0]?.flags['comment-file']).toBe(resolve(dir, 'c.txt'));
        expect(() => parseManifest(JSON.stringify({ version: 1, tasks: [{ id: 'a', command: 'create', flags: { input: 'x', output: 'o.zip', 'comment-file': '../c.txt' } }] }), dir)).toThrow(CliError);
    });
});

describe.skipIf(process.platform === 'win32')('bounded read of a FIFO (security review 1)', () => {
    it('a trickled FIFO reads back exactly (one block kept per 64 KiB, not per read)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'zipnative-fifo-'));
        try {
            const fifo = join(dir, 'p');
            expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
            const payload = Buffer.from(Array.from({ length: 70_000 }, (_, i) => i & 255));
            // A writer that delivers small pieces, so the reader sees many short reads.
            const writer = spawn(process.execPath, ['-e', `
                const fs = require('fs'); const fd = fs.openSync(process.argv[1], 'w');
                const b = Buffer.from(Array.from({ length: 70000 }, (_, i) => i & 255));
                for (let i = 0; i < b.length; i += 997) fs.writeSync(fd, b.subarray(i, i + 997));
                fs.closeSync(fd);`, fifo]);
            const read = await readFileOrStdin(fifo, 1024 * 1024);
            await new Promise((r) => writer.on('exit', r));
            expect(Buffer.compare(Buffer.from(read), payload)).toBe(0);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
