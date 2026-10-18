// Terminal-safe rendering of attacker-controlled text.
//
// Entry names, comments, extra-field names and engine messages that quote
// them come from the ARCHIVE — i.e. from whoever produced it. Printed raw
// on a terminal, a name such as "a<ESC>]0;pwned<BEL>.txt" retitles the
// window, "<ESC>[2J" clears the screen, "<ESC>[1A" overwrites the previous
// line (a listing that hides an entry), and the Unicode bidi controls
// (Trojan Source, CVE-2021-42574) make "evil<U+202E>txt.exe" display as
// "evilexe.txt".
//
// TEXT output therefore goes through this module. Escaped as a visible
// `\xNN`, `\uNNNN` or `\u{NNNNN}`:
//   • every C0 control, DEL and every C1 control (U+0080–U+009F, which some
//     terminals honour as 8-bit escapes);
//   • the bidi marks, embeddings, overrides and isolates (U+061C, U+200E,
//     U+200F, U+202A–U+202E, U+2066–U+2069);
//   • the invisible characters that make two names look alike or hide text:
//     the soft hyphen U+00AD, the Hangul fillers U+115F, U+1160, U+3164 and
//     U+FFA0, the zero-width space U+200B, the line / paragraph separators
//     U+2028 / U+2029, the word joiners U+2060–U+2064, the BOM U+FEFF and
//     the tag characters U+E0000–U+E007F.
// ZWNJ / ZWJ (U+200C / U+200D) and the variation selectors stay: they
// compose ordinary Persian, Indic and emoji text.
//
// A report is several lines, so `escapeTerminal()` keeps TAB and LF. Every
// single FIELD that comes from an archive (a name, a comment, an engine
// message) and every one-line message goes through `escapeLine()`, which
// escapes TAB and LF too: an entry named "a.txt<LF>   5  safe.txt" must not
// print as two rows, nor an error message grow a forged "remedy:" line.
//
// JSON output is NOT escaped here: `JSON.stringify` already escapes C0
// controls, the data must round-trip exactly, and `--long` keeps the raw
// bytes in `rawNameHex` either way. A literal backslash is left alone — the
// escape is for display, the JSON row is the machine form.

const TAB = 0x09;
const LF = 0x0a;

/** Inclusive code-point ranges escaped in every text sink (TAB and LF aside). */
const ESCAPED: readonly (readonly [number, number])[] = [
    [0x0000, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad], [0x061c, 0x061c],
    [0x115f, 0x1160], [0x200b, 0x200b], [0x200e, 0x200f], [0x2028, 0x202e],
    [0x2060, 0x2064], [0x2066, 0x2069], [0x3164, 0x3164], [0xfeff, 0xfeff],
    [0xffa0, 0xffa0], [0xe0000, 0xe007f],
];

function escaped(cp: number, keepLines: boolean): boolean {
    if (keepLines && (cp === TAB || cp === LF)) return false;
    return ESCAPED.some(([lo, hi]) => cp >= lo && cp <= hi);
}

function visible(cp: number): string {
    if (cp <= 0xff) return `\\x${cp.toString(16).padStart(2, '0')}`;
    return cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, '0')}` : `\\u{${cp.toString(16)}}`;
}

function render(text: string, keepLines: boolean): string {
    let out = '';
    for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        out += escaped(cp, keepLines) ? visible(cp) : ch;
    }
    return out;
}

/** `text` (a multi-line report) with every control / bidi / invisible character made visible; TAB and LF kept (display only, never for JSON). */
export function escapeTerminal(text: string): string {
    return render(text, true);
}

/** One field or one-line message: as {@link escapeTerminal}, with TAB and LF escaped too. */
export function escapeLine(text: string): string {
    return render(text, false);
}

/** True when `text` holds a character {@link escapeTerminal} would rewrite. */
export function hasTerminalControls(text: string): boolean {
    for (const ch of text) {
        if (escaped(ch.codePointAt(0) ?? 0, true)) return true;
    }
    return false;
}
