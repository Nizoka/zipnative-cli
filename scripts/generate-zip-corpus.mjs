/**
 * zipnative-cli — veraZIP conformance corpus generator
 * ======================================================
 * Drives the BUILT CLI (`node dist/cli.cjs …`) — never a globally installed
 * `zipnative` binary — to produce a small, deterministic corpus of archives
 * under `test-output/zip/`, covering the write-side command surface
 * (create: store/deflate levels, manifests, unicode + deep names, comments,
 * --deterministic, --stream, --parallel, stdin; modify: append-only and
 * --compact) plus a set of CRAFTED archives written by an independent raw
 * ZIP writer (below): a forced-Zip64 layout, three spec-valid-but-hostile
 * shapes the CLI must REFUSE, and four well-formedness negatives the
 * validator must REJECT. `scripts/validate-zip.mjs` then validates every
 * file clause-by-clause against ISO/IEC 21320-1:2015.
 *
 * Usage:  npm run build && npm run corpus:zip
 *         node scripts/generate-zip-corpus.mjs
 * Exit:   0 when every file was written and every gate-time assertion held,
 *         1 at the first failing CLI invocation or assertion (stderr is
 *         reproduced), 2 when dist/cli.cjs is missing.
 *
 * Dependency-free: node built-ins only, and the CLI is spawned via
 * `process.execPath` (a real .exe / ELF binary — no `.bat` launcher, so no
 * `shell: true` and none of the CVE-2024-27980 quoting concerns apply).
 *
 * Anti-circularity: the raw writer below never imports `zipnative` — its
 * deflate comes from node:zlib and its CRC-32 from a 10-line table, so a
 * crafted negative is never shaped by the engine it exists to test. The CLI
 * IS invoked here (that is this script's job: producing the corpus and
 * checking the CLI's own verdicts on it), but never for parsing a crafted
 * archive on the validator's behalf.
 *
 * Gate-time assertions (exit 1 on any miss — a corpus that lies must never
 * reach the validator):
 *   - every CLI-produced conformant archive passes `verify --format json`
 *     with ok: true (the high-ratio sample with --max-ratio 2048);
 *   - every `refusedBy` entry is refused by the named command under --json
 *     with exit ≠ 0 and error.zipCode equal to the declared ZIP_* code;
 *   - deterministic-a/b and parallel-* are byte-identical pairs;
 *     stream-parity-* carry the same entries/CRCs/sizes (the --stream writer
 *     emits data descriptors, so bytes differ by design);
 *     the streaming sample carries a data descriptor; the append-only
 *     modify keeps the original bytes as its prefix; --compact drops the
 *     removed payload; every file starts with `PK`.
 *
 * Every manifest entry carries `expectConformant` and, for negatives, the
 * exact check id the validator must report (`expectedCheck`).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'test-output', 'zip');
const SPECS_DIR = join(OUT_DIR, '.specs');
const SRC_DIR = join(SPECS_DIR, 'src');
const INPUTS_DIR = join(SPECS_DIR, 'inputs');
const MANIFESTS_DIR = join(SPECS_DIR, 'manifests');
const REFUSE_TMP = join(SPECS_DIR, 'refuse-tmp');
const CLI = join(ROOT, 'dist', 'cli.cjs');

if (!existsSync(CLI)) {
    process.stderr.write('dist/cli.cjs not found — run `npm run build` first.\n');
    process.exit(2);
}

const log = (s) => process.stderr.write(`${s}\n`);
const out = (s) => process.stdout.write(`${s}\n`);
const posix = (p) => p.split('\\').join('/');
const rel = (p) => posix(relative(ROOT, p));
const te = new TextEncoder();

function fail(label, lines) {
    log(`FAIL  ${label}`);
    for (const l of lines) log(`      ${l}`);
    process.exit(1);
}

// ── Raw ZIP writer (engine-independent; subset of zipnative's test builder) ──
// Ported from zipnative tests/helpers/raw-zip-builder.ts (the anti-circularity
// cornerstone): headers written by hand, deflate from node:zlib, CRC-32 from a
// local table (node:zlib.crc32 needs Node 22.2+; the engine floor is 22.0).

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
}
function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a complete ZIP archive from raw entry specs.
 * Entry: { name, data?, method? (0|8), flags?, versionNeeded?, externalAttributes?,
 *          lfhNameOverride?, localHeaderOffsetOverride?, uncompressedSizeOverride? }
 * Options: { totalEntriesOverride?, forceZip64?, prepend?, comment? }
 */
function buildRawZip(entries, options = {}) {
    const parts = [];
    const central = [];
    let offset = 0;
    const w16 = (v, p, x) => v.setUint16(p, x, true);
    const w32 = (v, p, x) => v.setUint32(p, x >>> 0, true);

    for (const spec of entries) {
        const name = typeof spec.name === 'string' ? te.encode(spec.name) : spec.name;
        const data = spec.data ?? new Uint8Array(0);
        const method = spec.method ?? 0;
        const stored = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
        const crc = crc32(data);
        const flags = (spec.flags ?? 0) | (name.some((b) => b > 0x7f) ? 0x0800 : 0);
        const versionNeeded = spec.versionNeeded ?? 20;

        const lfhName = spec.lfhNameOverride ?? name;
        const lfh = new Uint8Array(30 + lfhName.length);
        const lv = new DataView(lfh.buffer);
        w32(lv, 0, 0x04034b50);
        w16(lv, 4, versionNeeded);
        w16(lv, 6, flags);
        w16(lv, 8, method);
        w16(lv, 10, 0);
        w16(lv, 12, 0x0021);
        w32(lv, 14, crc);
        w32(lv, 18, stored.length);
        w32(lv, 22, data.length);
        w16(lv, 26, lfhName.length);
        w16(lv, 28, 0);
        lfh.set(lfhName, 30);

        const cfh = new Uint8Array(46 + name.length);
        const cv = new DataView(cfh.buffer);
        w32(cv, 0, 0x02014b50);
        w16(cv, 4, 0x031e);
        w16(cv, 6, versionNeeded);
        w16(cv, 8, flags);
        w16(cv, 10, method);
        w16(cv, 12, 0);
        w16(cv, 14, 0x0021);
        w32(cv, 16, crc);
        w32(cv, 20, stored.length);
        w32(cv, 24, spec.uncompressedSizeOverride ?? data.length);
        w16(cv, 28, name.length);
        w16(cv, 30, 0);
        w16(cv, 32, 0);
        w16(cv, 34, 0);
        w16(cv, 36, 0);
        w32(cv, 38, spec.externalAttributes ?? 0);
        w32(cv, 42, spec.localHeaderOffsetOverride ?? offset);
        cfh.set(name, 46);
        central.push(cfh);

        parts.push(lfh, stored);
        offset += lfh.length + stored.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const record of central) {
        parts.push(record);
        cdSize += record.length;
        offset += record.length;
    }

    const comment = options.comment !== undefined ? te.encode(options.comment) : new Uint8Array(0);
    const totalEntries = options.totalEntriesOverride ?? entries.length;
    const zip64 = options.forceZip64 === true;

    if (zip64) {
        const z64Pos = offset;
        const z64 = new Uint8Array(56);
        const zv = new DataView(z64.buffer);
        w32(zv, 0, 0x06064b50);
        zv.setBigUint64(4, 44n, true);
        w16(zv, 12, 0x032d);
        w16(zv, 14, 45);
        w32(zv, 16, 0);
        w32(zv, 20, 0);
        zv.setBigUint64(24, BigInt(totalEntries), true);
        zv.setBigUint64(32, BigInt(totalEntries), true);
        zv.setBigUint64(40, BigInt(cdSize), true);
        zv.setBigUint64(48, BigInt(cdOffset), true);
        parts.push(z64);
        const locator = new Uint8Array(20);
        const lv2 = new DataView(locator.buffer);
        w32(lv2, 0, 0x07064b50);
        w32(lv2, 4, 0);
        lv2.setBigUint64(8, BigInt(z64Pos), true);
        w32(lv2, 16, 1);
        parts.push(locator);
    }

    const eocd = new Uint8Array(22 + comment.length);
    const ev = new DataView(eocd.buffer);
    w32(ev, 0, 0x06054b50);
    w16(ev, 4, 0);
    w16(ev, 6, 0);
    w16(ev, 8, zip64 ? 0xffff : totalEntries);
    w16(ev, 10, zip64 ? 0xffff : totalEntries);
    w32(ev, 12, zip64 ? 0xffffffff : cdSize);
    w32(ev, 16, zip64 ? 0xffffffff : cdOffset);
    w16(ev, 20, comment.length);
    eocd.set(comment, 22);
    parts.push(eocd);

    return Buffer.concat([options.prepend ?? new Uint8Array(0), ...parts]);
}

// ── CLI invocation ──────────────────────────────────────────────────────

/** Run `node dist/cli.cjs <args>`; never throws — returns { status, stdout, stderr, error }. */
function runCli(args, { input } = {}) {
    const r = spawnSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        input: input !== undefined ? input : undefined,
        stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
        env: process.env,
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? String(r.error.message ?? r.error) : null };
}

/** ROOT-relative, posix rendering of an argv token (also inside `name=path` values). */
const recordArg = (a) => (a.includes(ROOT) ? posix(a.split(ROOT).join('.')) : a);

/**
 * Run the CLI and exit 1 on spawn error or non-zero exit (stderr reproduced).
 * Returns the spawn result plus `args`, the ROOT-relative argv recorded in
 * the manifest as the entry's `command`.
 */
function cli(label, args, opts) {
    const r = runCli(args, opts);
    if (r.error || r.status !== 0) {
        const lines = [`node dist/cli.cjs ${args.map(recordArg).join(' ')}`];
        if (r.error) lines.push(`spawn failed: ${r.error}`);
        else lines.push(`exit ${r.status}`);
        for (const l of r.stderr.trim().split(/\r?\n/)) if (l) lines.push(l);
        fail(label, lines);
    }
    return { ...r, args: args.map(recordArg) };
}

/** Last JSON object on stderr with ok:false (the --json error envelope), or null. */
function errorEnvelope(stderr) {
    for (const line of stderr.trim().split(/\r?\n/).reverse()) {
        try {
            const v = JSON.parse(line);
            if (v && typeof v === 'object' && v.ok === false) return v;
        } catch { /* progress line */ }
    }
    return null;
}

// ── Source tree + inputs (deterministic, regenerated every run) ─────────

function writeSourceTree() {
    rmSync(SPECS_DIR, { recursive: true, force: true });
    for (const d of [SRC_DIR, INPUTS_DIR, MANIFESTS_DIR]) mkdirSync(d, { recursive: true });
    const put = (base, name, data) => {
        const p = join(base, name);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, data);
        return p;
    };
    const pattern = new Uint8Array(4096);
    for (let i = 0; i < pattern.length; i++) pattern[i] = (i * 31 + 7) & 0xff;
    put(SRC_DIR, 'text/readme.txt', 'zipnative-cli conformance corpus — plain ASCII text\n'.repeat(20));
    put(SRC_DIR, 'text/notes.md', '# Notes\n\nThe same line, over and over, compresses well.\n'.repeat(40));
    put(SRC_DIR, 'binary/pattern.bin', pattern);
    put(SRC_DIR, 'unicode/café/résumé.txt', 'non-ASCII path components (Latin-1 range)\n');
    put(SRC_DIR, 'unicode/文档/说明.md', '# 说明\n\nCJK path components\n');
    put(SRC_DIR, 'unicode/emoji-📦.txt', 'astral-plane code point in the name\n');

    const large = Array.from({ length: 2000 }, (_, i) => `line ${String(i + 1).padStart(4, '0')}: the quick brown fox jumps over the lazy dog`).join('\n') + '\n';
    put(INPUTS_DIR, 'large.txt', large);
    put(INPUTS_DIR, 'config-v2.json', '{ "version": 2, "features": ["incremental", "compact"] }\n');
    put(INPUTS_DIR, 'CHANGES.md', '# Changes\n\n- config.json bumped to v2\n- obsolete.log removed\n');
    put(INPUTS_DIR, 'zeros.bin', new Uint8Array(1024 * 1024));
    put(INPUTS_DIR, 'stdin-payload.bin', pattern.subarray(0, 1024));
    put(INPUTS_DIR, 'sfx-stub.sh', '#!/bin/sh\necho stub\n');
}

function manifestFile(name, doc) {
    const p = join(MANIFESTS_DIR, name);
    writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    return p;
}

// ── Corpus definition ───────────────────────────────────────────────────

const src = (p) => join(SRC_DIR, p);
const input = (p) => join(INPUTS_DIR, p);
const dest = (file) => join(OUT_DIR, file);
const bytesOf = (file) => readFileSync(dest(file));

/**
 * The CLI's refusals, as OBSERVED (zipnative 1.0.0) and re-verified at gate
 * time under --json: `{ command, code }` is what the manifest records.
 *   - `list` is lazy by default and accepts an overlapping archive; the
 *     eager readers (`inspect`, `list --validate eager`, `verify`) refuse it
 *     with ZIP_ENTRY_OVERLAP — `inspect` is recorded.
 *   - a 2 GiB declared size on a 4-byte stored payload is refused on read
 *     (`cat`, `extract`) as ZIP_LIMIT_EXCEEDED (the 1 GiB --max-entry-size
 *     bound), not as a CD↔LFH mismatch.
 *   - the LFH-name mismatch is NOT refused (verify exits 0; cat only emits a
 *     ZIP_NAME_MISMATCH diagnostic) — only the validator catches it.
 */
const REFUSE = {
    zipSlip: { command: 'extract', code: 'ZIP_PATH_TRAVERSAL' },
    deviceName: { command: 'extract', code: 'ZIP_PATH_TRAVERSAL' },
    duplicatePaths: { command: 'extract', code: 'ZIP_EXTRACT_DUPLICATE_PATH' },
    overlap: { command: 'inspect', code: 'ZIP_ENTRY_OVERLAP' },
    cdMismatch: { command: 'list', code: 'ZIP_CD_INCONSISTENT' },
    declaredBomb: { command: 'cat', code: 'ZIP_LIMIT_EXCEEDED', entry: 'bomb.bin' },
};

/**
 * `file` is the output name; `run(file)` produces it and returns the argv
 * recorded in the manifest (null for crafted files); `after(file)` runs the
 * gate-time assertion once the file exists. Later entries consume earlier
 * outputs, so execution is sequential in this order.
 */
const CORPUS = [
    // ── CLI-produced, conformant ─────────────────────────────────────────
    {
        file: 'basic-store.zip',
        run: (f) => cli(f, ['create', src('text'), '-o', dest(f), '--base', SRC_DIR, '--method', 'store']),
    },
    ...[1, 6, 9].map((level) => ({
        file: `basic-deflate-${level}.zip`,
        run: (f) => cli(f, ['create', src('text'), src('binary'), '-o', dest(f), '--base', SRC_DIR, '--method', 'deflate', '--level', String(level)]),
    })),
    {
        file: 'basic-empty.zip',
        run: (f) => cli(f, ['create', '--from-manifest', manifestFile('empty.json', { entries: [] }), '-o', dest(f)]),
    },
    {
        file: 'basic-mixed-methods.zip',
        run: (f) => cli(f, ['create', '--from-manifest', manifestFile('mixed.json', {
            entries: [
                { name: 'text/readme.txt', path: src('text/readme.txt'), method: 'deflate' },
                { name: 'binary/pattern.bin', path: src('binary/pattern.bin'), method: 'store' },
                { name: 'nested', directory: true },
                { name: 'nested/inner/deep.txt', data: 'nested inline data\n' },
            ],
        }), '-o', dest(f)]),
    },
    {
        file: 'names-ascii.zip',
        run: (f) => cli(f, ['create', src('text'), src('binary'), '-o', dest(f), '--base', SRC_DIR]),
    },
    {
        // bsdtar on Windows mangles non-ASCII names (documented upstream limitation).
        file: 'names-unicode-utf8.zip',
        integrityExclude: ['bsdtar@win32'],
        run: (f) => cli(f, ['create', src('unicode'), '-o', dest(f), '--base', SRC_DIR]),
    },
    {
        file: 'names-deep-paths.zip',
        run: (f) => cli(f, ['create', '--from-manifest', manifestFile('deep.json', {
            entries: [
                { name: `${'a/'.repeat(40)}deep.txt`, data: 'forty levels down\n' },
                { name: 'shallow.txt', data: 'top level\n' },
            ],
        }), '-o', dest(f)]),
    },
    {
        file: 'comments-archive.zip',
        run: (f) => cli(f, ['create', src('text'), '-o', dest(f), '--base', SRC_DIR, '--comment', 'zipnative-cli conformance corpus — archive comment']),
    },
    {
        file: 'comments-entries.zip',
        run: (f) => cli(f, ['create', '--from-manifest', manifestFile('entry-comments.json', {
            entries: [
                { name: 'readme.txt', path: src('text/readme.txt'), comment: 'per-entry comment (ASCII)' },
                { name: 'notes.md', path: src('text/notes.md'), comment: 'commentaire d’entrée — UTF-8' },
            ],
        }), '-o', dest(f)]),
    },
    {
        file: 'deterministic-a.zip',
        run: (f) => cli(f, ['create', src('text'), src('binary'), '-o', dest(f), '--base', SRC_DIR, '--deterministic']),
    },
    {
        file: 'deterministic-b.zip',
        run: (f) => cli(f, ['create', src('text'), src('binary'), '-o', dest(f), '--base', SRC_DIR, '--deterministic']),
        after: (f) => assertIdentical('deterministic-a.zip', f, 'two --deterministic runs'),
    },
    {
        file: 'stream-parity-buffered.zip',
        run: (f) => cli(f, ['create', src('text'), src('binary'), '-o', dest(f), '--base', SRC_DIR]),
    },
    {
        // `--stream` routes file inputs through addStream(), i.e. the
        // data-descriptor layout (flag bit 3, permitted by ISO 21320-1), so
        // the bytes legitimately differ from the buffered writer; the gate is
        // CONTENT parity: same entries, order, method, CRC-32 and sizes.
        file: 'stream-parity-chunked.zip',
        run: (f) => cli(f, ['create', src('text'), src('binary'), '-o', dest(f), '--base', SRC_DIR, '--stream']),
        after: (f) => {
            assertSameContent('stream-parity-buffered.zip', f, 'buffered vs --stream');
            const missing = inspectEntries(f).filter((e) => e.usesDataDescriptor !== true).map((e) => e.name);
            if (missing.length > 0) fail(f, [`--stream entries without a data descriptor: ${missing.join(', ')}`]);
        },
    },
    {
        file: 'streaming-descriptor.zip',
        run: (f) => cli(f, ['create', '--stdin-name', 'streamed.bin', '-o', dest(f), '--stream'], { input: readFileSync(input('stdin-payload.bin')) }),
        after: (f) => {
            const entry = inspectEntries(f).find((e) => e.name === 'streamed.bin');
            if (!entry) fail(f, ['inspect --entries reports no entry named streamed.bin']);
            if (entry.usesDataDescriptor !== true) fail(f, ['entry streamed.bin does not use a data descriptor (usesDataDescriptor !== true)']);
        },
    },
    {
        file: 'incremental-original.zip',
        run: (f) => cli(f, ['create', '--from-manifest', manifestFile('incremental.json', {
            entries: [
                { name: 'config.json', data: '{ "version": 1 }\n' },
                { name: 'data/large.txt', path: input('large.txt') },
                { name: 'obsolete.log', data: 'REMANENT-LOG-CONTENT\n' },
            ],
        }), '-o', dest(f)]),
    },
    {
        file: 'incremental-updated.zip',
        run: (f) => cli(f, [
            'modify', dest('incremental-original.zip'), '-o', dest(f),
            '--replace', `config.json=${input('config-v2.json')}`,
            '--add', `CHANGES.md=${input('CHANGES.md')}`,
            '--remove', 'obsolete.log',
        ]),
        after: (f) => {
            const original = bytesOf('incremental-original.zip');
            const updated = bytesOf(f);
            if (!updated.subarray(0, original.length).equals(original)) {
                fail(f, ['append-only modify did not keep the original bytes as its prefix']);
            }
        },
    },
    {
        file: 'incremental-compacted.zip',
        run: (f) => cli(f, [
            'modify', dest('incremental-original.zip'), '-o', dest(f),
            '--replace', `config.json=${input('config-v2.json')}`,
            '--add', `CHANGES.md=${input('CHANGES.md')}`,
            '--remove', 'obsolete.log',
            '--compact',
        ]),
        after: (f) => {
            if (bytesOf(f).includes('REMANENT-LOG-CONTENT')) fail(f, ['--compact output still contains the removed payload (REMANENT-LOG-CONTENT)']);
        },
    },
    {
        file: 'parallel-sequential.zip',
        run: (f) => cli(f, ['create', src('text'), src('binary'), '-o', dest(f), '--base', SRC_DIR, '--deterministic']),
    },
    {
        // The only proof that zip-worker.js resolves from the bundled CLI.
        file: 'parallel-parallel.zip',
        run: (f) => cli(f, ['create', src('text'), src('binary'), '-o', dest(f), '--base', SRC_DIR, '--deterministic', '--parallel', '--workers', '2', '--min-job-size', '1']),
        after: (f) => assertIdentical('parallel-sequential.zip', f, 'sequential vs --parallel --workers 2'),
    },
    {
        file: 'attributes-unix.zip',
        run: (f) => cli(f, ['create', '--from-manifest', manifestFile('attributes.json', {
            entries: [
                { name: 'bin/run.sh', data: '#!/bin/sh\necho ok\n', mode: '0755' },
                { name: 'etc/config.txt', data: 'key=value\n', mode: '0644' },
                { name: 'etc', directory: true, mode: '0755' },
            ],
        }), '-o', dest(f)]),
    },
    {
        file: 'from-manifest.zip',
        run: (f) => cli(f, ['create', '--from-manifest', manifestFile('mixed-sources.json', {
            comment: 'built from a create-manifest',
            entries: [
                { name: 'readme.txt', path: src('text/readme.txt') },
                { name: 'pattern.bin', path: src('binary/pattern.bin') },
                { name: 'inline.txt', data: 'inline UTF-8 data — é\n' },
                { name: 'inline.b64', dataBase64: Buffer.from('base64 payload\n').toString('base64') },
            ],
        }), '-o', dest(f)]),
    },
    {
        file: 'edge-empty-entries.zip',
        run: (f) => cli(f, ['create', '--from-manifest', manifestFile('empty-entries.json', {
            entries: [
                { name: 'empty.txt', data: '' },
                { name: 'empty-dir', directory: true },
                { name: 'nonempty.txt', data: 'x\n' },
            ],
        }), '-o', dest(f)]),
    },
    {
        file: 'edge-high-ratio.zip',
        verifyArgs: ['--max-ratio', '2048'],
        run: (f) => cli(f, ['create', input('zeros.bin'), '-o', dest(f), '--base', INPUTS_DIR]),
    },
    {
        // create → prepend an SFX-style stub (stored offsets become base-relative)
        // → modify --comment so the EOCD is re-anchored by the CLI, which keeps
        // the stub verbatim (append-only save): the file starts with the stub,
        // not with PK (`prefixed: true` in the manifest). 7-Zip's CLI refuses
        // archives it must open with an offset (documented upstream).
        file: 'edge-sfx-prefixed.zip',
        producedBy: 'cli+crafted',
        prefixed: true,
        integrityExclude: ['7z'],
        run: (f) => {
            const plain = join(SPECS_DIR, 'sfx-plain.zip');
            cli(f, ['create', src('text'), '-o', plain, '--base', SRC_DIR]);
            const stubbed = join(SPECS_DIR, 'sfx-stubbed.zip');
            writeFileSync(stubbed, Buffer.concat([readFileSync(input('sfx-stub.sh')), readFileSync(plain)]));
            return cli(f, ['modify', stubbed, '-o', dest(f), '--comment', 'sfx sample']);
        },
    },

    // ── Crafted (raw writer), conformant ─────────────────────────────────
    {
        file: 'zip64-forced.zip',
        producedBy: 'crafted',
        craft: () => buildRawZip([
            { name: 'first.txt', data: te.encode('zip64 EOCD + locator forced on a tiny archive\n'), method: 8, versionNeeded: 45 },
            { name: 'second.bin', data: Uint8Array.from({ length: 64 }, (_, i) => i), versionNeeded: 45 },
        ], { forceZip64: true }),
    },
    {
        // ISO-conformant but hostile: spec-valid does not mean safe.
        file: 'hostile-zip-slip.zip',
        producedBy: 'crafted',
        refusedBy: REFUSE.zipSlip,
        craft: () => buildRawZip([
            { name: '../evil.txt', data: te.encode('escapes the extraction root\n') },
            { name: 'ok.txt', data: te.encode('benign sibling\n') },
        ]),
    },
    {
        file: 'hostile-device-name.zip',
        producedBy: 'crafted',
        refusedBy: REFUSE.deviceName,
        craft: () => buildRawZip([
            { name: 'aux.txt', data: te.encode('reserved DOS device name\n') },
            { name: 'ok.txt', data: te.encode('benign sibling\n') },
        ]),
    },
    {
        file: 'hostile-duplicate-paths.zip',
        producedBy: 'crafted',
        refusedBy: REFUSE.duplicatePaths,
        craft: () => buildRawZip([
            { name: 'same.txt', data: te.encode('first\n') },
            { name: 'same.txt', data: te.encode('second\n') },
        ]),
    },

    // ── Crafted negatives: the validator MUST reject with the named check ─
    {
        file: 'neg-overlap.zip',
        producedBy: 'crafted',
        expectConformant: false,
        expectedCheck: 'WF/ENTRY-OVERLAP',
        refusedBy: REFUSE.overlap,
        craft: () => buildRawZip([
            { name: 'one.txt', data: te.encode('first payload\n') },
            { name: 'two.txt', data: te.encode('second payload\n'), localHeaderOffsetOverride: 0 },
        ]),
    },
    {
        file: 'neg-cd-mismatch.zip',
        producedBy: 'crafted',
        expectConformant: false,
        expectedCheck: 'WF/CD-COUNT',
        refusedBy: REFUSE.cdMismatch,
        craft: () => buildRawZip([
            { name: 'one.txt', data: te.encode('first payload\n') },
            { name: 'two.txt', data: te.encode('second payload\n') },
        ], { totalEntriesOverride: 9 }),
    },
    {
        file: 'neg-declared-bomb.zip',
        producedBy: 'crafted',
        expectConformant: false,
        expectedCheck: 'WF/LFH-SIZE-MISMATCH',
        refusedBy: REFUSE.declaredBomb,
        craft: () => buildRawZip([
            { name: 'bomb.bin', data: te.encode('tiny'), uncompressedSizeOverride: 2 * 1024 * 1024 * 1024 },
        ]),
    },
    {
        file: 'neg-lfh-name-mismatch.zip',
        producedBy: 'crafted',
        expectConformant: false,
        expectedCheck: 'WF/LFH-NAME-MISMATCH',
        craft: () => buildRawZip([
            { name: 'central.txt', data: te.encode('the local header says otherwise\n'), lfhNameOverride: te.encode('locally.txt') },
        ]),
    },
];

function assertIdentical(a, b, what) {
    if (!bytesOf(a).equals(bytesOf(b))) fail(b, [`${what}: ${a} and ${b} are not byte-identical`]);
}

/** Long-form entry rows from `inspect --format json --entries`. */
function inspectEntries(file) {
    const r = cli(`${file} (inspect)`, ['inspect', dest(file), '--format', 'json', '--entries']);
    return JSON.parse(r.stdout).entries ?? [];
}

/** Entry-level fingerprint (name, method, CRC-32, sizes, order). */
function contentFingerprint(file) {
    return inspectEntries(file).map((e) => [e.name, e.method, e.crc32, e.compressedSize, e.uncompressedSize].join('|')).join('\n');
}

function assertSameContent(a, b, what) {
    const fa = contentFingerprint(a);
    const fb = contentFingerprint(b);
    if (fa !== fb) fail(b, [`${what}: ${a} and ${b} differ in entry content`, `${a}: ${fa.split('\n').join(' ; ')}`, `${b}: ${fb.split('\n').join(' ; ')}`]);
}

// ── Gate-time assertions ────────────────────────────────────────────────

function assertVerifies(entry) {
    const args = ['verify', dest(entry.file), '--format', 'json', ...(entry.verifyArgs ?? [])];
    const r = runCli(args);
    let report = null;
    try { report = JSON.parse(r.stdout); } catch { /* handled below */ }
    if (r.error || r.status !== 0 || report === null || report.ok !== true) {
        const lines = [`node dist/cli.cjs ${args.map(rel).join(' ')}`, `exit ${r.status ?? r.error}`];
        for (const l of r.stderr.trim().split(/\r?\n/)) if (l) lines.push(l);
        if (report !== null && report.error) lines.push(`report.error: ${JSON.stringify(report.error)}`);
        fail(`${entry.file} (verify)`, lines);
    }
}

function assertRefused(entry) {
    const { command, code, entry: name } = entry.refusedBy;
    rmSync(REFUSE_TMP, { recursive: true, force: true });
    mkdirSync(REFUSE_TMP, { recursive: true });
    const args = command === 'extract'
        ? ['extract', dest(entry.file), '--output-dir', REFUSE_TMP, '--json']
        : command === 'cat'
            ? ['cat', dest(entry.file), name, '--json']
            : [command, dest(entry.file), '--json'];
    const r = runCli(args);
    const envelope = errorEnvelope(r.stderr);
    const observed = envelope?.error?.zipCode ?? null;
    if (r.error || r.status === 0 || envelope === null || observed !== code) {
        const lines = [`node dist/cli.cjs ${args.map(rel).join(' ')}`, `exit ${r.status ?? r.error} — expected a refusal with zipCode ${code}, observed ${observed ?? '(no envelope)'}`];
        for (const l of r.stderr.trim().split(/\r?\n/)) if (l) lines.push(l);
        fail(`${entry.file} (refusal)`, lines);
    }
    out(`  refusal ok  ${entry.file.padEnd(32)} ${command} → ${code}`);
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
    mkdirSync(OUT_DIR, { recursive: true });
    writeSourceTree();
    // Prune archives left over from an older corpus layout so the validator's
    // "unlisted file" note only ever points at something unexpected. Only
    // top-level *.zip files are pruned — manifest.json, .specs/ and reports/
    // are never touched.
    const current = new Set(CORPUS.map((e) => e.file));
    for (const stale of readdirSync(OUT_DIR).filter((f) => f.toLowerCase().endsWith('.zip') && !current.has(f))) {
        rmSync(join(OUT_DIR, stale));
        out(`  pruned ${stale}`);
    }

    const version = JSON.parse(cli('--version', ['--version', '--json']).stdout);
    const manifest = [];
    let totalBytes = 0;

    // Pass 1: write every file (CLI or raw writer) and run the per-entry
    // structural assertions (`after`). Pass 2 (below) runs the CLI-verdict
    // assertions once the whole corpus exists, so a mismatch leaves every
    // file on disk for inspection.
    for (const entry of CORPUS) {
        let command = null;
        if (entry.craft !== undefined) {
            writeFileSync(dest(entry.file), entry.craft());
        } else {
            const r = entry.run(entry.file); // exits 1 on the first failing CLI invocation
            command = r?.args ?? null;
        }
        const target = dest(entry.file);
        if (!existsSync(target)) fail(entry.file, [`CLI exited 0 but wrote no file at ${rel(target)}.`]);
        // Sanity: written bytes must at least start like a ZIP — at offset 0, or
        // (SFX-prefixed sample) a local-file-header signature right after the stub.
        const written = readFileSync(target);
        const prefixed = entry.prefixed === true;
        const sigAt = prefixed ? written.indexOf(Buffer.from('PK\x03\x04', 'latin1')) : 0;
        if (prefixed ? sigAt <= 0 : !written.subarray(0, 2).equals(Buffer.from('PK', 'ascii'))) {
            fail(entry.file, [prefixed ? 'output has no local-file-header signature after the SFX stub.' : 'output does not start with PK.']);
        }
        const bytes = statSync(target).size;
        totalBytes += bytes;

        const producedBy = entry.producedBy ?? (entry.craft !== undefined ? 'crafted' : 'cli');
        const expectConformant = entry.expectConformant !== false;
        if (entry.after) entry.after(entry.file);

        manifest.push({
            file: entry.file,
            bytes,
            producedBy,
            command,
            expectConformant,
            expectedCheck: entry.expectedCheck ?? null,
            refusedBy: entry.refusedBy ? { command: entry.refusedBy.command, code: entry.refusedBy.code } : null,
            integrityExclude: entry.integrityExclude ?? [],
            ...(prefixed ? { prefixed: true } : {}),
        });
        const note = !expectConformant
            ? `NEGATIVE canary — must fail ${entry.expectedCheck}`
            : entry.refusedBy ? `conformant, refused by ${entry.refusedBy.command} (${entry.refusedBy.code})` : '';
        out(`  wrote  ${entry.file.padEnd(32)} ${String(bytes).padStart(8)} B  ${producedBy.padEnd(11)}${note ? ` (${note})` : ''}`);
    }

    // Pass 2: the CLI's own verdicts on the corpus it produced / must refuse.
    out('');
    let verified = 0;
    for (const entry of CORPUS) {
        const producedBy = entry.producedBy ?? (entry.craft !== undefined ? 'crafted' : 'cli');
        if (entry.expectConformant !== false && producedBy !== 'crafted') {
            assertVerifies(entry);
            verified++;
        }
        if (entry.refusedBy) assertRefused(entry);
    }
    out(`  verify ok   ${verified} CLI-produced archive(s) pass \`verify --format json\``);
    rmSync(REFUSE_TMP, { recursive: true, force: true });

    const negatives = manifest.filter((m) => !m.expectConformant).length;
    writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify({
        generatedBy: 'scripts/generate-zip-corpus.mjs',
        cli: version.version,
        zipnative: version.zipnative,
        node: process.version,
        platform: process.platform,
        files: manifest,
    }, null, 2)}\n`);
    out(`\nZIP corpus: ${manifest.length} file(s), ${totalBytes} bytes, ${negatives} negative canar${negatives === 1 ? 'y' : 'ies'} → test-output/zip/ (manifest.json written)`);
    return 0;
}

process.exit(main());
