---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# Release integrity: the bytes that passed the gate are the bytes published

## Context and Problem Statement

Up to 1.0.0, `publish.yml` was one job that held every permission at once — the OIDC
`id-token` that mints the npm token, `contents: write` and `attestations: write` — while it ran
`npm ci` without `--ignore-scripts`, the whole dev toolchain, the tests and an SBOM generator
fetched as a dev dependency. It restored the npm cache other workflows had written, set up "the
newest Node `>=22.14.0`" with its bundled npm, and could be dispatched from any branch with no
version check. Dev-dependency code therefore ran where a publishing token could be minted, and
nothing checked afterwards that what the registry served was what the gate had tested.
pkinative-cli and zipnative 1.1 had both split their release for exactly these reasons.

## Decision Outcome

- **Four jobs** — `guard` → `build` → `publish` → `attest` (`.github/workflows/publish.yml`):
  - `guard` reads `package.json` and refuses a non-tag ref, a tag that is not `v<version>` and a
    0.x version, before any approval is asked; it installs nothing.
  - `build` holds no `id-token`, restores no cache, builds on the `.nvmrc` line, runs
    `npm ci --ignore-scripts` and the whole publish gate (`node scripts/gate.mjs --publish
    --require-all`: build, reproducible build, bundle check, smoke, coverage, engine data, the
    pinned tarball list, the samples, the veraZIP corpus fail-closed, the install smoke test),
    packs **once** and hands the tarball on with its SHA-256 and SHA-512 as job outputs.
  - `publish` runs behind the `npm-publish` environment (a required reviewer), checks out
    `.nvmrc` only, re-verifies both digests and the version inside the tarball, fetches an npm
    client pinned **by content** (SHA-512) and publishes that file with provenance through
    Trusted Publishing — no `NPM_TOKEN`, no repository script.
  - `attest` fetches the published tarball back from the registry, checks it against the build
    digests and `dist.integrity`, writes the runtime SBOMs (CycloneDX and SPDX, `npm sbom`) and the
    toolchain SBOM from the lockfile, attests all of them with `actions/attest-build-provenance`
    (Sigstore) and attaches them, with the bundle, to the release. It runs no code fetched from
    the registry: every step of a job with `id-token: write` can mint the signing identity.
  - `consumer` (read-only permissions) installs the published version into an empty project,
    runs `npm audit signatures` and the installed bin once. The install resolves `zipnative`
    afresh from the registry, which is why it is a job of its own (found by the 1.1.0 security
    review).
- Every job starts with `step-security/harden-runner` (egress blocked to an allow-list where the
  endpoints are known); every action is pinned by SHA; `tests/tools/workflows.test.ts` holds the
  graph, the permissions, the digests and the absence of a cache.
- The `@cyclonedx/cyclonedx-npm` dev dependency is dropped: npm's own `sbom` command writes both
  formats from the lockfile without installing anything.

### Consequences

- Good: dev-dependency code never runs next to a publishing token; the published bytes are the
  gated bytes, verified twice; a consumer can check provenance (`npm audit signatures`) and the
  release attestation (`gh attestation verify zipnative-cli-<version>.tgz -R
  Nizoka/zipnative-cli`).
- Neutral: the maintainer must create the `npm-publish` environment and bind Trusted Publishing
  to it (CONTRIBUTING.md §Release) before the first 1.1 publish.
