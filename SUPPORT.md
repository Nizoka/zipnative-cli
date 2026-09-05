# Support

Thanks for using **zipnative-cli**! Here is where to get help depending on what you need.

## 📚 Documentation

- **Quick start & command reference:** [README.md](./README.md)
- **Agent contract (envelopes, codes, token economy):** [AGENTS.md](./AGENTS.md)
- **Knowledge base (AI-friendly):** [docs/KNOWLEDGE_BASE.md](./docs/KNOWLEDGE_BASE.md)
- **Error registry (every `ZIP_*` code with its cause, remedy and CLI mapping):** [docs/data/errors.json](./docs/data/errors.json)
- **zipnative engine docs:** [zipnative.dev](https://zipnative.dev)
- **Changelog:** [CHANGELOG.md](./CHANGELOG.md)
- **Roadmap:** [ROADMAP.md](./ROADMAP.md)

Every command answers `zipnative <command> --help`, and `zipnative schema <subject>` prints the JSON Schema of every input and output shape.

## ❓ Questions & Discussions

- **GitHub Discussions** — the ecosystem's discussions live on the engine repository today:
  [github.com/Nizoka/zipnative/discussions](https://github.com/Nizoka/zipnative/discussions).
  Use them for how-to questions, design ideas, and anything open-ended about the engine or the
  CLI. A Discussions tab on
  [zipnative-cli](https://github.com/Nizoka/zipnative-cli/discussions) is a maintainer setting
  that is enabled when ready; until then the engine's board is the place.

## 🐛 Bugs & Feature Requests

- **GitHub Issues** — [github.com/Nizoka/zipnative-cli/issues](https://github.com/Nizoka/zipnative-cli/issues)
  (blank issues are disabled — pick a template).
  Before opening an issue, please:
  1. Search existing issues (open and closed).
  2. Reproduce on the latest published version and attach the output of `zipnative doctor --json`
     (CLI, Node and engine versions, deflate tiers, workers, codecs, effective limits).
  3. Re-run the failing command with `--json` and include the exact command, the stderr error
     envelope — its `code` (the `E_*` class) and `zipCode` (the engine's `ZIP_*` cause), plus
     `entryName` / `detail` when present — and, when an archive is involved, either the archive or
     a script that builds one. Branch on the codes, not the message text: messages may be reworded
     between releases, codes are stable.
  4. Decide where it belongs: the CLI contains no ZIP logic of its own, so a wrong byte, a wrong
     verdict or a `ZIP_*` code raised on a valid archive is an engine matter for
     [zipnative](https://github.com/Nizoka/zipnative/issues); the CLI ships the fixed engine in a
     patch release. Flag parsing, the filesystem sink, envelopes, exit codes and manifests are
     CLI matters.

## 🔒 Security Vulnerabilities

**Do not open public issues for security problems.**

Report privately through
[GitHub private vulnerability reporting](https://github.com/Nizoka/zipnative-cli/security/advisories/new)
(engine vulnerabilities go to the
[zipnative advisory form](https://github.com/Nizoka/zipnative/security/advisories/new)).
`security@pdfnative.dev` is the shared maintainer inbox of the pdfnative and zipnative ecosystems
and works as a fallback; a dedicated `security@zipnative.dev` inbox is a maintainer decision not
yet taken. See [SECURITY.md](./SECURITY.md) for the disclosure procedure and the security model.

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). AI agents drafting issues or PRs: run `zipnative govern verify-issue <draft.md>` first, then hand the draft to a human — see [AGENTS.md](./AGENTS.md) and [.github/AGENT_RULES.md](./.github/AGENT_RULES.md).
