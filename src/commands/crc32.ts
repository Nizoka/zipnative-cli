// `zipnative crc32` — CRC-32 (IEEE 802.3, the ZIP checksum) of files or
// stdin, streamed in 64 KiB chunks through zipnative's incremental `crc32()`
// so a multi-gigabyte input costs constant memory. `--expect <hex>` turns it
// into a check (exit 1 / E_CHECK_FAILED on mismatch) and `--seed` continues a
// running checksum — the same primitive agents use to cross-check `list`
// output against extracted files.

import { type ParsedArgs, getStringFlag, getStringFlagAll, hasFlag } from '../utils/args.js';
import { emitStatus, isJsonMode } from '../utils/agent.js';
import { crc32 as coreCrc32 } from '../core-bridge/index.js';
import { crcHex } from '../utils/entryfmt.js';
import { prepareEngine } from '../utils/engine.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { openInputStream } from '../utils/io.js';
import { serializeJson } from '../utils/projection.js';
import { mapZipError } from '../utils/ziperr.js';
import { parseFormat } from '../utils/zipops.js';

function parseHex(raw: string, flag: string): number {
    const v = raw.trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{1,8}$/.test(v)) {
        throw new CliError(`--${flag} expects a hexadecimal CRC-32 (up to 8 digits), got "${raw}".`, 2);
    }
    return Number.parseInt(v, 16) >>> 0;
}

export async function crc32(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const format = parseFormat(args, ['text', 'json'] as const, isJsonMode() ? 'json' : 'text');
    const seedRaw = getStringFlag(args.flags, 'seed');
    const seed = seedRaw !== undefined ? parseHex(seedRaw, 'seed') : 0;
    const expectRaw = getStringFlag(args.flags, 'expect');
    const expect = expectRaw !== undefined ? parseHex(expectRaw, 'expect') : undefined;
    const files = [...getStringFlagAll(args.flags, 'input', 'i'), ...args.positionals];
    const targets = files.length > 0 ? files : ['-'];
    if (expect !== undefined && targets.length !== 1) {
        throw new CliError('--expect applies to exactly one input.', 2);
    }

    const results: { file: string; crc32: string; value: number; bytes: number }[] = [];
    for (const file of targets) {
        let value = seed;
        let bytes = 0;
        try {
            for await (const chunk of openInputStream(file === '-' ? undefined : file)) {
                const u8 = chunk as Uint8Array;
                value = coreCrc32(u8, value);
                bytes += u8.length;
            }
        } catch (e) {
            throw mapZipError(e, `Failed to read ${file === '-' ? 'stdin' : `"${file}"`}`);
        }
        results.push({ file, crc32: crcHex(value), value: value >>> 0, bytes });
    }

    if (format === 'json') {
        const pretty = hasFlag(args.flags, 'pretty') || !isJsonMode();
        process.stdout.write(serializeJson({ files: results, ...(expect !== undefined ? { expect: crcHex(expect) } : {}) }, pretty) + '\n');
    } else {
        for (const r of results) process.stdout.write(`${r.crc32}  ${r.bytes}  ${r.file}\n`);
    }

    if (expect !== undefined) {
        const got = results[0] as { value: number; crc32: string };
        if (got.value !== expect) {
            throw new CliError(
                `CRC-32 mismatch: expected ${crcHex(expect)}, got ${got.crc32}`,
                1,
                ErrorCode.CHECK_FAILED,
                { detail: { expectedCrc: expect, actualCrc: got.value } },
            );
        }
    }

    emitStatus({
        command: 'crc32',
        files: results.length,
        bytes: results.reduce((n, r) => n + r.bytes, 0),
        ...(expect !== undefined ? { expect: crcHex(expect), matched: true } : {}),
    });
}
