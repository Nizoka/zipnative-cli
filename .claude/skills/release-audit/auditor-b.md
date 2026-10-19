# Auditor B — help text, the surface tables and the release surfaces

You audit one release of zipnative-cli. Your angle: **does everything a reader, an agent or the release pipeline consumes describe the behaviour that actually shipped?** Another auditor checks the claims against the code; you check the surfaces against the claims and against the code where the two disagree. The brief (`.audit/<version>/brief.md`) lists the decisions already recorded; a settled item is not a finding unless you show it unsafe.

## Surfaces to cover

| Surface | Where | What to check |
|---|---|---|
| Help text | `src/index.ts` (`<NAME>_USAGE`, `GLOBAL_USAGE`), `node dist/cli.cjs <command> --help` | Every command of `COMMANDS` (`src/commands/completion.ts`) has a help block; every flag in `COMMANDS` and `GLOBAL_FLAGS` is described, with its real default; no flag is described that `assertInvocation` refuses; every flag the release adds says what the code does |
| Completion and schema | `src/commands/completion.ts`, `src/commands/schema.ts`, `node dist/cli.cjs schema manifest --no-config`, `schema list` | The same commands and flags as `COMMANDS`; arity, repeatable flags, path flags and operands published; the schema `$id` embeds the package version; the subject count matches the docs |
| Errors and remedies | `node dist/cli.cjs schema errors --json`, `docs/data/errors.json` | Every `ZIP_*` code and diagnostic the CLI can print is listed with its `E_*` class; every `cli.remedy` says what the thrown message implies; `raisedBy` names real commands |
| Export map | `docs/data/core-exports.json`, `docs/KNOWLEDGE_BASE.md` §8 | Regenerated (`node scripts/sync-engine-data.mjs --check` when `../zipnative` is checked out, else cite `npx vitest run tests/docs/consistency.test.ts`); the row count matches the engine's export count; nothing graded `bridged` that a command could reach; each `via` names a command that really calls the export |
| Samples | `samples/`, `node samples/run-all.js --clean` | Every job passes; every command has a `.sh` and a `.ps1` pair that say the same thing; every sample the release note names exists |
| veraZIP | `npm run validate:zip`, `scripts/generate-zip-corpus.mjs` | PASS and XFAIL counts match the docs; the corpus exercises every writer the release adds; a changed corpus is declared in the CHANGELOG |
| README, AGENTS.md, llms.txt | grep `^## ` first, read by section | Every example runs as written against `dist/cli.cjs`; the command list matches `COMMANDS`; the one-dependency, offline and "no ZIP parsing" statements are true; every file llms.txt links ships in the tarball (`node scripts/package-files.mjs`) |
| Publish workflow | `.github/workflows/publish.yml` | Triggered on `release: published` (and `workflow_dispatch`) only; guard → build → publish → attest → consumer; the `npm-publish` environment on `publish` only; `id-token: write` on `publish` and `attest` only; actions pinned by SHA; the publish gate runs in `build`; SBOMs by `npm sbom` in `attest`; `npm audit signatures` in `consumer` |
| CHANGELOG and release note | `CHANGELOG.md`, `release-notes/v<version>.md` | Same version, same date, same claims; every user-visible change in `git diff <previous-tag>..HEAD` is named; Keep a Changelog types only; every narrowed input sits under `### Security` with its migration; the zipnative version the release is built on is stated |
| Governance | `SECURITY.md`, `docs/.well-known/security.txt`, `.github/SECURITY-INSIGHTS.yml`, `.github/ai-governance.json`, `.github/AGENT_RULES.md` | The same reporting channel everywhere; `Expires` in the future; no statement the workflows do not back; `node dist/cli.cjs govern policy --json` equals the JSON (`tests/utils/governance-sync.test.ts`) |

## Method

1. Start from the release note's claims (number them `B-01`, …) and map each to the surfaces above. A claim with no surface is a finding (`major` when the feature is public).
2. For each surface, run the regenerator where one exists and diff; where none exists, read the surface and the code side by side. Quote the line numbers.
3. Reproduce at least one assertion per surface with a command (`node samples/run-all.js --clean`, `node scripts/sync-engine-data.mjs --check`, `npx vitest run tests/docs`, `node dist/cli.cjs <command> --help`, a `node -e` over a JSON surface).

## Autonomy pass (Phase D)

When invoked for Phase D, ignore the table above and answer one question: **can an agent that has only the published surfaces use every feature without reading `src/`?** For every feature in the release note, write the command you would run from `zipnative --help`, `zipnative <command> --help`, `zipnative schema manifest | errors | <subject>`, `zipnative doctor`, the README, AGENTS.md, llms.txt and `samples/` alone, then run it against `dist/cli.cjs` with the inputs of `tests/fixtures/interop/`, `samples/input/` and `test-output/zip/` (after `npm run corpus:zip`; read those archives only through the binary). A command that needs `src/` to get right is a finding; name the sentence that was missing. Then provoke one failure per command and check that `error.remedy` in the envelope, and the `cli.remedy` of that `zipCode` in `schema errors`, tell the agent what to do next. Measure the token cost of the loop in bytes (`--summary`, `--fields`, compact `--json` against text) on the tasks the previous review measured, so the "token gain" claim is a number, not a feeling.

## Output

Write `.audit/<version>/auditor-b.md` (or `auditor-d.md` for the autonomy pass) in the finding format of `ledger.md`, every row with its evidence command. Finish with the three-line summary: surfaces checked, findings by severity, anything left unverified and why.

Do not fix anything. Do not push, tag or publish. Never put `npm publish`, `git push`, `git tag <name>` or a `gh` write in a shell command — `.claude/settings.json` denies them, and the audit never needs them.
