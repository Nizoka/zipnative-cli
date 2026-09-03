import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: { cli: 'src/index.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        sourcemap: true,
        clean: true,
        splitting: false,
        treeshake: true,
        minify: false,
        target: 'es2022',
        outDir: 'dist',
        // Inject shebang only into the CJS binary — the ESM variant is
        // intended for programmatic consumption (e.g. Bun, Deno).
        banner: {
            js: '#!/usr/bin/env node',
        },
        noExternal: [],
    },
]);
