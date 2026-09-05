---
description: "Use when writing tests, adding test coverage, or debugging test failures in zipnative-cli. Covers vitest patterns, CLI testing conventions, hostile-archive fixtures, Windows cases, and coverage targets."
applyTo: "tests/**"
---
# Testing

## Framework

- **vitest** (native ESM). Run: `npm test`, `npm run test:watch`, `npm run test:coverage`.
  `npm run lint` covers `tests/**` too (a relaxed override in `eslint.config.js`); keep it at
  0 errors.
- Tests mirror `src/`: `tests/commands/*.test.ts`, `tests/utils/*.test.ts`,
  `tests/integration/*.test.ts`, plus `tests/docs/*.test.ts` (documentation counts,
  fixture policy), `tests/scripts/*.test.ts` (vendored validator pins) and `tests/helpers/`.
  `tests/utils/governance-sync.test.ts` pins `govern policy` / `govern rules` to
  `.github/ai-governance.json` / `.github/AGENT_RULES.md`; `tests/utils/sink.test.ts` covers
  the extraction sink (realpath containment, exclusive open).

## Command test pattern

1. Run commands **in-process**: drive them through `parseArgs([...])`, e.g.
   `await create(parseArgs(['src', '--output', tmpOut]))`. Do not spawn the binary.
2. Capture stdout/stderr with the shared spy in `tests/helpers/capture.ts`
   (`vi.spyOn(process.stdout, 'write')` under the hood; it honours the write callback that
   `writeOutput` awaits). Restore in `afterEach`.
3. Use `os.tmpdir()` temp directories; clean up in `afterEach`.
4. Test error paths with `await expect(fn(...)).rejects.toBeInstanceOf(CliError)` and assert
   `.exitCode`, `.code` (`E_*`) and `.zipCode` (`ZIP_*`) — the envelope contract is the test.
5. Build well-formed test archives through `core-bridge` (`createZip` → `toBytes()`), never by
   hand — and never by calling the `create` command from another command's test (a bug in
   `create` must not hide a bug in `extract`).
6. Build **hostile** archives (zip-slip names, overlapping entries, CRC lies, symlink modes,
   reserved device names, zip64 contradictions) with `tests/helpers/raw-zip-builder.ts` —
   raw bytes from node:zlib, engine-independent by construction. Never craft them with
   `create`: the writer refuses to produce them, and a writer-produced fixture would attest
   the engine with the engine.
7. Assert archive output starts with `PK\x03\x04` (or `PK\x05\x06` for an empty archive) and
   round-trips through `openZip`; assert deterministic outputs by SHA-256, not by length.

## Fixtures and binaries

- **Never commit CLI-produced binaries.** Archives are generated in tests (temp dir) or by
  `scripts/generate-zip-corpus.mjs` into the git-ignored `test-output/`. Committed
  fixtures under `tests/fixtures/` are foreign-provenance only (see its README) and are
  marked `binary` in `.gitattributes` — a CRLF rewrite silently breaks offsets and CRCs.
- `tests/docs/fixture-policy.test.ts` enforces this; extend it rather than bypass it.

## Windows

- Windows CI is blocking. Cases about path separators, reserved device names
  (`CON`, `NUL`, `COM1`), case-folded collisions and drive/UNC prefixes run on BOTH
  platforms: build the expectation from `path.sep` / `process.platform` inside the test, do
  not `it.skip` on `win32` without a linked issue.
- Compare paths after `path.resolve`; never assert on a hard-coded `/` in a filesystem path
  (entry names inside archives are always `/`).

## Conventions

- `describe('functionName')` → `it('should ...')`; one concept per assertion; `it.each` for
  parameterized flag forms (`--flag v`, `--flag=v`, `-f v`).
- Append new cases before the final `});` of the relevant `describe`.
- A test that touches `--json` asserts the parsed envelope, not a substring.
- Exactly **one** spawn test exists: `tests/integration/built-binary-smoke.test.ts` runs the
  built `dist/cli.cjs` (real argv, pipes, exit codes, EPIPE, SIGINT cleanup) and self-skips
  when `dist/` is absent; CI runs it post-build. Every other test is in-process.
- A test that needs a TTY or a signal stubs `process.stdin.isTTY` / sends the signal to the
  spawned binary; a case that a platform cannot express (signals on win32, symlink creation
  without privilege) uses `skipIf` with the reason in the name.

## Coverage targets

- Enforced thresholds live in `vitest.config.ts` (single source of truth):
  Statements ≥ 93% · Branches ≥ 88% · Functions ≥ 94% · Lines ≥ 93% (ratcheted after the
  1.0.0 audit pass, three points below the measured actuals).
- `src/index.ts` (dispatcher + USAGE strings, exercised by the spawn test) and
  `src/core-bridge/index.ts` (pure re-export barrel) are excluded.
- Never lower a threshold to make a change pass — add tests.
