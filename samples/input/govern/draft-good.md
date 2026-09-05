# Bug: `extract --flat` drops a file when two entries share a basename

## Environment

- zipnative-cli 1.0.0, zipnative 1.0.0
- Node 22.x, Windows 11 / Ubuntu 24.04

## Minimal reproduction

```sh
zipnative create samples/input/text --output flat.zip
zipnative extract --input flat.zip --output-dir out --flat
```

## Expected behavior

The second entry with the same basename is refused (ZIP_EXTRACT_DUPLICATE_PATH)
unless `--on-duplicate first|last` is passed.

## Actual behavior

Both are written and the second silently wins.

## Compliance report

- zero_dependency_confirmed: yes (no new packages)
- reproduction_command: see above
- reproduction_result: executed locally, fails as described
- duplicate_search_performed: yes, open and closed issues
- affected_packages: zipnative-cli
- identity_reminder_shown: yes — this draft will be submitted under the human's GitHub identity
