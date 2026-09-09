import { rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The recommendation-update prompt's state machine: when a prompt is
 * offered, what apply/dismiss write, and that a version is offered once.
 */

const workDir = vi.hoisted(() =>
    `${process.env.TMPDIR?.replace(/\/$/, '') ?? '/tmp'}/rec-update-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
);

const mocks = vi.hoisted(() => ({
    getConfig: vi.fn(async (): Promise<unknown> => ({ version: 2, providers: {} })),
    updateConfig: vi.fn<(patch: unknown) => Promise<void>>(async () => {}),
    getRowboatConfig: vi.fn(async (): Promise<unknown> => ({ modelRecommendations: {} })),
    getModelCatalog: vi.fn(async (): Promise<unknown> => ({ providers: [], defaultModel: null })),
    capture: vi.fn(),
}));

vi.mock('../config/config.js', () => ({ WorkDir: workDir }));
vi.mock('../config/rowboat.js', () => ({ getRowboatConfig: mocks.getRowboatConfig }));
vi.mock('../analytics/posthog.js', () => ({ capture: mocks.capture }));
vi.mock('./catalog.js', () => ({ getModelCatalog: mocks.getModelCatalog }));
vi.mock('../di/container.js', () => ({
    default: { resolve: () => ({ getConfig: mocks.getConfig, updateConfig: mocks.updateConfig }) },
}));

import { checkRecommendationUpdate, markRecommendationSeen, resolveRecommendationUpdate } from './recommendation-update.js';

const statePath = path.join(workDir, 'config', 'model-recommendations.json');

const RECS = {
    rowboat: {
        assistantModel: 'Auto',
        taskModels: { knowledgeGraph: 'Auto-background', chatTitle: 'Auto-background' },
    },
    openai: 'gpt-5.4',
};

function serveConfig(cfg: Record<string, unknown>): void {
    mocks.getConfig.mockImplementation(async () => ({ version: 2, providers: {}, ...cfg }));
}

function serveCatalog(providerId: string, models: string[], status: 'ok' | 'error' = 'ok'): void {
    mocks.getModelCatalog.mockImplementation(async () => ({
        providers: [{ id: providerId, flavor: providerId, status, models: models.map((id) => ({ id })) }],
        defaultModel: null,
    }));
}

async function readState(): Promise<Record<string, string>> {
    return JSON.parse(await fs.readFile(statePath, 'utf8')).seen;
}

beforeEach(async () => {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    mocks.getConfig.mockReset();
    mocks.updateConfig.mockReset();
    mocks.capture.mockReset();
    mocks.getRowboatConfig.mockImplementation(async () => ({ modelRecommendations: RECS }));
    serveConfig({ assistantModel: { provider: 'rowboat', model: 'google/gemini-3.5-flash' } });
    serveCatalog('rowboat', ['Auto', 'Auto-background', 'google/gemini-3.5-flash']);
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

process.on('exit', () => {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

describe('checkRecommendationUpdate', () => {
    it('offers the per-slot diff for the assistant\'s provider', async () => {
        const result = await checkRecommendationUpdate();
        expect(result.shouldShow).toBe(true);
        if (!result.shouldShow) return;
        expect(result.flavor).toBe('rowboat');
        expect(result.providerId).toBe('rowboat');
        expect(result.rows.map((r) => r.slot)).toEqual(['assistantModel', 'knowledgeGraph', 'chatTitle']);
        expect(mocks.capture).toHaveBeenCalledWith('llm_recommendation_update_shown', expect.objectContaining({ flavor: 'rowboat', row_count: 3 }));
    });

    it('resolves a BYOK provider\'s flavor through the providers map', async () => {
        serveConfig({
            providers: { openai: { flavor: 'openai', apiKey: 'k' } },
            assistantModel: { provider: 'openai', model: 'gpt-4.1' },
        });
        serveCatalog('openai', ['gpt-4.1', 'gpt-5.4']);
        const result = await checkRecommendationUpdate();
        expect(result).toMatchObject({ shouldShow: true, flavor: 'openai', rows: [{ slot: 'assistantModel' }] });
    });

    it('is quiet with no assistant, no recommendation for the flavor, or a failed listing', async () => {
        serveConfig({});
        expect(await checkRecommendationUpdate()).toEqual({ shouldShow: false });

        serveConfig({ providers: { ollama: { flavor: 'ollama' } }, assistantModel: { provider: 'ollama', model: 'llama3' } });
        expect(await checkRecommendationUpdate()).toEqual({ shouldShow: false });

        serveConfig({ assistantModel: { provider: 'rowboat', model: 'google/gemini-3.5-flash' } });
        serveCatalog('rowboat', [], 'error');
        expect(await checkRecommendationUpdate()).toEqual({ shouldShow: false });
        // A failed listing leaves no marker so the next launch retries.
        await expect(fs.readFile(statePath, 'utf8')).rejects.toThrow();
    });

    it('records a recommendation the config already matches as seen', async () => {
        serveConfig({
            assistantModel: { provider: 'rowboat', model: 'Auto' },
            taskModels: {
                knowledgeGraph: { provider: 'rowboat', model: 'Auto-background' },
                chatTitle: { provider: 'rowboat', model: 'Auto-background' },
            },
        });
        expect(await checkRecommendationUpdate()).toEqual({ shouldShow: false });
        expect(Object.keys(await readState())).toEqual(['rowboat']);
    });

    it('never throws: a failing config fetch is a quiet no-show', async () => {
        mocks.getRowboatConfig.mockRejectedValue(new Error('offline'));
        expect(await checkRecommendationUpdate()).toEqual({ shouldShow: false });
    });
});

describe('resolveRecommendationUpdate', () => {
    it('applies exactly the checked slots and records the version as seen', async () => {
        const shown = await checkRecommendationUpdate();
        if (!shown.shouldShow) throw new Error('expected a prompt');

        const result = await resolveRecommendationUpdate({ flavor: 'rowboat', hash: shown.hash, apply: ['assistantModel', 'chatTitle'] });
        expect(result.applied).toEqual(['assistantModel', 'chatTitle']);
        expect(mocks.updateConfig).toHaveBeenCalledWith({
            assistantModel: { provider: 'rowboat', model: 'Auto' },
            taskModels: { chatTitle: { provider: 'rowboat', model: 'Auto-background' } },
        });
        expect(await readState()).toEqual({ rowboat: shown.hash });
        expect(mocks.capture).toHaveBeenCalledWith('llm_recommendation_update_applied', expect.objectContaining({
            applied_slots: ['assistantModel', 'chatTitle'],
        }));

        // The same version is not offered again, even though the unchecked
        // knowledgeGraph slot still differs.
        expect(await checkRecommendationUpdate()).toEqual({ shouldShow: false });
    });

    it('"Not now" writes nothing but still records the version', async () => {
        const shown = await checkRecommendationUpdate();
        if (!shown.shouldShow) throw new Error('expected a prompt');

        const result = await resolveRecommendationUpdate({ flavor: 'rowboat', hash: shown.hash, apply: [] });
        expect(result.applied).toEqual([]);
        expect(mocks.updateConfig).not.toHaveBeenCalled();
        expect(await readState()).toEqual({ rowboat: shown.hash });
        expect(mocks.capture).toHaveBeenCalledWith('llm_recommendation_update_dismissed', expect.anything());
        expect(await checkRecommendationUpdate()).toEqual({ shouldShow: false });
    });

    it('re-derives rows at apply time so a stale dialog cannot clobber a newer edit', async () => {
        const shown = await checkRecommendationUpdate();
        if (!shown.shouldShow) throw new Error('expected a prompt');

        // The user set the assistant to the recommendation by hand while the
        // dialog was open: that slot no longer has a row.
        serveConfig({ assistantModel: { provider: 'rowboat', model: 'Auto' } });
        const result = await resolveRecommendationUpdate({ flavor: 'rowboat', hash: shown.hash, apply: ['assistantModel', 'knowledgeGraph'] });
        expect(result.applied).toEqual(['knowledgeGraph']);
        expect(mocks.updateConfig).toHaveBeenCalledWith({
            taskModels: { knowledgeGraph: { provider: 'rowboat', model: 'Auto-background' } },
        });
    });

    it('applies nothing when the recommendation version no longer matches', async () => {
        const result = await resolveRecommendationUpdate({ flavor: 'rowboat', hash: 'stale', apply: ['assistantModel'] });
        expect(result.applied).toEqual([]);
        expect(mocks.updateConfig).not.toHaveBeenCalled();
    });
});

describe('markRecommendationSeen', () => {
    it('suppresses the prompt for the current version only', async () => {
        await markRecommendationSeen('rowboat');
        expect(await checkRecommendationUpdate()).toEqual({ shouldShow: false });

        // A changed backend recommendation is a new version.
        mocks.getRowboatConfig.mockImplementation(async () => ({
            modelRecommendations: { ...RECS, rowboat: { assistantModel: 'Auto', taskModels: {} } },
        }));
        expect(await checkRecommendationUpdate()).toMatchObject({ shouldShow: true, rows: [{ slot: 'assistantModel' }] });
    });

    it('is a no-op for a flavor without a recommendation', async () => {
        await markRecommendationSeen('ollama');
        await expect(fs.readFile(statePath, 'utf8')).rejects.toThrow();
    });
});
