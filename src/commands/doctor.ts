// `zipnative doctor` — environment / capability preflight.
//
// A zero-dependency, offline self-check for humans (onboarding) and agents
// (pre-flight before attempting an operation). Reports the CLI version, Node
// version, the resolved `zipnative` version (package vs the engine's own
// `VERSION` export), the active deflate tiers, streaming codec availability,
// worker-thread availability for `create --parallel`, registered codecs, the
// effective security limits and the registered command count. Text by
// default; `--format json` / `--json` emits `{ ok, checks: [...] }`.
// Exit code 0 when all checks pass, 1 otherwise.

import { createRequire } from 'node:module';
import type { ParsedArgs } from '../utils/args.js';
import { hasFlag } from '../utils/args.js';
import { isJsonMode } from '../utils/agent.js';
import { serializeJson } from '../utils/projection.js';
import { cliVersion, engineVersion } from '../utils/version.js';
import { COMMANDS } from './completion.js';
import {
    DEFAULT_ZIP_LIMITS,
    METHOD_DEFLATE,
    METHOD_STORE,
    VERSION,
    activeDeflateTier,
    getCodec,
} from '../core-bridge/index.js';
import { loadedCodecModules } from '../utils/codecs.js';
import { prepareEngine, isPureCodecs } from '../utils/engine.js';
import { LIMIT_FLAGS, effectiveLimits, formatLimitValue } from '../utils/limits.js';
import { parseLimitFlags } from '../utils/limits.js';
import { parseFormat } from '../utils/zipops.js';

type CheckStatus = 'ok' | 'warn' | 'error';

interface Check {
    readonly name: string;
    readonly status: CheckStatus;
    readonly value: string;
    readonly detail: string;
}

const MIN_NODE_MAJOR = 22;

function nodeCheck(): Check {
    const raw = process.versions.node;
    const major = Number.parseInt(raw.split('.')[0] ?? '0', 10);
    const ok = Number.isInteger(major) && major >= MIN_NODE_MAJOR;
    return {
        name: 'node',
        status: ok ? 'ok' : 'error',
        value: `v${raw}`,
        detail: `>= ${MIN_NODE_MAJOR} required`,
    };
}

function engineCheck(): Check {
    const pkg = engineVersion();
    if (pkg === 'unknown') {
        return { name: 'zipnative', status: 'error', value: 'not found', detail: 'engine (sole runtime dependency)' };
    }
    const agree = pkg === VERSION;
    return {
        name: 'zipnative',
        status: agree ? 'ok' : 'warn',
        value: pkg,
        detail: agree ? 'engine (sole runtime dependency)' : `package ${pkg} but VERSION export is ${VERSION}`,
    };
}

function tierChecks(pure: boolean): Check[] {
    const tier = activeDeflateTier(false);
    const pinned = activeDeflateTier(true);
    return [
        {
            name: 'deflate-tier',
            status: tier === 'node-zlib' || tier === 'injected' ? 'ok' : pure ? 'ok' : 'warn',
            value: tier,
            detail: pure ? 'pure-TS tier requested (--pure-codecs)' : 'sync deflate/inflate tier (node-zlib expected)',
        },
        {
            name: 'deflate-pinned',
            status: 'ok',
            value: pinned,
            detail: 'tier used under --deterministic (byte-identical on every runtime)',
        },
    ];
}

function streamingCodecCheck(): Check {
    const g = globalThis as { CompressionStream?: unknown; DecompressionStream?: unknown };
    const comp = typeof g.CompressionStream === 'function';
    const decomp = typeof g.DecompressionStream === 'function';
    return {
        name: 'web-streams',
        status: comp && decomp ? 'ok' : 'warn',
        value: comp && decomp ? 'available' : comp || decomp ? 'partial' : 'missing',
        detail: `CompressionStream=${comp}, DecompressionStream=${decomp} (platform streaming codecs used by readEntryStream / extract)`,
    };
}

async function workersCheck(): Promise<Check> {
    try {
        const wt = await import('node:worker_threads');
        const require = createRequire(import.meta.url);
        const script = require.resolve('zipnative/worker/zip-worker.js');
        const os = await import('node:os');
        const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
        const defaultWorkers = Math.max(1, Math.min(cores - 1, 8));
        return {
            name: 'workers',
            status: typeof wt.Worker === 'function' ? 'ok' : 'warn',
            value: `${defaultWorkers} default`,
            detail: `create --parallel: ${cores} cores, worker script ${script}`,
        };
    } catch (e) {
        return {
            name: 'workers',
            status: 'warn',
            value: 'unavailable',
            detail: `create --parallel falls back to the calling thread: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}

function codecsCheck(): Check {
    const builtin = [METHOD_STORE, METHOD_DEFLATE]
        .map((m) => `${m}=${getCodec(m)?.name ?? '?'}`)
        .join(', ');
    const extra = loadedCodecModules().flatMap((m) => m.codecs.map((c) => `${c.method}=${c.name}`));
    const all = extra.length > 0 ? `${builtin}, ${extra.join(', ')}` : builtin;
    return {
        name: 'codecs',
        status: 'ok',
        value: String(2 + extra.length),
        detail: `registered methods: ${all}`,
    };
}

function limitsCheck(args: ParsedArgs): Check {
    const overrides = parseLimitFlags(args);
    const effective = effectiveLimits(overrides);
    const parts = LIMIT_FLAGS.map((l) => `${l.key}=${formatLimitValue(l, effective[l.key])}`);
    const custom = overrides !== undefined ? Object.keys(overrides).length : 0;
    return {
        name: 'limits',
        status: 'ok',
        value: custom > 0 ? `${custom} override(s)` : 'defaults',
        detail: parts.join('; '),
    };
}

async function buildChecks(args: ParsedArgs): Promise<Check[]> {
    const pure = isPureCodecs(args);
    return [
        { name: 'cli', status: 'ok', value: cliVersion(), detail: 'zipnative-cli version' },
        nodeCheck(),
        engineCheck(),
        ...tierChecks(pure),
        streamingCodecCheck(),
        await workersCheck(),
        codecsCheck(),
        limitsCheck(args),
        { name: 'commands', status: 'ok', value: String(COMMANDS.length), detail: 'registered commands' },
    ];
}

export async function doctor(args: ParsedArgs): Promise<void> {
    await prepareEngine(args);
    const checks = await buildChecks(args);
    const ok = checks.every((c) => c.status !== 'error');

    const format = parseFormat(args, ['text', 'json'] as const, 'text');
    const jsonOut = format === 'json' || isJsonMode() || hasFlag(args.flags, 'json');

    if (jsonOut) {
        const pretty = hasFlag(args.flags, 'pretty') || !isJsonMode();
        const payload = {
            ok,
            checks: checks.map((c) => ({ name: c.name, status: c.status, value: c.value, detail: c.detail })),
        };
        process.stdout.write(serializeJson(payload, pretty) + '\n');
    } else {
        const lines = ['zipnative-cli doctor', ''];
        for (const c of checks) {
            const mark = c.status === 'ok' ? 'ok  ' : c.status === 'warn' ? 'warn' : 'FAIL';
            lines.push(`  ${c.name.padEnd(16)}${c.value.padEnd(22)}${mark}  (${c.detail})`);
        }
        lines.push('', ok ? 'All checks passed.' : 'One or more checks FAILED.');
        process.stdout.write(lines.join('\n') + '\n');
    }

    if (!ok) process.exitCode = 1;
}

/** Defaults exposed for `schema limits` / docs (avoids importing the bridge there). */
export const LIMIT_DEFAULTS = DEFAULT_ZIP_LIMITS;
