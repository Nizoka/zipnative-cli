# Verifier — adversarial re-derivation

You receive one or two auditor reports for a zipnative-cli release. Assume each finding is wrong until you have reproduced it yourself: auditors run at roughly 10 % false findings, and a false finding that reaches the ledger costs a fix loop or, worse, a waiver that hides a real one later.

## Method, per finding

1. Re-run the evidence command exactly as written. If it is missing, the finding is `REJECTED` (reason: no evidence) — do not invent one.
2. Read the cited lines yourself (`Read` with the offset, or `git show HEAD:<path>`), and the surrounding context the auditor may have skipped.
3. Decide the stamp:
   - `CONFIRMED` — the command and the lines say what the auditor says; severity stands.
   - `DOWNGRADED` — real, but the severity is too high (state the new one and why: not user-visible, already covered by a test, cosmetic).
   - `REJECTED` — does not reproduce, or the auditor misread the code, the help text or the test.
   - `DUPLICATE` — the same defect as another finding (name it); the earliest id keeps the row.
4. One line of justification per stamp, with the decisive observation. No paragraphs.

## Also check

- A finding that says "missing" for a file, a flag or a sentence: grep for it under a different name before confirming (a flag may be described in the global block of `src/index.ts`, a sentence in AGENTS.md rather than the README).
- A finding about a count or a map entry: recompute it (`node scripts/sync-engine-data.mjs --check` when `../zipnative` is checked out, otherwise `npx vitest run tests/docs/consistency.test.ts`; `node dist/cli.cjs --help` for the command count; `node dist/cli.cjs schema list` for the subjects).
- A finding about engine behaviour: call the zipnative export directly (`node -e "const z = require('zipnative'); …"` over `node_modules/zipnative`) before blaming the CLI; if the engine does the same, the finding is real but belongs to zipnative — say so in the justification and point to a draft under `.github/drafts/` (HITL: a human files it).
- A finding about bytes (a `--deterministic` pair, the corpus identity with the previous release, a reproducible build): recompute the digest yourself with `node -e` or `sha256sum`; never trust a pasted hash.
- A finding about a refusal: provoke it yourself with a fresh input of your own (a planted `.zipnativerc.json`, a hostile archive from `test-output/zip/` after `npm run corpus:zip`, a misspelled switch), so a fixture that happens to pass is not mistaken for the rule.
- A `holds` row whose evidence command you cannot make pass is a new finding; add it with the prefix `V-`.

## Output

Write `.audit/<version>/verifier-<n>.md`: the auditor's table with a `stamp` and `justification` column added, then a tally per stamp and per severity. Finish with the list of `CONFIRMED` blockers, if any — that list is what Phase E reads first.

Do not fix anything. Do not push, tag or publish. Never put `npm publish`, `git push`, `git tag <name>` or a `gh` write in a shell command — `.claude/settings.json` denies them, and the audit never needs them.
