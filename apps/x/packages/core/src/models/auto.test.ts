import fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Auto sentinel resolution and its integration into the selection funnels.
 * Pins the policy: recommendation (task slot first) only when the provider
 * actually lists it, then the persisted last resolution, then first-listed;
 * concrete selections never touch the resolver; task inheritance from an
 * Auto assistant stays category-aware.
 */

// vi.mock factories are hoisted above module code — the temp path must be
// computable inside vi.hoisted without imports (created in beforeEach).
const workDir = vi.hoisted(() =>
    `${process.env.TMPDIR?.replace(/\/$/, '') ?? '/tmp'}/models-auto-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
);

const mocks = vi.hoisted(() => ({
    listProviderModelIds: vi.fn(async (): Promise<string[]> => []),
    getRowboatConfig: vi.fn(async (): Promise<unknown> => {
        throw new Error('api unreachable');
    }),
    capture: vi.fn(),
    getConfig: vi.fn(async (): Promise<unknown> => {
        throw new Error('no models.json');
    }),
}));

vi.mock('../config/config.js', () => ({ WorkDir: workDir }));
vi.mock('./catalog.js', () => ({ listProviderModelIds: mocks.listProviderModelIds }));
vi.mock('../config/rowboat.js', () => ({ getRowboatConfig: mocks.getRowboatConfig }));
vi.mock('../analytics/posthog.js', () => ({ capture: mocks.capture }));
vi.mock('../di/container.js', () => ({
    default: { resolve: () => ({ getConfig: mocks.getConfig }) },
}));

import { resolveAutoSelection, __resetAutoResolutionForTests } from './auto.js';
import { getDefaultModelAndProvider, getKgModel, getSubagentModelOverride } from './defaults.js';

const configDir = path.join(workDir, 'config');

function serveRecommendations(recommendations: Record<string, unknown>): void {
    mocks.getRowboatConfig.mockResolvedValue({ modelRecommendations: recommendations });
}

function serveModelsJson(config: Record<string, unknown>): void {
    mocks.getConfig.mockImplementation(async () => ({ version: 2, providers: {}, ...config }));
}

beforeEach(async () => {
    vi.clearAllMocks();
    __resetAutoResolutionForTests();
    mocks.listProviderModelIds.mockResolvedValue([]);
    mocks.getRowboatConfig.mockRejectedValue(new Error('api unreachable'));
    mocks.getConfig.mockRejectedValue(new Error('no models.json'));
    await fs.rm(configDir, { recursive: true, force: true });
});

afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true });
});

process.on('exit', () => {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

describe('resolveAutoSelection', () => {
    it('resolves to the flavor assistant recommendation when the provider lists it', async () => {
        mocks.listProviderModelIds.mockResolvedValue(['other-model', 'google/gemini-3.8-flash']);
        serveRecommendations({ rowboat: { assistantModel: 'google/gemini-3.8-flash' } });

        await expect(resolveAutoSelection('rowboat', 'assistant')).resolves.toEqual({
            provider: 'rowboat',
            model: 'google/gemini-3.8-flash',
        });
    });

    it('prefers the task recommendation slot over the assistant slot for a task category', async () => {
        mocks.listProviderModelIds.mockResolvedValue(['google/gemini-3.8-flash', 'google/gemini-3.1-flash-lite']);
        serveRecommendations({
            rowboat: {
                assistantModel: 'google/gemini-3.8-flash',
                taskModels: { knowledgeGraph: 'google/gemini-3.1-flash-lite' },
            },
        });

        await expect(resolveAutoSelection('rowboat', 'knowledgeGraph')).resolves.toEqual({
            provider: 'rowboat',
            model: 'google/gemini-3.1-flash-lite',
        });
        // A category without its own slot inherits the assistant slot.
        await expect(resolveAutoSelection('rowboat', 'chatTitle')).resolves.toEqual({
            provider: 'rowboat',
            model: 'google/gemini-3.8-flash',
        });
    });

    it('carries a recommended effort into the resolved selection', async () => {
        mocks.listProviderModelIds.mockResolvedValue(['gpt-5.4']);
        serveRecommendations({ openai: { assistantModel: { model: 'gpt-5.4', effort: 'high' } } });

        await expect(resolveAutoSelection('openai', 'assistant')).resolves.toEqual({
            provider: 'openai',
            model: 'gpt-5.4',
            effort: 'high',
        });
    });

    it('looks recommendations up by the provider entry FLAVOR, not the instance id', async () => {
        mocks.listProviderModelIds.mockResolvedValue(['claude-opus-4-8']);
        serveModelsJson({ providers: { 'anthropic-work': { flavor: 'anthropic' } } });
        serveRecommendations({ anthropic: 'claude-opus-4-8' });

        await expect(resolveAutoSelection('anthropic-work', 'assistant')).resolves.toEqual({
            provider: 'anthropic-work',
            model: 'claude-opus-4-8',
        });
    });

    it('falls back to the first listed model when the recommendation is not served', async () => {
        mocks.listProviderModelIds.mockResolvedValue(['first-model', 'second-model']);
        serveRecommendations({ rowboat: { assistantModel: 'retired-model' } });

        await expect(resolveAutoSelection('rowboat', 'assistant')).resolves.toEqual({
            provider: 'rowboat',
            model: 'first-model',
        });
    });

    it('serves the persisted last resolution when offline with an unlistable provider', async () => {
        mocks.listProviderModelIds.mockResolvedValue(['google/gemini-3.8-flash']);
        serveRecommendations({ rowboat: { assistantModel: 'google/gemini-3.8-flash' } });
        await resolveAutoSelection('rowboat', 'assistant');

        // Cold process, dead network, no listable models: the cache file
        // written above is the only signal left.
        __resetAutoResolutionForTests();
        mocks.listProviderModelIds.mockResolvedValue([]);
        mocks.getRowboatConfig.mockRejectedValue(new Error('offline'));

        await expect(resolveAutoSelection('rowboat', 'assistant')).resolves.toEqual({
            provider: 'rowboat',
            model: 'google/gemini-3.8-flash',
        });
    });

    it('prefers a still-listed cached resolution over first-listed when the recommendation goes stale', async () => {
        mocks.listProviderModelIds.mockResolvedValue(['other-model', 'cached-model']);
        serveRecommendations({ rowboat: { assistantModel: 'cached-model' } });
        await resolveAutoSelection('rowboat', 'assistant');

        // The recommendation rotates to a model the gateway doesn't serve
        // yet: stability beats jumping to an arbitrary first entry.
        serveRecommendations({ rowboat: { assistantModel: 'unreleased-model' } });
        await expect(resolveAutoSelection('rowboat', 'assistant')).resolves.toEqual({
            provider: 'rowboat',
            model: 'cached-model',
        });
    });

    it('drops a cached resolution the provider no longer lists', async () => {
        mocks.listProviderModelIds.mockResolvedValue(['cached-model']);
        serveRecommendations({ rowboat: { assistantModel: 'cached-model' } });
        await resolveAutoSelection('rowboat', 'assistant');

        mocks.getRowboatConfig.mockRejectedValue(new Error('offline'));
        mocks.listProviderModelIds.mockResolvedValue(['replacement-model']);

        await expect(resolveAutoSelection('rowboat', 'assistant')).resolves.toEqual({
            provider: 'rowboat',
            model: 'replacement-model',
        });
    });

    it('throws when there is no recommendation, cache, or listed model', async () => {
        await expect(resolveAutoSelection('rowboat', 'assistant')).rejects.toThrow(/Unable to resolve the Auto model/);
    });

    it('captures the resolution only when it changes', async () => {
        mocks.listProviderModelIds.mockResolvedValue(['google/gemini-3.8-flash']);
        serveRecommendations({ rowboat: { assistantModel: 'google/gemini-3.8-flash' } });

        await resolveAutoSelection('rowboat', 'assistant');
        await resolveAutoSelection('rowboat', 'assistant');

        expect(mocks.capture).toHaveBeenCalledTimes(1);
        expect(mocks.capture).toHaveBeenCalledWith('auto_model_resolved', {
            provider: 'rowboat',
            category: 'assistant',
            model: 'google/gemini-3.8-flash',
            source: 'recommendation',
        });
    });
});

describe('selection funnels with the Auto sentinel', () => {
    it('getDefaultModelAndProvider resolves an Auto assistant', async () => {
        serveModelsJson({ assistantModel: { provider: 'rowboat', model: 'auto' } });
        mocks.listProviderModelIds.mockResolvedValue(['google/gemini-3.8-flash']);
        serveRecommendations({ rowboat: { assistantModel: 'google/gemini-3.8-flash' } });

        await expect(getDefaultModelAndProvider()).resolves.toEqual({
            provider: 'rowboat',
            model: 'google/gemini-3.8-flash',
        });
    });

    it('leaves a concrete assistant selection untouched', async () => {
        serveModelsJson({ assistantModel: { provider: 'rowboat', model: 'pinned-model', effort: 'low' } });

        await expect(getDefaultModelAndProvider()).resolves.toEqual({
            provider: 'rowboat',
            model: 'pinned-model',
            effort: 'low',
        });
        expect(mocks.listProviderModelIds).not.toHaveBeenCalled();
    });

    it('keeps task inheritance from an Auto assistant category-aware', async () => {
        serveModelsJson({ assistantModel: { provider: 'rowboat', model: 'auto' } });
        mocks.listProviderModelIds.mockResolvedValue(['google/gemini-3.8-flash', 'google/gemini-3.1-flash-lite']);
        serveRecommendations({
            rowboat: {
                assistantModel: 'google/gemini-3.8-flash',
                taskModels: { knowledgeGraph: 'google/gemini-3.1-flash-lite' },
            },
        });

        // No knowledgeGraph override in models.json — inheritance resolves
        // against the task's own recommendation slot, not the assistant's.
        await expect(getKgModel()).resolves.toEqual({
            provider: 'rowboat',
            model: 'google/gemini-3.1-flash-lite',
        });
    });

    it('resolves an explicit Auto task override and keeps concrete overrides as-is', async () => {
        serveModelsJson({
            assistantModel: { provider: 'rowboat', model: 'pinned-model' },
            taskModels: {
                knowledgeGraph: { provider: 'rowboat', model: 'auto' },
                subagent: { provider: 'rowboat', model: 'explicit-subagent-model' },
            },
        });
        mocks.listProviderModelIds.mockResolvedValue(['google/gemini-3.1-flash-lite']);
        serveRecommendations({ rowboat: { taskModels: { knowledgeGraph: 'google/gemini-3.1-flash-lite' }, assistantModel: 'x' } });

        await expect(getKgModel()).resolves.toEqual({
            provider: 'rowboat',
            model: 'google/gemini-3.1-flash-lite',
        });
        await expect(getSubagentModelOverride()).resolves.toEqual({
            provider: 'rowboat',
            model: 'explicit-subagent-model',
        });
    });

    it('keeps the absent subagent override as parent-inherit (null)', async () => {
        serveModelsJson({ assistantModel: { provider: 'rowboat', model: 'auto' } });

        await expect(getSubagentModelOverride()).resolves.toBeNull();
    });
});
