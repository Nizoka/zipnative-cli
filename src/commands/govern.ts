// `zipnative govern <rules|policy|verify-issue>` — expose the zipnative
// ecosystem's AI-governance / Human-in-the-Loop (HITL) contract to agents
// driving the CLI.
//
//   govern rules                 Print the human/agent protocol (AGENT_RULES).
//   govern policy                Print the machine-readable policy (JSON).
//   govern verify-issue <draft>  Validate an issue/PR draft against the policy.
//
// This makes the governance model actionable from any agent pipeline: draft
// locally, verify, then let a HUMAN review and submit.

import { type ParsedArgs, getStringFlag, hasFlag } from '../utils/args.js';
import { readFileOrStdin, assertJsonSizeLimit } from '../utils/io.js';
import { parseInputSizeFlag } from '../utils/limits.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { isJsonMode } from '../utils/agent.js';
import { serializeJson } from '../utils/projection.js';
import {
    AI_GOVERNANCE_POLICY,
    AGENT_RULES_TEXT,
    validateGovernanceDraft,
    type GovernanceValidation,
} from '../utils/governance.js';

const SUBCOMMANDS = ['rules', 'policy', 'verify-issue'];

function printPolicy(pretty: boolean): void {
    process.stdout.write(serializeJson(AI_GOVERNANCE_POLICY, pretty) + '\n');
}

async function verifyIssue(args: ParsedArgs): Promise<void> {
    const draftPath = args.positionals[1] ?? getStringFlag(args.flags, 'input', 'i');
    if (draftPath === undefined) {
        throw new CliError('Usage: zipnative govern verify-issue <draft.md>', 2);
    }

    // A draft is a buffered read like any other: --max-input-size applies
    // (then the 50 MB text cap before the regex pass).
    const buf = await readFileOrStdin(draftPath, parseInputSizeFlag(args));
    assertJsonSizeLimit(buf);
    const result: GovernanceValidation = validateGovernanceDraft(buf.toString('utf8'));

    const format = getStringFlag(args.flags, 'format', 'f');
    if (format !== undefined && format !== 'json' && format !== 'text') {
        throw new CliError(`--format must be "json" or "text", got "${format}".`, 2);
    }
    const jsonOut = isJsonMode() || format === 'json';
    if (jsonOut) {
        const pretty = hasFlag(args.flags, 'pretty') || !isJsonMode();
        process.stdout.write(serializeJson(result, pretty) + '\n');
    } else {
        for (const w of result.warnings) process.stderr.write(`warning: ${w}\n`);
        if (result.ok) {
            process.stdout.write(
                'Draft validation PASSED. Reminder: this draft must be reviewed and '
                + 'submitted by a HUMAN under their own GitHub identity.\n',
            );
        } else {
            for (const e of result.errors) process.stderr.write(`error: ${e}\n`);
        }
    }

    if (!result.ok) {
        // Non-zero exit so pipelines can gate on the verdict. In agent mode the
        // error envelope (stderr) carries the detail; the report is on stdout.
        const detail = result.errors.join(' ');
        throw new CliError(jsonOut ? detail : '', 1, ErrorCode.POLICY);
    }
}

export async function govern(args: ParsedArgs): Promise<void> {
    const sub = args.positionals[0];
    if (sub === undefined) {
        throw new CliError(`Usage: zipnative govern <${SUBCOMMANDS.join('|')}>`, 2);
    }
    switch (sub) {
        case 'rules':
            process.stdout.write(AGENT_RULES_TEXT);
            return;
        case 'policy':
            printPolicy(hasFlag(args.flags, 'pretty') || !isJsonMode());
            return;
        case 'verify-issue':
            await verifyIssue(args);
            return;
        default:
            throw new CliError(
                `Unknown govern subcommand "${sub}". Valid: ${SUBCOMMANDS.join(', ')}.`,
                2,
            );
    }
}
