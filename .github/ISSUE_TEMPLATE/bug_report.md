---
name: Bug Report
about: Report a bug in zipnative-cli
title: ''
labels: bug
assignees: ''
---

## Description

<!-- A clear description of the bug. -->

## CLI Command & Flags

```
zipnative <command> [...flags]
```

<!-- Paste the exact command you ran. -->

## Steps to Reproduce

1.
2.
3.

## Expected Behavior

<!-- What should happen? -->

## Actual Behavior

<!-- What happens instead? Include the full error output. Re-run with
     `--json` and paste the whole envelope from stderr — the `error.code`
     (E_*) and `error.zipCode` (ZIP_*) are what we branch on:

     zipnative <command> [...flags] --json 2>&1 1>/dev/null
-->

```json
{ "ok": false, "command": "...", "error": { "code": "E_...", "zipCode": "ZIP_...", "message": "..." } }
```

## Environment

- **zipnative-cli version:** <!-- zipnative --version -->
- **zipnative version:** <!-- zipnative doctor --format json  (reports both, plus the active deflate tier) -->
- **Runtime:** <!-- Node.js 22 / 24 (node --version) -->
- **OS:** <!-- incl. filesystem when relevant: NTFS / APFS (case-insensitive) / ext4 -->

## Minimal Reproduction

```bash
# Smallest shell command / manifest that demonstrates the issue
```

<!-- For an archive the CLI mishandles: attach the archive (as a .zip inside
     a .zip so GitHub keeps the bytes intact), or a generator script that
     crafts it, or at least the output of:

     zipnative inspect --input <a.zip> --format json --entries
-->

```json
// If using a JSON manifest (--from-manifest / --manifest), paste the minimal content here
```

## Additional Context

<!-- Diagnostics (`warning: [ZIP_*]` lines on stderr), `zipnative verify --format json`
     output, what another tool (unzip, 7z, Explorer) says about the same archive -->
