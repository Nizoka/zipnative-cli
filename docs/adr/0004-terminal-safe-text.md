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
- It also escapes the invisible characters that make two names look alike or hide text: U+00AD, U+115F, U+1160, U+200B, U+2028, U+2029, U+2060–U+2064, U+3164, U+FEFF, U+FFA0 and the tag characters U+E0000–U+E007F
  (`\u{e0041}`). ZWNJ / ZWJ and the variation selectors stay: they compose ordinary
  Persian, Indic and emoji text.
- `escapeTerminal()` keeps TAB and LF because a report is several lines. Every FIELD that comes
  from an archive (an entry name, an extra-field name, an engine message) and every one-line
  message (progress, diagnostics, errors, the `remedy:` and `info:` lines) goes through
  `escapeLine()`, which escapes TAB and LF too — otherwise an entry named
  `a.txt<LF>   5  safe.txt` prints as two rows and an error message can grow a forged
  `remedy:` line (both found by the 1.1.0 security review, before release).
- It is applied at the text sinks: the commands' text reports on stdout, `progress()` lines,
  text diagnostics (`formatDiagnosticLine`), text-mode error messages and remedies, and the
  configuration `info:` line (a planted `.zipnativerc.json` key or path is attacker text too).
- JSON is not escaped: `JSON.stringify` already escapes C0 controls, agents need the exact text,
  and `--long` carries the bytes in `rawNameHex`. Entry DATA (`cat`, `stream --cat`, `inflate`)
  is never touched.
- The repository holds its own sources to the rule: `tests/docs/source-hygiene.test.ts` fails on
  a raw NUL, C0 / C1 or bidi control in any tracked text file.

### Consequences

- Good: no archive can drive the terminal of the person reading a report.
- Neutral: a name with a control character reads with its escape in text mode, exactly as `ls -b`
  would show it; the JSON row is the machine form.
