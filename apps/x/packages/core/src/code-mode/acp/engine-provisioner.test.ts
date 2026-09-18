import { describe, expect, it } from 'vitest';
import {
    getProvisionedEnginePath,
    isEngineProvisioned,
    isEngineSupported,
} from './engine-provisioner.js';

// Regression guard: before the registry split, every managed-only helper indexed
// ENGINE_MANIFEST[agent] directly, so calling one for an externally-installed
// agent (OpenCode) threw `TypeError: Cannot read properties of undefined`.
describe('engine provisioner guards for external agents', () => {
    it('does not throw for opencode on the status helpers', () => {
        expect(() => isEngineProvisioned('opencode')).not.toThrow();
        expect(() => isEngineSupported('opencode')).not.toThrow();
    });

    it('reports opencode as supported but never provisioned', () => {
        // External agents are supported on every platform and have no managed engine.
        expect(isEngineSupported('opencode')).toBe(true);
        expect(isEngineProvisioned('opencode')).toBe(false);
    });

    it('resolves opencode without a TypeError (path present or a clear error)', () => {
        try {
            const p = getProvisionedEnginePath('opencode');
            expect(typeof p).toBe('string');
            expect(p.length).toBeGreaterThan(0);
        } catch (e) {
            expect((e as Error).message).toMatch(/OpenCode isn't installed/);
        }
    });
});
