---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# The configuration file is presentation only

## Context and Problem Statement

`.zipnativerc.json` is found by walking up from the working directory, so a user who runs
`zipnative extract …` inside a cloned repository reads a file somebody else wrote. Up to 1.0.0
the loader refused a deny-list of one key (`codec`, because it executes user code) and accepted
every other flag. A planted file could therefore:

- disable or widen every bound (`"max-entries": "none"`, `"max-ratio": "none"`,
  `"max-input-size": "none"`) — the zip-bomb defences of the engine and the CLI;
- turn on `overwrite`, `skip-unsafe`, `skip-unsupported` or `allow-symlinks` for `extract`;
- replace the input or the output the user named (`input`, `output`, `output-dir`);
- do all of it silently: nothing said which file had supplied defaults.

A deny-list fails open: every flag added later is accepted until somebody remembers to list it.
pkinative-cli reached the same conclusion in its 1.0.0 audit (its ADR 0007); this decision
aligns zipnative-cli with it.

## Decision Outcome

- **An allow-list, `CONFIG_KEYS`** (`src/utils/config.ts`): `json`, `pretty`, `quiet`,
  `no-color`, `progress`, `strict`, `long`, `summary`, `format`, `fields` — how a result is
  shown, plus `strict`, which only tightens a run.
  - Any other key, at the top level or in a command section, is `E_USAGE` (exit 2) naming the
    file, with a remedy (`pass --<key> on the command line, or run with --no-config`). This
    includes every flag added after this decision. The whole file is validated, whatever the
    command, so a file is either entirely valid or refused.
  - `__proto__`, `constructor` and `prototype` are refused; a value of the wrong type (a switch
    takes `true` / `false`, `format` / `fields` a string) is refused, never dropped.
- **Defaults apply only where they mean something.** A key is applied only when the invoked
  command declares the flag (`knownFlags()` from the `COMMANDS` table); elsewhere it is ignored.
- **Visibility.** When a file supplied a default, text mode prints `info: defaults from <path>:
  <keys>` on stderr (unless `--quiet`) and the `--json` envelopes — success and failure — carry
  `config: { path, applied }`.
- **Bounded read.** Only a regular file is read, through one descriptor whose size is checked
  against 1 MiB before the read.

### Consequences

- Good: no file in a working directory can change what a command reads, what it trusts, which
  bounds protect it, where it writes or which code it runs. New flags inherit the boundary.
- Neutral: a file may still choose how a result is shown, and `strict` / `progress` only add
  checks or stderr lines. The envelope names the file that did so.
- Bad: a 1.0 configuration that set operational defaults (`"create": { "deterministic": true,
  "level": 9 }`, `"extract": { "overwrite": true }`, a `--max-*` bound) is refused by 1.1.0. The
  migration is to move those flags to the script that invokes the CLI, where they are visible in
  review. This narrows the public surface in a minor release; it is recorded as a security fix
  in the CHANGELOG.
