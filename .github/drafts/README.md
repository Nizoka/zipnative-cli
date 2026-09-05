# AI-agent issue / PR drafts

This directory holds **locally-drafted** issues and pull requests produced by AI
coding agents under the zipnative Human-in-the-Loop governance policy
(see [../AGENT_RULES.md](../AGENT_RULES.md) and
[../ai-governance.json](../ai-governance.json)).

Drafts are **git-ignored** (only this README and [TEMPLATE.md](TEMPLATE.md)
are tracked), exactly as in the engine repository: a draft is an intermediate
state addressed to a human, not a deliverable. Once the human has filed the
issue upstream, the file has served its purpose.

Nothing here is submitted automatically. A human must review, sign off on, and
manually submit any draft under their own GitHub identity. Engine root causes
(anything about ZIP bytes, codecs, limits, dates, verification) are filed in
`Nizoka/zipnative`, never here.

Start from the template, then validate before presenting the draft:

```bash
cp .github/drafts/TEMPLATE.md .github/drafts/upstream-<topic>.md
zipnative govern verify-issue .github/drafts/upstream-<topic>.md
```

The verifier fails on a proposed runtime dependency or a missing reproduction
block, and warns on missing recommended fields or a documented anti-goal. It
is necessary, not sufficient — the human review gate always applies.
