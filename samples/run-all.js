#!/usr/bin/env node
// run-all.js — Cross-platform sample runner
//
// Runs every CLI invocation the samples demonstrate (one declarative JOBS
// table, no shell required) and writes the results under
// samples/output/<category>/, then reports a summary. Byte-identity
// assertions cover the deterministic-build and stream-parity jobs; the
// tamper / refusal / error-envelope demos assert their expected non-zero
// exit codes and E_* codes.
//
// Prerequisites:
//   - Node.js >= 22
//   - a built CLI: `npm run build` (dist/cli.cjs), or point ZIPNATIVE_CLI at
//     another cli.cjs
//
// Usage (from the repo root):
//   node samples/run-all.js
//
// Flags:
//   --category <name>   Only run the jobs of samples/<name>/
//   --clean             Delete samples/output/ before running
//   --verbose           Echo every command line before running it

import { spawnSync } from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const INPUT_DIR = join(__dirname, 'input');
const OUTPUT_DIR = join(__dirname, 'output');
const CLI = process.env.ZIPNATIVE_CLI ?? join(ROOT_DIR, 'dist', 'cli.cjs');

// Print-only categories: their commands emit text meant for a human (or a
// shell to source). The runner still executes one job per category and
// checks the exit code, but discards stdout instead of keeping an artefact.
const SKIP_CATEGORIES = new Set(['completion', 'govern']);

// ── CLI flags ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const categoryFilter = (() => {
  const i = argv.indexOf('--category');
  return i !== -1 ? argv[i + 1] : null;
})();
const doClean = argv.includes('--clean');
const verbose = argv.includes('--verbose');

if (!existsSync(CLI)) {
  process.stderr.write(
    `CLI not found: ${CLI}\nRun \`npm run build\` first (or set ZIPNATIVE_CLI to a built cli.cjs).\n`,
  );
  process.exit(2);
}

if (doClean && existsSync(OUTPUT_DIR)) {
  process.stdout.write('→ Cleaning samples/output/ …\n');
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────────────

const IN = (...p) => join(INPUT_DIR, ...p);
const OUT = (...p) => join(OUTPUT_DIR, ...p);

function byteIdentical(a, b) {
  const x = readFileSync(a);
  const y = readFileSync(b);
  if (!x.equals(y)) throw new Error(`byte mismatch: ${a} vs ${b} (${x.length} vs ${y.length} bytes)`);
}

/** Flip one byte of a STORED-method archive inside an entry payload (tamper demo). */
function flipByte(src, dst, needle) {
  const buf = Buffer.from(readFileSync(src));
  const i = buf.indexOf(needle);
  if (i === -1) throw new Error(`needle "${needle}" not found in ${src}`);
  buf[i] ^= 0xff;
  writeFileSync(dst, buf);
}

/** Prepend a self-extractor-style stub to an archive (strict-diagnostic demo). */
function prependStub(src, dst) {
  writeFileSync(dst, Buffer.concat([Buffer.from('#!/bin/sh\nexit 0\n'), readFileSync(src)]));
}

/** Copy the batch manifest and its input tree next to each other under output/. */
function stagePipeline(dir) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(IN('batch', 'tasks.json'), join(dir, 'tasks.json'));
  cpSync(IN('text'), join(dir, 'text'), { recursive: true });
}

// ── Jobs ───────────────────────────────────────────────────────────────────
//
// { category, id, args, input?, stdout?, expectExit?, expectCode?, before?, after? }
//   input      file streamed into the CLI's stdin
//   stdout     file that receives stdout (default: discarded, or kept in
//              memory for the print-only categories)
//   expectExit expected exit code (default 0)
//   expectCode E_* code the stderr JSON envelope must carry
//   before     () => void  — set-up (staging, tampering)
//   after      () => void  — assertions on the written artefacts

/** @type {{ category: string; id: string; args: string[]; input?: string; stdout?: string; expectExit?: number; expectCode?: string; before?: () => void; after?: () => void }[]} */
const JOBS = [
  // ── create ──────────────────────────────────────────────────────────────
  { category: 'create', id: '01-basic', args: ['create', IN('text'), '--output', OUT('create', '01-basic.zip')] },
  { category: 'create', id: '02-store', args: ['create', IN('text'), IN('binary'), '--method', 'store', '--output', OUT('create', '02-store.zip')] },
  { category: 'create', id: '02-deflate-9', args: ['create', IN('text'), IN('binary'), '--method', 'deflate', '--level', '9', '--output', OUT('create', '02-deflate-9.zip')] },
  { category: 'create', id: '03-deterministic-a', args: ['create', IN('text'), IN('binary'), IN('unicode'), '--deterministic', '--output', OUT('create', '03-deterministic-a.zip')] },
  {
    category: 'create', id: '03-deterministic-b',
    args: ['create', IN('text'), IN('binary'), IN('unicode'), '--deterministic', '--output', OUT('create', '03-deterministic-b.zip')],
    after: () => byteIdentical(OUT('create', '03-deterministic-a.zip'), OUT('create', '03-deterministic-b.zip')),
  },
  { category: 'create', id: '04-from-manifest', args: ['create', '--from-manifest', IN('manifest', 'entries.json'), '--output', OUT('create', '04-from-manifest.zip')] },
  { category: 'create', id: '04-from-manifest-empty', args: ['create', '--from-manifest', IN('manifest', 'empty.json'), '--output', OUT('create', '04-from-manifest-empty.zip')] },
  { category: 'create', id: '05-stdin-stream', input: IN('binary', 'pattern.bin'), args: ['create', '--stdin-name', 'data/pattern.bin', '--stream', '--output', OUT('create', '05-stdin-stream.zip')] },
  { category: 'create', id: '06-sequential', args: ['create', INPUT_DIR, '--output', OUT('create', '06-sequential.zip')] },
  {
    category: 'create', id: '06-parallel',
    args: ['create', INPUT_DIR, '--parallel', '--workers', '2', '--min-job-size', '1k', '--output', OUT('create', '06-parallel.zip')],
    after: () => byteIdentical(OUT('create', '06-sequential.zip'), OUT('create', '06-parallel.zip')),
  },
  { category: 'create', id: '07-comment-and-order', args: ['create', IN('text'), '--comment', 'built by samples/run-all.js', '--entry-comment', 'text/readme.txt=the readme', '--order', 'insertion', '--date', '2024-01-02T03:04:06Z', '--output', OUT('create', '07-comment-and-order.zip')] },

  // ── list ────────────────────────────────────────────────────────────────
  { category: 'list', id: '00-setup', args: ['create', IN('text'), IN('unicode'), '--output', OUT('list', 'archive.zip')] },
  { category: 'list', id: '01-table', stdout: OUT('list', '01-table.txt'), args: ['list', '--input', OUT('list', 'archive.zip'), '--long'] },
  { category: 'list', id: '02-json-fields', stdout: OUT('list', '02-json-fields.json'), args: ['list', '--input', OUT('list', 'archive.zip'), '--format', 'json', '--fields', 'entries.name,entries.uncompressedSize'] },
  { category: 'list', id: '03-ndjson', stdout: OUT('list', '03-ndjson.ndjson'), args: ['list', '--input', OUT('list', 'archive.zip'), '--format', 'ndjson', '--include', '**/*.md'] },

  // ── inspect ─────────────────────────────────────────────────────────────
  { category: 'inspect', id: '00-setup', args: ['create', IN('text'), IN('binary'), '--deterministic', '--output', OUT('inspect', 'archive.zip')] },
  { category: 'inspect', id: '01-report', stdout: OUT('inspect', '01-report.json'), args: ['inspect', '--input', OUT('inspect', 'archive.zip'), '--format', 'json', '--entries'] },
  { category: 'inspect', id: '02-check-pass', stdout: OUT('inspect', '02-check-pass.json'), args: ['inspect', '--input', OUT('inspect', 'archive.zip'), '--format', 'json', '--summary', '--check', 'deterministic,no-encryption,no-symlinks,max-entries=10,has=text/readme.txt'] },
  { category: 'inspect', id: '02-check-fail', expectExit: 1, expectCode: 'E_CHECK_FAILED', stdout: OUT('inspect', '02-check-fail.json'), args: ['inspect', '--input', OUT('inspect', 'archive.zip'), '--json', '--summary', '--check', 'store-only'] },
  {
    category: 'inspect', id: '03-strict-diagnostics', expectExit: 1, expectCode: 'E_CHECK_FAILED',
    before: () => prependStub(OUT('inspect', 'archive.zip'), OUT('inspect', '03-prepended.zip')),
    args: ['inspect', '--input', OUT('inspect', '03-prepended.zip'), '--strict', '--json', '--summary'],
  },

  // ── extract ─────────────────────────────────────────────────────────────
  { category: 'extract', id: '00-setup', args: ['create', IN('text'), IN('unicode'), '--output', OUT('extract', 'archive.zip')] },
  {
    category: 'extract', id: '01-basic', args: ['extract', '--input', OUT('extract', 'archive.zip'), '--output-dir', OUT('extract', '01-basic')],
    after: () => byteIdentical(IN('text', 'readme.txt'), OUT('extract', '01-basic', 'text', 'readme.txt')),
  },
  { category: 'extract', id: '02-filter-and-flat', args: ['extract', '--input', OUT('extract', 'archive.zip'), '--output-dir', OUT('extract', '02-flat'), '--include', '**/*.md', '--flat'] },
  { category: 'extract', id: '03-dry-run-plan', args: ['extract', '--input', OUT('extract', 'archive.zip'), '--output-dir', OUT('extract', '03-never-created'), '--dry-run', '--json'], after: () => { if (existsSync(OUT('extract', '03-never-created'))) throw new Error('--dry-run wrote output'); } },
  { category: 'extract', id: '04-overwrite-refusal', expectExit: 1, expectCode: 'E_IO', args: ['extract', '--input', OUT('extract', 'archive.zip'), '--output-dir', OUT('extract', '01-basic'), '--json'] },
  { category: 'extract', id: '04-skip-unsafe', args: ['extract', '--input', OUT('extract', 'archive.zip'), '--output-dir', OUT('extract', '04-skip-unsafe'), '--skip-unsafe', '--skip-symlinks', '--json'] },

  // ── cat ─────────────────────────────────────────────────────────────────
  { category: 'cat', id: '00-setup', args: ['create', IN('text'), '--output', OUT('cat', 'archive.zip')] },
  {
    category: 'cat', id: '01-cat-entry', stdout: OUT('cat', '01-readme.txt'), args: ['cat', '--input', OUT('cat', 'archive.zip'), '--entry', 'text/readme.txt'],
    after: () => byteIdentical(IN('text', 'readme.txt'), OUT('cat', '01-readme.txt')),
  },
  { category: 'cat', id: '01-cat-raw', stdout: OUT('cat', '01-readme.deflate'), args: ['cat', '--input', OUT('cat', 'archive.zip'), '--entry', 'text/readme.txt', '--raw'] },

  // ── verify ──────────────────────────────────────────────────────────────
  { category: 'verify', id: '00-setup', args: ['create', IN('text'), '--method', 'store', '--output', OUT('verify', 'stored.zip')] },
  { category: 'verify', id: '01-verify', stdout: OUT('verify', '01-verify.json'), args: ['verify', '--input', OUT('verify', 'stored.zip'), '--format', 'json'] },
  {
    category: 'verify', id: '02-tamper-detect', expectExit: 1, expectCode: 'E_VERIFY_FAILED',
    before: () => flipByte(OUT('verify', 'stored.zip'), OUT('verify', '02-tampered.zip'), 'zipnative-cli sample input'),
    args: ['verify', '--input', OUT('verify', '02-tampered.zip'), '--json', '--summary'],
  },

  // ── stream ──────────────────────────────────────────────────────────────
  { category: 'stream', id: '00-setup', args: ['create', IN('text'), '--output', OUT('stream', 'archive.zip')] },
  { category: 'stream', id: '01-forward-list', input: OUT('stream', 'archive.zip'), stdout: OUT('stream', '01-forward-list.ndjson'), args: ['stream', '--list', '--format', 'ndjson'] },
  { category: 'stream', id: '02-extract-reference', args: ['extract', '--input', OUT('stream', 'archive.zip'), '--output-dir', OUT('stream', '02-extract')] },
  {
    category: 'stream', id: '02-forward-extract', input: OUT('stream', 'archive.zip'), args: ['stream', '--output-dir', OUT('stream', '02-forward-extract')],
    after: () => byteIdentical(OUT('stream', '02-extract', 'text', 'notes.md'), OUT('stream', '02-forward-extract', 'text', 'notes.md')),
  },
  {
    category: 'stream', id: '03-forward-cat', input: OUT('stream', 'archive.zip'), stdout: OUT('stream', '03-forward-cat.md'), args: ['stream', '--cat', 'text/notes.md'],
    after: () => byteIdentical(IN('text', 'notes.md'), OUT('stream', '03-forward-cat.md')),
  },

  // ── modify ──────────────────────────────────────────────────────────────
  { category: 'modify', id: '00-setup', args: ['create', IN('text'), '--output', OUT('modify', 'base.zip')] },
  { category: 'modify', id: '01-append-only', args: ['modify', '--input', OUT('modify', 'base.zip'), '--output', OUT('modify', '01-append-only.zip'), '--add', `extra/pattern.bin=${IN('binary', 'pattern.bin')}`, '--replace', `text/readme.txt=${IN('text', 'notes.md')}`, '--remove', 'text/with-dash_and.dots.txt', '--json'] },
  { category: 'modify', id: '02-compact', args: ['modify', '--input', OUT('modify', '01-append-only.zip'), '--output', OUT('modify', '02-compact.zip'), '--remove', 'extra/pattern.bin', '--compact', '--json'] },
  { category: 'modify', id: '03-rename-and-comment', args: ['modify', '--input', OUT('modify', 'base.zip'), '--output', OUT('modify', '03-rename-and-comment.zip'), '--rename', 'text/notes.md=text/NOTES.md', '--comment', 'renamed by samples/run-all.js', '--compact', '--json'] },
  { category: 'modify', id: '04-from-manifest', args: ['modify', '--input', OUT('modify', 'base.zip'), '--output', OUT('modify', '04-from-manifest.zip'), '--from-manifest', IN('manifest', 'edits.json'), '--compact', '--json'] },

  // ── crc32 ───────────────────────────────────────────────────────────────
  { category: 'crc32', id: '01-file', stdout: OUT('crc32', '01-file.json'), args: ['crc32', IN('text', 'readme.txt'), IN('binary', 'pattern.bin'), '--format', 'json'] },
  { category: 'crc32', id: '01-stdin', input: IN('text', 'readme.txt'), stdout: OUT('crc32', '01-stdin.txt'), args: ['crc32'] },
  { category: 'crc32', id: '01-expect-ok', args: ['crc32', IN('text', 'readme.txt'), '--expect', '4c30b41c'] },
  { category: 'crc32', id: '01-expect-mismatch', expectExit: 1, expectCode: 'E_CHECK_FAILED', args: ['crc32', IN('text', 'readme.txt'), '--expect', 'deadbeef', '--json'] },

  // ── inflate ─────────────────────────────────────────────────────────────
  {
    category: 'inflate', id: '01-inflate',
    before: () => { mkdirSync(OUT('inflate'), { recursive: true }); writeFileSync(OUT('inflate', 'readme.deflate'), deflateRawSync(readFileSync(IN('text', 'readme.txt')))); },
    args: ['inflate', '--input', OUT('inflate', 'readme.deflate'), '--output', OUT('inflate', '01-readme.txt'), '--json'],
    after: () => byteIdentical(IN('text', 'readme.txt'), OUT('inflate', '01-readme.txt')),
  },
  { category: 'inflate', id: '01-max-output', expectExit: 1, expectCode: 'E_DATA', args: ['inflate', '--input', OUT('inflate', 'readme.deflate'), '--max-output', '16', '--json'] },

  // ── batch ───────────────────────────────────────────────────────────────
  { category: 'batch', id: '01-directory-mode', stdout: OUT('batch', '01-directory-mode.json'), args: ['batch', '--input-dir', INPUT_DIR, '--output-dir', OUT('batch', '01-archives'), '--deterministic', '--format', 'json', '--quiet'] },
  { category: 'batch', id: '01-directory-verify', stdout: OUT('batch', '01-directory-verify.json'), args: ['batch', '--input-dir', OUT('batch', '01-archives'), '--task', 'verify', '--format', 'json', '--quiet'] },
  {
    category: 'batch', id: '02-manifest-pipeline', stdout: OUT('batch', '02-manifest-pipeline.json'),
    before: () => stagePipeline(OUT('batch', '02-pipeline')),
    args: ['batch', '--manifest', OUT('batch', '02-pipeline', 'tasks.json'), '--format', 'json', '--quiet'],
    after: () => byteIdentical(IN('text', 'readme.txt'), OUT('batch', '02-pipeline', 'out', 'unpacked', 'text', 'readme.txt')),
  },
  { category: 'batch', id: '03-dry-run', stdout: OUT('batch', '03-dry-run.json'), args: ['batch', '--manifest', OUT('batch', '02-pipeline', 'tasks.json'), '--dry-run', '--format', 'json'] },

  // ── doctor ──────────────────────────────────────────────────────────────
  { category: 'doctor', id: '01-doctor', stdout: OUT('doctor', '01-doctor.json'), args: ['doctor', '--format', 'json'] },

  // ── schema ──────────────────────────────────────────────────────────────
  { category: 'schema', id: '01-list', stdout: OUT('schema', '01-list.json'), args: ['schema', 'list'] },
  { category: 'schema', id: '01-create-manifest', stdout: OUT('schema', '01-create-manifest.schema.json'), args: ['schema', 'create-manifest'] },
  { category: 'schema', id: '01-errors', stdout: OUT('schema', '01-errors.json'), args: ['schema', 'errors'] },
  { category: 'schema', id: '01-manifest', stdout: OUT('schema', '01-manifest.json'), args: ['schema', 'manifest'] },

  // ── completion (print-only) ─────────────────────────────────────────────
  { category: 'completion', id: '01-generate-bash', args: ['completion', 'bash'] },
  { category: 'completion', id: '01-generate-powershell', args: ['completion', 'powershell'] },

  // ── config ──────────────────────────────────────────────────────────────
  { category: 'config', id: '01-with-config', args: ['create', IN('text'), '--config', IN('config', '.zipnativerc.json'), '--output', OUT('config', '01-with-config.zip')] },
  { category: 'config', id: '01-no-config', args: ['create', IN('text'), '--no-config', '--output', OUT('config', '01-no-config.zip')] },
  { category: 'config', id: '01-check-deterministic', args: ['inspect', '--input', OUT('config', '01-with-config.zip'), '--check', 'deterministic', '--summary', '--format', 'json'] },

  // ── agent ───────────────────────────────────────────────────────────────
  { category: 'agent', id: '01-dry-run', args: ['create', IN('text'), '--output', OUT('agent', '01-never-written.zip'), '--dry-run', '--json'], after: () => { if (existsSync(OUT('agent', '01-never-written.zip'))) throw new Error('--dry-run wrote output'); } },
  { category: 'agent', id: '01-status-envelope', args: ['create', IN('text'), '--output', OUT('agent', '01-status.zip'), '--json'] },
  { category: 'agent', id: '02-error-not-found', expectExit: 1, expectCode: 'E_NOT_FOUND', args: ['cat', '--input', OUT('agent', '01-status.zip'), '--entry', 'missing.txt', '--json'] },
  { category: 'agent', id: '02-error-parse', expectExit: 1, expectCode: 'E_PARSE', args: ['list', '--input', IN('text', 'readme.txt'), '--json'] },
  { category: 'agent', id: '02-error-usage', expectExit: 2, expectCode: 'E_USAGE', args: ['create', '--json'] },
  { category: 'agent', id: '03-token-economy-summary', stdout: OUT('agent', '03-summary.json'), args: ['inspect', '--input', OUT('agent', '01-status.zip'), '--json', '--summary'] },
  // --summary and --fields do not combine (summary wins); project the full report instead.
  { category: 'agent', id: '03-token-economy-fields', stdout: OUT('agent', '03-fields.json'), args: ['inspect', '--input', OUT('agent', '01-status.zip'), '--json', '--fields', 'archive.bytes,determinism.deterministic'] },

  // ── govern (print-only) ─────────────────────────────────────────────────
  { category: 'govern', id: '01-rules', args: ['govern', 'rules'] },
  { category: 'govern', id: '01-policy', args: ['govern', 'policy', '--pretty'] },
  { category: 'govern', id: '02-verify-good', args: ['govern', 'verify-issue', IN('govern', 'draft-good.md')] },
  { category: 'govern', id: '02-verify-bad', expectExit: 1, expectCode: 'E_POLICY', args: ['govern', 'verify-issue', IN('govern', 'draft-bad.md'), '--json'] },
];

// ── Run jobs ───────────────────────────────────────────────────────────────

const jobs = categoryFilter ? JOBS.filter((j) => j.category === categoryFilter) : JOBS;
if (jobs.length === 0) {
  process.stderr.write(`No jobs for category "${categoryFilter}".\n`);
  process.exit(1);
}

const PAD = 40;
let passed = 0;
let failed = 0;

process.stdout.write(`\nRunning ${jobs.length} sample job(s) with ${CLI}…\n\n`);

for (const job of jobs) {
  const label = `${job.category}/${job.id}`;
  process.stdout.write(`  ${label.padEnd(PAD)}`);

  try {
    mkdirSync(OUT(job.category), { recursive: true });
    job.before?.();

    if (verbose) process.stdout.write(`\n    $ zipnative ${job.args.join(' ')}\n    `);

    const stdin = job.input !== undefined ? readFileSync(job.input) : undefined;
    const result = spawnSync(process.execPath, [CLI, ...job.args], {
      input: stdin,
      stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });

    if (result.error) throw result.error;
    const expectExit = job.expectExit ?? 0;
    if (result.status !== expectExit) {
      throw new Error(`exit ${result.status}, expected ${expectExit}\n${(result.stderr ?? '').toString().trim()}`);
    }
    if (job.expectCode !== undefined) {
      const stderr = (result.stderr ?? '').toString();
      if (!stderr.includes(`"code":"${job.expectCode}"`)) {
        throw new Error(`stderr envelope does not carry "${job.expectCode}":\n${stderr.trim()}`);
      }
    }
    if (job.stdout !== undefined && !SKIP_CATEGORIES.has(job.category)) {
      writeFileSync(job.stdout, result.stdout);
    }
    job.after?.();

    process.stdout.write('✓\n');
    passed++;
  } catch (e) {
    process.stdout.write('✗\n');
    const message = e instanceof Error ? e.message : String(e);
    for (const line of message.split(/\r?\n/)) process.stderr.write(`    ${line}\n`);
    failed++;
  }
}

// ── Summary ────────────────────────────────────────────────────────────────

process.stdout.write(`\n${'─'.repeat(PAD + 4)}\n`);
process.stdout.write(`  ${passed} passed`);
if (failed > 0) process.stdout.write(`, ${failed} FAILED`);
process.stdout.write(`\n  Output: ${OUTPUT_DIR}\n\n`);

if (failed > 0) process.exit(1);
