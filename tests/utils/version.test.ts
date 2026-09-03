import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { cliVersion, engineVersion } from '../../src/utils/version.js';
import { VERSION } from '../../src/core-bridge/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { name: string; version: string };
const enginePkg = require('zipnative/package.json') as { name: string; version: string };

describe('cliVersion', () => {
    it('resolves the package version (matches package.json)', () => {
        expect(pkg.name).toBe('zipnative-cli');
        expect(cliVersion()).toBe(pkg.version);
    });

    it('returns a semver-shaped string', () => {
        expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('is stable across calls (cached)', () => {
        expect(cliVersion()).toBe(cliVersion());
    });
});

describe('engineVersion', () => {
    it('matches the installed zipnative package.json version', () => {
        expect(enginePkg.name).toBe('zipnative');
        expect(engineVersion()).toBe(enginePkg.version);
    });

    it('agrees with the VERSION constant the engine exports', () => {
        expect(engineVersion()).toBe(VERSION);
    });

    it('returns a semver-shaped string and is cached', () => {
        expect(engineVersion()).toMatch(/^\d+\.\d+\.\d+/);
        expect(engineVersion()).toBe(engineVersion());
    });
});
