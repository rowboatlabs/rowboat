import { describe, expect, it } from 'vitest';
import {
    compareSemver,
    meetsMinimumVersion,
    parseVersion,
    resolveExternalAgentPathSync,
} from './external-agent.js';

describe('external agent version parsing', () => {
    it('extracts a semver from version output', () => {
        expect(parseVersion('1.18.31')).toBe('1.18.31');
        expect(parseVersion('opencode 1.2.3\n')).toBe('1.2.3');
        expect(parseVersion('v0.1.0-beta.2')).toBe('0.1.0-beta.2');
    });

    it('returns undefined when no version is present', () => {
        expect(parseVersion('no version here')).toBeUndefined();
        expect(parseVersion('')).toBeUndefined();
    });

    it('orders versions numerically, not lexically', () => {
        expect(compareSemver('1.10.0', '1.2.0')).toBeGreaterThan(0);
        expect(compareSemver('1.2.0', '1.2.0')).toBe(0);
        expect(compareSemver('0.9.9', '1.0.0')).toBeLessThan(0);
    });
});

describe('external agent version gate', () => {
    it('passes when no minimum is declared or the version is unknown', () => {
        // opencode declares no minVersion today; the ACP handshake is the gate.
        expect(meetsMinimumVersion('opencode', '0.0.1')).toBe(true);
        expect(meetsMinimumVersion('opencode', undefined)).toBe(true);
    });

    it('never gates managed agents through this helper', () => {
        expect(meetsMinimumVersion('claude', '0.0.1')).toBe(true);
    });
});

describe('external agent resolution classification', () => {
    it('returns null for managed agents', () => {
        expect(resolveExternalAgentPathSync('claude')).toBeNull();
        expect(resolveExternalAgentPathSync('codex')).toBeNull();
    });
});
