---
name: release-audit
description: Pre-release audit of zipnative-cli — two parallel auditors (claims vs code and the non-negotiables; help text, the surface tables, the engine-export map, samples, veraZIP and the release surfaces), an adversarial verifier, an agent-autonomy pass and a GO/NO-GO ledger under .audit/<version>/. Run by the maintainer before every release; never invoked by the model on its own.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(npm run *), Bash(npm ls *), Bash(npx vitest *), Bash(node scripts/*), Bash(node samples/run-all.js *), Bash(node dist/cli.cjs *), Bash(node -e *), Bash(git diff*), Bash(git log*), Bash(git show*), Bash(git describe*), Bash(git grep *), Bash(git check-ignore *), Agent
argument-hint: [release-notes/vX.Y.Z.md] [previous-tag]
---

# Release audit

Audit the release described by `$0` (default: the newest `release-notes/v*.md`) against everything that changed since `$1` (default: the previous `v*` tag from `git describe --tags --abbrev=0`, or the root commit for the first release). The audit produces findings, never fixes: every fix goes through the normal edit → gate loop afterwards, and the ledger records what was fixed.

Read `ledger.md` first for the ledger and verdict formats. Each phase below hands a template to the agents it spawns; the agents return findings, you file them.

## Ledger location

`.audit/<version>/` — git-ignored (check `git check-ignore -v .audit/<version>/x.md` prints the rule before writing; it is NOT under `test-output/`, which Claude Code is denied to Read), so nothing here is ever committed. One Markdown file per report: brief, auditor-a, auditor-b, verifier-1, auditor-d, verifier-2, then the ledger and the verdict (formats in `ledger.md`).

## Brief

Before Phase A, write `.audit/<version>/brief.md`: the criteria the release is judged on, the decisions already recorded (every ADR under `docs/adr/`, the deferred items in `ROADMAP.md`, the engine-side drafts under `.github/drafts/`) and the items a previous round settled. Every agent below receives the brief with its template, so a settled item is not re-filed — a finding that shows one of those decisions is *unsafe* stays admissible, and names the decision.

## Phase A and B — two auditors, in parallel

Spawn both with the Agent tool in the same message (distinct angles; neither sees the other's report):

- **Auditor A — claims vs code.** Template: `auditor-a.md`. Every claim in the release note and the top CHANGELOG entry is checked against `src/commands/`, `src/utils/`, `src/core-bridge/` and `tests/`; at least one assertion per claim is *reproduced with a command* (a test, a script, the BUILT binary `node dist/cli.cjs …`), not inferred from reading. Its brief includes the refusal posture and the non-negotiables of CLAUDE.md §Project philosophy (one runtime dependency, no ZIP parsing in `src/`, every engine import through the bridge, offline, no security default loosened, a symlink never materialised, `--deterministic` bytes never post-processed).
- **Auditor B — help text, the surface tables and the release surfaces.** Template: `auditor-b.md`. Every command's `--help` against `COMMANDS` in `src/commands/completion.ts` and the flag tables of `src/utils/flags.ts`, `schema manifest`, the engine-export map `docs/data/core-exports.json` and KB §8, `docs/data/errors.json`, the samples (`samples/run-all.js`) and the veraZIP corpus, the README, AGENTS.md and llms.txt, the publish workflow, the CHANGELOG, the release note and the governance files — every surface a human, an agent or the release pipeline reads — compared with the behaviour that actually shipped.

Both write their report in the finding format of `ledger.md` (id, severity, claim, evidence command, observed, expected).

## Phase C — adversarial verifier

Spawn one verifier (template: `verifier.md`) with both reports. It re-derives every finding from scratch — re-runs the evidence command, reads the cited lines — and stamps each one `CONFIRMED | DOWNGRADED | REJECTED | DUPLICATE` with a one-line justification. Auditors have about 10 % false findings; the verifier exists to keep them out of the ledger. A finding the verifier cannot reproduce is `REJECTED`, not "probably fine".

## Phase D — agent-autonomy pass, then verify

**The mechanical half is `npm run gate`; do not re-derive it.** That every command of `COMMANDS` has a USAGE block naming every flag it declares, that the README and the knowledge base list the same commands and flags, that every runtime export of zipnative is mapped in `docs/data/core-exports.json` and KB §8 and re-exported by the bridge (`tests/docs/consistency.test.ts`), that `schema manifest` publishes what `--help` declares (the gate's `smoke` step), that every sample still runs (`samples`, 96 jobs) and that every archive the CLI writes is conformant (`verazip`, `verazip-validate`) is decided on every run. Cite the test or the gate step instead of re-deriving it.

Spawn Auditor D (template: `auditor-b.md`, section "Autonomy pass") for what no test can decide: *can an agent that has only the published surfaces (`zipnative --help`, `zipnative <command> --help`, `zipnative schema manifest | errors | <subject>`, `zipnative doctor`, the README, AGENTS.md, llms.txt and `samples/`) drive every feature the release note names without reading `src/`?* Is each sentence of the help text true, is the advice still the best advice, and after a provoked failure do `error.remedy` in the envelope and the `cli.remedy` of that code in `schema errors` tell the agent what to do next? Then a second verifier pass (template: `verifier.md`) over its findings.

## Phase E — GO / NO-GO

Merge the confirmed findings into the ledger, then write the verdict file (both formats are in `ledger.md`):

- **GO** — no CONFIRMED finding of severity `blocker`; every `major` has a fix commit or an explicit maintainer waiver in the ledger.
- **NO-GO** — otherwise. List the blockers first, each with its evidence command, so the fix loop starts from the ledger, not from memory.

Report the verdict, the counts per severity and per stamp, and the ledger path. Do not push, tag, open a PR or publish: the maintainer takes over from `GO` — squash-merges the `release/vX.Y.Z` pull request, publishes the GitHub Release (which creates the tag), and `.github/workflows/publish.yml` publishes to npm.

## Known blind spots

Add a check for each of these to the auditor briefs; they are where an audit of a CLI over an engine misses something.

- Help text drifts from the tables: a flag added to `COMMANDS` (`src/commands/completion.ts`) or to `COMMAND_BOOLEAN_FLAGS` (`src/utils/flags.ts`) but described with a stale default or a false sentence in `src/index.ts` passes `tests/docs/consistency.test.ts`, which proves presence, not truth.
- The export map is generated (`npm run sync:engine`; `--check` runs in the gate only when an engine checkout is present): a map regenerated after the code but never reviewed proves consistency, not correctness. Read the `via` of each export the release adds against the command that claims it.
- `samples/run-all.js` asserts byte identity only for the deterministic and stream-parity jobs; a behaviour change on a flag no sample exercises is invisible to it. The veraZIP corpus carries no committed digest list of the previous release: byte identity with it is a comparison the maintainer prepares (`.audit/<version>/corpus-<previous>.sha256`, auditor-a.md §4).
- The non-negotiables are negative properties: no test looks everywhere for a second dependency, a `PK` signature parsed in `src/`, a socket, a symlink written to disk or a post-processed `--deterministic` byte unless one looks for it. Each needs its command (auditor-a.md §4).
- Refusal posture: a config file must not relax a check (`CONFIG_KEYS` in `src/utils/config.ts` is presentation-only), a switch value must be strict (`--flag=flase` and `ZIPNATIVE_*=flase` are usage errors), `--codec` is argv-only and a manifest needs `--allow-codec-load`. Try each from a planted `.zipnativerc.json`, the command line, the environment and a manifest task, not only from the tests.
- CI assumptions live outside the repo: Trusted Publishing needs the `npm-publish` environment, the `release: published` trigger and the npm client `publish.yml` pins by SHA-512; `tests/tools/workflows.test.ts` pins the file's shape, not the GitHub or npmjs settings. A green local gate proves nothing about the publish job.
- Auditors have ~10 % false findings — never file an unverified finding, and never let a `REJECTED` one reach the verdict.
- `.claude/settings.json` denies the shell tools `npm publish`, `git push`, `git tag` and the `gh` writes (`pr`, `issue`, `release`, `api --method POST`). An auditor never needs them: a finding is a row in a file under `.audit/`, written with Write or Edit — never a GitHub write (`.github/AGENT_RULES.md`).
