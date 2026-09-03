import { describe, it, expect, beforeAll } from 'vitest';
import {
    rowFromEntry,
    rowFromHeader,
    decodeFlags,
    methodName,
    crcHex,
    renderTable,
    type EntryRow,
} from '../../src/utils/entryfmt.js';
import {
    FLAG_DATA_DESCRIPTOR,
    FLAG_ENCRYPTED,
    FLAG_STRONG_ENCRYPTION,
    FLAG_UTF8,
    createZip,
    iterateZipEntries,
    openZip,
    type StreamedZipHeader,
    type ZipEntry,
} from '../../src/core-bridge/index.js';

const UT_EXTRA = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00]); // flags + one 32-bit mtime

let bytes: Uint8Array;
let entries: Map<string, ZipEntry>;
let headers: Map<string, StreamedZipHeader>;

async function* once(data: Uint8Array): AsyncGenerator<Uint8Array, void, undefined> {
    yield data;
}

beforeAll(async () => {
    const w = createZip();
    w.add('a.txt', 'stored bytes', { compression: { method: 'store' }, comment: 'hello comment' });
    w.add('big.txt', 'compressible '.repeat(200), { compression: { method: 'deflate', level: 6 } });
    w.addDirectory('d');
    w.add('u/é.txt', 'unicode', { extraFields: [{ id: 0x5455, data: UT_EXTRA }, { id: 0x1234, data: new Uint8Array([9]) }] });
    bytes = w.toBytes();

    entries = new Map();
    for (const e of openZip(bytes).entries()) entries.set(e.name, e);

    headers = new Map();
    for await (const streamed of iterateZipEntries(once(bytes))) {
        headers.set(streamed.header.name, streamed.header);
        await streamed.skip();
    }
});

function entry(name: string): ZipEntry {
    const e = entries.get(name);
    if (e === undefined) throw new Error(`missing entry ${name}`);
    return e;
}

function header(name: string): StreamedZipHeader {
    const h = headers.get(name);
    if (h === undefined) throw new Error(`missing header ${name}`);
    return h;
}

describe('decodeFlags', () => {
    it('decodes every FLAG_* mask independently', () => {
        expect(decodeFlags(0)).toEqual({ raw: 0, encrypted: false, dataDescriptor: false, strongEncryption: false, utf8: false });
        expect(decodeFlags(FLAG_ENCRYPTED)).toMatchObject({ encrypted: true, utf8: false });
        expect(decodeFlags(FLAG_DATA_DESCRIPTOR)).toMatchObject({ dataDescriptor: true });
        expect(decodeFlags(FLAG_STRONG_ENCRYPTION)).toMatchObject({ strongEncryption: true });
        expect(decodeFlags(FLAG_UTF8)).toMatchObject({ utf8: true });
        const all = FLAG_ENCRYPTED | FLAG_DATA_DESCRIPTOR | FLAG_STRONG_ENCRYPTION | FLAG_UTF8;
        expect(decodeFlags(all)).toEqual({ raw: all, encrypted: true, dataDescriptor: true, strongEncryption: true, utf8: true });
    });
});

describe('methodName / crcHex', () => {
    it('names the built-in methods and falls back to method-N', () => {
        expect(methodName(0)).toBe('store');
        expect(methodName(8)).toBe('deflate');
        expect(methodName(97)).toBe('method-97');
    });

    it('renders CRC-32 as 8 lowercase hex digits, unsigned', () => {
        expect(crcHex(0)).toBe('00000000');
        expect(crcHex(0xdeadbeef)).toBe('deadbeef');
        expect(crcHex(-1)).toBe('ffffffff');
        expect(crcHex(0x1)).toBe('00000001');
    });
});

describe('rowFromEntry (central directory)', () => {
    it('renders a stored file with its comment', () => {
        const e = entry('a.txt');
        const row = rowFromEntry(e);
        expect(row).toMatchObject({
            name: 'a.txt',
            nameEncoding: 'utf-8',
            isDirectory: false,
            isSymlink: false,
            method: 0,
            methodName: 'store',
            compressedSize: 12,
            uncompressedSize: 12,
            ratio: '0%',
            crc32: crcHex(e.crc32),
            isEncrypted: false,
            usesZip64: false,
            usesDataDescriptor: false,
            unixMode: '0644',
            comment: 'hello comment',
        });
        expect(row.crc32).toMatch(/^[0-9a-f]{8}$/);
        expect(new Date(row.lastModified).toISOString()).toBe(row.lastModified);
        expect('flags' in row).toBe(false);
    });

    it('renders a deflated file with a positive ratio and no comment key', () => {
        const row = rowFromEntry(entry('big.txt'));
        expect(row.method).toBe(8);
        expect(row.methodName).toBe('deflate');
        expect(row.compressedSize).toBeLessThan(row.uncompressedSize);
        expect(Number.parseInt(row.ratio, 10)).toBeGreaterThan(50);
        expect('comment' in row).toBe(false);
    });

    it('renders a directory entry', () => {
        const row = rowFromEntry(entry('d/'));
        expect(row).toMatchObject({ name: 'd/', isDirectory: true, uncompressedSize: 0, unixMode: '0755', ratio: '0%' });
    });

    it('keeps unicode names and flags them UTF-8', () => {
        const row = rowFromEntry(entry('u/é.txt'), { long: true });
        expect(row.name).toBe('u/é.txt');
        expect(row.nameEncoding).toBe('utf-8');
        expect(row.flags?.utf8).toBe(true);
    });

    it('adds the --long columns and names known extra fields', () => {
        const e = entry('u/é.txt');
        const row = rowFromEntry(e, { long: true });
        expect(row.flags).toEqual(decodeFlags(e.flags));
        expect(row.versionMadeBy).toBe(e.versionMadeBy);
        expect(row.versionNeeded).toBe(e.versionNeeded);
        expect(row.internalAttributes).toBe(e.internalAttributes);
        expect(row.externalAttributes).toBe(e.externalAttributes);
        expect(row.localHeaderOffset).toBe(e.localHeaderOffset);
        expect(row.dosDate).toBe(e.dosDate);
        expect(row.dosTime).toBe(e.dosTime);
        expect(row.extraFields).toEqual([
            { id: 0x5455, idHex: '0x5455', name: 'Extended timestamp (UT)', length: 5 },
            { id: 0x1234, idHex: '0x1234', name: null, length: 1 },
        ]);
    });

    it('includes hex payloads with extraHex', () => {
        const row = rowFromEntry(entry('u/é.txt'), { long: true, extraHex: true });
        expect(row.extraFields?.[0]?.hex).toBe('0100000000');
        expect(row.extraFields?.[1]?.hex).toBe('09');
    });

    it('does not include extra fields without --long even when extraHex is set', () => {
        const row = rowFromEntry(entry('u/é.txt'), { extraHex: true });
        expect(row.extraFields).toBeUndefined();
    });
});

describe('rowFromHeader (forward-streamed local header)', () => {
    it('renders the LFH subset with CD-only fields nulled', () => {
        const h = header('a.txt');
        const row = rowFromHeader(h);
        expect(row).toMatchObject({
            name: 'a.txt',
            nameEncoding: 'utf-8',
            isDirectory: false,
            isSymlink: null,
            method: 0,
            methodName: 'store',
            compressedSize: 12,
            uncompressedSize: 12,
            crc32: crcHex(h.crc32),
            isEncrypted: false,
            usesZip64: null,
            usesDataDescriptor: false,
            unixMode: null,
        });
        expect('comment' in row).toBe(false);
        expect('flags' in row).toBe(false);
    });

    it('agrees with the central-directory row on the shared fields', () => {
        for (const name of ['a.txt', 'big.txt', 'd/', 'u/é.txt']) {
            const fromCd = rowFromEntry(entry(name));
            const fromLfh = rowFromHeader(header(name));
            expect(fromLfh.crc32, name).toBe(fromCd.crc32);
            expect(fromLfh.compressedSize, name).toBe(fromCd.compressedSize);
            expect(fromLfh.uncompressedSize, name).toBe(fromCd.uncompressedSize);
            expect(fromLfh.method, name).toBe(fromCd.method);
            expect(fromLfh.isDirectory, name).toBe(fromCd.isDirectory);
            expect(fromLfh.lastModified, name).toBe(fromCd.lastModified);
        }
    });

    it('adds the --long LFH columns only (no versionMadeBy / offsets)', () => {
        const h = header('u/é.txt');
        const row = rowFromHeader(h, { long: true, extraHex: true });
        expect(row.flags).toEqual(decodeFlags(h.flags));
        expect(row.versionNeeded).toBe(h.versionNeeded);
        expect(row.dosDate).toBe(h.dosDate);
        expect(row.dosTime).toBe(h.dosTime);
        expect(row.versionMadeBy).toBeUndefined();
        expect(row.localHeaderOffset).toBeUndefined();
        expect(row.extraFields?.map((f) => f.id)).toEqual([0x5455, 0x1234]);
        expect(row.extraFields?.[0]?.hex).toBe('0100000000');
    });
});

describe('renderTable', () => {
    const TABLE_NAMES = ['a.txt', 'big.txt', 'd/'] as const;
    let rows: EntryRow[] = [];

    beforeAll(() => {
        rows = TABLE_NAMES.map((n) => rowFromEntry(entry(n)));
    });

    it('renders a header line, a rule, one line per row, a rule and a totals line', () => {
        const out = renderTable(rows, false);
        const lines = out.split('\n');
        expect(out.endsWith('\n')).toBe(true);
        expect(lines[0]).toMatch(/^\s*Length\s+Method\s+Size\s+Ratio\s+Date\s+Time\s+CRC-32\s+Name$/);
        expect(lines[1]).toMatch(/^-+$/);
        expect(lines[1]?.length).toBe(lines[0]?.length);
        expect(lines).toHaveLength(1 + 1 + rows.length + 1 + 1 + 1); // + trailing ''
        expect(lines[lines.length - 3]).toMatch(/^-+$/);
        expect(lines[lines.length - 2]).toMatch(/3 entries$/);
    });

    it('sums lengths and sizes in the totals line', () => {
        const out = renderTable(rows, false);
        const totalLen = rows.reduce((s, r) => s + r.uncompressedSize, 0);
        const totalSize = rows.reduce((s, r) => s + r.compressedSize, 0);
        const totals = out.trimEnd().split('\n').pop() as string;
        expect(totals).toContain(String(totalLen));
        expect(totals).toContain(String(totalSize));
    });

    it('uses the singular for one entry', () => {
        expect(renderTable([rows[0] as EntryRow], false)).toMatch(/1 entry\n$/);
    });

    it('renders the DOS epoch as 1980-01-01 00:00 in local time', () => {
        expect(renderTable(rows, false)).toContain('1980-01-01 00:00');
    });

    it('lists every name and the CRC in the plain table', () => {
        const out = renderTable(rows, false);
        for (const r of rows) {
            expect(out).toContain(r.name);
            expect(out).toContain(r.crc32);
        }
        expect(out).not.toContain('Mode');
    });

    it('adds Mode and Flags columns with --long', () => {
        const out = renderTable(TABLE_NAMES.map((n) => rowFromEntry(entry(n), { long: true })), true);
        const head = out.split('\n')[0] as string;
        expect(head).toMatch(/Mode\s+Flags\s+Name$/);
        expect(out).toContain('0644');
        expect(out).toContain('0755');
        expect(out).toMatch(/\sU---\s/); // utf8 set, no descriptor / encryption / zip64
    });

    it('falls back to empty flags in --long for rows without flags', () => {
        const out = renderTable(rows, true);
        expect(out).toMatch(/\s0644\s+----\s+a\.txt/);
    });

    it('renders "-" for a row without a unix mode (DOS-authored) in --long', () => {
        const dos: EntryRow = { ...(rows[0] as EntryRow), unixMode: null };
        expect(renderTable([dos], true)).toMatch(/\s-\s+----\s+a\.txt/);
    });

    it('marks symlinks and encrypted entries', () => {
        const base = rowFromEntry(entry('a.txt'));
        const link: EntryRow = { ...base, name: 'link', isSymlink: true };
        const enc: EntryRow = { ...base, name: 'secret', isEncrypted: true };
        const out = renderTable([link, enc], false);
        expect(out).toContain('link -> (symlink)');
        expect(out).toContain('secret [encrypted]');
    });

    it('renders zip64 rows with a Z flag in --long', () => {
        const base = rowFromEntry(entry('a.txt'), { long: true });
        const z: EntryRow = { ...base, usesZip64: true };
        expect(renderTable([z], true)).toMatch(/\sU--Z\s/);
    });
});
