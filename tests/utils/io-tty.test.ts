// Batch 1 of the 1.0.0 audit (A-08): a terminal with nothing piped is refused
// instead of blocking forever; an explicit `-` still reads stdin.

import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { assertStdinNotTty, openInputStream, readFileOrStdin, readStdin } from '../../src/utils/io.js';
import { CliError } from '../../src/utils/error.js';

const original = Object.getOwnPropertyDescriptor(process, 'stdin');

function stubStdin(isTTY: boolean | undefined, chunks: Buffer[] = []): void {
    const readable = Readable.from(chunks) as Readable & { isTTY?: boolean };
    if (isTTY !== undefined) readable.isTTY = isTTY;
    Object.defineProperty(process, 'stdin', { value: readable, configurable: true });
}

afterEach(() => {
    if (original !== undefined) Object.defineProperty(process, 'stdin', original);
});

describe('stdin TTY guard', () => {
    it('assertStdinNotTty throws E_USAGE (exit 2) on a terminal', () => {
        stubStdin(true);
        expect(() => assertStdinNotTty()).toThrow(CliError);
        try {
            assertStdinNotTty();
        } catch (e) {
            expect((e as CliError).exitCode).toBe(2);
            expect((e as CliError).message).toMatch(/--input/);
        }
    });

    it('is silent when stdin is piped', () => {
        stubStdin(false);
        expect(() => assertStdinNotTty()).not.toThrow();
        stubStdin(undefined);
        expect(() => assertStdinNotTty()).not.toThrow();
    });

    it('readFileOrStdin(undefined) refuses a terminal but reads a pipe', async () => {
        stubStdin(true);
        await expect(readFileOrStdin(undefined)).rejects.toMatchObject({ exitCode: 2 });
        stubStdin(false, [Buffer.from('piped')]);
        expect((await readFileOrStdin(undefined)).toString()).toBe('piped');
    });

    it('an explicit "-" is never guarded', async () => {
        stubStdin(true, [Buffer.from('explicit')]);
        expect((await readFileOrStdin('-')).toString()).toBe('explicit');
        stubStdin(true, [Buffer.from('again')]);
        expect((await readStdin(true)).toString()).toBe('again');
    });

    it('openInputStream(undefined) refuses a terminal; "-" does not', () => {
        stubStdin(true);
        expect(() => openInputStream(undefined)).toThrow(CliError);
        expect(() => openInputStream('-')).not.toThrow();
    });
});
