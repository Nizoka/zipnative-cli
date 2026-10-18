---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# Copies without recompression are verified first; canonicalisation decodes nothing

## Context and Problem Statement

zipnative 1.1 can write compressed bytes it did not produce:

- `addFromReader()` transplants an entry from an open archive (merge, split, repack).
- `addRaw()` adds a pre-compressed payload whose metadata the caller vouches for.
- `canonicalizeZip()` rewrites an archive from any producer into the canonical deterministic
  form.

None of them recompresses. Each could therefore re-emit a lying entry — a CRC or size that does
not match the payload — as the CLI's own output. `modify` already settled this rule for
re-emitted entries: verify every one, with no opt-out.

## Decision Outcome

- **`merge`** opens every source eagerly (structure first) and copies each entry with
  `addFromReader(…, { verify: true })`: one decompress pass checks CRC-32 and size before the
  copy. A lie is `E_DATA` with `entryName`, and nothing is written. The engine would copy two
  kinds of entry unverified, so the CLI refuses them (`E_UNSUPPORTED`), or leaves them out with
  `--skip-unsupported`:
  - an encrypted entry;
  - an entry whose method no registered codec decodes.

  A duplicate name is refused unless `--on-duplicate first|last` picks one; the same directory
  met twice is one directory.
- **Manifest `raw` entries** (`create --from-manifest`, `addRaw`) are not vouched for by the
  manifest. A manifest is data. The CLI decodes the payload once through the registered codec,
  bounded by the declared size and `--max-entry-size`, and requires the declared size and CRC-32
  (`ZIP_SIZE_MISMATCH` / `ZIP_CRC_MISMATCH` otherwise). Nothing may ride behind the payload: a
  DEFLATE stream is decoded by the resumable inflater, which reports what follows it, and any
  trailing byte is refused (a stored payload must be exactly the declared size). The counter-
  verification of the second review found that gap. A registered third-party codec exposes no
  leftover, so its trailing bytes cannot be detected. A method without a synchronous decoder is
  `ZIP_UNSUPPORTED_METHOD`. `raw` saves the recompression, never the verification.
- **`canonicalize`** (and `modify --compact --canonical`) decodes nothing: it rewrites the
  metadata around unchanged payloads, so a corrupt entry travels unchanged. Names keep their
  meaning: a traversal or device name is carried into the output, counted in the envelope
  (`unsafeNames`) and announced with a `warning:` line — reproducible is not safe to extract. That
  is stated in its help, the README and AGENTS.md (run `verify` first; gate with
  `inspect --check safe-names`). The output's determinism is measured, not
  assumed: the envelope carries `analyzeDeterminism()` on the bytes written.

### Consequences

- Good: no command turns an archive's lie into the CLI's own output; the merge and raw paths
  cost one decode pass, never a recompression.
- Neutral: `canonicalize` is a metadata rewrite. Its integrity guarantee is the source's, which
  `verify` checks.
