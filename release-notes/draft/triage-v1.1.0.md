# Triage of open pull requests and security alerts — zipnative-cli v1.1.0

_Draft written by an agent for the maintainer (HITL). Nothing below has been posted, closed or
dismissed: every action is a human step._

Data was read on 2026-10-18 with read-only `gh api` calls, then checked against the
`release/v1.1.0` branch (lockfile, workflows, `npm audit`). Commit references are to that branch.

## Summary

| Item | What it is | Legitimate? | Verdict | Action after merge |
|---|---|---|---|---|
| PR #1 | `ossf/scorecard-action` 2.4.3 → 2.4.4 | yes | integrated (`5c09933`, same SHA `2d11466…`) | close as superseded |
| PR #3 | `codeql-action/init` 4.36.0 → 4.37.9 | yes | integrated (`5c09933`) | close as superseded |
| PR #4 | `codeql-action/upload-sarif` 4.36.0 → 4.37.9 | yes | integrated (`5c09933`) | close as superseded |
| PR #5 | `codeql-action/analyze` 4.36.0 → 4.37.9 | yes | integrated (`5c09933`) | close as superseded |
| PR #7 | `codeql-action/autobuild` 4.36.0 → 4.37.9 | yes, but unmergeable alone | integrated (`5c09933`) | close as superseded |
| PR #10 | `@types/node` 22.20.1 → 26.5.1 | **no** | rejected; majors ignored in `dependabot.yml` | close |
| PR #11 | dev group: `zipnative` 1.0.0 → 1.1.0 + `typescript-eslint` 8.69.0 → 8.71.1 | half | redone by hand (`a01d7c4` + the release commit) | close |
| Dependabot #1 | `ip-address` ≤ 10.7.0 (GHSA-j6r3-76f7-8jcv, medium, dev) | yes, dev-only | fixed: package gone from the lockfile | auto-closes |
| Dependabot #3 | `http-cache-semantics` ≤ 4.2.0 (GHSA-ch52-4w7c-c8xp, high, dev, no patch) | yes, dev-only | fixed: package gone from the lockfile | auto-closes |
| Code scanning #1 | Scorecard Branch-Protection 0 | yes | fixed as code (`.github/rulesets/main.json`) | import the ruleset |
| Code scanning #2 | Scorecard Token-Permissions: `publish.yml` job-level `contents: write` | **no** (needed) | kept, scoped to the `attest` job | dismiss "won't fix" |
| Code scanning #3 | Scorecard Token-Permissions: `codeql.yml` top-level `security-events: write` | yes | fixed (top-level read-only, job-level write) | auto-closes |
| Code scanning #4 | Scorecard Code-Review 0/1 | partly | solo maintainer; PR-only flow enforced by the ruleset | dismiss "won't fix" or leave open |
| Code scanning #5 | Scorecard Maintained 0 (repository < 90 days) | time-bound | nothing to fix | resolves itself after 2026-12-01 |
| Code scanning #6 | Scorecard CII-Best-Practices 0 | yes | human registration needed | register at bestpractices.dev |
| Code scanning #7 | Scorecard Fuzzing 0 | partly | seeded fuzz suite added; Scorecard cannot see it | dismiss "won't fix" (or add `fast-check`, a decision) |
| Code scanning #8 | Scorecard Vulnerabilities 2 (8 OSV ids) | yes, dev-only | fixed: 0 vulnerabilities on the branch | auto-closes |

## Pull requests

### #1, #3, #4, #5, #7 — superseded by one commit

The four `github/codeql-action` steps (`init`, `autobuild` and `analyze` in `codeql.yml`, and
`upload-sarif` in `scorecard.yml`) must run the same release. CodeQL refuses a mixed-version
run, which is why #7's "Analyze (javascript-typescript)" check failed. Dependabot opened one PR
per step. Commit `5c09933` moves all four to `cdf488f595d80d6e07e03d4674febd5ab45fa938 # v4.37.9`
and `ossf/scorecard-action` to `2d1146689b8cda280b9bc96326124645441f03bc # v2.4.4` (both SHAs
verified against the peeled upstream tags). `dependabot.yml` now groups GitHub Actions, so the
steps move together in the future.

Ready-to-paste comment (each PR):

> Superseded by the `release/v1.1.0` branch (commit 5c09933), which moves all four
> `github/codeql-action` steps to v4.37.9 in one change — CodeQL refuses a mixed-version run —
> and `ossf/scorecard-action` to v2.4.4. Dependabot now groups GitHub Actions updates. Closing.

### #10 — `@types/node` 26: close

`engines.node` is `>=22`. Types for Node 26 would type-check calls to APIs that Node 22 does not
have, and the error would only show at runtime on the oldest supported line. `dependabot.yml`
on the branch ignores `@types/node` semver-major updates. Minors and patches of the 22 line still
arrive.

> Closing: the supported floor is Node 22 (`engines.node`), so `@types/node` stays on the 22.x
> line — 26.x would type APIs that Node 22 lacks. `dependabot.yml` now ignores its major
> versions.
> @dependabot ignore this major version

### #11 — dev group (zipnative + typescript-eslint): close, redone by hand

All five platform jobs fail. The group bumped **`zipnative`, the only runtime dependency**,
under a "dev-dependencies" label. 1.1.0 changes types (`nameEncoding: 'custom'`), `ZipLimits`
(`maxEntryCompressedSize`), the diagnostics set and the export count the docs tests pin.
Commit `a01d7c4` makes that bump by hand with every consequence absorbed. The
`typescript-eslint` half (8.69.0 → 8.71.1, past the seven-day cooldown) is in the release
commit. `dependabot.yml` excludes `zipnative` from the dev group, so the engine is always
bumped alone.

> Closing: `zipnative` is the runtime dependency, and 1.1.0 needs code and documentation
> changes (types, limits, the 12th diagnostic, the 106-export ledger). It is bumped by hand on
> `release/v1.1.0` (a01d7c4), together with typescript-eslint 8.71.1. Dependabot now bumps
> `zipnative` alone, outside the dev group.

## Dependabot alerts

Both are in **development** dependencies — nothing in the published package (`dist/cli.cjs`
requires only `zipnative`, which the bundle probe and the install smoke test both prove).

- **#1 `ip-address`** (GHSA-j6r3-76f7-8jcv, medium; also GHSA-h3mg-xc3c-68pw in Scorecard).
  It was a transitive dev dependency in the 1.0.0 lockfile. It is not in the branch's lockfile,
  so the alert closes when `main` receives it.
- **#3 `http-cache-semantics`** (GHSA-ch52-4w7c-c8xp, high, no patched version). Same: it is
  gone from the lockfile, so the alert closes after the merge. Since no patched version exists,
  removal was the only fix.

Verification on the branch: `npm audit` reports `found 0 vulnerabilities`. The weekly
`audit.yml` (`npm audit` + OSV-Scanner) and `dependency-review.yml` now watch for regressions.

## Code-scanning alerts (all OpenSSF Scorecard, on `main`)

- **#1 Branch-Protection.** `.github/rulesets/main.json` and `tags.json` hold the protection as
  code: PRs only, required checks, no force-push or deletion, immutable `v*` tags. Import them
  (Settings → Rules → Rulesets → Import), then the next Scorecard run re-scores.
- **#2 Token-Permissions (`publish.yml`, `contents: write`).** Needed: the `attest` job attaches
  the tarball, SBOMs and Sigstore bundle to the GitHub Release. The permission is granted
  only to that job, which runs only on a `v*` tag, after the tarball has been published and
  fetched back. The top-level permissions are read-only (ADR 0009). pkinative-cli holds the
  same grant.
  > Dismiss as "won't fix": `contents: write` is scoped to the `attest` job, which runs only
  > on a release tag, after publication, to attach the release assets; top-level permissions
  > are read-only (docs/adr/0009-release-integrity.md).
- **#3 Token-Permissions (`codeql.yml`, top-level `security-events: write`).** Fixed: the top
  level is `contents: read`, and `security-events: write` sits on the `analyze` job. Closes on
  the first scan after the merge.
- **#4 Code-Review.** Scorecard counts approved changesets; a single-maintainer project cannot
  approve its own PRs. The ruleset enforces the PR flow and the required checks. Either leave
  the alert open as an honest signal, or dismiss:
  > Dismiss as "won't fix": single-maintainer project; every change lands through a PR with the
  > required checks enforced by the main ruleset. Re-evaluate when a second maintainer joins.
- **#5 Maintained.** The repository was created on 2026-09-02; Scorecard scores 0 for the first
  90 days. Nothing to do — it re-scores after 2026-12-01 given continued activity.
- **#6 CII-Best-Practices.** Register the project at <https://www.bestpractices.dev> (a human
  account step), then replace the commented badge placeholder at the top of README.md.
- **#7 Fuzzing.** 1.1.0 adds seeded fuzzing of every CLI-owned parser (`tests/fuzz/`,
  ADR 0010), and the engine — which owns all ZIP parsing — has its own fuzzing. Scorecard
  recognises TypeScript fuzzing only through specific integrations (OSS-Fuzz,
  ClusterFuzzLite, or a property-based library such as `fast-check`), so the alert stays
  open until one of these exists. Adding `fast-check` as a **dev** dependency is allowed (the
  zero-dependency rule covers runtime only), but ADR 0010 chose the dependency-free PRNG. This
  is a decision for the maintainer:
  > Dismiss as "won't fix": the CLI owns no ZIP parsing; its argv, size, glob, projection,
  > manifest, configuration and escaper parsers are fuzzed by a seeded campaign in CI
  > (tests/fuzz/, docs/adr/0010), and the engine fuzzes the format.
- **#8 Vulnerabilities.** The eight OSV ids map to `brace-expansion` (GHSA-6j4f-fj2g-mc7p,
  GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7), `fast-uri` (GHSA-hrr3-gc8f-f4qj),
  `http-cache-semantics` (GHSA-ch52-4w7c-c8xp), `ip-address` (GHSA-h3mg-xc3c-68pw,
  GHSA-j6r3-76f7-8jcv) and `source-map-js` (GHSA-68fv-2mgg-jv7q). All are dev-only. On the
  branch, `brace-expansion` is 1.1.21 and 5.0.12 and `source-map-js` is 1.2.2 (each at or past
  its patched version), and `fast-uri`, `http-cache-semantics` and `ip-address` are absent. The
  alert closes on the first Scorecard run after the merge.

## Order of operations for the maintainer

1. Review and push `release/v1.1.0`; open the PR from `release-notes/draft/PR-v1.1.0.md`.
2. Import `.github/rulesets/main.json` and `tags.json`; create the `npm-publish` environment
   (required reviewer = you) and bind npm Trusted Publishing to `publish.yml` + `npm-publish`.
3. Merge; then close PRs #1, #3, #4, #5, #7, #10 and #11 with the comments above.
4. After the next Scorecard and Dependabot runs, confirm alerts #1, #3, #8 (Dependabot #1, #3)
   closed; dismiss #2 (and #4, #7 if you choose) with the texts above; register at
   bestpractices.dev for #6.
5. Tag `v1.1.0` on the merge commit; `publish.yml` does the rest.
