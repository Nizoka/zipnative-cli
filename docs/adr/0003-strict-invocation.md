---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# Strict invocation: undeclared, repeated or surplus input is a usage error

## Context and Problem Statement

1.0.0's parser collected any `--flag` as-is and the commands read the names they knew, so:

- a typo was a silent no-op — `extract --overwite`, `extract --skip-unsfe`, a `--max-entrys`
  bound that never applied;
- `--constructor x` reached a plain object and crashed with `E_RUNTIME`;
- `--long --long` and `--input a --input b` on a single-input command were merged or silently
  reduced to one value;
- an extra positional (`list a.zip b.zip`) was ignored;
- a one-letter alias meant something only where a command happened to read it (`batch -f` and
  `inspect -e` were ignored).

For an agent-first CLI an ignored argument is the worst outcome: the run "succeeds" with a
policy the caller did not ask for. pkinative-cli refuses all of these (its audit A2-11).

## Decision Outcome

- The parser (`src/utils/args.ts`) stores flags in a prototype-free record, refuses empty and
  prototype names, canonicalises the aliases (`-i`, `-o`, `-d`, `-e`, `-f`, `-h`, `-q`, `-V`) to
  their long name, and refuses a switch given twice or a flag given both bare and with a value.
- The dispatcher (`assertInvocation()` in `src/commands/completion.ts`) refuses, before any input
  is read: a flag the command does not declare in `COMMANDS` (or the global table), a value flag
  given twice unless declared repeatable (`REPEATABLE_FLAGS`), more positionals than the command
  takes, and an operand together with the flag it stands for (`OPERANDS`). All `E_USAGE`, exit 2.
- Every task of a `batch --manifest` goes through the same check — aliases canonicalised,
  prototype keys refused — for all tasks before the first one runs.
- Refusal messages never echo a value: a stray token may be a secret typed in the wrong place.

### Consequences

- Good: an invocation either means exactly what it says or does not run; the `COMMANDS` table
  stays the single source of truth for the surface (completions, `schema manifest`, docs tests,
  and now the parser).
- Bad: a script that relied on an ignored flag or positional fails with exit 2 on 1.1.0 —
  which is the point. Recorded as a security fix with its migration in the CHANGELOG.
