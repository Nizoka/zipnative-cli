// Entry rendering shared by `list`, `inspect` and `stream`: one JSON row shape
// (`EntryRow`) built from a `ZipEntry` (central directory) or a
// `StreamedZipHeader` (local header only), flag decoding via the core's
// `FLAG_*` masks, extra-field naming, and the text table.

import {
    FLAG_DATA_DESCRIPTOR,
    FLAG_ENCRYPTED,
    FLAG_STRONG_ENCRYPTION,
    FLAG_UTF8,
    METHOD_DEFLATE,
    METHOD_STORE,
    getCodec,
    getUnixMode,
    isSymlinkEntry,
    type StreamedZipHeader,
    type ZipEntry,
    type ZipExtraField,
} from '../core-bridge/index.js';
import { bytesToHex, decodeComment } from './zipops.js';
import { formatRatio } from './sizes.js';

export interface DecodedFlags {
    readonly raw: number;
    readonly encrypted: boolean;
    readonly dataDescriptor: boolean;
    readonly strongEncryption: boolean;
    readonly utf8: boolean;
}

export interface ExtraFieldRow {
    readonly id: number;
    readonly idHex: string;
    readonly name: string | null;
    readonly length: number;
    readonly hex?: string;
}

/** The public per-entry JSON row (see `schema entries`). */
export interface EntryRow {
    readonly name: string;
    readonly nameEncoding: 'utf-8' | 'cp437';
    readonly isDirectory: boolean;
    readonly isSymlink: boolean | null;
    readonly method: number;
    readonly methodName: string;
    readonly compressedSize: number;
    readonly uncompressedSize: number;
    readonly ratio: string;
    readonly crc32: string;
    readonly lastModified: string;
    readonly isEncrypted: boolean;
    readonly usesZip64: boolean | null;
    readonly usesDataDescriptor: boolean;
    readonly unixMode: string | null;
    readonly comment?: string;
    // --long
    readonly flags?: DecodedFlags;
    readonly versionMadeBy?: number;
    readonly versionNeeded?: number;
    readonly internalAttributes?: number;
    readonly externalAttributes?: number;
    readonly localHeaderOffset?: number;
    readonly dosDate?: number;
    readonly dosTime?: number;
    readonly extraFields?: readonly ExtraFieldRow[];
    /** The stored name bytes, hex (forensics: cp437 / invalid UTF-8 names). */
    readonly rawNameHex?: string;
    /** The stored comment bytes, hex (present when the entry has a comment). */
    readonly commentHex?: string;
}

const EXTRA_FIELD_NAMES: Readonly<Record<number, string>> = {
    0x0001: 'Zip64 extended information',
    0x0007: 'AV info',
    0x0008: 'Extended language encoding',
    0x0009: 'OS/2',
    0x000a: 'NTFS',
    0x000c: 'OpenVMS',
    0x000d: 'UNIX',
    0x000e: 'File stream and fork descriptors',
    0x000f: 'Patch descriptor',
    0x0014: 'PKCS#7 store',
    0x0015: 'X.509 certificate ID (file)',
    0x0016: 'X.509 certificate ID (CD)',
    0x0017: 'Strong encryption header',
    0x0018: 'Record management controls',
    0x0019: 'PKCS#7 encryption recipient list',
    0x0065: 'IBM S/390 attributes',
    0x4690: 'POSZIP 4690',
    0x5455: 'Extended timestamp (UT)',
    0x5855: 'Info-ZIP UNIX (original)',
    0x6375: 'Info-ZIP Unicode comment',
    0x7075: 'Info-ZIP Unicode path',
    0x7855: 'Info-ZIP UNIX (new)',
    0x7875: 'Info-ZIP UNIX (uid/gid)',
    0x9901: 'AES encryption (WinZip)',
    0xa220: 'Microsoft Open Packaging growth hint',
};

export function decodeFlags(flags: number): DecodedFlags {
    return {
        raw: flags,
        encrypted: (flags & FLAG_ENCRYPTED) !== 0,
        dataDescriptor: (flags & FLAG_DATA_DESCRIPTOR) !== 0,
        strongEncryption: (flags & FLAG_STRONG_ENCRYPTION) !== 0,
        utf8: (flags & FLAG_UTF8) !== 0,
    };
}

export function methodName(method: number): string {
    if (method === METHOD_STORE) return 'store';
    if (method === METHOD_DEFLATE) return 'deflate';
    const codec = getCodec(method);
    return codec !== null ? codec.name : `method-${method}`;
}

export function crcHex(crc: number): string {
    return (crc >>> 0).toString(16).padStart(8, '0');
}

function octal(mode: number): string {
    return '0' + (mode & 0o7777).toString(8);
}

function extraRows(fields: readonly ZipExtraField[], withHex: boolean): ExtraFieldRow[] {
    return fields.map((f) => ({
        id: f.id,
        idHex: '0x' + f.id.toString(16).padStart(4, '0'),
        name: EXTRA_FIELD_NAMES[f.id] ?? null,
        length: f.data.length,
        ...(withHex ? { hex: Buffer.from(f.data).toString('hex') } : {}),
    }));
}

export interface RowOptions {
    readonly long?: boolean;
    readonly extraHex?: boolean;
}

/** Row from a central-directory entry (full metadata). */
export function rowFromEntry(entry: ZipEntry, options: RowOptions = {}): EntryRow {
    const mode = getUnixMode(entry);
    const comment = decodeComment(entry.comment);
    const base: EntryRow = {
        name: entry.name,
        nameEncoding: entry.nameEncoding,
        isDirectory: entry.isDirectory,
        isSymlink: isSymlinkEntry(entry),
        method: entry.compressionMethod,
        methodName: methodName(entry.compressionMethod),
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
        ratio: formatRatio(entry.compressedSize, entry.uncompressedSize),
        crc32: crcHex(entry.crc32),
        lastModified: entry.lastModified.toISOString(),
        isEncrypted: entry.isEncrypted,
        usesZip64: entry.usesZip64,
        usesDataDescriptor: entry.usesDataDescriptor,
        unixMode: mode === null ? null : octal(mode),
        ...(comment.length > 0 ? { comment } : {}),
    };
    if (!options.long) return base;
    return {
        ...base,
        flags: decodeFlags(entry.flags),
        versionMadeBy: entry.versionMadeBy,
        versionNeeded: entry.versionNeeded,
        internalAttributes: entry.internalAttributes,
        externalAttributes: entry.externalAttributes,
        localHeaderOffset: entry.localHeaderOffset,
        dosDate: entry.dosDate,
        dosTime: entry.dosTime,
        extraFields: extraRows(entry.extraFields, options.extraHex === true),
        rawNameHex: bytesToHex(entry.rawName),
        ...(entry.comment.length > 0 ? { commentHex: bytesToHex(entry.comment) } : {}),
    };
}

/** Row from a forward-streamed local header (no CD-only fields). */
export function rowFromHeader(header: StreamedZipHeader, options: RowOptions = {}): EntryRow {
    const base: EntryRow = {
        name: header.name,
        nameEncoding: header.nameEncoding,
        isDirectory: header.isDirectory,
        isSymlink: null,
        method: header.compressionMethod,
        methodName: methodName(header.compressionMethod),
        compressedSize: header.compressedSize,
        uncompressedSize: header.uncompressedSize,
        ratio: formatRatio(header.compressedSize, header.uncompressedSize),
        crc32: crcHex(header.crc32),
        lastModified: header.lastModified.toISOString(),
        isEncrypted: header.isEncrypted,
        usesZip64: null,
        usesDataDescriptor: (header.flags & FLAG_DATA_DESCRIPTOR) !== 0,
        unixMode: null,
    };
    if (!options.long) return base;
    return {
        ...base,
        flags: decodeFlags(header.flags),
        versionNeeded: header.versionNeeded,
        dosDate: header.dosDate,
        dosTime: header.dosTime,
        extraFields: extraRows(header.extraFields, options.extraHex === true),
        rawNameHex: bytesToHex(header.rawName),
    };
}

function pad(s: string, w: number, left = false): string {
    return left ? s.padEnd(w) : s.padStart(w);
}

function fmtDate(iso: string): string {
    // The core builds `lastModified` from the DOS fields in LOCAL time (like
    // every archiver); render the table in local time too so the DOS epoch
    // reads 1980-01-01 00:00 everywhere. JSON keeps the ISO/UTC instant.
    const d = new Date(iso);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `unzip -l`-style text table. */
export function renderTable(rows: readonly EntryRow[], long: boolean): string {
    const lines: string[] = [];
    const head = long
        ? `${pad('Length', 12)}  ${pad('Method', 8, true)}  ${pad('Size', 12)}  Ratio  ${pad('Date', 10, true)} ${pad('Time', 5, true)}  ${pad('CRC-32', 8, true)}  ${pad('Mode', 6, true)}  Flags  Name`
        : `${pad('Length', 12)}  ${pad('Method', 8, true)}  ${pad('Size', 12)}  Ratio  ${pad('Date', 10, true)} ${pad('Time', 5, true)}  ${pad('CRC-32', 8, true)}  Name`;
    lines.push(head);
    lines.push('-'.repeat(head.length));
    let totalLen = 0;
    let totalSize = 0;
    for (const r of rows) {
        totalLen += r.uncompressedSize;
        totalSize += r.compressedSize;
        const mark = r.isSymlink === true ? ' -> (symlink)' : r.isEncrypted ? ' [encrypted]' : '';
        const common = `${pad(String(r.uncompressedSize), 12)}  ${pad(r.methodName, 8, true)}  ${pad(String(r.compressedSize), 12)}  ${pad(r.ratio, 5)}  ${fmtDate(r.lastModified)}  ${r.crc32}`;
        if (long) {
            const flags = r.flags ?? decodeFlags(0);
            const f = `${flags.utf8 ? 'U' : '-'}${flags.dataDescriptor ? 'D' : '-'}${flags.encrypted ? 'E' : '-'}${r.usesZip64 === true ? 'Z' : '-'}`;
            lines.push(`${common}  ${pad(r.unixMode ?? '-', 6, true)}  ${pad(f, 5, true)}  ${r.name}${mark}`);
        } else {
            lines.push(`${common}  ${r.name}${mark}`);
        }
    }
    lines.push('-'.repeat(head.length));
    lines.push(`${pad(String(totalLen), 12)}  ${pad('', 8)}  ${pad(String(totalSize), 12)}  ${pad(formatRatio(totalSize, totalLen), 5)}  ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`);
    return lines.join('\n') + '\n';
}
