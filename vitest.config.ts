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
                // Ratcheted after the 1.0.0 audit pass from the measured
                // 96.3 / 92.3 / 97.9 / 96.8 (2026-09-05), three points below
                // the actuals so a legitimate refactor does not flap the gate.
                // Never lower them to make a change pass — add tests.
                statements: 93,
                branches: 88,
                functions: 94,
                lines: 93,
            },
        },
    },
});
