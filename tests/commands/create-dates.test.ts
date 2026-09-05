// Batch 2 of the 1.0.0 audit (A-02): `--date <ISO>` stores the UTC wall-clock
// in the DOS fields, so a --deterministic build hashes identically on every
// host regardless of TZ. Asserted on the raw dosDate/dosTime the engine read
// back, which is exactly what the archive bytes carry.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../../src/utils/args.js';
import { create } from '../../src/commands/create.js';
import { openZip } from '../../src/core-bridge/index.js';

const DOS_DATE_2020_06_01 = ((2020 - 1980) << 9) | (6 << 5) | 1; // 20673
const DOS_TIME_12_00_00 = 12 << 11; // 24576

describe('create --date is UTC wall-clock (TZ-independent)', () => {
    let tmp = '';

    beforeEach(async () => {
        tmp = await mkdtemp(join(tmpdir(), 'zipnative-cli-dates-'));
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await rm(tmp, { recursive: true, force: true });
    });

    async function entryFields(args: string[]): Promise<{ dosDate: number; dosTime: number }> {
        const out = join(tmp, `${Math.random().toString(36).slice(2)}.zip`);
        await create(parseArgs([...args, '-o', out]));
        const reader = openZip(new Uint8Array(await readFile(out)));
        const entry = [...reader.entries()][0];
        if (entry === undefined) throw new Error('no entry');
        return { dosDate: entry.dosDate, dosTime: entry.dosTime };
    }

    it('a zoned instant pins the UTC fields into the DOS timestamp', async () => {
        await writeFile(join(tmp, 'a.txt'), 'a');
        const fields = await entryFields([join(tmp, 'a.txt'), '--deterministic', '--date', '2020-06-01T12:00:00Z']);
        expect(fields).toEqual({ dosDate: DOS_DATE_2020_06_01, dosTime: DOS_TIME_12_00_00 });
    });

    it('an offset instant and a naive string store the same UTC wall-clock', async () => {
        await writeFile(join(tmp, 'b.txt'), 'b');
        const offset = await entryFields([join(tmp, 'b.txt'), '--date', '2020-06-01T14:00:00+02:00']);
        const naive = await entryFields([join(tmp, 'b.txt'), '--date', '2020-06-01T12:00:00']);
        expect(offset).toEqual({ dosDate: DOS_DATE_2020_06_01, dosTime: DOS_TIME_12_00_00 });
        expect(naive).toEqual(offset);
    });

    it('two --deterministic builds with the same zoned date are byte-identical', async () => {
        await writeFile(join(tmp, 'c.txt'), 'c'.repeat(500));
        const a = join(tmp, 'a.zip');
        const b = join(tmp, 'b.zip');
        await create(parseArgs([join(tmp, 'c.txt'), '--deterministic', '--date', '2021-03-04T05:06:08Z', '-o', a]));
        await create(parseArgs([join(tmp, 'c.txt'), '--deterministic', '--date', '2021-03-04T05:06:08Z', '-o', b]));
        expect(Buffer.compare(await readFile(a), await readFile(b))).toBe(0);
    });

    it('a manifest date follows the same rule', async () => {
        const manifest = join(tmp, 'm.json');
        await writeFile(manifest, JSON.stringify({ entries: [{ name: 'x.txt', data: 'x', date: '2020-06-01T12:00:00Z' }] }));
        const fields = await entryFields(['--from-manifest', manifest]);
        expect(fields).toEqual({ dosDate: DOS_DATE_2020_06_01, dosTime: DOS_TIME_12_00_00 });
    });
});
