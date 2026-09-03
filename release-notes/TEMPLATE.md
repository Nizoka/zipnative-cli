# Release Notes Template

This directory contains release notes for each published version of `zipnative-cli`.

## File naming

- One file per version: `release-notes/vMAJOR.MINOR.PATCH.md`
- Examples: `v1.0.0.md`, `v1.1.0.md`, `v2.0.0.md`
- Release PR drafts live in `release-notes/draft/PR-vX.Y.Z.md` (written by an agent, submitted by a human).

## Template

Copy the content below into a new `release-notes/vX.Y.Z.md` file and fill in the sections. Omit any section that has no entries for the release (do not leave empty sections). Every release states the `zipnative` version it is built on, and the Verification section always carries the veraZIP evidence line.

```markdown
# zipnative-cli vX.Y.Z

<!-- GitHub Release title: vX.Y.Z — short description -->

_Released YYYY-MM-DD_

<!-- One-paragraph summary: what is this release about (feature / refactor / polish / security), the zipnative version it is built on, and the compatibility statement (e.g. "100% backward-compatible with vX.Y.Z-1"). -->

## Highlights

<!-- 2–5 bullets calling out the most user-visible changes. Link to detailed sections below where useful. -->

- ...

## Security

<!-- CVE-style entries: CWE reference, affected versions, mitigation. Keep this section first when present. State explicitly when no parser / writer / sink behaviour changed. -->

- **fix(security):** ...

## Breaking Changes

<!-- Only for MAJOR bumps. Each entry must include: what changed, why, migration path. A change to the --json envelope, an E_* code, an exit code, or the ZIP_* mapping is breaking. -->

- **BREAKING:** ...

## Added

<!-- New commands, new flags, new schema subjects, new samples. Use conventional commit scopes: feat(create), feat(extract), feat(agent), feat(samples), etc. -->

- **feat(scope):** ...

## Changed

<!-- Non-breaking behavior changes, sample updates, dependency updates (always name the zipnative bump: ^a.b.c → ^x.y.z and the inherited engine changes). -->

- **chore(meta):** ...
- **docs(samples):** ...

## Fixed

<!-- Bug fixes. Reference GitHub issues (#NN) where applicable. -->

- **fix(scope):** ... ([#NN]).

## Deprecated

<!-- CLI flags/commands kept working but scheduled for removal in a future MAJOR. Include the target version. -->

- **deprecate(scope):** `--old-flag` — use `--new-flag` instead. Will be removed in vX+1.0.0.

## Removed

<!-- Only for MAJOR bumps. Cross-reference the deprecation notice from a prior release. -->

- **remove(scope):** ... (deprecated in vX.Y.Z).

## Performance

<!-- Benchmark deltas or observed improvements. -->

- **perf(scope):** improved X by N% (measured on Node 22.x, median of 5 runs).

## Documentation

<!-- README / KNOWLEDGE_BASE / AGENTS / llms.txt / sample reference updates. -->

- **docs(scope):** ...

## Install

\`\`\`bash
npm install --global zipnative-cli@X.Y.Z
\`\`\`

## Upgrade

<!-- Step-by-step migration if non-trivial. For PATCH releases with no breaking changes, one sentence suffices. -->

No breaking changes. Drop-in replacement for vX.Y.Z-1.

## Verification

All checks passed:
- `npm run typecheck:all` — clean
- `npm run lint` — 0 errors
- `npm run test` — all passing (N tests, F files); coverage above the enforced thresholds
- `npm run build` — dist output verified; built-binary smoke test (`node dist/cli.cjs …`) for every command
- `npm run validate:zip` — veraZIP: <conformant> PASS + <canaries> XFAIL, exit 0 (blocking in CI on Linux and Windows, and pre-publish)

## Contributors

<!-- Optional: acknowledge external contributors for this release. -->

Thanks to contributors and community feedback.
```
