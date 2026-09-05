---
name: Interop report
about: An archive zipnative-cli wrote that another tool rejects, or a real-world archive the CLI mishandles
title: '[interop] '
labels: interop
assignees: ''
---

## Direction

- [ ] zipnative-cli **wrote** an archive that another tool rejects
- [ ] Another tool **wrote** an archive that zipnative-cli mishandles

## The other tool

Name and **exact version** (e.g. `unzip 6.00`, `7-Zip 24.08`, `Windows 11 Explorer`,
`macOS 15 Archive Utility`, `bsdtar 3.7.4`, `Temurin 21 jar`, `Python 3.12 zipfile`):

## The CLI command

```bash
# Exact zipnative-cli invocation (create / modify / extract / stream …) and version
zipnative --version
```

## Evidence

- Error/output from the other tool:
- `zipnative verify --input <a.zip> --format json` output:
- `zipnative inspect --input <a.zip> --format json --entries` output (paste the
  `diagnostics` array in full — `ZIP_*` diagnostic codes are the first clue):
- Archive attached (as a .zip inside a .zip so GitHub keeps the bytes intact),
  or a generator script, or a `7z l -slt <a.zip>` dump:

## Producer

If the archive came from a real-world producer (Word, a build tool, a phone),
name it — the interop corpus grows from these reports.

<!-- Note: the CLI contains no ZIP parsing logic — every byte-level operation
     is a zipnative call. When triage shows the root cause is in the engine
     (a header the reader misparses, bytes the writer emits), the issue is
     re-filed upstream in zipnative and this one is linked to it; the CLI
     tracks the fix through its dependency bump. -->
