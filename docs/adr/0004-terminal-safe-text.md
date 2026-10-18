---
status: accepted
date: 2026-10-18
since: 1.1.0
---

# Text output is terminal-safe; JSON is exact

## Context and Problem Statement

Entry names, entry and archive comments, and the engine messages that quote them are bytes from
whoever produced the archive. 1.0.0 printed them raw in every text output — the `list` table,
`inspect` / `verify` reports, `warning:` / `info:` lines, error messages. A name carrying
`ESC [2J` clears the screen, `ESC [1A` rewrites the previous line (a listing that hides an
entry), `ESC ] 0 ; … BEL` retitles the window, and the Unicode bidi controls make
`evil<U+202E>txt.exe` display as `evilexe.txt` (Trojan Source, CVE-2021-42574). Neither the
engine nor pkinative-cli escapes them; zipnative-cli is the more exposed of the two because its
names come straight from the attacker.

## Decision Outcome

- `escapeTerminal()` (`src/utils/sanitize.ts`) replaces every C0 control except TAB / LF, DEL,
  every C1 control (U+0080–U+009F, honoured as 8-bit escapes by some terminals) and the bidi
  embedding / override / isolate controls (U+061C, U+200E/F, U+202A–E, U+2066–9) with a visible
  escape (`\x1b`, `\u202e`).
- It is applied at the text sinks: the commands' text reports on stdout, `progress()` lines,
  text diagnostics (`formatDiagnosticLine`), and text-mode error messages.
- JSON is not escaped: `JSON.stringify` already escapes C0 controls, agents need the exact text,
  and `--long` carries the bytes in `rawNameHex`. Entry DATA (`cat`, `stream --cat`, `inflate`)
  is never touched.
- The repository holds its own sources to the rule: `tests/docs/source-hygiene.test.ts` fails on
  a raw NUL, C0 / C1 or bidi control in any tracked text file.

### Consequences

- Good: no archive can drive the terminal of the person reading a report.
- Neutral: a name with a control character reads with its escape in text mode, exactly as `ls -b`
  would show it; the JSON row is the machine form.
