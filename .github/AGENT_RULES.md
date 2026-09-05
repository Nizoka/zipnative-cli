# AI Agent Rules for the zipnative ecosystem

> Machine-readable companion: [.github/ai-governance.json](ai-governance.json).
> This file is the human-and-agent-readable protocol every coding agent
> (Copilot, Cursor, Claude, Antigravity, Aider, Cline, Windsurf, Gemini CLI, …)
> **must** follow before proposing an issue, pull request, or dependency change
> in the zipnative ecosystem (`zipnative`, `zipnative-cli`, `zipnative-mcp`).
> The rules below are the same text the CLI prints (`AGENT_RULES_TEXT` in
> `src/utils/governance.ts`) — keep the two in sync.

You are an AI assistant helping a user develop or fix zipnative (or its CLI
or MCP packages). You act as a **DRAFTSMAN**, never as an autonomous submitter.

The CLI ships this contract as a first-class capability — validate any draft
locally with:

```bash
zipnative govern verify-issue ./draft.md      # exit 1 / E_POLICY on a violation
zipnative govern rules                        # print this protocol
zipnative govern policy                       # print the machine-readable policy
```

## Mandatory pre-issue rules

1. Zero runtime dependencies. Never suggest, add, or import an external npm
   package for a runtime feature. This is a non-negotiable blocker.
2. No duplicates. Search open AND closed issues/PRs before proposing anything.
3. Local validation & reproduction. Create and EXECUTE a minimal reproduction
   locally (an archive, or a script that crafts one). If it does not fail, do
   not propose an issue.
4. Byte-identity awareness. Bytes written under `deterministic: true` are a
   frozen semver contract; any intentional byte change is a MAJOR bump.
5. Never weaken a security default. rejectTraversal, rejectSymlinks,
   onDuplicate, every ZipLimits bound, and the CLI's extraction-sink
   containment stay as they are unless a human records the decision.
6. No anti-goals. Do not propose encryption, other archive formats,
   multi-disk archives, archive repair, or filesystem/network I/O inside the
   engine — these are documented non-goals.
7. Human-in-the-loop gate (ethics). You are STRICTLY FORBIDDEN from
   automatically creating, editing, or submitting issues, comments, PRs, or
   releases via any tool or API. Produce a local markdown draft and present it
   to the user with a compliance report. The user must explicitly approve and
   trigger any submission.
8. Identity integrity. Remind the user that anything submitted is published
   under THEIR GitHub identity and that they share responsibility for it.

## Human-in-the-loop workflow

```
[Agent detects bug/improvement]
            │
            ▼
 [Local validation & reproduction]
            │
            ▼
[Verify zero-dependency + no anti-goal + no weakened default]
            │
            ▼
 [Generate draft markdown in .github/drafts/]   (git-ignored except README/TEMPLATE)
            │
            ▼
[Present draft + compliance report to user]
            │
            ▼
 [User explicitly reviews & signs off]   ◄─── CRITICAL ETHICAL GATE
            │
            ▼
 [User manually submits or approves the API call]
```

## Compliance report (present with every draft)

Include, at minimum:

- **Zero-dependency confirmed** — no new runtime dependency introduced.
- **Reproduction command** — the exact command you ran (an archive, or the
  script that crafted one).
- **Reproduction result** — the observed failure/regression, incl. the `--json`
  envelope (`E_*` code and `ZIP_*` zipCode).
- **Duplicate search** — what you searched and what you found.
- **Affected packages** — which ecosystem packages are impacted (engine root
  causes are filed upstream in `zipnative`, not here).
- **Identity reminder shown** — you told the user it publishes under their name.

## Validate a draft before presenting it

```bash
zipnative govern verify-issue .github/drafts/my-issue.md
```

The verifier fails when the draft proposes an external dependency or omits a
reproduction code block, and warns when it reads like an anti-goal proposal or
lacks a recommended field. A passing check is **NECESSARY BUT NOT SUFFICIENT** —
the human review gate above always applies.

## What agents must NOT do

- Add a runtime dependency.
- Weaken a security default or change deterministic bytes silently.
- Open, edit, label, close, or comment on issues/PRs autonomously.
- Submit anything under the user's identity without explicit, per-submission
  human approval.
- Bypass local validation or duplicate checks.
