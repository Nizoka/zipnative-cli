# [zipnative] `ZipReader.verifyEntry()` reports an encrypted or stream-only-codec entry as a failed verification, indistinguishable from corruption — `verifyZip()` knows the `skipped` reason but `verifyEntry()` cannot say it

> **Draft for human submission** — target repository: `Nizoka/zipnative` (engine), not this one.
> Drafted under the zipnative Human-in-the-Loop policy ([AGENT_RULES.md](../AGENT_RULES.md)).
> Nothing here has been submitted; validate with `zipnative govern verify-issue .github/drafts/upstream-verify-entry-skipped-reason.md`.
> Suggested labels: `enhancement`, `api`, `verification`.

## Summary

`verifyZip()` classifies an entry it cannot decode as `skipped: 'encrypted'` or `skipped: 'stream-only-codec'` and does not count it as a failure. `ZipReader.verifyEntry()` — the per-entry primitive a consumer reaches for when it must verify a *subset* of entries — returns the bare `EntryVerification` `{ ok, crcMatch, sizeMatch, localHeaderMatch }`: for an encrypted entry it comes back `ok: false, localHeaderMatch: false` (the read preparation throws), for a codec without `decompressSync` it comes back `ok: false, crcMatch: false, sizeMatch: false`. Neither can be told apart from a lying local header or a wrong CRC, so every consumer that verifies entry by entry has to **re-derive the engine's own classification** from `entry.isEncrypted` and `getCodec(method).decompressSync === undefined` before calling it.

zipnative-cli does exactly that twice (`verify --entry`, and `modify`, which verifies every entry it re-emits verbatim). Duplicating a classification the engine already owns is the kind of drift the bridge-only rule exists to prevent.

## Environment

- zipnative **1.0.0** (`VERSION` export `1.0.0`), Node.js **v22.17.0**, Windows 11 Pro (10.0.26200)
- Consumers: zipnative-cli 1.0.0 `verify --entry` (`src/commands/verify.ts`) and `modify` survivor verification (`src/commands/modify.ts`); layering review 2026-09-05, item B7

## Reproduction

One stored entry with flag bit 0 (encrypted) set, crafted byte by byte (the engine never writes encryption).

```js
// verify-encrypted.mjs — verifyZip vs verifyEntry on one encrypted entry.
import { openZip, verifyZip } from 'zipnative';
import { crc32 } from 'node:zlib';
const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const name = Buffer.from('secret.bin');
const data = Buffer.from('opaque-ciphertext');
const crc = crc32(data) >>> 0;
const lfh = Buffer.from([...u32(0x04034b50), ...u16(20), ...u16(1), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
const cfh = Buffer.from([...u32(0x02014b50), ...u16(0x031e), ...u16(20), ...u16(1), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0)]);
const eocd = Buffer.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u32(cfh.length + name.length), ...u32(lfh.length + name.length + data.length), ...u16(0)]);
const bytes = Buffer.concat([lfh, name, data, cfh, name, eocd]);
console.log(JSON.stringify(verifyZip(bytes).entries));
console.log(JSON.stringify(openZip(bytes).verifyEntry('secret.bin')));
```

Output (zipnative 1.0.0):

```
[{"name":"secret.bin","ok":false,"crcMatch":false,"sizeMatch":false,"localHeaderMatch":true,"skipped":"encrypted"}]
{"ok":false,"crcMatch":false,"sizeMatch":false,"localHeaderMatch":false}
```

The second line is what a consumer gets for a *broken local header* too. Registering a codec for the entry's method with `decompressStream` only (no `decompressSync`) gives `{"ok":false,"crcMatch":false,"sizeMatch":false,"localHeaderMatch":true}` — the shape of a CRC lie.

## Expected behaviour

Either (additive, non-breaking):

1. `verifyEntry()` returns `EntryVerification & { skipped?: 'encrypted' | 'stream-only-codec' }` — the field `VerifiedEntry` already declares — with `localHeaderMatch` still reflecting the cross-check that *was* possible (as `verifyZip` reports it: `true` for the encrypted case), or
2. `verifyZip(bytes, { entries: string[] })` verifies only the named entries with the full report shape (`skipped`, diagnostics, structural `error`), so subset verification never needs the primitive.

Either makes "could not verify" and "verified and wrong" distinct at the API, which is the difference between "skip and count" and "refuse and abort" for a consumer.

## Actual behaviour

`src/parser/zip-reader.ts` `verifyEntry()` (around line 2112 of `dist/index.js` in 1.0.0) wraps `prepareRead()` + `codec.decompressSync()` in one `try {} catch {}` and reports whatever booleans were reached; `verifyZip()` (around lines 3476–3500) tests `entry.isEncrypted` and `codec.decompressSync === undefined` *before* calling it and writes the `skipped` reason itself. The classification lives only in the whole-archive path.

## How zipnative-cli compensates today

`src/commands/verify.ts` (`--entry`) and `src/commands/modify.ts` (`verifySurvivors`) each check `entry.isEncrypted` and `getCodec(entry.compressionMethod)?.decompressSync === undefined` before calling `verifyEntry()`, and emit `skipped` / `verifySkipped` themselves. Both copies are to be deleted once the engine reports the reason.

## Related (engine API asks noted by the same review, no separate issue yet)

- `analyzeDeterminism(reader)` — `inspect` re-derives the determinism verdict (DOS-epoch fields, raw-name order, UTF-8 flags) from public `ZipEntry` fields.
- a write-side `unixMode` helper (`setUnixMode(mode, isDirectory)` or `AddEntryOptions.unixMode`) — the CLI synthesises the external-attributes word for `--preserve-mode` and manifest `mode`.
- the node-zlib inflate error classes (sibling draft `upstream-node-zlib-inflate-errors.md`) and local-time DOS encoding (`upstream-dos-time-local-wallclock.md`).

## Non-goals check

No encryption support is requested (only the honest *reporting* of an undecodable entry), no other archive format, no multi-volume archives, no salvage, no filesystem or network I/O in the engine, no runtime dependency. Read path only: the frozen `deterministic: true` bytes are untouched. No security default is weakened — a consumer can only become *more* precise in what it refuses.

## Compliance report

- **Zero-dependency confirmed** — no new runtime dependency is proposed.
- **Reproduction command** — `node verify-encrypted.mjs` (zipnative 1.0.0, Node v22.17.0).
- **Reproduction result** — `verifyZip` reports `skipped: "encrypted"` (not a failure); `verifyEntry` reports `ok: false, localHeaderMatch: false` with no reason.
- **Duplicate search** — to be performed by the submitting human against open and closed issues of `Nizoka/zipnative` (search terms: `verifyEntry`, `skipped`, `stream-only-codec`, `EntryVerification`). No GitHub read or write was performed by the drafting agent.
- **Affected packages** — `zipnative` (API); `zipnative-cli` (two duplicated classifications); `zipnative-mcp` (future consumer).
- **Identity reminder shown** — see below.

## Identity reminder

Anything submitted from this draft is published under **your** GitHub identity and you share responsibility for its content. Review it, run the reproduction yourself, edit freely, and submit it manually — no agent may open, edit or comment on the upstream issue on your behalf.
