import { describe, it, expect } from 'vitest';
import { captureStdout } from '../../src/utils/io.js';

describe('captureStdout', () => {
    it('collects everything the callback writes to stdout and restores the writer', async () => {
        const original = process.stdout.write;
        const { result, bytes } = await captureStdout(async () => {
            process.stdout.write('hello ');
            process.stdout.write(Buffer.from('world'));
            return 42;
        });
        expect(result).toBe(42);
        expect(bytes.toString()).toBe('hello world');
        expect(process.stdout.write).toBe(original);
    });

    it('restores the writer when the callback throws, and rethrows', async () => {
        const original = process.stdout.write;
        await expect(captureStdout(async () => {
            process.stdout.write('partial');
            throw new Error('boom');
        })).rejects.toThrow('boom');
        expect(process.stdout.write).toBe(original);
    });

    it('caps the capture with E_LIMIT { limit: captureBytes }', async () => {
        const original = process.stdout.write;
        let caught: unknown;
        try {
            await captureStdout(async () => {
                for (let i = 0; i < 10; i++) process.stdout.write(Buffer.alloc(100));
            }, 500);
        } catch (e) {
            caught = e;
        }
        expect(caught).toMatchObject({ code: 'E_LIMIT', detail: { limit: 'captureBytes', configured: 500, observed: 600 } });
        expect(process.stdout.write).toBe(original);
    });

    it('honours the write callback contract (encoding-or-callback overload)', async () => {
        const calls: string[] = [];
        const { bytes } = await captureStdout(async () => {
            await new Promise<void>((r) => process.stdout.write('a', () => { calls.push('cb1'); r(); }));
            await new Promise<void>((r) => process.stdout.write('b', 'utf8', () => { calls.push('cb2'); r(); }));
        });
        expect(bytes.toString()).toBe('ab');
        expect(calls).toEqual(['cb1', 'cb2']);
    });
});
