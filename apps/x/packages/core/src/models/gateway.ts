import { ProviderV2 } from '@ai-sdk/provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getAccessToken } from '../auth/tokens.js';
import { API_URL } from '../config/env.js';

export async function getGatewayProvider(): Promise<ProviderV2> {
    const accessToken = await getAccessToken();
    return createOpenRouter({
        baseURL: `${API_URL}/v1/llm`,
        apiKey: accessToken,
    });
}

type ProviderSummary = {
    id: string;
    name: string;
    models: Array<{
        id: string;
        name?: string;
        release_date?: string;
    }>;
};

export async function listGatewayModels(): Promise<{ providers: ProviderSummary[] }> {
    const accessToken = await getAccessToken();
    const response = await fetch(`${API_URL}/v1/llm/models`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        throw new Error(`Gateway /v1/models failed: ${response.status}`);
    }
    const body = await response.json() as { data: Array<{ id: string }> };
    const models = body.data.map((m) => ({ id: m.id }));
    return {
        providers: [{
            id: 'rowboat',
            name: 'Rowboat',
            models,
        }],
    };
}
