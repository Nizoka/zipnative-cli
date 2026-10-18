// Terminal-safe rendering of attacker-controlled text.
//
// Entry names, comments, extra-field names and engine messages that quote
// them come from the ARCHIVE — i.e. from whoever produced it. Printed raw
// on a terminal, a name such as "a\x1b]0;pwned\x07.txt" retitles the window,
// "\x1b[2J" clears the screen, "\x1b[1A" overwrites the previous line (a
// listing that hides an entry), and the Unicode bidi controls (Trojan
// Source, CVE-2021-42574) make "evil\u202etxt.exe" display as "evilexe.txt".
//
// TEXT output therefore goes through `escapeTerminal()`: every C0 control
// except TAB / LF, DEL, every C1 control (U+0080–U+009F, which some
// terminals honour as 8-bit escapes), and the bidi embedding / override /
// isolate controls are replaced by a visible escape (`\x1b`, `\u202e`).
// JSON output is NOT escaped here: `JSON.stringify` already escapes C0
// controls, the data must round-trip exactly, and `--long` keeps the raw
// bytes in `rawNameHex` either way. A literal backslash is left alone — the
// escape is for display, the JSON row is the machine form.

// Matching control characters is this module's whole purpose.
// eslint-disable-next-line no-control-regex
const ESCAPE_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function visible(ch: string): string {
    const code = ch.charCodeAt(0);
    return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
}

/** `text` with every control / bidi character made visible (display only, never for JSON). */
export function escapeTerminal(text: string): string {
    return text.replace(ESCAPE_RE, visible);
}

/** True when `text` holds a character {@link escapeTerminal} would rewrite. */
export function hasTerminalControls(text: string): boolean {
    ESCAPE_RE.lastIndex = 0;
    const found = ESCAPE_RE.test(text);
    ESCAPE_RE.lastIndex = 0;
    return found;
}
