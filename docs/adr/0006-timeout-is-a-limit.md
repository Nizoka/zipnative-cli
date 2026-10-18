---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# `--timeout` is a bound (`E_LIMIT`); `--progress` is stderr data

## Context and Problem Statement

zipnative 1.1 accepts an `AbortSignal` (`signal`) and an `onProgress` handler on every
asynchronous path. An agent driving the CLI wants a wall-clock bound and observable progress;
neither may change what stdout carries, and the error vocabulary (13 stable `E_*` classes) should
not grow for a condition that already has a class.

## Decision Outcome

- `--timeout <duration>` (`500`, `500ms`, `30s`, `5m`, `1h`; at most 2³¹−1 ms) arms one
  process-wide `AbortController` (`src/utils/control.ts`) whose abort reason IS the CLI error:
  `E_LIMIT`, exit 1, `detail { limit: "timeout", configured, observed }` (milliseconds), remedy
  `--timeout <duration>`. The engine rejects with that reason and `mapZipError` passes it through.
- The engine checks the signal before the first byte and between chunks and entries; the CLI's
  own byte loops call `checkAborted()`. A synchronous step already running (opening or verifying
  a buffered archive) always completes — JavaScript cannot pre-empt it — so the deadline bounds
  progress; it is not a kill. The file being written is removed like any failed write.
- `--progress` forwards the engine's snapshots to stderr: one throttled text line per update, or
  one NDJSON `{ "type": "progress", … }` object under `--json`. It is reported only where the
  engine measures progress (the chunked writer, the streaming extractor, the forward reader,
  `readEntryStream`); `--quiet` silences it. Opt-in, so a `--json` caller that did not ask for it
  still reads exactly one envelope.
- `stream` does not pass the signal to `iterateZipEntries`: zipnative 1.1.0's forward reader
  left a pending entry read unsettled when aborted, the event loop drained, and the run exited
  0 with a truncated file (found by the 1.1.0 review). The CLI's input loop
  (`readableToByteSource`) and write loop enforce the deadline there. As a backstop, the
  dispatcher fails any run whose event loop drains with the command still pending.
- `mapZipError` returns the deadline error whenever the signal has fired: the engine wraps an
  abort that reaches a decompressor as `ZIP_DECOMPRESSION_FAILED`.
- One deadline per process: a `batch` manifest task cannot carry `timeout`.
- No new `E_*` class.

### Consequences

- Good: agents get a deadline and progress without a new error class or a second output channel.
- Neutral: the deadline is cooperative; a huge buffered archive still finishes its synchronous
  open before the next check.
