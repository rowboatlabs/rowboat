import { describe, expect, it } from 'vitest';
import { selectInitialModel, selectInitialTaskModels } from './initial-selection.js';

describe('selectInitialModel', () => {
    const recommendations = {
        openai: 'gpt-5.4',
        openrouter: 'anthropic/claude-opus-4.8',
    };

    it('picks the recommended model when the provider lists it', () => {
        expect(selectInitialModel('openai', ['gpt-4.1', 'gpt-5.4', 'gpt-5.4-mini'], recommendations))
            .toBe('gpt-5.4');
    });

    it('falls back to the first listed model when the recommendation is not in the list', () => {
        expect(selectInitialModel('openai', ['gpt-4.1', 'gpt-4o'], recommendations))
            .toBe('gpt-4.1');
    });

    it('falls back to the first listed model for flavors with no recommendation', () => {
        expect(selectInitialModel('ollama', ['llama3', 'qwen3'], recommendations))
            .toBe('llama3');
    });

    it('falls back to the first listed model when no recommendations map is available', () => {
        expect(selectInitialModel('openai', ['gpt-4.1'], undefined)).toBe('gpt-4.1');
    });

    it('returns null when the provider listed nothing', () => {
        expect(selectInitialModel('openai', [], recommendations)).toBeNull();
    });

    it('accepts the nested { assistantModel, taskModels } wire shape', () => {
        const nested = { rowboat: { assistantModel: 'google/gemini-3.5-flash', taskModels: {} } };
        expect(selectInitialModel('rowboat', ['a', 'google/gemini-3.5-flash'], nested))
            .toBe('google/gemini-3.5-flash');
    });
});

describe('selectInitialTaskModels', () => {
    const gatewayList = [
        'google/gemini-3.5-flash',
        'google/gemini-3.1-flash-lite',
        'google/gemini-3.5-flash-lite',
    ];
    const nested = {
        rowboat: {
            assistantModel: 'google/gemini-3.5-flash',
            taskModels: {
                knowledgeGraph: 'google/gemini-3.1-flash-lite',
                chatTitle: 'google/gemini-3.5-flash-lite',
                // Equal to the assistant → redundant, inherit produces it.
                meetingNotes: 'google/gemini-3.5-flash',
                // Not in the provider's list → stale hint, skipped.
                liveNoteAgent: 'google/gemini-9-experimental',
                // Unknown key → ignored.
                somethingNew: 'google/gemini-3.1-flash-lite',
            },
        },
    };

    it('writes overrides only for listed recs that differ from the assistant', () => {
        expect(selectInitialTaskModels('rowboat', 'rowboat', gatewayList, nested, 'google/gemini-3.5-flash'))
            .toEqual({
                knowledgeGraph: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' },
                chatTitle: { provider: 'rowboat', model: 'google/gemini-3.5-flash-lite' },
            });
    });

    it('returns nothing for legacy flat recommendations or absent maps', () => {
        expect(selectInitialTaskModels('rowboat', 'rowboat', gatewayList, { rowboat: 'google/gemini-3.5-flash' }, 'x'))
            .toEqual({});
        expect(selectInitialTaskModels('rowboat', 'rowboat', gatewayList, undefined, 'x')).toEqual({});
    });
});
