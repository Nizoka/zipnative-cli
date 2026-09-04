// `zipnative completion <bash|zsh|fish|powershell>` — emit a shell completion
// script.
//
// The generated scripts are self-contained and driven by the static command /
// flag metadata below — the SINGLE SOURCE OF TRUTH for the command surface:
// the four shells, `schema manifest`, `doctor`'s command count and the docs
// consistency test all derive from `COMMANDS`. Install by sourcing the
// output, e.g.:
//
//     zipnative completion bash > /etc/bash_completion.d/zipnative
//     zipnative completion zsh  > "${fpath[1]}/_zipnative"
//     zipnative completion fish > ~/.config/fish/completions/zipnative.fish
//     zipnative completion powershell >> $PROFILE

import type { ParsedArgs } from '../utils/args.js';
import { CliError } from '../utils/error.js';
import { LIMIT_FLAG_NAMES } from '../utils/limits.js';

export { BOOLEAN_FLAGS, COMMAND_BOOLEAN_FLAGS, GLOBAL_BOOLEAN_FLAGS, isBooleanFlag } from '../utils/flags.js';

export interface CommandSpec {
    readonly name: string;
    readonly summary: string;
    readonly flags: readonly string[];
    /** Human grouping used by `--help` and the docs. */
    readonly group: 'Create & modify' | 'Read & extract' | 'Integrity & codecs' | 'Automation & meta';
}

export const GLOBAL_FLAGS: readonly string[] = [
    '--help', '--version', '--json', '--dry-run', '--quiet', '--no-color', '--config', '--no-config', '--pretty',
    '--strict', '--pure-codecs', '--codec',
    ...LIMIT_FLAG_NAMES,
];

/** Commands that honour `--dry-run` (validate + plan, write nothing). */
export const DRY_RUN_COMMANDS: readonly string[] = ['create', 'extract', 'modify', 'stream', 'cat', 'inflate', 'batch'];

const COMPRESSION_FLAGS = ['--method', '--level', '--deterministic'];
const PROJECTION_FLAGS = ['--summary', '--fields'];
const FILTER_FLAGS = ['--include', '--exclude'];

export const COMMANDS: readonly CommandSpec[] = [
    {
        name: 'create',
        group: 'Create & modify',
        summary: 'Build a deterministic ZIP from files, directories, stdin or a manifest',
        flags: [
            '--input', '--output', '--stdin-name', '--from-manifest', '--base', '--prefix', '--dir-entries',
            ...FILTER_FLAGS, '--follow-symlinks', ...COMPRESSION_FLAGS, '--order', '--date', '--mtime',
            '--comment', '--entry-comment', '--preserve-mode', '--store-ext', '--stream', '--chunk-size',
            '--parallel', '--workers', '--min-job-size', '--job-timeout',
        ],
    },
    {
        name: 'modify',
        group: 'Create & modify',
        summary: 'Incremental edits: add/replace/remove/rename/comment, append-only or compact',
        flags: [
            '--input', '--output', '--add', '--add-dir', '--replace', '--remove', '--rename', '--comment',
            ...COMPRESSION_FLAGS, '--date', '--compact', '--in-place', '--from-manifest',
        ],
    },
    {
        name: 'list',
        group: 'Read & extract',
        summary: 'List archive entries (text | json | ndjson)',
        flags: ['--input', '--format', '--long', '--validate', ...FILTER_FLAGS, ...PROJECTION_FLAGS],
    },
    {
        name: 'inspect',
        group: 'Read & extract',
        summary: 'Forensic archive report with determinism/security assertions',
        flags: ['--input', '--format', '--entries', '--entry', '--extra', '--check', ...PROJECTION_FLAGS],
    },
    {
        name: 'cat',
        group: 'Read & extract',
        summary: 'Stream one or more entries to stdout',
        flags: ['--input', '--entry', '--output', '--raw', '--no-verify-crc'],
    },
    {
        name: 'extract',
        group: 'Read & extract',
        summary: 'Extract to a directory (zip-slip, symlink, bomb and duplicate guards on by default)',
        flags: [
            '--input', '--output-dir', ...FILTER_FLAGS, '--entry', '--overwrite', '--on-duplicate',
            '--skip-unsafe', '--allow-symlinks', '--skip-symlinks', '--flat', '--buffered',
            '--preserve-mode', '--preserve-mtime',
        ],
    },
    {
        name: 'stream',
        group: 'Read & extract',
        summary: 'Forward-only reader over stdin/pipes (no central directory)',
        flags: [
            '--input', '--list', '--output-dir', '--cat', '--format', '--long', ...FILTER_FLAGS,
            '--overwrite', '--on-duplicate', '--skip-unsafe', '--skip-unsupported', '--flat',
            '--preserve-mtime', ...PROJECTION_FLAGS,
        ],
    },
    {
        name: 'verify',
        group: 'Integrity & codecs',
        summary: 'Deep integrity verification (CRC, sizes, local headers, diagnostics)',
        flags: ['--input', '--format', ...PROJECTION_FLAGS],
    },
    {
        name: 'crc32',
        group: 'Integrity & codecs',
        summary: 'CRC-32 of files or stdin',
        flags: ['--input', '--seed', '--expect', '--format'],
    },
    {
        name: 'inflate',
        group: 'Integrity & codecs',
        summary: 'Decompress a raw DEFLATE (or registered-codec) stream',
        flags: ['--input', '--output', '--method', '--max-output', '--sync', '--allow-trailing'],
    },
    {
        name: 'batch',
        group: 'Automation & meta',
        summary: 'Archive a directory tree per subfolder, verify a folder of archives, or run a manifest pipeline',
        flags: [
            '--input-dir', '--output-dir', '--task', '--concurrency', '--fail-fast', '--manifest',
            '--continue-on-error', '--allow-codec-load', '--format', ...PROJECTION_FLAGS,
            ...COMPRESSION_FLAGS, '--order', '--date', '--comment',
        ],
    },
    {
        name: 'doctor',
        group: 'Automation & meta',
        summary: 'Environment / capability preflight (text or --json)',
        flags: ['--format'],
    },
    {
        name: 'schema',
        group: 'Automation & meta',
        summary: 'Print a JSON Schema / capability manifest for agents',
        flags: [],
    },
    {
        name: 'completion',
        group: 'Automation & meta',
        summary: 'Emit a shell completion script (bash|zsh|fish|powershell)',
        flags: [],
    },
    {
        name: 'govern',
        group: 'Automation & meta',
        summary: 'AI-governance / HITL contract (rules, policy, verify-issue)',
        flags: ['--input', '--format'],
    },
];

export const COMMAND_NAMES: readonly string[] = COMMANDS.map((c) => c.name);

function bashScript(): string {
    const cmds = COMMAND_NAMES.join(' ');
    const cases = COMMANDS.map(
        (c) => `        ${c.name}) opts="${[...c.flags, ...GLOBAL_FLAGS].join(' ')}" ;;`,
    ).join('\n');
    return `\
# bash completion for zipnative
_zipnative() {
    local cur prev words cword
    _init_completion 2>/dev/null || { cur="\${COMP_WORDS[COMP_CWORD]}"; }
    local cmd="\${COMP_WORDS[1]}"
    local opts="${GLOBAL_FLAGS.join(' ')}"
    if [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "${cmds}" -- "\${cur}") )
        return 0
    fi
    case "\${cmd}" in
${cases}
    esac
    COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
    return 0
}
complete -F _zipnative zipnative
`;
}

function zshScript(): string {
    const cmdLines = COMMANDS.map((c) => `        '${c.name}:${c.summary.replace(/'/g, '')}'`).join('\n');
    const cases = COMMANDS.map(
        (c) =>
            `            ${c.name})\n                _values 'flags' ${[...c.flags, ...GLOBAL_FLAGS]
                .map((f) => `'${f}'`)
                .join(' ')} ;;`,
    ).join('\n');
    return `\
#compdef zipnative
# zsh completion for zipnative
_zipnative() {
    local -a commands
    commands=(
${cmdLines}
    )
    if (( CURRENT == 2 )); then
        _describe 'command' commands
        return
    fi
    case "\${words[2]}" in
${cases}
    esac
}
_zipnative "$@"
`;
}

function fishScript(): string {
    const lines: string[] = ['# fish completion for zipnative'];
    lines.push('complete -c zipnative -f');
    for (const c of COMMANDS) {
        lines.push(
            `complete -c zipnative -n __fish_use_subcommand -a ${c.name} -d '${c.summary.replace(/'/g, '')}'`,
        );
    }
    for (const c of COMMANDS) {
        for (const flag of [...c.flags, ...GLOBAL_FLAGS]) {
            lines.push(
                `complete -c zipnative -n '__fish_seen_subcommand_from ${c.name}' -l ${flag.replace(/^--/, '')}`,
            );
        }
    }
    return lines.join('\n') + '\n';
}

function powershellScript(): string {
    // A Register-ArgumentCompleter script block. First positional → command
    // names; after a command → that command's flags plus the global flags.
    const cmdList = COMMAND_NAMES.map((n) => `'${n}'`).join(', ');
    const cases = COMMANDS.map(
        (c) => `            '${c.name}' { @(${[...c.flags, ...GLOBAL_FLAGS].map((f) => `'${f}'`).join(', ')}) }`,
    ).join('\n');
    return `\
# PowerShell completion for zipnative
# Add to your profile:  zipnative completion powershell >> $PROFILE
Register-ArgumentCompleter -Native -CommandName zipnative -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $commands = @(${cmdList})
    $tokens = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
    # tokens[0] is 'zipnative'; tokens[1] is the sub-command when present.
    if ($tokens.Count -le 2 -and -not $wordToComplete.StartsWith('-')) {
        $commands | Where-Object { $_ -like "$wordToComplete*" } |
            ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
        return
    }
    $cmd = if ($tokens.Count -ge 2) { $tokens[1] } else { '' }
    $flags = switch ($cmd) {
${cases}
            default { @(${GLOBAL_FLAGS.map((f) => `'${f}'`).join(', ')}) }
    }
    $flags | Where-Object { $_ -like "$wordToComplete*" } |
        ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_) }
}
`;
}

export async function completion(args: ParsedArgs): Promise<void> {
    const shell = args.positionals[0];
    if (shell === undefined) {
        throw new CliError('Usage: zipnative completion <bash|zsh|fish|powershell>', 2);
    }
    switch (shell) {
        case 'bash':
            process.stdout.write(bashScript());
            break;
        case 'zsh':
            process.stdout.write(zshScript());
            break;
        case 'fish':
            process.stdout.write(fishScript());
            break;
        case 'powershell':
        case 'pwsh':
            process.stdout.write(powershellScript());
            break;
        default:
            throw new CliError(`Unsupported shell "${shell}". Valid: bash, zsh, fish, powershell.`, 2);
    }
    return Promise.resolve();
}
