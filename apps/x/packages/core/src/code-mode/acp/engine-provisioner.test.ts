import { describe, expect, it } from 'vitest';
import {
    getProvisionedEnginePath,
    isEngineProvisioned,
    isEngineSupported,
} from './engine-provisioner.js';

// Regression guard: every agent is externally installed, so the provisioner must
// never try to download one, and must never throw a TypeError for any known agent.
describe('engine provisioner (external-only)', () => {
    it('supports every known agent and reports none as provisioned', () => {
        for (const agent of ['opencode', 'cursor', 'hermes'] as const) {
            expect(isEngineSupported(agent)).toBe(true);
            expect(isEngineProvisioned(agent)).toBe(false);
        }
    });

    it('resolves a path or throws a clear install error (never a TypeError)', () => {
        for (const agent of ['opencode', 'cursor', 'hermes'] as const) {
            try {
                const p = getProvisionedEnginePath(agent);
                expect(typeof p).toBe('string');
                expect(p.length).toBeGreaterThan(0);
            } catch (e) {
                expect((e as Error).message).toMatch(/isn't installed/);
            }
        }
    });
});