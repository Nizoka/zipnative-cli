## Description

<!-- What does this PR change and why? -->

## Related Issues

<!-- Link related issues: Fixes #123, Relates to #456 -->

## Checklist

- [ ] Tests pass (`npm run test`)
- [ ] Type check passes (`npm run typecheck:all`)
- [ ] Lint passes (`npm run lint`)
- [ ] New code has tests (coverage thresholds must not regress)
- [ ] CHANGELOG.md updated (if user-facing change)
- [ ] No breaking changes (or documented in description)
- [ ] Binary smoke test passes (`node dist/cli.cjs --help` outputs all 15 commands)
- [ ] veraZIP gate passes (`npm run validate:zip` locally; CI on Linux + Windows)
- [ ] No ZIP parsing logic in the CLI (every byte-level operation is a core call; raw bytes only in `scripts/` and `tests/helpers/`)
- [ ] No security default loosened silently (opt-outs are named `--skip-*` / `--allow-*` and documented in SECURITY.md)
- [ ] Docs counts updated (`tests/docs/consistency.test.ts` green)

## AI assistance

<!-- If AI tooling drafted part of this PR, say so — see .github/AGENT_RULES.md.
     Include the compliance report: what was drafted by AI, which instructions
     files were followed, the quality-gate results, and any rule this draft
     bends (with justification) for the human reviewer to weigh. -->
