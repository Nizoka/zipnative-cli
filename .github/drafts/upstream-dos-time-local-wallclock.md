# [zipnative] `dateToDosDateTime()` encodes the host-local wall-clock: one `Date` yields different DOS fields per time zone

> **Draft for human submission** — target repository: `Nizoka/zipnative` (engine), not this one.
> Drafted under the zipnative Human-in-the-Loop policy ([AGENT_RULES.md](../AGENT_RULES.md)).
> Nothing here has been submitted; validate with `zipnative govern verify-issue .github/drafts/upstream-dos-time-local-wallclock.md`.
> Suggested labels: `bug`, `determinism`, `docs`.

## Summary

`src/core/zip-dos-time.ts` converts a `Date` to the DOS date/time pair through the **local** getters (`getFullYear`, `getMonth`, `getDate`, `getHours`, `getMinutes`, `getSeconds`). A caller that passes one instant — `new Date('2020-06-01T12:00:00Z')` — therefore gets three different `dosTime` words on three hosts (UTC, Europe/Paris, Asia/Tokyo), and three different archives. Nothing in the public API or the determinism guide says that a `Date` is encoded as the host-local wall-clock, so consumers that promise reproducible bytes for an explicit date (zipnative-cli's `--date <ISO>` did) silently depend on `TZ`.

This is not about `deterministic: true` timestamps, which are pinned to the DOS epoch and unaffected. It is about every archive that carries a caller-supplied `date` (`CreateZipOptions.defaultDate`, `AddEntryOptions.date`, `ZipModifier` payloads).

## Environment

- zipnative **1.0.0** (`node_modules/zipnative/dist/index.js`, `VERSION` export `1.0.0`)
- Node.js **v22.17.0**, Windows 11 Pro (10.0.26200); the CLI audit reproduced the same pair (`24576` vs `28672`) under Git Bash with `TZ=UTC` / `TZ=Europe/Paris`
- zipnative-cli 1.0.0 (`release/v1.0.0`) is the consumer that hit it

## Reproduction

Minimal script, engine only (no CLI involved). It sets `process.env.TZ` between runs, which Node honours at runtime on every platform.

```js
// dos-time.mjs — one instant, three host time zones, three DOS encodings.
import { createZip, openZip } from 'zipnative';

const instant = new Date('2020-06-01T12:00:00Z');
for (const tz of ['UTC', 'Europe/Paris', 'Asia/Tokyo']) {
  process.env.TZ = tz;
  const zip = createZip();
  zip.add('a.txt', new TextEncoder().encode('hello'), { date: instant });
  const reader = await openZip(await zip.toBytes());
  const [e] = Array.from(await reader.entries());
  console.log(`TZ=${tz.padEnd(12)} dosDate=${e.dosDate} dosTime=${e.dosTime}`);
}
```

```
$ node dos-time.mjs
TZ=UTC          dosDate=20673 dosTime=24576
TZ=Europe/Paris dosDate=20673 dosTime=28672
TZ=Asia/Tokyo   dosDate=20673 dosTime=43008
```

`24576` is 12:00:00, `28672` is 14:00:00 (CEST), `43008` is 21:00:00 (JST) — the local wall-clock of the same instant. Across a date boundary `dosDate` moves too.

## Expected behaviour

One of the two, explicitly:

1. **A documented, selectable convention.** The same `Date` produces the same DOS fields on every host, or the caller can ask for that: e.g. a `dosTimeMode: 'utc' | 'local'` option on `CreateZipOptions` (inherited by `AddEntryOptions` and `createZipModifier`), and the mirror on the read side so `ZipEntry.lastModified` / `StreamedZipHeader.lastModified` decode with the same convention. The default must stay `'local'` — see the byte-identity note below.
2. **At minimum, the contract written down.** The API docs for `defaultDate` / `date` / `lastModified` and `docs/guides/determinism.md` state that a `Date` is encoded as the **host-local wall-clock** (DOS convention: no zone), that the reverse conversion builds a local `Date`, and that a caller who needs host-independent bytes must hand the engine a `Date` whose local components are the wall-clock it wants stored.

## Actual behaviour

The `Date` is encoded through the local getters and nothing says so. `dosDateTimeToDate()` is symmetric (it builds a local `Date` from the fields), so a round-trip on one host is stable and the tests pass, but the bytes differ between hosts. A consumer only notices when a reproducibility check compares hashes produced in two time zones.

## Root cause

`src/core/zip-dos-time.ts` (1.0.0, bundled as `dist/index.js` "// src/core/zip-dos-time.ts"):

```js
function dateToDosDateTime(date) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const dosDate = year - 1980 << 9 | date.getMonth() + 1 << 5 | date.getDate();
  const dosTime = date.getHours() << 11 | date.getMinutes() << 5 | date.getSeconds() >>> 1;
  return { dosDate, dosTime };
}
```

The DOS convention itself is fine (a ZIP timestamp carries no zone); what is missing is the choice of which wall-clock is stored, and a statement of it.

## How zipnative-cli compensates today (1.0.0)

`src/utils/zipops.ts` `parseIsoDateUtc()` reads every ISO date the CLI accepts as UTC (a string without a zone designator gets `Z`), then builds `new Date(y, m, d, h, mi, s)` from the **UTC** components — a `Date` whose local getters return the UTC wall-clock — before handing it to the engine. The stored DOS fields are then identical on every host. This works, but it is a consumer re-deriving an engine contract that is not published; `date: 'now'` and `--mtime` remain local by nature and are documented as non-reproducible.

## Byte-identity note (rule 4)

- `deterministic: true` output is **not** affected: timestamps are pinned to `DETERMINISTIC_DOS_DATE` / `DETERMINISTIC_DOS_TIME` and the frozen byte contract holds as is.
- Changing the default conversion for non-deterministic output would change the bytes of every archive written with an explicit `date` on a non-UTC host. That is a semver-**major** byte change; hence the proposal keeps `'local'` as the default and adds an opt-in, or documents the current behaviour without changing it.

## Non-goals check

No encryption, no other archive format, no multi-volume archives, no salvage of damaged files, no filesystem or network I/O in the engine. No runtime dependency: the change is a pure conversion option (or a documentation change).

## Compliance report

- **Zero-dependency confirmed** — no new runtime dependency is proposed; the fix is a conversion option or documentation.
- **Reproduction command** — `node dos-time.mjs` (script above) with zipnative 1.0.0, Node v22.17.0.
- **Reproduction result** — `dosTime` 24576 / 28672 / 43008 for one instant under `TZ=UTC` / `Europe/Paris` / `Asia/Tokyo`; the CLI audit (finding A-02) observed the same 24576 vs 28672 pair through `zipnative create --deterministic --date 2020-06-01T12:00:00Z` before the CLI-side compensation landed in zipnative-cli commit `ecda18a`.
- **Duplicate search** — to be performed by the submitting human against open and closed issues of `Nizoka/zipnative` (search terms: `dosTime`, `time zone`, `TZ`, `getHours`, `zip-dos-time`). No GitHub read or write was performed by the drafting agent.
- **Affected packages** — `zipnative` (root cause); `zipnative-cli` (compensated in 1.0.0, would drop the workaround once an engine option exists); `zipnative-mcp` (future consumer).
- **Identity reminder shown** — see below.

## Identity reminder

Anything submitted from this draft is published under **your** GitHub identity and you share responsibility for its content. Review it, run the reproduction yourself, edit freely, and submit it manually — no agent may open, edit or comment on the upstream issue on your behalf.
