# Auditor A — claims versus code

You audit one release of zipnative-cli. Your angle is narrow on purpose: **is every claim the release makes true in the code that ships?** Another auditor covers the help text, the surface tables and the release surfaces; do not spend time there.

## Inputs

- The release note (`release-notes/v<version>.md`) and the top entry of `CHANGELOG.md`.
- The brief (`.audit/<version>/brief.md`): the criteria and the decisions already recorded. A settled item is not a finding unless you show it unsafe.
- `git diff <previous-tag>..HEAD --stat` and the per-area diff for anything a claim points at (for a first release, the whole tree).
- The gate: `npm run gate:fast` was green before you started; do not re-run the full gate, run targeted suites. `dist/cli.cjs` is built (`npm run build` if `node dist/cli.cjs --version` fails). `npm run corpus:zip` has written the adversarial archives under `test-output/zip/` (read them only through `node dist/cli.cjs <path>`; the directory is denied to Read).

## Method

1. Enumerate the claims. One line each: commands, flags, envelope fields (`code`, `zipCode`, `remedy`, `entryName`, `detail`, `config`, `diagnostics`), exit codes, the `ZIP_*` → `E_*` mapping, refusals, bounds (`--max-*`, `--max-input-size`, `--timeout`), engine (zipnative) behaviour inherited, sample or corpus changes. Number them `A-01`, `A-02`, …
2. For each claim, locate the evidence: the command module (`src/commands/<name>.ts`), the helper (`src/utils/`), the engine symbol it reaches (`src/core-bridge/index.ts`), the test that proves it (`tests/commands/`, `tests/utils/`, `tests/integration/`, `tests/fuzz/`, `tests/docs/`, `tests/scripts/`, `tests/tools/`), the sample that demonstrates it (`samples/<command>/`).
3. **Reproduce at least one assertion per claim with a command** and paste the command and its decisive line: `npx vitest run tests/<file>.test.ts -t "<name>"`, `node dist/cli.cjs <command> … --json` (read the stderr envelope and the exit code), `node samples/run-all.js --category <name>`. A claim you could only confirm by reading is `unverified`, and says so.
4. Check the negative space — each one with a command, not a reading. The expected code of every refusal comes from `node dist/cli.cjs schema errors --json`, not from memory.
   - "one runtime dependency" needs `npm ls --omit=dev --all` to list `zipnative` and nothing else, and `src/core-bridge/index.ts` to be the only module importing it (`git grep -n "from 'zipnative" src/` — `src/utils/version.ts` may read `zipnative/package.json`, nothing else).
   - "no ZIP parsing in `src/`" needs `git grep -n -i -E "0x04034b50|0x02014b50|0x06054b50|PK\\x03\\x04" src/` to come back empty; the raw parsers are `scripts/validate-zip.mjs` and `tests/helpers/raw-zip-builder.ts` only.
   - "offline" needs `git grep -n -E "node:(http|https|net|dns|tls|http2|dgram)|fetch\(|WebSocket" src/` to come back empty and `node scripts/gate.mjs --only bundle-check` to pass (the bundle probe denies the network built-ins).
   - "no security default loosened" needs, over the corpus: `extract test-output/zip/hostile-zip-slip.zip --output-dir <empty tmp> --json` refused with the traversal code and the directory still empty; the same for `hostile-device-name.zip`; `hostile-duplicate-paths.zip` refused under the default duplicate policy; `cat test-output/zip/neg-declared-bomb.zip --entry <name>` stopped by a limit; `--max-entries none` exit 2; `batch --task verify` with `--max-input-size` smaller than an input refused; `modify --help` listing no opt-out of the re-emission check and `modify` over `neg-cd-mismatch.zip` refused.
   - "a symlink is never materialised" needs the symlink suites (`npx vitest run -t symlink`) and one built-binary run: an archive carrying a store-method entry with `S_IFLNK` external attributes (build it with `node -e` through the engine, or take the one `tests/helpers/raw-zip-builder.ts` builds in its suite), extracted with and without `--skip-symlinks` / `--allow-symlinks`, then `ls -l` of the output directory showing no `l` entry.
   - "`--deterministic` bytes are never post-processed" needs two `create … --deterministic` runs whose SHA-256 are equal (`node -e` over both files), the pairs `npm run corpus:zip` asserts, and the archives inherited from the previous release compared against the maintainer's digest list (`.audit/<version>/corpus-<previous>.sha256`); a missing list leaves the claim `unverified`, never `holds`.
   - "switch values are strict" needs `node dist/cli.cjs list x.zip --overwite` exit 2; `create <dir> -o x.zip --overwrite=flase --json` exit 2 with `E_USAGE` and the value absent from the message; `ZIPNATIVE_DRY_RUN=flase node dist/cli.cjs list x.zip` exit 2; `ZIPNATIVE_JSON=yes` behaving as `--json`.
   - "a config file never relaxes a check" needs a scratch directory with a `.zipnativerc.json` setting `overwrite`, `skip-unsafe`, `max-entries`, `codec` and `allow-symlinks`, and a run of any command in it refused with `E_USAGE` naming the file and the key; then one setting only `json`, `pretty`, `quiet`, `no-color`, `progress`, `strict`, `long`, `summary`, `format`, `fields`, applied and named in the envelope's `config` field; and `--no-config` ignoring it.
   - "overwrite is refused uniformly" needs `create <dir> -o existing.zip` refused without `--overwrite`, and `--overwrite` over a symlink replacing the link with its target untouched (`ls -l` before and after).
   - "`--codec` is argv-only" needs `{"codec":"./x.js"}` in a config refused, and a manifest task carrying `codec` refused unless `batch --allow-codec-load` is given.
   - "no autonomous GitHub write" needs `node dist/cli.cjs govern verify-issue <draft> --json` to pass on every draft under `.github/drafts/`, and `git grep -n -E "gh (pr|issue|release)" .github/workflows scripts` to show nothing that writes.
5. Check the release note's own bookkeeping: version in `package.json`, `package-lock.json` and `CITATION.cff`; the `zipnative` range in `dependencies`; `node dist/cli.cjs --version --json` printing both; one date in `CHANGELOG.md`, the release note, `CITATION.cff` and `.github/SECURITY-INSIGHTS.yml` (`last-updated`); `docs/.well-known/security.txt` `Expires` in the future; the release title.

## Output

Write `.audit/<version>/auditor-a.md` using the finding format of `ledger.md`. Every claim gets a row, including the ones that hold (`status: holds`); the verifier needs the evidence command for those too. Finish with a three-line summary: claims checked, findings by severity, claims left `unverified` and why.

Do not fix anything. Do not push, tag or publish. Never put `npm publish`, `git push`, `git tag <name>` or a `gh` write in a shell command — `.claude/settings.json` denies them, and the audit never needs them.
