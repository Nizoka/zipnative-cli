# Architecture decision records

One file per decision, numbered without gaps, each opening with a `status` (`proposed`,
`accepted`, `superseded`, `deprecated`), the date and the version it applies from
(`tests/docs/consistency.test.ts` checks the front matter and this index). A decision is amended
by a new ADR that supersedes it, never by rewriting history. The engine's own decisions live in
[zipnative's docs](https://github.com/Nizoka/zipnative/tree/main/docs); where a CLI decision rests
on one, it says so. Decisions taken before 1.1.0 are recorded in the knowledge base and
SECURITY.md; the ADR series starts with 1.1.0.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-configuration-is-presentation-only.md) | The configuration file is presentation only | accepted |
| [0002](0002-every-bound-is-finite.md) | Every bound is finite | accepted |
| [0003](0003-strict-invocation.md) | Strict invocation: undeclared, repeated or surplus input is a usage error | accepted |
| [0004](0004-terminal-safe-text.md) | Text output is terminal-safe; JSON is exact | accepted |
| [0005](0005-one-descriptor-reads-and-rename-overwrites.md) | Bounded reads through one descriptor; overwrites by temp file and rename | accepted |
| [0006](0006-timeout-is-a-limit.md) | `--timeout` is a bound (`E_LIMIT`); `--progress` is stderr data | accepted |
| [0007](0007-no-flag-without-an-effect.md) | No flag without an effect: `maxEntryCompressedSize` is reported, not flagged | accepted |
| [0008](0008-dos-dates-per-entry-convention.md) | DOS dates: a per-entry convention, so the engine's `dosTimeMode` is not adopted | accepted |
| [0009](0009-release-integrity.md) | Release integrity: the bytes that passed the gate are the bytes published | accepted |
| [0010](0010-seeded-fuzzing-of-cli-parsers.md) | Seeded fuzzing of the CLI-owned parsers; coverage-guided fuzzing stays in the engine | accepted |
