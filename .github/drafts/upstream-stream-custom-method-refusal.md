# [zipnative] `iterateZipEntries()`: `data()` on a registered custom-method entry runs the DEFLATE pump and fails with `ZIP_DECOMPRESSION_FAILED` instead of using the codec or refusing before the first byte

> **Draft for human submission** — target repository: `Nizoka/zipnative` (engine), not this one.
> Drafted under the zipnative Human-in-the-Loop policy ([AGENT_RULES.md](../AGENT_RULES.md)).
> Nothing here has been submitted; validate with `zipnative govern verify-issue .github/drafts/upstream-stream-custom-method-refusal.md`.
> Suggested labels: `bug`, `streaming`, `codecs`.

## Summary

The forward reader accepts an entry whose compression method has a registered codec (`getCodec(method) !== null` passes inside `data()`), but the entry pump only knows STORE and the built-in DEFLATE path: a method-99 entry with a codec that exports `decompressSync` **and** `decompressStream` is pushed through the inflater and dies with `ZIP_DECOMPRESSION_FAILED` ("the data is corrupt or hostile"). The random-access reader (`openZip` → `readEntryStream` / `verifyEntry`) decodes the same entry with the same codec correctly, so the two readers disagree on what a registered codec means.

For a consumer that streams to a sink this is the worst failure class: it is reported as **data corruption** (`ZipDataError`) rather than as an **unsupported** shape (`ZipUnsupportedError`), so an "unsupported → skip" policy cannot catch it, and — depending on the payload — bytes may already have been yielded before the failure. The refusal should happen before `data()` yields anything, or the codec's `decompressStream` should be used.

## Environment

- zipnative **1.0.0** (`VERSION` export `1.0.0`), Node.js **v22.17.0**, Windows 11 Pro (10.0.26200)
- Consumer: zipnative-cli 1.0.0 `stream --cat` / `stream --output-dir` with `--codec` (audit finding B-20; probe ids `A27-stream-m99`, `A27-stream-sync-only`)

## Reproduction

The engine writes methods 0 and 8 only, so the archive is crafted byte by byte (one entry, method 99, payload stored as-is, valid CRC-32, no data descriptor).

```js
// make-method99.mjs — one-entry archive whose entry declares compression method 99.
import { writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
const name = Buffer.from('x.bin');
const data = Buffer.from('exotic method payload');
const fixed = (sig, fields) => { const b = Buffer.alloc(4 + fields.reduce((n, [w]) => n + w, 0)); b.writeUInt32LE(sig, 0); let o = 4; for (const [w, v] of fields) { w === 2 ? b.writeUInt16LE(v, o) : b.writeUInt32LE(v >>> 0, o); o += w; } return b; };
const common = [[2, 0], [2, 99], [2, 0], [2, 33], [4, crc32(data)], [4, data.length], [4, data.length], [2, name.length], [2, 0]];
const lfh = Buffer.concat([fixed(0x04034b50, [[2, 20], ...common]), name, data]);
const cfh = Buffer.concat([fixed(0x02014b50, [[2, 20], [2, 20], ...common, [2, 0], [2, 0], [2, 0], [4, 0], [4, 0]]), name]);
const eocd = fixed(0x06054b50, [[2, 0], [2, 0], [2, 1], [2, 1], [4, cfh.length], [4, lfh.length], [2, 0]]);
writeFileSync('method99.zip', Buffer.concat([lfh, cfh, eocd]));
```

```js
// identity-99.mjs — read-side codec for method 99 (the payload is stored as-is).
export const codecs = [{
  method: 99,
  name: 'identity-99',
  decompressSync: (data) => data.slice(),
  decompressStream: async function* (data) { yield data.slice(); },
}];
```

Driven through zipnative-cli 1.0.0 (every call below goes straight to the engine; `--codec` is `registerCodec()`):

```
$ node make-method99.mjs
$ zipnative verify method99.zip --codec ./identity-99.mjs --json --summary
{"ok":true,"entries":1,"failed":0,"skipped":0,"diagnostics":0}
$ zipnative cat method99.zip x.bin --codec ./identity-99.mjs
exotic method payload
$ zipnative stream method99.zip --list --codec ./identity-99.mjs --format json --fields entries.name,entries.method,entries.methodName
{"entries":[{"name":"x.bin","method":99,"methodName":"identity-99"}]}
$ zipnative stream method99.zip --cat x.bin --codec ./identity-99.mjs --json
{"ok":false,"command":"stream","error":{"code":"E_DATA","message":"Failed to read entry \"x.bin\": zipnative: streamed entry failed to decompress () — the data is corrupt or hostile","zipCode":"ZIP_DECOMPRESSION_FAILED","entryName":"x.bin"}}
$ zipnative stream method99.zip --cat x.bin --codec ./identity-99.mjs --skip-unsupported --json
(same E_DATA envelope — the skip policy only covers ZipUnsupportedError)
```

Engine-only equivalent: `registerCodec(codecs[0])`, then `for await (const item of iterateZipEntries(source)) for await (const chunk of item.data()) …` on `method99.zip` throws `ZipDataError` `ZIP_DECOMPRESSION_FAILED`; `openZip(bytes).readEntryStream('x.bin')` yields the 21 payload bytes.

## Expected behaviour

Either of these, so that the forward reader and the random-access reader agree on what a registered codec means:

1. **Use the codec.** When `getCodec(method)` returns a codec with `decompressStream`, `data()` pumps through it (with the same output counting and CRC verification as the DEFLATE path); a codec with `decompressSync` only is refused with `ZIP_UNSUPPORTED_CODEC_MODE` before any byte is yielded, exactly as the random-access `readEntryStream` refuses today.
2. **Or refuse before the first byte.** If the forward pump intentionally stays STORE/DEFLATE-only, `data()` throws `ZipUnsupportedError` (`ZIP_UNSUPPORTED_METHOD` or `ZIP_UNSUPPORTED_CODEC_MODE`, feature `method:99`) **before** yielding, so a consumer can `skip()` and continue — the same shape it already has for encrypted entries. A helper such as `canDecode(header)` (or a `decodable: boolean` / `codecMode` field on `StreamedZipHeader`) would let a sink decide before it opens a destination.

In both cases the failure is classified as unsupported, never as corrupt data.

## Actual behaviour

`data()` checks `getCodec(lfh.compressionMethod) === null` and, because the codec is registered, proceeds to `streamEntryData()`, which only distinguishes STORE from the inflate pump. The inflater is fed the raw method-99 bytes and throws `ZIP_DECOMPRESSION_FAILED` (message suffix empty: `"failed to decompress ()"`). With this 21-byte fixture no payload byte was yielded before the throw; the CLI audit observed partial output on a larger payload (probe `A27-stream-m99`) before the same error. The `--list` / `skip()` path is fine — only `data()` is affected.

## Root cause (1.0.0 source)

`src/parser/zip-iterate.ts`: the entry object's `data()` (around lines 274–282 in 1.0.0) only guards encryption and `getCodec(...) === null`, then delegates to `streamEntryData()` (around lines 383–390), which branches on `method === METHOD_STORE` and otherwise runs the built-in DEFLATE pump. The registered codec's `decompressStream` / `decompressSync` is never consulted on this path. The file header already documents that custom codec + bit 3 (data descriptor) is refused with `ZIP_UNSUPPORTED_CD_LESS_DESCRIPTOR`; the descriptor-less custom-method case is the gap.

## Impact on consumers

- zipnative-cli 1.0.0 documents the limitation ("`stream` lists and skips custom-method entries but cannot decode them; use `cat` / `extract --codec` on the complete file") and its `--skip-unsupported` cannot cover an `E_DATA` failure by design (skipping on `E_DATA` would hide real corruption).
- Any sink that has already opened a destination when the pump fails has to unlink a partial file and cannot tell "codec not usable here" from "hostile bytes".

## Non-goals check

No encryption, no other archive format, no multi-volume archives, no salvage of damaged files, no filesystem or network I/O in the engine. No runtime dependency. No byte written by the engine changes (this is the read path only); the frozen `deterministic: true` contract is untouched. No security default is weakened — the proposal makes a refusal earlier and better classified.

## Compliance report

- **Zero-dependency confirmed** — no new runtime dependency is proposed.
- **Reproduction command** — `node make-method99.mjs` then the four `zipnative` commands above (zipnative 1.0.0 through zipnative-cli 1.0.0, Node v22.17.0).
- **Reproduction result** — `verify` and `cat` decode the entry with the codec (exit 0, payload intact); `stream --cat` fails with `E_DATA` / `ZIP_DECOMPRESSION_FAILED` (exit 1), also under `--skip-unsupported`; `stream --list` is fine.
- **Duplicate search** — to be performed by the submitting human against open and closed issues of `Nizoka/zipnative` (search terms: `iterateZipEntries`, `custom codec`, `decompressStream`, `ZIP_DECOMPRESSION_FAILED`, `streamEntryData`). No GitHub read or write was performed by the drafting agent.
- **Affected packages** — `zipnative` (root cause, forward reader); `zipnative-cli` (`stream --cat` / `--output-dir` with `--codec`; documented as a limitation in 1.0.0); `zipnative-mcp` (future consumer of the same reader).
- **Identity reminder shown** — see below.

## Identity reminder

Anything submitted from this draft is published under **your** GitHub identity and you share responsibility for its content. Review it, run the reproduction yourself, edit freely, and submit it manually — no agent may open, edit or comment on the upstream issue on your behalf.
