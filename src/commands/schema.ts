// `zipnative schema [subject]` — print a JSON Schema for a CLI input/output
// shape so autonomous agents (and humans) can self-validate before invoking
// the CLI.
//
// Schemas are CLI-scoped: they describe the TOP-LEVEL shape the CLI accepts or
// emits. They are hand-authored and versioned via a `$id` that embeds the CLI
// version, so drift is detectable and a test pins the contract.
//
// Philosophy: zero runtime deps, pure data. No validation engine is bundled —
// the CLI only PRODUCES schemas; callers validate with their own tooling.

import type { ParsedArgs } from '../utils/args.js';
import { CliError, ErrorCode } from '../utils/error.js';
import { cliVersion, engineVersion } from '../utils/version.js';
import { LIMIT_FLAGS } from '../utils/limits.js';
import { ZIP_REMEDY } from '../utils/agent.js';
import { ZIP_DIAGNOSTIC_CODES, ZIP_TO_CLI } from '../utils/ziperr.js';
import { MANIFEST_COMMANDS } from '../utils/manifest.js';
import { PROJECTED_COMMANDS } from '../utils/projection.js';
import { DEFAULT_ZIP_LIMITS } from '../core-bridge/index.js';
import { COMMANDS, DRY_RUN_COMMANDS, GLOBAL_FLAGS } from './completion.js';

type JsonSchema = Readonly<Record<string, unknown>>;

export const SUBJECTS = [
    'create-manifest',
    'modify-manifest',
    'batch-manifest',
    'entries',
    'entries-summary',
    'inspect',
    'inspect-summary',
    'verify',
    'verify-summary',
    'stream',
    'stream-summary',
    'batch',
    'batch-summary',
    'doctor',
    'govern-verify',
    'crc32',
    'status',
    'error',
    'errors',
    'limits',
    'diagnostics',
    'manifest',
] as const;
export type Subject = (typeof SUBJECTS)[number];

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const ID_BASE = 'https://zipnative.dev/schema/cli';

function id(subject: Subject): string {
    return `${ID_BASE}/${cliVersion()}/${subject}.schema.json`;
}

const ERROR_CODES = Object.values(ErrorCode);
const ZIP_CODES = Object.keys(ZIP_TO_CLI);
const SEVERITIES = ['warning', 'info'];

const compressionProps = {
    method: { enum: ['store', 'deflate'] },
    level: { type: 'integer', minimum: 0, maximum: 9 },
    deterministic: { type: 'boolean', description: 'Pin the pure-TS deflate encoder (byte-identical on every runtime).' },
};

const diagnosticSchema: JsonSchema = {
    type: 'object',
    required: ['code', 'severity', 'message'],
    additionalProperties: false,
    properties: {
        code: { enum: [...ZIP_DIAGNOSTIC_CODES] },
        severity: { enum: SEVERITIES },
        message: { type: 'string' },
        entryName: { type: 'string' },
    },
};

const entryRowSchema: JsonSchema = {
    type: 'object',
    title: 'EntryRow',
    required: ['name', 'nameEncoding', 'isDirectory', 'isSymlink', 'method', 'methodName', 'compressedSize', 'uncompressedSize', 'ratio', 'crc32', 'lastModified', 'isEncrypted', 'usesZip64', 'usesDataDescriptor', 'unixMode'],
    properties: {
        name: { type: 'string' },
        nameEncoding: { enum: ['utf-8', 'cp437'] },
        isDirectory: { type: 'boolean' },
        isSymlink: { type: ['boolean', 'null'], description: 'null in forward (stream) mode — attributes live only in the central directory.' },
        method: { type: 'integer' },
        methodName: { type: 'string' },
        compressedSize: { type: 'integer' },
        uncompressedSize: { type: 'integer' },
        ratio: { type: 'string', description: 'Space saved, e.g. "64%".' },
        crc32: { type: 'string', pattern: '^[0-9a-f]{8}$' },
        lastModified: { type: 'string', format: 'date-time' },
        isEncrypted: { type: 'boolean' },
        usesZip64: { type: ['boolean', 'null'] },
        usesDataDescriptor: { type: 'boolean' },
        unixMode: { type: ['string', 'null'], pattern: '^[0-7]{4}$', description: 'Four octal digits — setuid/setgid/sticky digit then permissions, e.g. "0644", "4755"; null when not Unix-authored.' },
        comment: { type: 'string' },
        flags: {
            type: 'object',
            description: 'Present with --long.',
            properties: { raw: { type: 'integer' }, encrypted: { type: 'boolean' }, dataDescriptor: { type: 'boolean' }, strongEncryption: { type: 'boolean' }, utf8: { type: 'boolean' } },
        },
        versionMadeBy: { type: 'integer' },
        versionNeeded: { type: 'integer' },
        internalAttributes: { type: 'integer' },
        externalAttributes: { type: 'integer' },
        localHeaderOffset: { type: 'integer' },
        dosDate: { type: 'integer' },
        dosTime: { type: 'integer' },
        extraFields: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'integer' }, idHex: { type: 'string' }, name: { type: ['string', 'null'] }, length: { type: 'integer' }, hex: { type: 'string' } } },
        },
        rawNameHex: { type: 'string', pattern: '^([0-9a-f]{2})*$', description: 'Present with --long: the stored name bytes (cp437 / invalid-UTF-8 forensics).' },
        commentHex: { type: 'string', pattern: '^([0-9a-f]{2})*$', description: 'Present with --long when the entry has a comment: its raw bytes.' },
    },
};

/** Manifest `extraFields` item: `{ id, hex | base64 }` (create entries, modify add/replace/add-dir). */
const extraFieldsInputSchema: JsonSchema = {
    type: 'array',
    description: 'Raw extra fields written verbatim: id (0-65535 or "0x5455") plus exactly one of hex / base64 (at most 65531 bytes each).',
    items: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
            id: { anyOf: [{ type: 'integer', minimum: 0, maximum: 65535 }, { type: 'string', pattern: '^0x[0-9a-fA-F]{1,4}$' }] },
            hex: { type: 'string', pattern: '^([0-9a-fA-F]{2})*$' },
            base64: { type: 'string' },
        },
    },
};

function createManifestSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('create-manifest'),
        title: 'zipnative-cli create manifest',
        description: 'Input for `zipnative create --from-manifest`. Relative "path" values resolve against the manifest file\'s directory. Every name is checked with the engine\'s sanitizeEntryPath().',
        type: 'object',
        required: ['entries'],
        additionalProperties: false,
        properties: {
            version: { const: 1 },
            comment: { type: 'string' },
            commentBase64: { type: 'string', description: 'Raw archive comment bytes (exclusive with comment; at most 65535 bytes).' },
            order: { enum: ['canonical', 'insertion'], description: 'insertion = the manifest order (first entry first, e.g. an EPUB mimetype).' },
            date: { type: 'string', description: '"epoch" (default), "now", or an ISO 8601 date (UTC wall-clock).' },
            compression: { type: 'object', additionalProperties: false, properties: compressionProps },
            entries: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['name'],
                    additionalProperties: false,
                    properties: {
                        name: { type: 'string', minLength: 1 },
                        path: { type: 'string', description: 'File to read (exactly one of path / data / dataBase64 for files).' },
                        data: { type: 'string', description: 'Inline UTF-8 content.' },
                        dataBase64: { type: 'string', description: 'Inline base64 content.' },
                        directory: { type: 'boolean', description: 'Explicit directory entry (no payload).' },
                        ...compressionProps,
                        date: { type: 'string' },
                        comment: { type: 'string' },
                        mode: { type: 'string', pattern: '^0?[0-7]{3,4}$', description: 'POSIX mode, octal (e.g. "0755").' },
                        extraFields: extraFieldsInputSchema,
                    },
                },
            },
        },
    };
}

function modifyManifestSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('modify-manifest'),
        title: 'zipnative-cli modify manifest',
        description: 'Input for `zipnative modify --from-manifest`. Edits are applied in a fixed order: remove → rename → replace → add / add-dir → comment.',
        type: 'object',
        required: ['edits'],
        additionalProperties: false,
        properties: {
            version: { const: 1 },
            comment: { type: 'string' },
            commentBase64: { type: 'string', description: 'Raw archive comment bytes (exclusive with comment; at most 65535 bytes).' },
            edits: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['op', 'name'],
                    additionalProperties: false,
                    properties: {
                        op: { enum: ['add', 'replace', 'remove', 'rename', 'add-dir'] },
                        name: { type: 'string', minLength: 1 },
                        to: { type: 'string', description: 'rename target' },
                        path: { type: 'string' },
                        data: { type: 'string' },
                        dataBase64: { type: 'string' },
                        ...compressionProps,
                        date: { type: 'string', format: 'date-time' },
                        comment: { type: 'string' },
                        mode: { type: 'string', pattern: '^0?[0-7]{3,4}$', description: 'POSIX mode, octal (add / replace / add-dir).' },
                        extraFields: extraFieldsInputSchema,
                    },
                },
            },
        },
    };
}

function batchManifestSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('batch-manifest'),
        title: 'zipnative-cli batch manifest',
        description: 'Input for `zipnative batch --manifest`. Flag values "@<id>" reference the output (or output-dir) of an EARLIER task. Relative paths resolve against the manifest file\'s directory. Tasks run sequentially, fail-fast by default. A "codec" flag inside a manifest additionally requires --allow-codec-load on the command line.',
        type: 'object',
        required: ['version', 'tasks'],
        additionalProperties: false,
        properties: {
            version: { const: 1 },
            tasks: {
                type: 'array',
                minItems: 1,
                maxItems: 1000,
                items: {
                    type: 'object',
                    required: ['id', 'command'],
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
                        command: { enum: [...MANIFEST_COMMANDS] },
                        flags: {
                            type: 'object',
                            additionalProperties: {
                                anyOf: [
                                    { type: 'string' },
                                    { type: 'number' },
                                    { type: 'boolean' },
                                    { type: 'array', items: { type: 'string' } },
                                ],
                            },
                        },
                    },
                },
            },
        },
    };
}

function entriesSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('entries'),
        title: 'zipnative-cli list output',
        description: 'JSON emitted by `zipnative list --format json` (one EntryRow per line for --format ndjson).',
        type: 'object',
        required: ['archive', 'entries', 'diagnostics'],
        additionalProperties: false,
        properties: {
            archive: {
                type: 'object',
                required: ['bytes', 'entryCount', 'isZip64', 'comment', 'commentBytes'],
                properties: { bytes: { type: 'integer' }, entryCount: { type: 'integer' }, isZip64: { type: 'boolean' }, comment: { type: 'string' }, commentBytes: { type: 'integer' }, commentHex: { type: 'string', description: 'Present when commentBytes > 0: the raw comment bytes.' } },
            },
            entries: { type: 'array', items: entryRowSchema },
            diagnostics: { type: 'array', items: diagnosticSchema },
        },
    };
}

function entriesSummarySchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('entries-summary'),
        title: 'zipnative-cli list --summary output',
        type: 'object',
        required: ['entries', 'files', 'directories', 'compressedSize', 'uncompressedSize', 'zip64', 'encrypted'],
        additionalProperties: false,
        properties: {
            entries: { type: 'integer' }, files: { type: 'integer' }, directories: { type: 'integer' },
            compressedSize: { type: 'integer' }, uncompressedSize: { type: 'integer' },
            zip64: { type: 'boolean' }, encrypted: { type: 'integer' },
        },
    };
}

function inspectSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('inspect'),
        title: 'zipnative-cli inspect output',
        description: 'JSON emitted by `zipnative inspect --format json`.',
        type: 'object',
        required: ['archive', 'stats', 'determinism', 'diagnostics'],
        additionalProperties: false,
        properties: {
            archive: {
                type: 'object',
                required: ['bytes', 'entryCount', 'isZip64', 'comment', 'commentBytes', 'prependedData', 'multipleEocd'],
                properties: {
                    bytes: { type: 'integer' }, entryCount: { type: 'integer' }, isZip64: { type: 'boolean' },
                    comment: { type: 'string' }, commentBytes: { type: 'integer' },
                    prependedData: { type: 'boolean' }, multipleEocd: { type: 'boolean' },
                },
            },
            stats: {
                type: 'object',
                required: ['files', 'directories', 'compressedSize', 'uncompressedSize', 'ratio', 'methods', 'encrypted', 'symlinks', 'dataDescriptor', 'zip64Entries', 'utf8Names', 'cp437Names', 'duplicateNames', 'unsafeNames', 'earliestDate', 'latestDate'],
                properties: {
                    files: { type: 'integer' }, directories: { type: 'integer' },
                    compressedSize: { type: 'integer' }, uncompressedSize: { type: 'integer' }, ratio: { type: 'string' },
                    methods: { type: 'object', additionalProperties: { type: 'integer' }, description: 'method id → entry count' },
                    encrypted: { type: 'integer' }, symlinks: { type: 'integer' }, dataDescriptor: { type: 'integer' },
                    zip64Entries: { type: 'integer' }, utf8Names: { type: 'integer' }, cp437Names: { type: 'integer' },
                    unsafeNames: { type: 'integer', description: 'Entry names the engine\'s sanitizeEntryPath() refuses (what extract would refuse without --skip-unsafe).' },
                    duplicateNames: { type: 'integer' },
                    earliestDate: { type: ['string', 'null'] }, latestDate: { type: ['string', 'null'] },
                },
            },
            determinism: {
                type: 'object',
                required: ['epochTimestamps', 'canonicalOrder', 'utf8Flags', 'noDataDescriptors', 'canonicalLayout', 'deterministic'],
                properties: {
                    epochTimestamps: { type: 'boolean' }, canonicalOrder: { type: 'boolean' }, utf8Flags: { type: 'boolean' },
                    noDataDescriptors: { type: 'boolean' },
                    canonicalLayout: { type: 'boolean', description: 'No data descriptors (buffered layout). A streamed archive is reproducible but not canonical.' },
                    deterministic: { type: 'boolean', description: 'Reproducible: epoch timestamps AND canonical order AND UTF-8 flags (layout excluded).' },
                },
            },
            entries: { type: 'array', items: entryRowSchema, description: 'Present with --entries / --entry.' },
            diagnostics: { type: 'array', items: diagnosticSchema },
            checks: {
                type: 'array',
                description: 'Present with --check.',
                items: { type: 'object', required: ['check', 'ok', 'detail'], properties: { check: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } } },
            },
        },
    };
}

function inspectSummarySchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('inspect-summary'),
        title: 'zipnative-cli inspect --summary output',
        type: 'object',
        required: ['entries', 'bytes', 'uncompressedSize', 'zip64', 'encrypted', 'deterministic', 'canonicalLayout', 'diagnostics'],
        additionalProperties: false,
        properties: {
            entries: { type: 'integer' }, bytes: { type: 'integer' }, uncompressedSize: { type: 'integer' },
            zip64: { type: 'boolean' }, encrypted: { type: 'integer' }, deterministic: { type: 'boolean' },
            canonicalLayout: { type: 'boolean' },
            diagnostics: { type: 'integer' }, checksPassed: { type: 'boolean' },
        },
    };
}

function verifySchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('verify'),
        title: 'zipnative-cli verify output',
        description: 'JSON emitted by `zipnative verify --format json` — zipnative\'s ZipVerificationReport plus CLI counters. Exit 1 / E_VERIFY_FAILED when ok is false.',
        type: 'object',
        required: ['ok', 'error', 'entryCount', 'entries', 'diagnostics', 'failed', 'skipped', 'strict'],
        additionalProperties: false,
        properties: {
            ok: { type: 'boolean' },
            error: { type: ['object', 'null'], properties: { code: { enum: ZIP_CODES }, message: { type: 'string' } } },
            entryCount: { type: 'integer' },
            entries: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['name', 'ok', 'crcMatch', 'sizeMatch', 'localHeaderMatch'],
                    properties: {
                        name: { type: 'string' }, ok: { type: 'boolean' }, crcMatch: { type: 'boolean' },
                        sizeMatch: { type: 'boolean' }, localHeaderMatch: { type: 'boolean' },
                        skipped: { enum: ['encrypted', 'stream-only-codec'] },
                    },
                },
            },
            diagnostics: { type: 'array', items: diagnosticSchema },
            failed: { type: 'integer' },
            skipped: { type: 'integer' },
            strict: { type: 'boolean' },
            selected: { type: 'array', items: { type: 'string' }, description: 'Present under --entry: the names verified; entries lists only those.' },
        },
    };
}

function verifySummarySchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('verify-summary'),
        title: 'zipnative-cli verify --summary output',
        type: 'object',
        required: ['ok', 'entries', 'failed', 'skipped', 'diagnostics'],
        additionalProperties: false,
        properties: {
            ok: { type: 'boolean' }, entries: { type: 'integer' }, failed: { type: 'integer' },
            skipped: { type: 'integer' }, diagnostics: { type: 'integer' }, selected: { type: 'integer' }, error: { enum: ZIP_CODES },
        },
    };
}

function streamSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('stream'),
        title: 'zipnative-cli stream --format json output',
        description: 'Forward-mode listing. trust is always "local-headers-only": no central directory was consulted.',
        type: 'object',
        required: ['mode', 'trust', 'entries', 'diagnostics'],
        additionalProperties: false,
        properties: {
            mode: { const: 'list' },
            trust: { const: 'local-headers-only' },
            entries: { type: 'array', items: entryRowSchema },
            diagnostics: { type: 'array', items: diagnosticSchema },
        },
    };
}

function streamSummarySchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('stream-summary'),
        title: 'zipnative-cli stream --summary output',
        type: 'object',
        required: ['entries', 'bytes', 'descriptorEntries', 'bytesKnown', 'trust'],
        additionalProperties: false,
        properties: {
            entries: { type: 'integer' },
            bytes: { type: 'integer', description: 'Sum of the local-header sizes — excludes data-descriptor entries, whose local header carries zeros.' },
            descriptorEntries: { type: 'integer', description: 'Entries whose sizes trail the payload (flag bit 3); their bytes are not counted.' },
            bytesKnown: { type: 'boolean', description: 'true when descriptorEntries is 0, i.e. bytes is exact.' },
            trust: { const: 'local-headers-only' },
        },
    };
}

function batchSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('batch'),
        title: 'zipnative-cli batch output',
        description: 'JSON emitted by `zipnative batch --format json` (directory mode or manifest mode).',
        type: 'object',
        required: ['ok', 'command', 'mode', 'total', 'succeeded', 'failed'],
        properties: {
            ok: { type: 'boolean' },
            command: { const: 'batch' },
            mode: { enum: ['directory', 'manifest'] },
            task: { enum: ['create', 'verify'] },
            dryRun: { type: 'boolean' },
            total: { type: 'integer' }, succeeded: { type: 'integer' }, failed: { type: 'integer' }, skipped: { type: 'integer' },
            results: {
                type: 'array',
                items: { type: 'object', required: ['input', 'ok', 'error'], properties: { input: { type: 'string' }, output: { type: 'string' }, ok: { type: 'boolean' }, error: { type: ['string', 'null'] }, code: { enum: ERROR_CODES } } },
            },
            tasks: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['id', 'command', 'ok'],
                    properties: {
                        id: { type: 'string' }, command: { type: 'string' }, ok: { type: 'boolean' }, output: { type: 'string' },
                        skipped: { const: true },
                        error: { type: 'object', required: ['code', 'message'], properties: { code: { enum: ERROR_CODES }, message: { type: 'string' }, zipCode: { enum: ZIP_CODES }, remedy: { type: 'string' } } },
                        report: { description: 'JSON mode only: what the task wrote to stdout, parsed (an object, or an array of objects for NDJSON).' },
                        stdout: { type: 'string', description: 'JSON mode only: the task\'s stdout when it was not JSON (text output).' },
                        stdoutBytes: { type: 'integer', description: 'JSON mode only: bytes the task wrote to stdout (captured, never interleaved with the batch document).' },
                    },
                },
            },
        },
    };
}

function batchSummarySchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('batch-summary'),
        title: 'zipnative-cli batch --summary output',
        type: 'object',
        required: ['ok', 'command', 'mode', 'total', 'succeeded', 'failed'],
        properties: {
            ok: { type: 'boolean' }, command: { const: 'batch' }, mode: { enum: ['directory', 'manifest'] }, task: { enum: ['create', 'verify'] },
            dryRun: { type: 'boolean' }, total: { type: 'integer' }, succeeded: { type: 'integer' }, failed: { type: 'integer' }, skipped: { type: 'integer' },
        },
    };
}

function doctorSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('doctor'),
        title: 'zipnative-cli doctor output',
        type: 'object',
        required: ['ok', 'checks'],
        additionalProperties: false,
        properties: {
            ok: { type: 'boolean' },
            checks: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['name', 'status', 'value', 'detail'],
                    properties: {
                        name: { enum: ['cli', 'node', 'zipnative', 'deflate-tier', 'deflate-pinned', 'web-streams', 'workers', 'codecs', 'limits', 'commands'] },
                        status: { enum: ['ok', 'warn', 'error'] },
                        value: { type: 'string' },
                        detail: { type: 'string' },
                        data: { type: 'object', description: 'Machine-readable payload; `limits` carries the effective bounds (ZipLimits keys + maxInputSize; "none" when disabled).' },
                    },
                },
            },
        },
    };
}

function governVerifySchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('govern-verify'),
        title: 'zipnative-cli govern verify-issue output',
        type: 'object',
        required: ['ok', 'errors', 'warnings'],
        additionalProperties: false,
        properties: {
            ok: { type: 'boolean' },
            errors: { type: 'array', items: { type: 'string' } },
            warnings: { type: 'array', items: { type: 'string' } },
        },
    };
}

function crc32Schema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('crc32'),
        title: 'zipnative-cli crc32 --format json output',
        type: 'object',
        required: ['files'],
        additionalProperties: false,
        properties: {
            files: {
                type: 'array',
                items: { type: 'object', required: ['file', 'crc32', 'value', 'bytes'], properties: { file: { type: 'string' }, crc32: { type: 'string', pattern: '^[0-9a-f]{8}$' }, value: { type: 'integer' }, bytes: { type: 'integer' } } },
            },
            expect: { type: 'string', pattern: '^[0-9a-f]{8}$' },
        },
    };
}

function statusSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('status'),
        title: 'zipnative-cli --json success status envelope',
        description: 'One JSON line on stderr after a successful run (or --dry-run) of create, modify, extract, stream, cat, inflate, or after crc32. Fields beyond the required ones are command-specific (documented in AGENTS.md).',
        type: 'object',
        required: ['ok', 'command'],
        properties: {
            ok: { const: true },
            command: { enum: ['create', 'modify', 'extract', 'stream', 'cat', 'inflate', 'crc32'] },
            dryRun: { type: 'boolean' },
            output: { type: 'string' },
            outputDir: { type: 'string' },
            bytes: { type: 'integer' },
            bytesIn: { type: 'integer' },
            bytesConsumed: { type: 'integer', description: 'inflate: compressed bytes the stream occupied (bytesIn minus leftover on the streaming path).' },
            bytesOut: { type: 'integer' },
            entries: { anyOf: [{ type: 'integer' }, { type: 'array', items: { type: 'string' } }] },
            files: { type: 'integer' },
            directories: { type: 'integer' },
            tier: { enum: ['pure-pinned', 'injected', 'node-zlib', 'pure'] },
            layout: { enum: ['buffered', 'data-descriptor', 'append-only', 'compact'], description: 'create: buffered | data-descriptor (streamed entries); modify: append-only | compact.' },
            verified: { type: 'integer', description: 'modify: untouched entries verified (CRC, sizes, local header) before being re-emitted verbatim.' },
            verifySkipped: { type: 'integer', description: 'modify: untouched entries that could not be verified (encrypted, or a stream-only codec) and were re-emitted as-is.' },
            changed: { type: 'boolean' },
            trust: { const: 'local-headers-only' },
            skipped: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } } } },
            diagnostics: { type: 'array', items: diagnosticSchema },
        },
    };
}

function errorSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('error'),
        title: 'zipnative-cli --json error envelope',
        description: 'One JSON line on stderr on any failure under --json. Branch on error.code for the class and on error.zipCode (zipnative\'s frozen code, verbatim) for the exact cause.',
        type: 'object',
        required: ['ok', 'command', 'error'],
        additionalProperties: false,
        properties: {
            ok: { const: false },
            command: { type: ['string', 'null'] },
            error: {
                type: 'object',
                required: ['code', 'message'],
                additionalProperties: false,
                properties: {
                    code: { enum: ERROR_CODES },
                    message: { type: 'string' },
                    zipCode: { enum: ZIP_CODES },
                    entryName: { type: 'string' },
                    detail: {
                        type: 'object',
                        description: 'Code-specific: { limit, configured, observed } (E_LIMIT), { feature } (E_UNSUPPORTED), { expectedCrc, actualCrc } (E_DATA / E_CHECK_FAILED).',
                        additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
                    },
                    remedy: {
                        type: 'string',
                        description: 'The CLI flag(s) or command that lift this refusal (e.g. "--skip-unsafe (extract, stream)", "--overwrite"); absent when nothing does. Apply it only for trusted input.',
                    },
                },
            },
        },
    };
}

function errorsDocument(): JsonSchema {
    const zip: Record<string, { code: string; exitCode: number; remedy?: string }> = {};
    for (const [k, [code, exitCode]] of Object.entries(ZIP_TO_CLI)) {
        const remedy = Object.hasOwn(ZIP_REMEDY, k) ? ZIP_REMEDY[k as keyof typeof ZIP_REMEDY] : undefined;
        zip[k] = { code, exitCode, ...(remedy !== undefined ? { remedy } : {}) };
    }
    return {
        $id: `${ID_BASE}/${cliVersion()}/errors.json`,
        kind: 'error-codes',
        name: 'zipnative-cli',
        version: cliVersion(),
        zipnative: engineVersion(),
        cli: ERROR_CODES.map((c) => ({ code: c, exitCode: c === ErrorCode.USAGE ? 2 : 1 })),
        zipnativeToCli: zip,
        diagnostics: [...ZIP_DIAGNOSTIC_CODES],
    };
}

function limitsSchema(): JsonSchema {
    const props: Record<string, unknown> = {};
    for (const l of LIMIT_FLAGS) {
        props[l.key] = {
            type: 'number',
            minimum: 1,
            default: DEFAULT_ZIP_LIMITS[l.key],
            description: `${l.description} (${l.cwe}); flag --${l.flag}; "none" disables the bound.`,
        };
    }
    return {
        $schema: DRAFT,
        $id: id('limits'),
        title: 'zipnative ZipLimits (security bounds)',
        description: 'The eight CWE-tagged bounds every core entry point enforces during parsing and inflation. Override with --max-* flags or .zipnativerc.json keys.',
        type: 'object',
        additionalProperties: false,
        properties: props,
    };
}

function diagnosticsSchema(): JsonSchema {
    return {
        $schema: DRAFT,
        $id: id('diagnostics'),
        title: 'zipnative diagnostic',
        description: 'Conformance / determinism concerns the engine reports without failing (11 codes). --strict escalates the first one into E_CHECK_FAILED.',
        ...diagnosticSchema,
    };
}

/**
 * The CLI capability manifest — DATA (not a JSON Schema) describing every
 * command, its flags, the global flags, and the stable error codes. Emitted by
 * `schema manifest` so an AI agent can discover the CLI's tools at runtime.
 * Kept in sync with the completion metadata (single source of truth).
 */
function manifestDocument(): JsonSchema {
    return {
        $id: `${ID_BASE}/${cliVersion()}/manifest.json`,
        kind: 'capability-manifest',
        name: 'zipnative-cli',
        version: cliVersion(),
        zipnative: engineVersion(),
        contract: {
            stdout: 'primary artifact (archive bytes, entry bytes, JSON report, text, schema, script)',
            stderr: 'diagnostics and, under --json, the status/error envelope',
            exitCodes: { '0': 'success', '1': 'runtime/check failure', '2': 'usage error' },
            network: 'none — no command can open a socket',
        },
        globalFlags: GLOBAL_FLAGS,
        dryRunCommands: DRY_RUN_COMMANDS,
        projectedCommands: PROJECTED_COMMANDS,
        manifestCommands: [...MANIFEST_COMMANDS],
        errorCodes: ERROR_CODES,
        zipErrorCodes: ZIP_CODES,
        diagnosticCodes: [...ZIP_DIAGNOSTIC_CODES],
        limits: LIMIT_FLAGS.map((l) => ({ flag: `--${l.flag}`, key: l.key, default: DEFAULT_ZIP_LIMITS[l.key], cwe: l.cwe })),
        schemas: SUBJECTS,
        commands: COMMANDS.map((c) => ({ name: c.name, group: c.group, summary: c.summary, flags: c.flags })),
    };
}

const BUILDERS: Readonly<Record<Subject, () => JsonSchema>> = {
    'create-manifest': createManifestSchema,
    'modify-manifest': modifyManifestSchema,
    'batch-manifest': batchManifestSchema,
    entries: entriesSchema,
    'entries-summary': entriesSummarySchema,
    inspect: inspectSchema,
    'inspect-summary': inspectSummarySchema,
    verify: verifySchema,
    'verify-summary': verifySummarySchema,
    stream: streamSchema,
    'stream-summary': streamSummarySchema,
    batch: batchSchema,
    'batch-summary': batchSummarySchema,
    doctor: doctorSchema,
    'govern-verify': governVerifySchema,
    crc32: crc32Schema,
    status: statusSchema,
    error: errorSchema,
    errors: errorsDocument,
    limits: limitsSchema,
    diagnostics: diagnosticsSchema,
    manifest: manifestDocument,
};

function isSubject(value: string): value is Subject {
    return (SUBJECTS as readonly string[]).includes(value);
}

/** Build a subject document (exported for tests). */
export function buildSchema(subject: Subject): JsonSchema {
    return BUILDERS[subject]();
}

export async function schema(args: ParsedArgs): Promise<void> {
    const subject = args.positionals[0];

    if (subject === undefined) {
        // No subject → the most common need: the create manifest input schema.
        process.stdout.write(JSON.stringify(BUILDERS['create-manifest'](), null, 2) + '\n');
        return Promise.resolve();
    }

    if (subject === 'list') {
        process.stdout.write(JSON.stringify({ subjects: SUBJECTS }, null, 2) + '\n');
        return Promise.resolve();
    }

    if (!isSubject(subject)) {
        throw new CliError(
            `Unknown schema subject "${subject}". Valid: ${SUBJECTS.join(', ')}, list.`,
            2,
            ErrorCode.USAGE,
        );
    }

    process.stdout.write(JSON.stringify(BUILDERS[subject](), null, 2) + '\n');
    return Promise.resolve();
}
