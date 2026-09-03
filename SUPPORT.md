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

## ❓ Questions & Discussions

- **GitHub Discussions** — [github.com/Nizoka/zipnative-cli/discussions](https://github.com/Nizoka/zipnative-cli/discussions)
  Use this for how-to questions, design ideas, and anything open-ended.

## 🐛 Bugs & Feature Requests

- **GitHub Issues** — [github.com/Nizoka/zipnative-cli/issues](https://github.com/Nizoka/zipnative-cli/issues)
  Before opening an issue, please:
  1. Search existing issues (open and closed).
  2. Reproduce on the latest published version and attach `zipnative doctor --format json`.
  3. Include the exact command you ran, the `--json` error envelope (its `code` and `zipCode`), and — when an archive is involved — either the archive or a script that builds one. Note that a problem in the archive engine itself belongs to [zipnative](https://github.com/Nizoka/zipnative/issues).

## 🔒 Security Vulnerabilities

**Do not open public issues for security problems.**

See [SECURITY.md](./SECURITY.md) for the private disclosure procedure.

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). AI agents drafting issues or PRs: run `zipnative govern verify-issue <draft.md>` first, then hand the draft to a human — see [AGENTS.md](./AGENTS.md).
