# Ledger and verdict formats

Everything lives under `.audit/<version>/` (git-ignored). Plain Markdown, one table per file, so review and grep both work.

## Finding format (auditors)

One row per claim or surface, including the ones that hold:

| id | severity | claim / surface | evidence command | observed | expected | status |
|---|---|---|---|---|---|---|
| A-03 | major | "`--overwrite=flase` is `E_USAGE`, never ON" | `node dist/cli.cjs create samples/input/text -o x.zip --overwrite=flase --json` | exit 2, `E_USAGE`, the value not echoed | exit 2 before any write | holds |
| B-07 | blocker | `list --help` describes `--range` | `node dist/cli.cjs list --help` | absent | present | finding |

- `id` — `A-`, `B-`, `D-` (autonomy pass) or `V-` (raised by a verifier), zero-padded to two digits.
- `severity` — `blocker` (a shipped claim is false, a security default is loosened, a config key relaxes a check, a symlink is materialised, `--deterministic` bytes change, a socket opens, a public surface is wrong, a gate step or the publish job would fail), `major` (a user or an agent is misled, no test catches it), `minor` (wording, ordering, a stale example that still behaves), `note` (observation, no action).
- `evidence command` — the exact command; the verifier re-runs it verbatim. A row without one is `unverified`.
- `status` — `holds`, `finding`, `unverified`.

## Verifier format

The auditor table plus two columns:

| … | stamp | justification |
|---|---|---|
| … | CONFIRMED | re-ran the command; the flag is in `COMMANDS` at src/commands/completion.ts:212 and absent from `LIST_USAGE` |
| … | DOWNGRADED → minor | real, but `tests/docs/consistency.test.ts` fails on it — cannot ship silently |
| … | REJECTED | the flag is described under the shared read options; the help block lists it |
| … | DUPLICATE of B-02 | same missing sentence, different command |

## Ledger (`ledger.md`)

Only `CONFIRMED` and `DOWNGRADED` findings, sorted by severity then id, with two more columns:

| id | severity | claim / surface | evidence command | fix | waiver |
|---|---|---|---|---|---|

- `fix` — the commit hash that resolved it, or `open`.
- `waiver` — empty, or the maintainer's one-line reason for shipping with it (only `major` and below may be waived).

Above the table: the tally per severity and per stamp, the previous tag, the HEAD hash audited, the zipnative version the release is built on, and the date.

## Verdict (`verdict.md`)

```
Verdict: GO | NO-GO
Release: v<version>   HEAD: <hash>   Previous: <tag>   Engine: zipnative <version>   Date: <YYYY-MM-DD>
Blockers open: <n>   Majors open: <n>   Waived: <n>
Findings: <confirmed> confirmed, <downgraded> downgraded, <rejected> rejected, <duplicate> duplicate
Next: <the one command the maintainer runs next — the fix loop, or the gate>
```

Then the open blockers, one per line, each with its evidence command.
