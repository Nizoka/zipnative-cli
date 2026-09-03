// Minimal ANSI color helper. Disabled automatically when output is not a TTY,
// when NO_COLOR is set (https://no-color.org), or under --quiet. Colour is a
// progressive enhancement only — never required to read CLI output.

function colorEnabled(stream: NodeJS.WriteStream): boolean {
    if (process.env['NO_COLOR'] !== undefined) return false;
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

/** Wrap `text` in an ANSI style when colour is enabled for stdout. */
export function style(text: string, ...styles: Style[]): string {
    if (!colorEnabled(process.stdout)) return text;
    const prefix = styles.map((s) => CODES[s]).join('');
    return `${prefix}${text}${CODES.reset}`;
}
