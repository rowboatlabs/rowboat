import { describe, expect, it } from 'vitest';
import { migrateModelsConfig } from './migrate.js';

/**
 * The migration contract: evaluate the v1 resolution rules (including the
 * curated signed-in defaults that lived only in code) one last time and
 * write their answers explicitly, so v2's simple "override else assistant"
 * rules produce identical effective models. Overrides are written ONLY
 * where the old effective model differs from inherit-from-assistant.
 */

describe('migrateModelsConfig', () => {
    it('returns null for a config that is already v2', () => {
        expect(migrateModelsConfig({ version: 2, providers: {} }, false)).toBeNull();
    });

    it('signed-out BYOK: adopts the top-level pair as assistant, writes no task overrides', () => {
        const v1 = {
            provider: { flavor: 'openai', apiKey: 'sk-a' },
            model: 'gpt-5.4',
            providers: { openai: { apiKey: 'sk-a', model: 'gpt-5.4', models: ['gpt-5.4'] } },
        };
        expect(migrateModelsConfig(v1, false)).toEqual({
            version: 2,
            providers: { openai: { flavor: 'openai', apiKey: 'sk-a' } },
            assistantModel: { provider: 'openai', model: 'gpt-5.4' },
        });
    });

    it('signed-in with untouched bootstrap config: materializes the curated defaults', () => {
        // The classic signed-in models.json — the bootstrap file that nothing
        // ever wrote to; every effective model lived in code branches.
        const v1 = { provider: { flavor: 'openai' }, model: 'gpt-5.4' };
        expect(migrateModelsConfig(v1, true)).toEqual({
            version: 2,
            providers: {}, // bootstrap top-level pair had no credentials
            assistantModel: { provider: 'rowboat', model: 'google/gemini-3.5-flash' },
            taskModels: {
                knowledgeGraph: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' },
                liveNoteAgent: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' },
                // v1 background tasks mirrored the live-note model.
                backgroundTask: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' },
                autoPermissionDecision: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' },
                // chat titles used flash-lite because the assistant routes
                // through the gateway; meeting notes used the curated default
                // which EQUALS the assistant → no override written for it.
                chatTitle: { provider: 'rowboat', model: 'google/gemini-3.5-flash-lite' },
            },
        });
    });

    it('signed-in user with a BYOK defaultSelection: keeps it, materializes the differing task models', () => {
        const v1 = {
            provider: { flavor: 'ollama', baseURL: 'http://localhost:11434' },
            model: 'llama3',
            providers: { ollama: { baseURL: 'http://localhost:11434', model: 'llama3' } },
            defaultSelection: { provider: 'ollama', model: 'llama3' },
        };
        const v2 = migrateModelsConfig(v1, true);
        expect(v2?.assistantModel).toEqual({ provider: 'ollama', model: 'llama3' });
        expect(v2?.taskModels).toEqual({
            knowledgeGraph: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' },
            liveNoteAgent: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' },
            backgroundTask: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' },
            autoPermissionDecision: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' },
            // Meeting notes used the curated gateway default, which now
            // differs from the (BYOK) assistant — preserved explicitly.
            meetingNotes: { provider: 'rowboat', model: 'google/gemini-3.5-flash' },
            // Chat titles followed the assistant whenever it was NOT the
            // gateway — inherit reproduces that, so no override.
        });
    });

    it('explicit v1 overrides survive: legacy strings pair with the top-level flavor, refs pass through', () => {
        const v1 = {
            provider: { flavor: 'openai', apiKey: 'sk-a' },
            model: 'gpt-5.4',
            providers: { openai: { apiKey: 'sk-a' } },
            knowledgeGraphModel: 'gpt-5.4-mini', // legacy string form
            meetingNotesModel: { provider: 'ollama', model: 'qwen3' }, // ref form
        };
        const v2 = migrateModelsConfig(v1, false);
        expect(v2?.taskModels).toEqual({
            knowledgeGraph: { provider: 'openai', model: 'gpt-5.4-mini' },
            meetingNotes: { provider: 'ollama', model: 'qwen3' },
        });
    });

    it('a v1 live-note override propagates to backgroundTask (v1 bg tasks mirrored live-note)', () => {
        const v1 = {
            provider: { flavor: 'openai', apiKey: 'sk-a' },
            model: 'gpt-5.4',
            liveNoteAgentModel: { provider: 'ollama', model: 'qwen3' },
        };
        expect(migrateModelsConfig(v1, false)?.taskModels).toEqual({
            liveNoteAgent: { provider: 'ollama', model: 'qwen3' },
            backgroundTask: { provider: 'ollama', model: 'qwen3' },
        });
    });

    it('an override equal to the assistant is dropped (inherit produces the same model)', () => {
        const v1 = {
            provider: { flavor: 'openai', apiKey: 'sk-a' },
            model: 'gpt-5.4',
            knowledgeGraphModel: 'gpt-5.4',
        };
        expect(migrateModelsConfig(v1, false)?.taskModels).toBeUndefined();
    });

    it('a rowboat defaultSelection is skipped while signed out (needs auth), like v1 resolution did', () => {
        const v1 = {
            provider: { flavor: 'openai', apiKey: 'sk-a' },
            model: 'gpt-5.4',
            defaultSelection: { provider: 'rowboat', model: 'google/gemini-3.5-flash' },
        };
        expect(migrateModelsConfig(v1, false)?.assistantModel)
            .toEqual({ provider: 'openai', model: 'gpt-5.4' });
    });

    it('providers without credentials are dropped; connection prefs survive', () => {
        const v1 = {
            provider: { flavor: 'openai', apiKey: 'sk-a' },
            model: 'gpt-5.4',
            providers: {
                openai: { apiKey: 'sk-a', models: ['gpt-5.4'] },
                anthropic: { model: 'claude-opus-4-8' }, // no key: never connected
                ollama: { baseURL: 'http://localhost:11434', contextLength: 32768, reasoningEffort: 'low' },
            },
        };
        expect(migrateModelsConfig(v1, false)?.providers).toEqual({
            openai: { flavor: 'openai', apiKey: 'sk-a' },
            ollama: { flavor: 'ollama', baseURL: 'http://localhost:11434', contextLength: 32768, reasoningEffort: 'low' },
        });
    });

    it('degrades gracefully on garbage input: empty v2 config', () => {
        expect(migrateModelsConfig('not an object', false)).toEqual({ version: 2, providers: {} });
        expect(migrateModelsConfig({}, false)).toEqual({ version: 2, providers: {} });
    });

    it('deferBackgroundTasks is carried over', () => {
        const v1 = { provider: { flavor: 'openai', apiKey: 'sk-a' }, model: 'gpt-5.4', deferBackgroundTasks: true };
        expect(migrateModelsConfig(v1, false)?.deferBackgroundTasks).toBe(true);
    });
});
