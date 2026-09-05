// The uniform output policy (audit A-14): every command that writes a file
// refuses an existing one with E_IO "Refusing to overwrite existing file …
// (pass --overwrite)" and leaves it intact; `--overwrite` replaces it. The
// sink commands (extract, stream) are covered in their own suites.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cat } from '../../src/commands/cat.js';
import { create } from '../../src/commands/create.js';
import { COMMANDS } from '../../src/commands/completion.js';
import { parseArgs } from '../../src/utils/args.js';
import { COMMAND_BOOLEAN_FLAGS } from '../../src/utils/flags.js';
import { createZip, openZip } from '../../src/core-bridge/index.js';

let tmp = '';
let src = '';
let archive = '';
let out = '';

async function fails(fn: () => Promise<void>): Promise<unknown> {
    try {
        await fn();
    } catch (e) {
        return e;
    }
    return undefined;
}

beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'zipnative-cli-ow-'));
    src = join(tmp, 'a.txt');
    await writeFile(src, 'alpha\n');
    const w = createZip();
    w.add('a.txt', 'alpha\n');
    archive = join(tmp, 'in.zip');
    await writeFile(archive, w.toBytes());
    out = join(tmp, 'out.bin');
    await writeFile(out, 'keep me');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmp, { recursive: true, force: true });
});

describe('--overwrite policy', () => {
    it('is declared on every file-writing command (COMMANDS + boolean table)', () => {
        for (const name of ['create', 'modify', 'cat', 'inflate', 'extract', 'stream']) {
            const spec = COMMANDS.find((c) => c.name === name);
            expect(spec?.flags, name).toContain('--overwrite');
            expect(COMMAND_BOOLEAN_FLAGS[name], name).toContain('overwrite');
        }
    });

    it('create: refuses an existing -o (buffered and --stream), intact; --overwrite replaces', async () => {
        const e1 = await fails(() => create(parseArgs([src, '-o', out])));
        expect(e1).toMatchObject({ code: 'E_IO', exitCode: 1, message: `Refusing to overwrite existing file ${out} (pass --overwrite).` });
        expect((await readFile(out)).toString()).toBe('keep me');
        const e2 = await fails(() => create(parseArgs([src, '-o', out, '--stream'])));
        expect(e2).toMatchObject({ code: 'E_IO' });
        expect((await readFile(out)).toString()).toBe('keep me');
        await create(parseArgs([src, '-o', out, '--overwrite']));
        expect([...openZip(new Uint8Array(await readFile(out))).entries()].map((e) => e.name)).toEqual(['a.txt']);
    });

    it('cat: refuses an existing -o, intact; --overwrite replaces', async () => {
        const e = await fails(() => cat(parseArgs([archive, 'a.txt', '-o', out])));
        expect(e).toMatchObject({ code: 'E_IO', exitCode: 1 });
        expect((await readFile(out)).toString()).toBe('keep me');
        await cat(parseArgs([archive, 'a.txt', '-o', out, '--overwrite']));
        expect((await readFile(out)).toString()).toBe('alpha\n');
    });

    it('create --dry-run never touches an existing output', async () => {
        await create(parseArgs([src, '-o', out, '--dry-run']));
        expect((await readFile(out)).toString()).toBe('keep me');
    });
});
