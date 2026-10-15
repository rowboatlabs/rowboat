import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createOpenAICompatible: vi.fn(() => ({ languageModel: vi.fn() })),
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
    createOpenAICompatible: mocks.createOpenAICompatible,
}));

import {
    ATLAS_CLOUD_BASE_URL,
    createProvider,
    listModelsForProvider,
    Provider,
} from './models.js';

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('Atlas Cloud provider', () => {
    it('is accepted as a provider flavor', () => {
        expect(Provider.parse({ flavor: 'atlascloud', apiKey: 'test-key' })).toEqual({
            flavor: 'atlascloud',
            apiKey: 'test-key',
        });
    });

    it('uses the OpenAI-compatible adapter and default endpoint', () => {
        createProvider({ flavor: 'atlascloud', apiKey: 'test-key' });

        expect(mocks.createOpenAICompatible).toHaveBeenCalledWith({
            name: 'atlascloud',
            apiKey: 'test-key',
            baseURL: ATLAS_CLOUD_BASE_URL,
            headers: undefined,
        });
    });

    it('discovers models from the Atlas Cloud catalog', async () => {
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ data: [{ id: 'deepseek-ai/deepseek-v4-pro' }] }),
            { status: 200 },
        ));
        vi.stubGlobal('fetch', fetchMock);

        const models = await listModelsForProvider({
            flavor: 'atlascloud',
            apiKey: 'test-key',
        });

        expect(models).toEqual(['deepseek-ai/deepseek-v4-pro']);
        expect(fetchMock).toHaveBeenCalledWith(
            `${ATLAS_CLOUD_BASE_URL}/models`,
            expect.objectContaining({
                headers: { Authorization: 'Bearer test-key' },
            }),
        );
    });
});
