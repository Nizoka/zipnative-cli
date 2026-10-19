# Third-Party Notices

zipnative-cli is licensed under the [MIT License](LICENSE). The published package contains only
code written for this project: `dist/cli.cjs` bundles the CLI's own sources and keeps its one
runtime dependency external (`scripts/lib/bundle-probe.mjs` fails the build if any engine code is
inlined).

## Runtime dependency (installed by npm, not bundled)

| Package | Version range | Source | Licence |
|---|---|---|---|
| zipnative | `^1.1.0` | https://github.com/Nizoka/zipnative | MIT |

zipnative itself has no runtime dependency; `npm ls --omit=dev --all` lists it alone
(`scripts/smoke-install.mjs` checks exactly that on the packed tarball).

## Development tools (never in the package)

The build, type-check, lint and test toolchain (TypeScript, tsup and esbuild, ESLint and
typescript-eslint, Vitest and its V8 coverage provider, `@types/node`) is declared in
`package.json` `devDependencies`, pinned by `package-lock.json`, and is not part of what a user
installs. The tree is under permissive licences (MIT, ISC, BSD-2/3-Clause, Apache-2.0,
BlueOak-1.0.0, Python-2.0), except `lightningcss` and its platform binaries, which Vitest's
bundler pulls in under MPL-2.0 and which are used unmodified at test time only.
`dependency-review.yml` holds every new dependency to that allow-list and names the
`lightningcss` exception package by package.

## Code ported from the ecosystem (in the repository, never in the package)

- `scripts/validate-zip.mjs` — the veraZIP ISO/IEC 21320-1:2015 validator, ported from zipnative
  (`scripts/validate-zip.ts`, MIT, same author); its source commit and blob are recorded in the
  file header and checked by `tests/scripts/verazip-vendor.test.ts`.
- `tests/helpers/raw-zip-builder.ts` — the engine-independent raw ZIP builder, ported from
  zipnative's test helpers (MIT, same author).
- `scripts/lib/bundle-probe.mjs`, `scripts/lib/package-files.mjs`, `scripts/gate.mjs` and
  `src/utils/engines.ts` — adapted from pkinative-cli (MIT, same author).

## Test material (in the repository, never in the package)

`tests/fixtures/interop/` holds two archives written by foreign tools (bsdtar, PowerShell
`Compress-Archive`) over files of this repository — their provenance is in
[tests/fixtures/README.md](tests/fixtures/README.md). Every other test archive is generated at
test time and never committed.
