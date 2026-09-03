import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        // The parallel-identity test spawns real worker threads and several
        // integration tests inflate ~1 MB under coverage instrumentation, so
        // give every test more headroom than the 5 s default (real hangs are
        // still caught well within this bound).
        testTimeout: 20000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // Excluded from coverage thresholds:
            //   - index.ts              dispatcher + USAGE strings; exercised by
            //                           tests/integration/built-binary-smoke.test.ts
            //                           and samples/run-all.js against the built bin
            //   - core-bridge/index.ts  pure re-export barrel of `zipnative`
            exclude: [
                'src/index.ts',
                'src/core-bridge/index.ts',
            ],
            thresholds: {
                // Starting values for 1.0.0 — between pdfnative-cli's
                // re-baselined 79/68/83/79 and zipnative's 85/78/85/85. The CLI
                // has no PKI/network engine to exclude, so it should sit near
                // the core. Never lower them to make a change pass — add tests.
                statements: 85,
                branches: 75,
                functions: 85,
                lines: 85,
            },
        },
    },
});
