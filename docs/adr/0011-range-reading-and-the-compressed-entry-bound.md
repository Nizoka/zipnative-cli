---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# Range reading of local archives, and the compressed-entry bound gets its flag

## Context and Problem Statement

Every random-access command loads the whole archive into memory, bounded by `--max-input-size`
(4 GiB by default). zipnative 1.1 adds `openZipRange()`: a reader over a `ByteRangeSource`
(`{ size, read(offset, length) }`) that parses the central directory and fetches each entry by
range, bounded by a ninth `ZipLimits` key, `maxEntryCompressedSize` (1 GiB + 1 MiB, CWE-770).
ADR 0007 declined a flag for that key because no command read through the range reader. The
second 1.1.0 review found the reader worth exposing: it is the only way to list, read or verify
an archive larger than memory.

## Decision Outcome

- `list`, `cat` and `verify` take `--range`. The CLI builds the `ByteRangeSource` itself over
  **one descriptor of a regular file** (`fileRangeSource()` in `src/utils/io.ts`): the size is the
  one checked on that descriptor, each read is bounds-checked and loops over short reads, and a
  file that shrinks mid-read is `E_IO`. stdin, a pipe or a device has no random access and is
  refused (`E_USAGE`). The engine owns every byte of structure; the CLI owns the I/O — the same
  split as everywhere else.
- Under `--range`, `--max-input-size` does not apply (nothing is buffered whole). The new
  `--max-entry-compressed-size` (the ninth `--max-*` flag, `LIMIT_FLAGS`) bounds every
  whole-entry fetch — `cat --raw`, `verify`, a codec without a streaming decoder. A streamed read
  (`cat`) holds one chunk at a time.
- `inspect` does not take `--range`: its determinism verdict (`analyzeDeterminism`) is measured
  over the archive's bytes, so a range-read `inspect` would be a flag with half an effect.
- No network source: `--url` stays out (offline, always). The range reader serves local files
  only.
- This supersedes ADR 0007: the flag now has an effect, so it exists.

### Consequences

- Good: an archive of any size can be listed, read entry by entry and verified with bounded
  memory; the ninth bound is configurable like the other eight.
- Neutral: `verify --range` verifies entry by entry (`verifyEntry`), with the same archive rule
  as `verifyZip` (`entryPasses()`), after an eager structural open.
