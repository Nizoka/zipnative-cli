---
description: "Use when working on the CLI entry point, arg parser, or overall dispatch logic. Covers entry point contract, help formatting, and exit code conventions."
applyTo: "src/index.ts"
---
# CLI Design

> Entry-point and arg-parser contracts live in `.github/copilot-instructions.md`. This file only
> adds deltas — do not restate the global rules.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (also a closed pipe: `EPIPE` on stdout/stderr ends the process quietly) |
| 1 | Runtime error (invalid input, I/O failure, hostile archive, failed check/verify, overwrite refusal) |
| 2 | Usage error (missing/invalid required argument, unknown command, `-xy` combined shorts, a refused combination, `ZIP_INVALID_OPTION`, `ZIP_LIMIT_INVALID`) |
| 130 / 143 | `SIGINT` / `SIGTERM` — the in-flight output files are removed first (`utils/inflight.ts`) |

## Dispatch

- `loadCommand(name)` lazy-imports one of the 15 commands: `create`, `modify` | `list`,
  `inspect`, `cat`, `extract`, `stream` | `verify`, `crc32`, `inflate` | `batch`, `doctor`,
  `schema`, `completion`, `govern`. Adding a command means touching `loadCommand`,
  `COMMAND_USAGE`, `USAGE` (the "Commands (15)" block), and `COMMANDS` in
  `src/commands/completion.ts` — the single source of truth that `schema manifest`,
  `doctor` and the docs consistency test all derive from.
- `--help`/`-h` and `--version`/`-V` handled before dispatch; `zipnative <cmd> --help`
  prints that command's usage.
- Unknown command → `CliError(…, 2, E_USAGE)` on both the dispatch and the `--help` path;
  flags but no command → exit 2 "No command given"; bare `zipnative` → usage, exit 0.
- Both `parseArgs` calls receive `BOOLEAN_FLAGS` (`utils/flags.ts`) so a boolean flag never
  swallows the command name or a positional (`zipnative --json list a.zip`).
- Only the FIRST occurrence of the command name is stripped from argv before the
  per-command `parseArgs` (an entry literally named `list` must survive as a positional).
- `main()` installs the `EPIPE` listeners and the `SIGINT` / `SIGTERM` handlers once, before
  any write.

## Agent globals

- The global-flag block sets `ZIPNATIVE_JSON=1` on `--json`, `ZIPNATIVE_DRY_RUN=1` on
  `--dry-run`, `ZIPNATIVE_QUIET=1` on `--quiet`, `ZIPNATIVE_STRICT=1` on `--strict`,
  `ZIPNATIVE_PURE_CODECS=1` on `--pure-codecs` and `NO_COLOR=1` on `--no-color`, so all
  commands and `utils/agent.ts` can read them via env (batch tasks run in-process and inherit
  them). A caller may set the variables directly; the behaviour must be identical to the flag
  (`create` / `extract --dry-run` print no text plan under `ZIPNATIVE_JSON` either way).
- Track the active command in a module-level `activeCommand` (set in `main()`); on a thrown
  error, when `isJsonMode()` is true, `emitJsonError(activeCommand, e)` writes the failure
  envelope (`{ ok:false, command, error:{ code, message, zipCode?, entryName?, detail? } }`)
  to stderr and the process exits with the `CliError.exitCode` (default 1).
- Numeric exit codes (0/1/2) are unchanged in every mode — `--json` only adds the envelope.
- Config merge (`.zipnativerc.json`) happens in `main()` after the command name is known and
  before dispatch; `--no-config` / `--config <file>` are read from the command's own flags.

## Help text

- One global `USAGE` block listing all 15 commands under their 4 group headings plus the
  `GLOBAL_USAGE` block (the global options incl. the 8 `--max-*` limits and
  `--max-input-size`), and one `*_USAGE` block per command. Point agents at `AGENTS.md`;
  state "Offline, always".
- Keep `*_USAGE` flag lists in sync with each command's actual flags AND with the `flags`
  array of the same command in `completion.ts` AND with the boolean table in
  `utils/flags.ts` (a boolean flag shows no `<value>` placeholder in the usage; a value flag
  shows one). Every `--format` line reads `--format, -f`.
- Name the security refusals and their codes in the usage of `extract` / `stream` (they are
  the contract agents branch on).
