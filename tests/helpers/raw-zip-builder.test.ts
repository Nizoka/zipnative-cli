// The raw builder crafts every hostile archive in this suite, so it must be
// trusted before it is used as an attacker: an archive it writes by hand must
// open cleanly under eager validation and read back byte-identically.
import { describe, expect, it } from 'vitest';
import { openZip } from '../../src/core-bridge/index.js';
import { buildExtraField, buildRawZip, seededRandom } from './raw-zip-builder.js';

const te = new TextEncoder();

describe('raw-zip-builder (engine-independent oracle)', () => {
    it('builds a 2-entry archive that opens eagerly and reads back byte-identically', () => {
        const stored = te.encode('stored payload, kept verbatim');
        const deflated = te.encode('deflate '.repeat(64));
        const archive = buildRawZip([
            { name: 'a.txt', data: stored },
            { name: 'dir/b.txt', data: deflated, method: 8 },
        ]);

        const reader = openZip(archive, { validate: 'eager' });
        expect(reader.entryCount).toBe(2);

        const a = reader.getEntry('a.txt');
        const b = reader.getEntry('dir/b.txt');
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a?.compressionMethod).toBe(0);
        expect(b?.compressionMethod).toBe(8);
        expect(Buffer.from(reader.readEntry('a.txt'))).toEqual(Buffer.from(stored));
        expect(Buffer.from(reader.readEntry('dir/b.txt'))).toEqual(Buffer.from(deflated));
        expect(reader.verifyEntry('a.txt').ok).toBe(true);
        expect(reader.verifyEntry('dir/b.txt').ok).toBe(true);
    });

    it('is deterministic for identical specs', () => {
        const spec = [{ name: 'x', data: te.encode('same') }];
        expect(Buffer.from(buildRawZip(spec))).toEqual(Buffer.from(buildRawZip(spec)));
    });

    it('honours archive comment and prepend options (SFX-stub shape stays readable)', () => {
        const archive = buildRawZip([{ name: 'x', data: te.encode('1') }], {
            comment: te.encode('hello'),
            prepend: te.encode('#!/bin/sh\n'),
        });
        expect(Buffer.from(archive.subarray(0, 10)).toString()).toBe('#!/bin/sh\n');
        const diagnostics: string[] = [];
        const reader = openZip(archive, { onDiagnostic: (d) => diagnostics.push(d.code) });
        expect(Buffer.from(reader.comment).toString()).toBe('hello');
        expect(Buffer.from(reader.readEntry('x')).toString()).toBe('1');
        expect(diagnostics).toContain('ZIP_PREPENDED_DATA');
    });

    it('append produces the trailing-garbage attack shape the engine refuses', () => {
        const archive = buildRawZip([{ name: 'x', data: te.encode('1') }], {
            append: te.encode('trailing'),
        });
        expect(Buffer.from(archive.subarray(archive.length - 8)).toString()).toBe('trailing');
        expect(() => openZip(archive)).toThrow(/trailing garbage|self-consistent/);
    });

    it('buildExtraField encodes id/length/data triplets little-endian', () => {
        const block = buildExtraField([
            { id: 0x5455, data: new Uint8Array([1, 2, 3]) },
            { id: 0x0001, data: new Uint8Array(0) },
        ]);
        expect(Array.from(block)).toEqual([0x55, 0x54, 3, 0, 1, 2, 3, 0x01, 0x00, 0, 0]);
    });

    it('seededRandom is deterministic and bounded to [0, 1)', () => {
        const a = seededRandom(42);
        const b = seededRandom(42);
        for (let i = 0; i < 16; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });
});
