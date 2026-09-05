# [zipnative] node-zlib inflate tier lets zlib's own `Z_DATA_ERROR` / `Z_BUF_ERROR` escape instead of `ZipFormatError` `ZIP_DEFLATE_CORRUPT` / `ZIP_DEFLATE_TRUNCATED`

> **Draft for human submission** — target repository: `Nizoka/zipnative` (engine), not this one.
> Drafted under the zipnative Human-in-the-Loop policy ([AGENT_RULES.md](../AGENT_RULES.md)).
> Nothing here has been submitted; validate with `zipnative govern verify-issue .github/drafts/upstream-node-zlib-inflate-errors.md`.
> Suggested labels: `bug`, `codecs`, `error-contract`.

## Summary

The frozen error vocabulary says a corrupt raw DEFLATE stream is `ZipFormatError` `ZIP_DEFLATE_CORRUPT` and a truncated one `ZIP_DEFLATE_TRUNCATED`. That holds on the pure-TS tier. On the **node-zlib tier** the sync inflate wrapper only translates `ERR_BUFFER_TOO_LARGE` (→ `ZIP_INFLATE_OUTPUT_OVERFLOW`) and rethrows every other zlib failure untouched, so the same corrupt bytes surface as a plain `Error` with `code: 'Z_DATA_ERROR'` (`invalid distance too far back`, `invalid block type`, …) or `code: 'Z_BUF_ERROR'` (`unexpected end of file`) — no `ZipError` class, no `ZIP_*` code. **Which class a consumer sees depends on which tier happened to activate**, which breaks the "branch on `err.code`, never on the message" contract the ecosystem documents for agents.

Not affected: `readEntry()` / `verifyEntry()` (they compare sizes and CRC after the inflate and report `ZIP_SIZE_MISMATCH` / `ZIP_CRC_MISMATCH`), and the output-overflow case (wrapped). Affected: every path that calls the registered method-8 codec's `decompressSync` directly — `getCodec(METHOD_DEFLATE).decompressSync(bytes, maxOutput)` — which is what a raw-DEFLATE consumer (zipnative-cli `inflate --sync`) does.

## Environment

- zipnative **1.0.0** (`VERSION` export `1.0.0`), Node.js **v22.17.0**, Windows 11 Pro (10.0.26200)
- Consumer: zipnative-cli 1.0.0 `inflate --sync` on the `node-zlib` tier (documentation audit finding D-04, 2026-09-05, verified on the built CLI at commit `54c5fa2`)

## Reproduction

Observed through zipnative-cli 1.0.0 before it added its own compensation (see "How zipnative-cli compensates today"): the same non-DEFLATE input, three tiers.

```
$ printf 'this is not a deflate stream at all, not even close' > payload.bin
$ zipnative inflate --input payload.bin --output out.bin --json
{"ok":false,"command":"inflate","error":{"code":"E_PARSE","message":"Inflate failed: zipnative: deflate back-reference before start of output (corrupt stream)","zipCode":"ZIP_DEFLATE_CORRUPT"}}
$ zipnative inflate --input payload.bin --output out.bin --sync --pure-codecs --json
{"ok":false,"command":"inflate","error":{"code":"E_PARSE","message":"Inflate failed: zipnative: deflate back-reference before start of output (corrupt stream)","zipCode":"ZIP_DEFLATE_CORRUPT"}}
$ zipnative inflate --input payload.bin --output out.bin --sync --json
{"ok":false,"command":"inflate","error":{"code":"E_RUNTIME","message":"Inflate failed: invalid distance too far back"}}
```

The third call is the node-zlib tier: `Error` with `code: 'Z_DATA_ERROR'`, no `ZipError`, no `zipCode`. A stream cut in half yields `code: 'Z_BUF_ERROR'`, message `unexpected end of file`, same class gap.

Engine-only, in a context where the node-zlib tier is active (a CommonJS bundle whose `require` the engine's probe can see — zipnative-cli's `dist/cli.cjs` is one; in a bare `node` script `activeDeflateTier()` stayed `pure` for me even after `await initNodeZipCodecs()`, which may be a second, smaller finding about tier activation in ESM contexts):

```js
// probe-inflate.cjs — the registered method-8 codec, corrupt and truncated input.
const { getCodec, initNodeZipCodecs, ZipError, METHOD_DEFLATE } = require('zipnative');
const { deflateRawSync } = require('node:zlib');
const garbage = new TextEncoder().encode('this is not a deflate stream at all, not even close');
const probe = (label, buf) => {
  try { getCodec(METHOD_DEFLATE).decompressSync(buf, 1 << 20); }
  catch (e) { console.log(label, e instanceof ZipError ? `ZipError ${e.code}` : `${e.constructor.name} code=${e.code} "${e.message}"`); }
};
(async () => {
  await initNodeZipCodecs();
  probe('corrupt  ', garbage);                                     // node-zlib: Error code=Z_DATA_ERROR "invalid distance too far back"
  const whole = deflateRawSync(Buffer.from('truncate me '.repeat(200)));
  probe('truncated', whole.subarray(0, whole.length >> 1));        // node-zlib: Error code=Z_BUF_ERROR "unexpected end of file"
})();
```

Expected on every tier: `ZipError ZIP_DEFLATE_CORRUPT` and `ZipError ZIP_DEFLATE_TRUNCATED` (which is exactly what the pure tier prints).

## Expected behaviour

`wrapNodeInflate()` maps zlib's error codes onto the frozen vocabulary before rethrowing:

- `Z_DATA_ERROR`, `Z_NEED_DICT` → `ZipFormatError('ZIP_DEFLATE_CORRUPT', …)`
- `Z_BUF_ERROR` → `ZipFormatError('ZIP_DEFLATE_TRUNCATED', …)`
- `ERR_BUFFER_TOO_LARGE` → `ZipDataError('ZIP_INFLATE_OUTPUT_OVERFLOW', …)` (already the case)
- anything else → rethrow (a genuine engine bug), keeping the original as `cause`

so that the class and code of a decode failure are independent of the codec tier, as `docs/errors.md` promises.

## Actual behaviour

`src/codecs/inflate.ts` (1.0.0 dist, `wrapNodeInflate`, around line 897 of `dist/index.js`) translates only `ERR_BUFFER_TOO_LARGE`; the pure tier (`inflateRawJS`) raises `ZipFormatError` for the same inputs. The registered method-8 codec's `decompressSync` therefore leaks a raw zlib `Error` on the node-zlib tier.

## How zipnative-cli compensates today

`src/utils/ziperr.ts` carries a `ZLIB_TO_ZIP` table (`Z_DATA_ERROR` / `Z_NEED_DICT` → `ZIP_DEFLATE_CORRUPT`, `Z_BUF_ERROR` → `ZIP_DEFLATE_TRUNCATED`, both `E_PARSE`) applied in `mapZipError()` when the caught value is not a `ZipError`. It is compensation: the `zipCode` it emits is inferred, not carried. The table is to be deleted once the engine wraps the errors.

## Related (engine API asks noted by the same audit, no separate issue yet)

- `analyzeDeterminism(reader)` — `inspect` re-derives the determinism verdict (DOS-epoch fields, raw-name order, UTF-8 flags) from public `ZipEntry` fields; an engine getter would make CLI and writer agree by construction.
- a write-side `unixMode` helper (`setUnixMode(mode, isDirectory)` or `AddEntryOptions.unixMode`) — the CLI synthesises the external-attributes word itself for `--preserve-mode` and manifest `mode`.
- `defaultDate` / `date` encoded from local getters (see the sibling draft `upstream-dos-time-local-wallclock.md`).

## Non-goals check

No encryption, no other archive format, no multi-volume archives, no salvage of damaged files, no filesystem or network I/O in the engine, no runtime dependency. Read path only: no byte written by the engine changes, the frozen `deterministic: true` contract is untouched. No security default is weakened — a failure is classified more precisely, never swallowed.

## Compliance report

- **Zero-dependency confirmed** — no new runtime dependency is proposed.
- **Reproduction command** — the three `zipnative inflate` calls above (zipnative-cli 1.0.0 at commit `54c5fa2`, before its compensation) and `node probe-inflate.cjs` in a context where the node-zlib tier is active.
- **Reproduction result** — pure tier and streaming path: `ZipError ZIP_DEFLATE_CORRUPT`; node-zlib `decompressSync`: plain `Error` `Z_DATA_ERROR` / `Z_BUF_ERROR` (CLI envelope `E_RUNTIME`, no `zipCode`).
- **Duplicate search** — to be performed by the submitting human against open and closed issues of `Nizoka/zipnative` (search terms: `wrapNodeInflate`, `Z_DATA_ERROR`, `ZIP_DEFLATE_CORRUPT`, `node-zlib tier`). No GitHub read or write was performed by the drafting agent.
- **Affected packages** — `zipnative` (root cause); `zipnative-cli` (compensates in `ziperr.ts`); `zipnative-mcp` (future consumer of the same codec registry).
- **Identity reminder shown** — see below.

## Identity reminder

Anything submitted from this draft is published under **your** GitHub identity and you share responsibility for its content. Review it, run the reproduction yourself, edit freely, and submit it manually — no agent may open, edit or comment on the upstream issue on your behalf.
