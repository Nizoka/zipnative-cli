// `zipnative batch` — batch orchestration.
//
// Two mutually exclusive modes:
//   • Directory mode (--input-dir/--output-dir):
//       --task create (default): every immediate subdirectory of --input-dir
//         becomes <output-dir>/<name>.zip through the full `create` command
//         (every create flag — method, level, deterministic, order, date,
//         comment … — is honoured) with a bounded-concurrency pool.
//       --task verify: every *.zip in --input-dir is verified (verifyZip) and
//         the per-archive verdicts are reported; any failure exits 1.
//   • Manifest mode (--manifest tasks.json): run an ordered multi-command
//     pipeline (create → verify → extract → …) with "@id" output references,
//     strict pre-validation and a codec-load policy. See src/utils/manifest.ts.

import { readdir, mkdir, readFile, stat } from 'node:fs/promises';
import { join, basename, dirname, extname, resolve } from 'node:path';
import { type ParsedArgs, getStringFlag, hasFlag } from '../utils/args.js';
import { assertJsonSizeLimit } from '../utils/io.js';
import { CliError, ErrorCode, type ErrorCodeValue } from '../utils/error.js';
import { isJsonMode, isDryRun, progress } from '../utils/agent.js';
import { selectFields, serializeJson, parseFieldList } from '../utils/projection.js';
import { style } from '../utils/colors.js';
import { verifyZip } from '../core-bridge/index.js';
import { prepareEngine } from '../utils/engine.js';
import { parseLimitFlags } from '../utils/limits.js';
import { guard } from '../utils/ziperr.js';
import {
    parseManifest,
    assertCodecPolicy,
    type ManifestPlan,
    type ManifestTaskPlan,
} from '../utils/manifest.js';
import { create } from './create.js';

// Flags consumed by `batch` itself and therefore NOT forwarded to `create`.
const BATCH_ONLY_FLAGS = new Set([
    'input-dir', 'output-dir', 'task', 'concurrency', 'fail-fast', 'format',
    'input', 'i', 'output', 'o', 'base', 'stdin-name', 'from-manifest',
    'summary', 'fields', 'pretty',
    'manifest', 'allow-codec-load', 'continue-on-error',
]);

interface FileResult {
    readonly input: string;
    readonly output?: string;
    readonly ok: boolean;
    readonly error: string | null;
    readonly code?: ErrorCodeValue;
}

/** Build the per-directory ParsedArgs forwarded to `create` (batch flags stripped). */
function forwardedFlags(args: ParsedArgs, input: string, output: string): ParsedArgs {
    const flags: Record<string, string | boolean | readonly string[]> = {};
    for (const [key, value] of Object.entries(args.flags)) {
        if (BATCH_ONLY_FLAGS.has(key)) continue;
        flags[key] = value;
    }
    flags['input'] = input;
    flags['base'] = input;
    flags['output'] = output;
    return { flags, positionals: [] };
}

async function runPool<T>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let next = 0;
    const runners: Promise<void>[] = [];
    const n = Math.min(concurrency, items.length);
    for (let i = 0; i < n; i++) {
        runners.push(
            (async () => {
                for (;;) {
                    const idx = next++;
                    if (idx >= items.length) return;
                    await worker(items[idx] as T);
                }
            })(),
        );
    }
    await Promise.all(runners);
}

type CommandFn = (args: ParsedArgs) => Promise<void>;

/**
 * Dynamically import a manifest task's command function — mirroring
 * `loadCommand()` in src/index.ts, but local so `batch` never imports the
 * dispatcher.
 */
async function loadTaskCommand(name: string): Promise<CommandFn> {
    switch (name) {
        case 'create': return (await import('./create.js')).create;
        case 'list': return (await import('./list.js')).list;
        case 'inspect': return (await import('./inspect.js')).inspect;
        case 'extract': return (await import('./extract.js')).extract;
        case 'cat': return (await import('./cat.js')).cat;
        case 'verify': return (await import('./verify.js')).verify;
        case 'stream': return (await import('./stream.js')).stream;
        case 'modify': return (await import('./modify.js')).modify;
        case 'crc32': return (await import('./crc32.js')).crc32;
        case 'inflate': return (await import('./inflate.js')).inflate;
        default:
            throw new CliError(`Manifest command "${name}" is not available in this build.`, 1, ErrorCode.UNSUPPORTED);
    }
}

interface ManifestTaskResult {
    readonly id: string;
    readonly command: string;
    readonly ok: boolean;
    readonly output?: string;
    readonly error?: { readonly code: ErrorCodeValue; readonly message: string; readonly zipCode?: string };
    readonly skipped?: true;
}

/** Write the final manifest summary (stdout) honouring the projection flags. */
function emitManifestSummary(
    args: ParsedArgs,
    format: 'json' | 'text',
    counts: { total: number; succeeded: number; failed: number; skipped: number },
    tasks: readonly ManifestTaskResult[],
    dryRun: boolean,
): void {
    if (format === 'json') {
        const base: Record<string, unknown> = {
            ok: counts.failed === 0,
            command: 'batch',
            mode: 'manifest',
            ...(dryRun ? { dryRun: true } : {}),
            total: counts.total,
            succeeded: counts.succeeded,
            failed: counts.failed,
            skipped: counts.skipped,
        };
        let out: unknown = hasFlag(args.flags, 'summary') ? base : { ...base, tasks };
        const fieldsRaw = getStringFlag(args.flags, 'fields');
        if (fieldsRaw !== undefined) {
            out = selectFields(out, parseFieldList(fieldsRaw));
        }
        const pretty = hasFlag(args.flags, 'pretty') || !isJsonMode();
        process.stdout.write(serializeJson(out, pretty) + '\n');
    } else if (dryRun) {
        process.stdout.write(
            `Dry run: ${counts.total} task(s) validated, nothing executed.\n`,
        );
    } else {
        process.stdout.write(
            `Manifest: ${counts.succeeded}/${counts.total} task(s) succeeded, `
            + `${counts.failed} failed, ${counts.skipped} skipped.\n`,
        );
    }
}

function parseBatchFormat(args: ParsedArgs): 'json' | 'text' {
    const format = isJsonMode() ? 'json' : (getStringFlag(args.flags, 'format') ?? 'text');
    if (format !== 'json' && format !== 'text') {
        throw new CliError(`Invalid --format value "${format}". Valid: json, text.`, 2);
    }
    return format;
}

/** Execute (or dry-run) a validated manifest plan sequentially. */
async function runManifest(manifestPath: string, args: ParsedArgs): Promise<void> {
    const format = parseBatchFormat(args);
    const allowCodecLoad = hasFlag(args.flags, 'allow-codec-load');
    const continueOnError = hasFlag(args.flags, 'continue-on-error');
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();

    let rawBuf: Buffer;
    try {
        rawBuf = await readFile(manifestPath);
    } catch {
        throw new CliError(`Cannot read --manifest: ${manifestPath}`, 1, ErrorCode.IO);
    }
    assertJsonSizeLimit(rawBuf);
    const raw = rawBuf.toString('utf8');

    const plan: ManifestPlan = parseManifest(raw, dirname(resolve(manifestPath)));
    assertCodecPolicy(plan, allowCodecLoad);
    const total = plan.tasks.length;

    if (dryRun) {
        // Everything is validated (structure, whitelist, @ref graph, codec
        // policy). Print the plan and stop — nothing is created or executed.
        if (format === 'text') {
            plan.tasks.forEach((task: ManifestTaskPlan, i: number) => {
                const target = task.output !== undefined ? ` → ${task.output}` : task.outputDir !== undefined ? ` → ${task.outputDir}/` : '';
                process.stdout.write(`plan [${i + 1}/${total}] ${task.command} ${task.id}${target}\n`);
            });
        }
        const planned = plan.tasks.map((t): ManifestTaskResult => ({
            id: t.id,
            command: t.command,
            ok: true,
            ...(t.output !== undefined ? { output: t.output } : {}),
        }));
        emitManifestSummary(args, format, { total, succeeded: 0, failed: 0, skipped: 0 }, planned, true);
        return;
    }

    const results: ManifestTaskResult[] = [];
    const status = new Map<string, 'ok' | 'failed' | 'skipped'>();
    let aborted = false;
    let firstError: CliError | undefined;

    for (const [i, task] of plan.tasks.entries()) {
        const label = `→ [${i + 1}/${total}] ${task.command} ${task.id}`;
        const brokenDep = task.dependsOn.find((dep) => status.get(dep) !== 'ok');
        if (aborted || brokenDep !== undefined) {
            status.set(task.id, 'skipped');
            results.push({
                id: task.id,
                command: task.command,
                ok: false,
                skipped: true,
                ...(task.output !== undefined ? { output: task.output } : {}),
            });
            progress(`${label} … ${style('skipped', 'yellow')}`);
            continue;
        }
        try {
            if (task.outputDir !== undefined) {
                await mkdir(task.outputDir, { recursive: true });
            }
            const fn = await loadTaskCommand(task.command);
            await fn({ flags: { ...task.flags }, positionals: [] });
            status.set(task.id, 'ok');
            results.push({
                id: task.id,
                command: task.command,
                ok: true,
                ...(task.output !== undefined ? { output: task.output } : {}),
            });
            progress(`${label} … ${style('ok', 'green')}`);
        } catch (e) {
            const cli = e instanceof CliError ? e : new CliError(e instanceof Error ? e.message : String(e), 1, ErrorCode.RUNTIME);
            firstError ??= cli;
            status.set(task.id, 'failed');
            results.push({
                id: task.id,
                command: task.command,
                ok: false,
                error: { code: cli.code, message: cli.message, ...(cli.zipCode !== undefined ? { zipCode: cli.zipCode } : {}) },
            });
            progress(`${label} … ${style('failed', 'red')} (${cli.message})`);
            if (!continueOnError) aborted = true;
        }
    }

    const failed = results.filter((r) => r.error !== undefined).length;
    const skipped = results.filter((r) => r.skipped === true).length;
    const succeeded = total - failed - skipped;

    emitManifestSummary(args, format, { total, succeeded, failed, skipped }, results, false);

    if (failed > 0 && firstError !== undefined) {
        throw new CliError('', 1, firstError.code, firstError.zipCode !== undefined ? { zipCode: firstError.zipCode } : undefined);
    }
}

export async function batch(args: ParsedArgs): Promise<void> {
    const inputDir = getStringFlag(args.flags, 'input-dir');
    const outputDir = getStringFlag(args.flags, 'output-dir');

    // Manifest mode — mutually exclusive with the directory mode.
    const manifestPath = getStringFlag(args.flags, 'manifest');
    if (manifestPath !== undefined) {
        if (inputDir !== undefined || outputDir !== undefined) {
            throw new CliError(
                '--manifest is mutually exclusive with --input-dir/--output-dir.',
                2,
            );
        }
        await runManifest(manifestPath, args);
        return;
    }

    const format = parseBatchFormat(args);
    const task = getStringFlag(args.flags, 'task') ?? 'create';
    if (task !== 'create' && task !== 'verify') {
        throw new CliError(`--task must be "create" or "verify", got "${task}".`, 2);
    }
    const failFast = hasFlag(args.flags, 'fail-fast');
    const dryRun = hasFlag(args.flags, 'dry-run') || isDryRun();

    if (inputDir === undefined) {
        throw new CliError('batch requires --input-dir <dir> (or --manifest <file>).', 2);
    }
    if (task === 'create' && outputDir === undefined) {
        throw new CliError('batch --task create requires --output-dir <dir>.', 2);
    }

    const concurrencyRaw = getStringFlag(args.flags, 'concurrency');
    let concurrency = 4;
    if (concurrencyRaw !== undefined) {
        const n = Number.parseInt(concurrencyRaw, 10);
        if (!Number.isInteger(n) || n < 1) {
            throw new CliError('--concurrency must be a positive integer.', 2);
        }
        concurrency = n;
    }

    let names: string[];
    try {
        names = (await readdir(inputDir)).sort();
    } catch {
        throw new CliError(`Cannot read --input-dir: ${inputDir}`, 1, ErrorCode.IO);
    }

    const results: FileResult[] = [];
    let aborted = false;

    if (task === 'create') {
        const dirs: string[] = [];
        for (const n of names) {
            try {
                if ((await stat(join(inputDir, n))).isDirectory()) dirs.push(n);
            } catch {
                // unreadable entry — skipped
            }
        }
        if (dirs.length === 0) {
            throw new CliError(`No subdirectories found in ${inputDir}.`, 1, ErrorCode.INPUT);
        }
        if (!dryRun) await mkdir(outputDir as string, { recursive: true });

        await runPool(dirs, concurrency, async (dir) => {
            if (aborted) return;
            const input = join(inputDir, dir);
            const output = join(outputDir as string, `${dir}.zip`);
            try {
                await create(forwardedFlags(args, input, output));
                results.push({ input, output, ok: true, error: null });
                progress(`${style('✓', 'green')} ${dir}/ → ${basename(output)}`);
            } catch (e) {
                const error = e instanceof Error ? e.message : String(e);
                results.push({ input, output, ok: false, error, ...(e instanceof CliError ? { code: e.code } : {}) });
                progress(`${style('✗', 'red')} ${dir}/: ${error}`);
                if (failFast) aborted = true;
            }
        });
    } else {
        await prepareEngine(args);
        const zips = names.filter((n) => extname(n).toLowerCase() === '.zip');
        if (zips.length === 0) {
            throw new CliError(`No .zip files found in ${inputDir}.`, 1, ErrorCode.INPUT);
        }
        const limits = parseLimitFlags(args);
        await runPool(zips, concurrency, async (file) => {
            if (aborted) return;
            const input = join(inputDir, file);
            if (dryRun) {
                results.push({ input, ok: true, error: null });
                return;
            }
            try {
                const buf = await readFile(input);
                const report = guard('Verification failed', () => verifyZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), limits !== undefined ? { limits } : undefined));
                if (report.ok) {
                    results.push({ input, ok: true, error: null });
                    progress(`${style('✓', 'green')} ${file}`);
                } else {
                    const failedEntries = report.entries.filter((e) => e.skipped === undefined && !e.ok).length;
                    const error = report.error !== null ? `${report.error.code}: ${report.error.message}` : `${failedEntries} entries failed verification`;
                    results.push({ input, ok: false, error, code: ErrorCode.VERIFY_FAILED });
                    progress(`${style('✗', 'red')} ${file}: ${error}`);
                    if (failFast) aborted = true;
                }
            } catch (e) {
                const error = e instanceof Error ? e.message : String(e);
                results.push({ input, ok: false, error, ...(e instanceof CliError ? { code: e.code } : {}) });
                progress(`${style('✗', 'red')} ${file}: ${error}`);
                if (failFast) aborted = true;
            }
        });
    }

    results.sort((a, b) => (a.input < b.input ? -1 : a.input > b.input ? 1 : 0));
    const failures = results.filter((r) => !r.ok).length;
    const succeeded = results.length - failures;
    const total = results.length;

    if (format === 'json') {
        const summary = hasFlag(args.flags, 'summary');
        const fieldsRaw = getStringFlag(args.flags, 'fields');
        const base = { ok: failures === 0, command: 'batch', mode: 'directory', task, ...(dryRun ? { dryRun: true } : {}), total, succeeded, failed: failures };
        let out: unknown = summary ? base : { ...base, results };
        if (fieldsRaw !== undefined) {
            out = selectFields(out, parseFieldList(fieldsRaw));
        }
        const pretty = hasFlag(args.flags, 'pretty') || !isJsonMode();
        process.stdout.write(serializeJson(out, pretty) + '\n');
    } else if (dryRun) {
        process.stdout.write(`Dry run: ${total} ${task === 'create' ? 'director' + (total === 1 ? 'y' : 'ies') : 'archive(s)'} planned, nothing ${task === 'create' ? 'written' : 'verified'}.\n`);
    } else {
        process.stdout.write(`${task === 'create' ? 'Created' : 'Verified'} ${succeeded}/${total} ${task === 'create' ? 'archive(s)' : 'archive(s)'}, ${failures} failed.\n`);
    }

    if (failures > 0) {
        const first = results.find((r) => !r.ok);
        throw new CliError('', 1, first?.code ?? ErrorCode.RUNTIME);
    }
}
