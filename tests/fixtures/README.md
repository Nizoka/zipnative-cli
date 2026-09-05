# Fixture provenance rules

**Committed binaries are allowed ONLY when their provenance is foreign** —
produced by a tool that is not zipnative and not this CLI. The point of the
interop corpus is that the reader behind every command is exercised against
bytes we did not shape. A CLI-produced archive is never committed: our own
code can rebuild it in-test, and committing it would make the determinism
proofs circular.

Rules (enforced by review + `tests/docs/fixture-policy.test.ts`):

- `interop/` — tiny archives (< 20 KB each, ≤ 20 KB in total) produced by
  named foreign tools. Naming: `<tool>-<trait>.zip`. Record the exact
  producer and command in the ledger below when adding one.
- Adversarial archives (overlap, zip-slip, CRC/size lies, descriptor
  tricks, prepended stubs…) are NEVER committed: they are generated in-test
  by `tests/helpers/raw-zip-builder.ts` (engine-independent — headers by
  hand, deflate/CRC from `node:zlib`), so no committed byte can drift from
  the attack it is meant to model.
- `.gitattributes` marks everything under `tests/fixtures/` (and `*.zip`)
  as `binary`. Never remove that protection — CRLF conversion silently
  corrupts archives.
- Every `*.zip` under this directory must appear in the ledger; the policy
  test fails otherwise.

## Provenance ledger

The two interop archives are copied verbatim from zipnative's own corpus
(`zipnative/tests/fixtures/interop/`, credit: the zipnative project) so the
CLI and the engine are validated against the same foreign bytes.

| File | Producer (exact version) | Command | Added |
|---|---|---|---|
| interop/powershell-compress-archive-basic.zip | PowerShell 7 Compress-Archive (System.IO.Compression), Windows 11 — via zipnative's corpus | `Compress-Archive -Path <src>/* -DestinationPath out.zip` (zipnative scripts/generate-fixtures.ts) | 2026-09-03 |
| interop/bsdtar-basic.zip | bsdtar 3.8.8 (libarchive 3.8.8, zlib 1.2.13.1-motley), Windows 11 tar.exe — via zipnative's corpus | `tar -a -cf out.zip -C <src> .` (zipnative scripts/generate-fixtures.ts) | 2026-09-03 |
