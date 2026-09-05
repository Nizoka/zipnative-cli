// Minimal ANSI colour helper for the stderr progress lines. Colour is a
// progressive enhancement only — never required to read CLI output.
//
// Decision, in order (the conventions agents and CI runners rely on):
//   1. NO_COLOR set (any value, https://no-color.org)  → off
//   2. FORCE_COLOR set to anything but "0"/"false"      → on (CI log viewers)
//   3. TERM=dumb                                         → off
//   4. otherwise: on only when STDERR is a TTY — the stream the styled lines
//      are actually written to (`progress()`), not stdout, which may be a
//      pipe carrying the artefact while stderr is still a terminal.
// `--no-color` and `--quiet` are applied by index.ts (NO_COLOR / no output).

function colorEnabled(stream: NodeJS.WriteStream): boolean {
    if (process.env['NO_COLOR'] !== undefined) return false;
    const force = process.env['FORCE_COLOR'];
    if (force !== undefined) return force !== '0' && force.toLowerCase() !== 'false';
    if (process.env['TERM'] === 'dumb') return false;
    return stream.isTTY === true;
}

const CODES = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
} as const;

type Style = keyof Omit<typeof CODES, 'reset'>;

/** Wrap `text` in an ANSI style when colour is enabled for stderr (where it is written). */
export function style(text: string, ...styles: Style[]): string {
    if (!colorEnabled(process.stderr)) return text;
    const prefix = styles.map((s) => CODES[s]).join('');
    return `${prefix}${text}${CODES.reset}`;
}
