import { defineConfig } from 'tsup';

// One artefact: dist/cli.cjs, the `zipnative` bin. The package is a
// command-line tool with no programmatic entry point, so there is no ESM
// build, no .d.ts and no source map to ship — the tarball carries the bin,
// the agent docs (AGENTS.md, llms.txt) and the error catalogue only.
export default defineConfig([
    {
        entry: { cli: 'src/index.ts' },
        format: ['cjs'],
        dts: false,
        sourcemap: false,
        clean: true,
        splitting: false,
        treeshake: true,
        minify: false,
        target: 'es2022',
        outDir: 'dist',
        banner: {
            js: '#!/usr/bin/env node',
        },
        // `zipnative` and `zipnative/worker` MUST stay external: the worker
        // subpath resolves `./zip-worker.js` next to its own bundle, and
        // core-bridge/loadParallelZip() resolves the script through the
        // package exports map — a flattened copy would silently compress on
        // the main thread instead of failing loudly.
        noExternal: [],
    },
]);
