import { describe, expect, it } from 'vitest';
import { selectInitialModel } from './initial-selection.js';

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
});
