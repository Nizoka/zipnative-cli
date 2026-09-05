# [zipnative] <one-line title: what is wrong, in the engine's vocabulary>

> **Draft for human submission** — target repository: `Nizoka/zipnative` (engine) or `Nizoka/zipnative-cli` (this CLI).
> Drafted under the zipnative Human-in-the-Loop policy ([AGENT_RULES.md](../AGENT_RULES.md)).
> Nothing here has been submitted; validate with `zipnative govern verify-issue .github/drafts/<this-file>.md`.
> Suggested labels: `bug` | `enhancement`, plus the area (`codecs`, `api`, `error-contract`, `verification`, …).

## Summary

What the consumer observes, which documented contract it contradicts, and who is affected.
Name the error classes and `ZIP_*` / `E_*` codes involved; never quote a message as the contract.

## Environment

- zipnative **x.y.z** (`VERSION` export), Node.js **vNN**, OS
- Consumer and command that surfaced it (zipnative-cli `<command>`, commit `<sha>`), date

## Reproduction

The exact script or command you **executed** locally, engine-only where possible
(a crafted archive or a generator script — never a CLI- or engine-produced archive
committed to the repository).

```js
// repro.mjs — minimal, self-contained, runs with `node repro.mjs`.
import { openZip } from 'zipnative';
```

Observed output, verbatim.

## Expected behaviour

The additive, non-breaking change requested, stated against the frozen contract
(`docs/errors.md`, the `deterministic: true` bytes, the public types).

## Actual behaviour

Where it happens in the source (`src/<file>.ts`, the dist line in the version above).

## How zipnative-cli compensates today

The workaround the CLI carries (file and function) and the statement that it is
to be deleted once the engine change lands. Omit if there is none.

## Non-goals check

No encryption, no other archive format, no multi-volume archives, no salvage of
damaged files, no filesystem or network I/O in the engine, no runtime dependency.
State whether the write path (frozen bytes) is touched and whether any security
default changes (it must not).

## Compliance report

- **Zero-dependency confirmed** — no new runtime dependency is proposed.
- **Reproduction command** — `node repro.mjs` (versions above).
- **Reproduction result** — the observed failure, including the `--json` envelope when driven through the CLI.
- **Duplicate search** — to be performed by the submitting human against open and closed issues (search terms: …). No GitHub read or write was performed by the drafting agent.
- **Affected packages** — `zipnative` | `zipnative-cli` | `zipnative-mcp`.
- **Identity reminder shown** — see below.

## Identity reminder

Anything submitted from this draft is published under **your** GitHub identity and you share responsibility for its content. Review it, run the reproduction yourself, edit freely, and submit it manually — no agent may open, edit or comment on the upstream issue on your behalf.
