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
                // Ratcheted for 1.1.0 from the measured 95.91 / 91.48 / 97.81 /
                // 96.77 (2026-10-20), within one point of the actuals (1.0.0 kept
                // three: 93 / 88 / 94 / 93). Never lower them to make a change
                // pass — add tests.
                statements: 95,
                branches: 91,
                functions: 97,
                lines: 96,
            },
        },
    },
});
