---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# Bounded reads through one descriptor; overwrites by temp file and rename

## Context and Problem Statement

1.0.0 had three filesystem weaknesses that pkinative-cli's audits had already closed:

1. **Check-then-read.** A buffered read `stat`'d the path, compared the size with
   `--max-input-size`, then `readFile`'d it. `/dev/zero` (or any device or FIFO) reports size 0,
   passed the check and was read until memory ran out; a file growing after the check was read in
   full.
2. **Overwrite followed links.** `--overwrite` opened the target with `w`: a symlink planted at
   the output path (including a file-level link inside an extraction destination — the sink's
   realpath checks cover parent directories) was followed and its target truncated.
3. **Cleanup removed what it had not created.** `cat`, `inflate` and `create` unlinked the
   output path after any non-I/O error. The exclusive (`wx`) stream open is deferred, so an
   engine error raised before it (an unsupported method on the first pull) made the CLI delete a
   **pre-existing** file it had been told not to overwrite. `existsSync`-style checks also missed a
   dangling symlink, which Windows' `CREATE_NEW` follows.

## Decision Outcome

- `readFileOrStdin()` opens the path once. A regular file is size-checked on the descriptor and
  read to that size only, looping over short reads; anything else (pipe, FIFO, device, socket) is
  read from the same descriptor and byte-counted like stdin, stopping with `E_LIMIT` past the
  bound. Process substitution (`<(curl …)`) keeps working; a directory is `E_IO`.
- Without `--overwrite`, a write refuses any existing path (`lstat`, so a dangling link counts)
  and creates the file exclusively (`wx`).
- With `--overwrite`, the bytes go to an exclusively created, unpredictable temp sibling
  (`.<name>.<12 hex>.tmp`) that is `rename()`d over the target once complete: a reader never sees
  a half-written file, a link at the target is replaced, and a failed write leaves the original
  untouched. `modify --in-place` already worked this way.
- The write layer (`writeOutput`, `writeFileStream`) removes only the file it created; callers
  never unlink a target.

### Consequences

- Good: no input can exceed its bound, no output is written through a planted link, and no
  failure can destroy a file the user owns.
- Neutral: `--overwrite` needs write permission on the target's directory (for the temp file and
  the rename), as `modify --in-place` always did; on Windows a target held open by another
  process cannot be replaced (`EPERM`).
