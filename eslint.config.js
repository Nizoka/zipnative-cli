import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    // Type-aware strict rules (no-floating-promises, no-misused-promises,
    // no-unnecessary-condition, …): the parser already pays for type
    // information, so use it.
    ...tseslint.configs.strictTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                // tsconfig.test.json includes src/ AND tests/ (tsconfig.json
                // excludes tests), so one project covers everything linted.
                project: ['./tsconfig.test.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-non-null-assertion': 'warn',
            '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
            'eqeqeq': ['error', 'always'],
            'no-throw-literal': 'error',
            'no-shadow': 'off',
            '@typescript-eslint/no-shadow': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-console': ['error', { allow: ['warn', 'error'] }],
            // Numbers and booleans in template literals are ubiquitous in CLI
            // messages and envelopes; the risk the rule guards (objects → "[object
            // Object]") is kept.
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
            // `(x) => doSomething()` arrow shorthands returning void are idiomatic here.
            '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
            // Every command is `async (args) => Promise<void>` by contract, whether
            // or not it awaits; the dispatcher awaits it.
            '@typescript-eslint/require-await': 'off',
        },
    },
    {
        // Tests are linted too (same parser, tsconfig.test.json via the
        // project service), with the rules that fight test ergonomics relaxed:
        // fixtures cast freely, helpers shadow names, and a test may leave an
        // unused destructured value on purpose.
        files: ['tests/**/*.ts'],
        // Type-aware rules stay off in tests (fixtures cast freely, mocks return
        // anything); the non-type-checked strict set still applies.
        extends: [tseslint.configs.disableTypeChecked],
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-shadow': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-console': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-extraneous-class': 'off',
            '@typescript-eslint/no-dynamic-delete': 'off',
            '@typescript-eslint/unified-signatures': 'off',
        },
    },
    {
        // scripts/**/*.mjs and samples/**/*.js are plain ESM outside the TypeScript
        // project (the type-aware parser cannot see them); they are exercised by
        // `npm run validate:zip` and `samples/run-all.js` instead.
        ignores: ['dist/**', 'node_modules/**', '*.config.*', 'scripts/**', 'samples/**', 'test-output/**', 'coverage/**'],
    },
);
