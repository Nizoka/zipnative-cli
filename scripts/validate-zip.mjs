/**
 * zipnative-cli — veraZIP: ISO/IEC 21320-1:2015 conformance validator
 * =====================================================================
 * Validates every archive in `test-output/zip/` (the corpus written by
 * scripts/generate-zip-corpus.mjs from the BUILT CLI) against ISO/IEC
 * 21320-1:2015 (Document Container File — the ISO-standardised ZIP
 * profile, Library of Congress fdd000361), clause by clause, the way
 * veraPDF validates a closed ISO constraint list for PDF/A, and compares
 * each verdict with the manifest's expectation.
 *
 * VENDORED from zipnative (the engine does not ship scripts/ in its npm
 * tarball, so the validator is copied, not imported):
 *   upstream file:   scripts/validate-zip.ts
 *   upstream commit: 4f1bc3619372e8543bccea65d2365bf0c048a10c (zipnative 1.0.0)
 *   upstream blob:   5ddea000a3b6a4adfb720d673a43664972118139
 *   sync rule:       when upstream's validate-zip.ts changes, re-port the
 *                    parser body 1:1 (types erased) and bump BOTH hashes
 *                    above in the same PR. tests/scripts/verazip-vendor.test.ts
 *                    pins the 22-id check vocabulary and these hashes.
 *
 * INDEPENDENT BY CONSTRUCTION: this script raw-parses the bytes with
 * its own EOCD/CD/LFH reader and NEVER imports `zipnative`, `src/` or
 * spawns the built CLI bundle for parsing — a validator that shared the
 * engine's parser would attest the engine with the engine (the same
 * anti-circularity rule the raw ZIP builder in the corpus generator
 * follows). The vendor test machine-checks this at text level.
 *
 * Three levels:
 *   0. ISO/IEC 21320-1 clause checks + APPNOTE well-formedness
 *      cross-checks (CD↔LFH agreement, offsets, overlap) — the checks
 *      lenient extractors forgive. ALWAYS runs.
 *   1. Foreign integrity pass (`unzip -t`, `7z t`, `python -m zipfile
 *      -t`, `tar -tf`, `jar tf`) over the conformant corpus when the
 *      tools exist — never simulated, absent tools are SKIPped.
 *   2. The differential-extraction matrix stays in zipnative's own
 *      interop suite (the posture Archivematica applies to ZIP packages:
 *      independent extraction + fixity).
 *
 * Usage:
 *   npm run validate:zip                 # build + corpus + validate
 *   node scripts/validate-zip.mjs        # validate an existing corpus only
 *
 * Environment:
 *   VERAZIP_REQUIRED=1        fail-closed: zero usable level-1 tools is an
 *                             INFRA failure (exit 3) instead of a skip. Set
 *                             in CI; unset locally so a bare machine never
 *                             blocks. Level 0 needs no tool and always runs.
 *   VERAZIP_REPORT_DIR=<dir>  where the per-file JSON reports and summary.json
 *                             go (default test-output/zip/reports/).
 *   VERAZIP_TOOLS=<ids|none>  restrict level 1 to a comma-separated subset of
 *                             bsdtar,unzip,7z,python-zipfile,jar; `none`
 *                             disables level 1 entirely.
 *
 * Outcomes per manifest file (one line each on stdout):
 *   PASS   conformant, and the manifest expected conformance.
 *   FAIL   non-conformant although the manifest expected conformance (first
 *          findings listed), OR a declared negative that failed with the
 *          WRONG check id — the crafted canary no longer proves what it
 *          claims to prove.
 *   XFAIL  non-conformant as expected — a negative canary rejected with its
 *          declared check id among the failures.
 *   XPASS  conformant although the manifest expects a failure: the validator
 *          is not validating ("accepts everything") — always fatal.
 *   INFRA  the parser threw or the file could not be read. Not a verdict.
 *   SKIP   reserved (every manifest entry is validated at level 0; level-1
 *          tools report `SKIP integrity <tool>` when absent).
 *
 * Exit codes:
 *   0 — every expectation met (or no level-1 tool is usable and
 *       VERAZIP_REQUIRED is unset: level 1 is SKIPPED — exit 0 is a skip of
 *       level 1, not a pass of it; level 0 verdicts still hold).
 *   1 — a conformance expectation was not met (FAIL / XPASS), a level-1 tool
 *       rejected a conformant archive, the coverage canary tripped (a
 *       manifest file is missing or is not a ZIP), the corpus has no
 *       negative canary, or a REQUIRED_NEGATIVE_CHECKS id has no canary.
 *   2 — the corpus directory / manifest is absent (run `npm run corpus:zip`).
 *   3 — INFRA: a file produced an INFRA outcome, or (VERAZIP_REQUIRED=1 only)
 *       zero level-1 tools are usable.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTEGRITY_TOOLS } from './helpers/interop-tools.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = join(ROOT, 'test-output', 'zip');
const MANIFEST = join(CORPUS_DIR, 'manifest.json');
const REPORT_DIR = process.env.VERAZIP_REPORT_DIR ? resolve(process.env.VERAZIP_REPORT_DIR) : join(CORPUS_DIR, 'reports');
const REQUIRED = process.env.VERAZIP_REQUIRED === '1' || process.env.VERAZIP_REQUIRED === 'true';
const TOOL_FILTER = process.env.VERAZIP_TOOLS === undefined
    ? null
    : process.env.VERAZIP_TOOLS.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

const EXIT_OK = 0;
const EXIT_CONFORMANCE = 1;
const EXIT_NO_CORPUS = 2;
const EXIT_INFRA = 3;

const log = (s) => process.stderr.write(`${s}\n`);
const out = (s) => process.stdout.write(`${s}\n`);
const posix = (p) => p.split('\\').join('/');

/**
 * Coverage canary (replaces upstream's docs/assets/ecosystem.json count):
 * each of these check ids MUST be the `expectedCheck` of at least one
 * manifest entry, so the four well-formedness cross-checks lenient
 * extractors forgive are each proven to fire on every run. A corpus
 * generator that silently dropped a crafted negative would otherwise shrink
 * the gate without anyone noticing.
 */
const REQUIRED_NEGATIVE_CHECKS = Object.freeze([
    'WF/ENTRY-OVERLAP',
    'WF/CD-COUNT',
    'WF/LFH-SIZE-MISMATCH',
    'WF/LFH-NAME-MISMATCH',
]);

// ── Signatures (little-endian u32) ───────────────────────────────────
const SIG_LFH = 0x04034b50;
const SIG_CFH = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_Z64_EOCD = 0x06064b50;
const SIG_Z64_LOCATOR = 0x07064b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_ARCHIVE_EXTRA = 0x08064b50;
const SIG_DIGITAL_SIGNATURE = 0x05054b50;

// GP flag bits ISO/IEC 21320-1 forbids (APPNOTE 4.4.4 annotation):
// bit 0 (encryption), bits 4–10, bits 12–15. Allowed: 1, 2 (deflate
// options), 3 (data descriptor — explicitly permitted), 11 (UTF-8).
const FORBIDDEN_GP_BITS = 0xf7f1;

const u16 = (b, p) => b[p] | (b[p + 1] << 8);
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const u64 = (b, p) => {
    const lo = u32(b, p);
    const hi = u32(b, p + 4);
    return hi * 0x1_0000_0000 + lo;
};

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
function isValidUtf8(bytes) {
    try { utf8Strict.decode(bytes); return true; } catch { return false; }
}
const hasHighByte = (bytes) => bytes.some((x) => x > 0x7f);

/**
 * Validate one archive (upstream `validateArchive`, transcribed 1:1 with
 * types erased). Returns `{ file, entries, failures: [{ check, detail }],
 * notes: string[] }`.
 */
function validateArchive(bytes, file) {
    const failures = [];
    const notes = [];
    const fail = (check, detail) => { failures.push({ check, detail }); };

    // ── EOCD: self-consistent record closest to EOF ──────────────────
    let eocdPos = -1;
    const scanFloor = Math.max(0, bytes.length - 22 - 65535);
    for (let p = bytes.length - 22; p >= scanFloor; p--) {
        if (u32(bytes, p) === SIG_EOCD && p + 22 + u16(bytes, p + 20) === bytes.length) {
            eocdPos = p;
            break;
        }
    }
    if (eocdPos < 0) {
        fail('WF/EOCD-NOT-FOUND', 'no self-consistent end-of-central-directory record');
        return { file, entries: 0, failures, notes };
    }

    const diskNumber = u16(bytes, eocdPos + 4);
    const cdStartDisk = u16(bytes, eocdPos + 6);
    let entriesOnDisk = u16(bytes, eocdPos + 8);
    let totalEntries = u16(bytes, eocdPos + 10);
    let cdSize = u32(bytes, eocdPos + 12);
    let cdOffset = u32(bytes, eocdPos + 16);

    // ── Zip64 EOCD (version 1 is permitted; version 2 fails 4.4.3) ───
    const needsZip64 = totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
    if (needsZip64) {
        const locPos = eocdPos - 20;
        if (locPos < 0 || u32(bytes, locPos) !== SIG_Z64_LOCATOR) {
            fail('WF/ZIP64-LOCATOR', 'sentinel EOCD fields but no zip64 locator');
            return { file, entries: 0, failures, notes };
        }
        if (u32(bytes, locPos + 16) !== 1) {
            fail('ISO21320-1/APPNOTE-4.3.3', `total number of disks is ${u32(bytes, locPos + 16)} — archives shall not span volumes`);
        }
        let z64Pos = u64(bytes, locPos + 8);
        if (u32(bytes, z64Pos) !== SIG_Z64_EOCD) {
            // Prepended data shifts every stored offset; scan back from the locator.
            let found = -1;
            for (let p = locPos - 56; p >= Math.max(0, locPos - 1048576); p--) {
                if (u32(bytes, p) === SIG_Z64_EOCD) { found = p; break; }
            }
            if (found < 0) {
                fail('WF/ZIP64-EOCD', 'zip64 locator points at no zip64 EOCD record');
                return { file, entries: 0, failures, notes };
            }
            z64Pos = found;
        }
        const z64VersionNeeded = u16(bytes, z64Pos + 14);
        if (z64VersionNeeded > 45) {
            fail('ISO21320-1/APPNOTE-4.4.3', `zip64 EOCD version needed to extract is ${z64VersionNeeded} — only ZIP64 version 1 (45) may be used`);
        }
        totalEntries = u64(bytes, z64Pos + 32);
        entriesOnDisk = u64(bytes, z64Pos + 24);
        cdSize = u64(bytes, z64Pos + 40);
        cdOffset = u64(bytes, z64Pos + 48);
    }

    // ── 4.3.3 / 4.4.1.5: no splitting or spanning ────────────────────
    if ((diskNumber !== 0 && diskNumber !== 0xffff) || (cdStartDisk !== 0 && cdStartDisk !== 0xffff)) {
        fail('ISO21320-1/APPNOTE-4.3.3', `disk numbers ${diskNumber}/${cdStartDisk} — archives shall not be split or spanned`);
    }
    if (entriesOnDisk !== totalEntries) {
        fail('ISO21320-1/APPNOTE-4.4.1.5', `entries on this disk (${entriesOnDisk}) != total entries (${totalEntries})`);
    }

    // ── Prepended data (SFX stubs): stored offsets are base-relative ─
    const actualCdPos = needsZip64
        ? (() => { // CD ends where the zip64 EOCD begins
            const locPos = eocdPos - 20;
            let z = u64(bytes, locPos + 8);
            if (u32(bytes, z) !== SIG_Z64_EOCD) {
                for (let p = locPos - 56; p >= 0; p--) { if (u32(bytes, p) === SIG_Z64_EOCD) { z = p; break; } }
            }
            return z - cdSize;
        })()
        : eocdPos - cdSize;
    const shift = actualCdPos - cdOffset;
    if (shift < 0) {
        fail('WF/CD-OFFSET', `central directory claimed at ${cdOffset} but the file layout places it at ${actualCdPos}`);
        return { file, entries: 0, failures, notes };
    }
    if (shift > 0) notes.push(`${shift} bytes of prepended data (SFX stub) — offsets shifted accordingly`);
    if (u32(bytes, actualCdPos) !== SIG_CFH && totalEntries > 0) {
        fail('WF/CD-OFFSET', `no central-file-header signature at the central directory start (${actualCdPos})`);
        return { file, entries: 0, failures, notes };
    }

    // ── 4.3.13: no digital signature record after the CD ─────────────
    const cdEnd = actualCdPos + cdSize;
    if (cdEnd + 4 <= bytes.length && u32(bytes, cdEnd) === SIG_DIGITAL_SIGNATURE) {
        fail('ISO21320-1/APPNOTE-4.3.13', 'digital signature record present after the central directory');
    }

    // ── Walk the central directory ───────────────────────────────────
    const entries = [];
    let pos = actualCdPos;
    let walked = 0;
    while (pos < cdEnd && walked < totalEntries) {
        if (pos + 46 > bytes.length || u32(bytes, pos) !== SIG_CFH) break;
        const nameLen = u16(bytes, pos + 28);
        const extraLen = u16(bytes, pos + 30);
        const commentLen = u16(bytes, pos + 32);
        const name = bytes.subarray(pos + 46, pos + 46 + nameLen);
        const extra = bytes.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen);
        const comment = bytes.subarray(pos + 46 + nameLen + extraLen, pos + 46 + nameLen + extraLen + commentLen);
        let compressedSize = u32(bytes, pos + 20);
        let uncompressedSize = u32(bytes, pos + 24);
        let localOffset = u32(bytes, pos + 42);
        // Zip64 extended-information extra (0x0001): fields appear in
        // order for exactly the sentinel-valued classic fields.
        let usesZip64 = false;
        for (let e = 0; e + 4 <= extra.length;) {
            const id = u16(extra, e);
            const len = u16(extra, e + 2);
            if (id === 0x0001) {
                usesZip64 = true;
                let f = e + 4;
                if (uncompressedSize === 0xffffffff && f + 8 <= e + 4 + len) { uncompressedSize = u64(extra, f); f += 8; }
                if (compressedSize === 0xffffffff && f + 8 <= e + 4 + len) { compressedSize = u64(extra, f); f += 8; }
                if (localOffset === 0xffffffff && f + 8 <= e + 4 + len) { localOffset = u64(extra, f); f += 8; }
            }
            e += 4 + len;
        }
        entries.push({
            name, flags: u16(bytes, pos + 8), method: u16(bytes, pos + 10),
            crc: u32(bytes, pos + 16), compressedSize, uncompressedSize,
            localOffset, versionNeeded: u16(bytes, pos + 6),
            externalAttrs: u32(bytes, pos + 38), comment, usesZip64,
        });
        pos += 46 + nameLen + extraLen + commentLen;
        walked++;
    }
    if (walked !== totalEntries) {
        fail('WF/CD-COUNT', `EOCD declares ${totalEntries} entries but the central directory holds ${walked}`);
    }
    if (pos !== cdEnd && walked === totalEntries) {
        fail('WF/CD-SIZE', `central directory records span ${pos - actualCdPos} bytes but the EOCD declares ${cdSize}`);
    }

    // ── Per-entry ISO clauses + LFH cross-checks ─────────────────────
    const spans = [];
    const nameOf = (raw) => {
        try { return utf8Strict.decode(raw); } catch { return `<${raw.length} bytes>`; }
    };
    for (const entry of entries) {
        const label = nameOf(entry.name);

        // 4.4.5: compression method 0 (stored) or 8 (deflated) only.
        if (entry.method !== 0 && entry.method !== 8) {
            fail('ISO21320-1/APPNOTE-4.4.5', `entry '${label}' uses compression method ${entry.method} — only 0 (stored) and 8 (deflated) are permitted`);
        }
        // 4.4.3: version needed to extract ≤ 45.
        if (entry.versionNeeded > 45) {
            fail('ISO21320-1/APPNOTE-4.4.3', `entry '${label}' needs version ${entry.versionNeeded} — shall not exceed 45`);
        }
        // 4.4.4: forbidden general-purpose bits (bit 0 = encryption → also 4.3.8).
        if ((entry.flags & 0x0001) !== 0) {
            fail('ISO21320-1/APPNOTE-4.3.8', `entry '${label}' is encrypted — file data shall not be encrypted`);
        }
        if ((entry.flags & FORBIDDEN_GP_BITS & ~0x0001) !== 0) {
            fail('ISO21320-1/APPNOTE-4.4.4', `entry '${label}' sets forbidden general-purpose bits 0x${(entry.flags & FORBIDDEN_GP_BITS).toString(16)}`);
        }
        // 4.4.4: UTF-8 discipline for names and comments.
        const utf8Flagged = (entry.flags & 0x0800) !== 0;
        if (!utf8Flagged && (hasHighByte(entry.name) || hasHighByte(entry.comment))) {
            fail('ISO21320-1/APPNOTE-4.4.4', `entry '${label}' has non-ASCII name/comment bytes without the UTF-8 flag (bit 11)`);
        }
        if (utf8Flagged && (!isValidUtf8(entry.name) || (entry.comment.length > 0 && !isValidUtf8(entry.comment)))) {
            fail('ISO21320-1/APPNOTE-4.4.4', `entry '${label}' sets bit 11 but its name/comment is not valid UTF-8`);
        }
        // APPNOTE note 1: volume labels are excluded from the profile.
        if ((entry.externalAttrs & 0x08) !== 0) {
            fail('ISO21320-1/APPNOTE-NOTE-1', `entry '${label}' carries the DOS volume-label attribute`);
        }

        // ── Local header cross-checks (what lenient extractors skip) ─
        const lfhPos = entry.localOffset + shift;
        if (lfhPos + 30 > bytes.length || u32(bytes, lfhPos) !== SIG_LFH) {
            fail('WF/LFH-SIGNATURE', `entry '${label}' points at ${entry.localOffset} where no local file header exists`);
            continue;
        }
        const lfhFlags = u16(bytes, lfhPos + 6);
        const lfhMethod = u16(bytes, lfhPos + 8);
        const lfhCrc = u32(bytes, lfhPos + 14);
        const lfhCompressed = u32(bytes, lfhPos + 18);
        const lfhUncompressed = u32(bytes, lfhPos + 22);
        const lfhNameLen = u16(bytes, lfhPos + 26);
        const lfhExtraLen = u16(bytes, lfhPos + 28);
        const lfhName = bytes.subarray(lfhPos + 30, lfhPos + 30 + lfhNameLen);
        const lfhVersionNeeded = u16(bytes, lfhPos + 4);

        if (lfhVersionNeeded > 45) {
            fail('ISO21320-1/APPNOTE-4.4.3', `entry '${label}' local header needs version ${lfhVersionNeeded} — shall not exceed 45`);
        }
        if ((lfhFlags & FORBIDDEN_GP_BITS) !== 0) {
            fail('ISO21320-1/APPNOTE-4.4.4', `entry '${label}' local header sets forbidden general-purpose bits`);
        }
        if (lfhMethod !== entry.method) {
            fail('WF/LFH-METHOD-MISMATCH', `entry '${label}': central directory says method ${entry.method}, local header says ${lfhMethod}`);
        }
        if (lfhName.length !== entry.name.length || !lfhName.every((x, i) => x === entry.name[i])) {
            fail('WF/LFH-NAME-MISMATCH', `entry '${label}': local header carries a different name ('${nameOf(lfhName)}')`);
        }
        const usesDescriptor = (lfhFlags & 0x0008) !== 0;
        const dataStart = lfhPos + 30 + lfhNameLen + lfhExtraLen;
        let dataEnd = dataStart + entry.compressedSize;
        if (!usesDescriptor) {
            // Resolve the LFH's own zip64 sizes when sentinelled.
            let lc = lfhCompressed;
            let lu = lfhUncompressed;
            if (lc === 0xffffffff || lu === 0xffffffff) {
                const lfhExtra = bytes.subarray(lfhPos + 30 + lfhNameLen, dataStart);
                for (let e = 0; e + 4 <= lfhExtra.length;) {
                    const id = u16(lfhExtra, e);
                    const len = u16(lfhExtra, e + 2);
                    if (id === 0x0001 && len >= 16) { lu = u64(lfhExtra, e + 4); lc = u64(lfhExtra, e + 12); }
                    e += 4 + len;
                }
            }
            if (lc !== entry.compressedSize || lu !== entry.uncompressedSize) {
                fail('WF/LFH-SIZE-MISMATCH', `entry '${label}': central directory sizes ${entry.compressedSize}/${entry.uncompressedSize} disagree with local header ${lc}/${lu}`);
            }
            if (lfhCrc !== entry.crc) {
                fail('WF/LFH-CRC-MISMATCH', `entry '${label}': central directory CRC 0x${entry.crc.toString(16)} disagrees with local header 0x${lfhCrc.toString(16)}`);
            }
        } else {
            // Bit 3 is PERMITTED by ISO 21320-1. Validate the trailing
            // descriptor against the authoritative CD values.
            const sizeLen = entry.usesZip64 ? 8 : 4;
            const readSize = entry.usesZip64 ? u64 : u32;
            let matched = false;
            for (const sigLen of [4, 0]) {
                const p = dataEnd + sigLen;
                if (p + 4 + 2 * sizeLen > bytes.length) continue;
                if (sigLen === 4 && u32(bytes, dataEnd) !== SIG_DESCRIPTOR) continue;
                const dCrc = u32(bytes, p);
                const dComp = readSize(bytes, p + 4);
                const dUnc = readSize(bytes, p + 4 + sizeLen);
                if (dCrc === entry.crc && dComp === entry.compressedSize && dUnc === entry.uncompressedSize) {
                    matched = true;
                    dataEnd = p + 4 + 2 * sizeLen;
                    break;
                }
            }
            if (!matched) {
                fail('WF/DESCRIPTOR-MISMATCH', `entry '${label}': no data descriptor matching the central directory values follows the payload`);
            }
        }
        spans.push({ start: lfhPos, end: dataEnd, name: label });
    }

    // ── Overlap detection (CWE-405 well-formedness) ──────────────────
    spans.sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
        if (spans[i].start < spans[i - 1].end) {
            fail('WF/ENTRY-OVERLAP', `entries '${spans[i - 1].name}' and '${spans[i].name}' claim overlapping byte ranges`);
        }
    }

    // ── 4.3.9.6 / 4.3.10: archive (de|en)cryption structures ─────────
    const lastSpanEnd = spans.length > 0 ? spans[spans.length - 1].end : shift;
    if (lastSpanEnd + 4 <= actualCdPos && u32(bytes, lastSpanEnd) === SIG_ARCHIVE_EXTRA) {
        fail('ISO21320-1/APPNOTE-4.3.10', 'archive extra-data / decryption header record precedes the central directory');
    }

    return { file, entries: entries.length, failures, notes };
}

// ── Main ─────────────────────────────────────────────────────────────

function infraExit(reason) {
    out(`  INFRA  ${reason}`);
    out('\nveraZIP infrastructure failure (VERAZIP_REQUIRED=1): level 1 validated nothing.');
    return EXIT_INFRA;
}

function main() {
    if (!existsSync(CORPUS_DIR) || !existsSync(MANIFEST)) {
        log('No ZIP corpus found in test-output/zip/. Run `npm run corpus:zip` first.');
        return EXIT_NO_CORPUS;
    }

    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const entries = Array.isArray(manifest.files) ? manifest.files : [];
    const listed = entries.map((f) => f.file);

    // Coverage canary: every manifest entry must exist on disk and at least
    // start like a ZIP — `PK` at offset 0 (local header, or the EOCD of an
    // empty archive), or for an entry flagged `prefixed: true` (SFX stub kept
    // in front of the archive) a local-file-header signature after the stub.
    // Never let the corpus shrink silently.
    const cases = [];
    let canaryFailures = 0;
    for (const entry of entries) {
        const name = entry.file;
        const file = join(CORPUS_DIR, name);
        if (!existsSync(file)) {
            log(`Coverage canary: ${name} is listed in manifest.json but missing on disk.`);
            canaryFailures++;
            continue;
        }
        let raw;
        try {
            raw = readFileSync(file);
        } catch (e) {
            log(`Coverage canary: ${name} cannot be read (${e instanceof Error ? e.message : String(e)}).`);
            canaryFailures++;
            continue;
        }
        const prefixed = entry.prefixed === true;
        const looksLikeZip = prefixed
            ? raw.indexOf(Buffer.from('PK\x03\x04', 'latin1')) > 0
            : raw.subarray(0, 2).equals(Buffer.from('PK', 'ascii'));
        if (!looksLikeZip) {
            log(`Coverage canary: ${name} ${prefixed ? 'has no local-file-header signature after its declared prefix' : 'does not start with PK'}.`);
            canaryFailures++;
            continue;
        }
        cases.push({
            file,
            name,
            expectConformant: entry.expectConformant !== false,
            expectedCheck: typeof entry.expectedCheck === 'string' ? entry.expectedCheck : null,
            refusedBy: entry.refusedBy && typeof entry.refusedBy === 'object' ? entry.refusedBy : null,
            integrityExclude: Array.isArray(entry.integrityExclude) ? entry.integrityExclude : [],
        });
    }
    const unlisted = readdirSync(CORPUS_DIR).filter((f) => f.toLowerCase().endsWith('.zip') && !listed.includes(f));
    if (unlisted.length > 0) {
        log(`Note: ${unlisted.length} ZIP(s) in test-output/zip/ are not in manifest.json and are ignored: ${unlisted.join(', ')}`);
    }
    if (listed.length === 0) {
        log('manifest.json lists no files. Run `npm run corpus:zip` first.');
        return EXIT_CONFORMANCE;
    }
    if (canaryFailures > 0) {
        log(`\nCoverage canary failed for ${canaryFailures} of ${listed.length} file(s).`);
        return EXIT_CONFORMANCE;
    }
    const negatives = cases.filter((c) => !c.expectConformant);
    log(`Corpus: ${listed.length} file(s) in manifest.json — ${negatives.length} negative canar${negatives.length === 1 ? 'y' : 'ies'}.`);
    if (negatives.length === 0) {
        // Without a file the validator must reject, a validator that accepts
        // everything would be indistinguishable from a fully conformant corpus.
        log('Negative canary missing: manifest.json has no file with expectConformant: false. Regenerate the corpus.');
        return EXIT_CONFORMANCE;
    }
    const declaredChecks = new Set(negatives.map((c) => c.expectedCheck).filter((c) => c !== null));
    const missingChecks = REQUIRED_NEGATIVE_CHECKS.filter((id) => !declaredChecks.has(id));
    if (missingChecks.length > 0) {
        log(`Coverage canary: no negative entry declares expectedCheck ${missingChecks.join(', ')} — the corpus generator must craft one for each of REQUIRED_NEGATIVE_CHECKS.`);
        return EXIT_CONFORMANCE;
    }
    for (const c of negatives) {
        if (c.expectedCheck === null) {
            log(`Coverage canary: ${c.name} is a negative entry without an expectedCheck id.`);
            return EXIT_CONFORMANCE;
        }
    }

    mkdirSync(REPORT_DIR, { recursive: true });
    log(`veraZIP: ISO/IEC 21320-1:2015 conformance over ${cases.length} archive(s)${REQUIRED ? ' — VERAZIP_REQUIRED=1 (fail-closed)' : ''}`);
    log(`Reports → ${posix(relative(ROOT, REPORT_DIR))}/`);

    // ── Level 0: ISO clause checks + well-formedness cross-checks ────
    const counts = { PASS: 0, FAIL: 0, XFAIL: 0, XPASS: 0, INFRA: 0 };
    const results = [];
    const showFindings = (failures) => {
        const shown = failures.slice(0, 5);
        for (const f of shown) out(`        - ${f.check}: ${f.detail}`);
        if (failures.length > shown.length) out(`        … (${failures.length - shown.length} more)`);
    };
    for (const c of cases) {
        const rel = posix(relative(ROOT, c.file));
        let report;
        try {
            report = validateArchive(new Uint8Array(readFileSync(c.file)), c.name);
        } catch (e) {
            counts.INFRA++;
            const detail = e instanceof Error ? e.message : String(e);
            out(`  INFRA  [iso21320]  ${rel}  (parser exception: ${detail})`);
            results.push({ ...c, outcome: 'INFRA', entries: 0, failures: [], notes: [`parser exception: ${detail}`] });
            continue;
        }
        const codes = report.failures.map((f) => f.check);
        let outcome;
        if (report.failures.length === 0 && c.expectConformant) {
            outcome = 'PASS';
            const refused = c.refusedBy !== null ? `  (conformant but refused by the CLI: ${c.refusedBy.code})` : '';
            out(`  PASS   [iso21320]  ${rel}  (${report.entries} entries)${refused}`);
        } else if (report.failures.length === 0) {
            outcome = 'XPASS';
            out(`  XPASS  [iso21320]  ${rel}  (negative canary ACCEPTED — expected ${c.expectedCheck} to fire; the validator is not validating)`);
        } else if (!c.expectConformant && codes.includes(c.expectedCheck)) {
            outcome = 'XFAIL';
            out(`  XFAIL  [iso21320]  ${rel}  (negative canary rejected as expected: ${c.expectedCheck})`);
        } else if (!c.expectConformant) {
            outcome = 'FAIL';
            out(`  FAIL   [iso21320]  ${rel}  (negative canary rejected, but ${c.expectedCheck} did not fire)`);
            showFindings(report.failures);
        } else {
            outcome = 'FAIL';
            out(`  FAIL   [iso21320]  ${rel}`);
            showFindings(report.failures);
        }
        for (const n of report.notes) out(`        note: ${n}`);
        counts[outcome]++;
        results.push({ ...c, outcome, entries: report.entries, failures: report.failures, notes: report.notes });
    }

    // ── Level 1: foreign integrity pass over the conformant corpus ───
    const conformant = results.filter((r) => r.outcome === 'PASS');
    const tools = TOOL_FILTER === null
        ? INTEGRITY_TOOLS
        : TOOL_FILTER.includes('none') ? [] : INTEGRITY_TOOLS.filter((t) => TOOL_FILTER.includes(t.id));
    if (TOOL_FILTER !== null) {
        const unknown = TOOL_FILTER.filter((id) => id !== 'none' && !INTEGRITY_TOOLS.some((t) => t.id === id));
        if (unknown.length > 0) log(`VERAZIP_TOOLS: unknown tool id(s) ignored: ${unknown.join(', ')}`);
    }
    const toolDescriptions = {};
    const integrity = new Map(results.map((r) => [r.name, {}]));
    let usableTools = 0;
    let integrityFailures = 0;
    log('');
    for (const tool of tools) {
        const description = tool.describe();
        toolDescriptions[tool.id] = description;
        if (description === null) {
            log(`SKIP  integrity ${tool.id} (not available)`);
            for (const r of conformant) integrity.get(r.name)[tool.id] = 'skip';
            continue;
        }
        usableTools++;
        let ok = 0;
        let excluded = 0;
        const failed = [];
        for (const r of conformant) {
            const exclusions = r.integrityExclude;
            if (exclusions.includes(tool.id) || exclusions.includes(`${tool.id}@${process.platform}`)) {
                excluded++;
                integrity.get(r.name)[tool.id] = 'excluded';
                continue;
            }
            if (tool.test(r.file)) {
                ok++;
                integrity.get(r.name)[tool.id] = 'ok';
            } else {
                failed.push(r.name);
                integrity.get(r.name)[tool.id] = 'fail';
            }
        }
        if (failed.length === 0) {
            const skipNote = excluded > 0 ? ` (${excluded} documented exclusion(s))` : '';
            log(`OK    integrity ${tool.id}: ${ok}/${conformant.length - excluded}${skipNote} — ${description}`);
        } else {
            integrityFailures += failed.length;
            log(`FAIL  integrity ${tool.id}: ${failed.length} archive(s) rejected — ${failed.join(', ')}`);
            log('      reproduce locally with the tool\'s own test command on the file(s) above; '
                + 'exit codes are read per tool contract (scripts/helpers/interop-tools.mjs)');
        }
    }
    for (const tool of INTEGRITY_TOOLS) {
        if (!(tool.id in toolDescriptions)) toolDescriptions[tool.id] = null;
    }

    // ── Reports ──────────────────────────────────────────────────────
    for (const r of results) {
        const report = {
            file: r.name,
            outcome: r.outcome,
            entries: r.entries,
            failures: r.failures,
            notes: r.notes,
            integrity: integrity.get(r.name),
        };
        writeFileSync(join(REPORT_DIR, `${r.name.replace(/\.zip$/i, '')}.json`), `${JSON.stringify(report, null, 2)}\n`);
    }
    writeFileSync(join(REPORT_DIR, 'summary.json'), `${JSON.stringify({
        counts,
        tools: toolDescriptions,
        platform: process.platform,
        node: process.version,
    }, null, 2)}\n`);

    // ── Verdict ──────────────────────────────────────────────────────
    out('');
    out(`Summary: ${counts.PASS} PASS, ${counts.XFAIL} XFAIL, ${counts.FAIL} FAIL, ${counts.XPASS} XPASS, ${counts.INFRA} INFRA (of ${cases.length}).`);
    if (counts.INFRA > 0) {
        out('INFRA: the parser produced no verdict for some files — not a conformance result. See the reports.');
        return EXIT_INFRA;
    }
    if (counts.XPASS > 0) {
        out('XPASS: a file that must be rejected was accepted — the validator accepts everything; do not trust the PASS lines.');
        return EXIT_CONFORMANCE;
    }
    if (counts.FAIL > 0) return EXIT_CONFORMANCE;
    if (integrityFailures > 0) {
        out(`Level 1: ${integrityFailures} foreign-tool rejection(s) of conformant archives.`);
        return EXIT_CONFORMANCE;
    }
    if (usableTools === 0) {
        if (REQUIRED) return infraExit(`no usable level-1 integrity tool (${tools.length === 0 ? 'VERAZIP_TOOLS disabled level 1' : 'none of ' + tools.map((t) => t.id).join(', ') + ' is installed'})`);
        out('\nSKIPPED: no foreign integrity tool available — level 1 validated nothing (exit 0 is a skip, not a pass; set VERAZIP_REQUIRED=1 to fail instead). Level 0 verdicts above still hold.');
        return EXIT_OK;
    }
    out('All expectations met.');
    return EXIT_OK;
}

process.exit(main());
