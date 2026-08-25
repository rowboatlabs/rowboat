import { ProviderV4 } from '@ai-sdk/provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getAccessToken } from '../auth/tokens.js';
import { getCurrentUseCase } from '../analytics/use_case.js';
import { API_URL } from '../config/env.js';
import { annotateReasoningFlags } from './models-dev.js';

// Exported for transport-level verification; production passes this directly
// to the Rowboat OpenRouter provider.
export const authedFetch: typeof fetch = async (input, init) => {
    const token = await getAccessToken();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const ctx = getCurrentUseCase();
    if (ctx?.useCase) headers.set('x-rowboat-use-case', ctx.useCase);
    if (ctx?.subUseCase) headers.set('x-rowboat-sub-use-case', ctx.subUseCase);
    if (ctx?.agentName) headers.set('x-rowboat-agent-name', ctx.agentName);
    return fetch(input, { ...init, headers });
};

export function getGatewayProvider(): ProviderV4 {
    return createOpenRouter({
        baseURL: `${API_URL}/v1/llm`,
        apiKey: 'managed-by-rowboat',
        fetch: authedFetch,
    });
}

type ProviderSummary = {
    id: string;
    name: string;
    models: Array<{
        id: string;
        name?: string;
        release_date?: string;
        reasoning?: boolean;
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
    // The gateway returns bare "vendor/model" ids; the models.dev cache
    // supplies the reasoning capability the composer's effort control needs.
    const models = await annotateReasoningFlags(body.data.map((m) => ({ id: m.id })));
    return {
        providers: [{
            id: 'rowboat',
            name: 'Rowboat',
            models,
        }],
    };
}

/**
 * The gateway's image-model allowlist: /v1/llm/models filtered to image
 * output (entries carry architecture.output_modalities). The filter is
 * applied server-side, so an entry without the field is kept rather than
 * dropped. Parsing is defensive — an odd body yields an empty list, never
 * a throw; only a failed request throws, so the catalog can surface it.
 */
export async function listGatewayImageModels(): Promise<string[]> {
    const accessToken = await getAccessToken();
    const response = await fetch(`${API_URL}/v1/llm/models?output_modalities=image`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        throw new Error(`Gateway /v1/models?output_modalities=image failed: ${response.status}`);
    }
    const body: unknown = await response.json().catch(() => null);
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return [];
    return data.flatMap((entry: unknown) => {
        const id = (entry as { id?: unknown } | null)?.id;
        if (typeof id !== 'string' || id.length === 0) return [];
        const modalities = (entry as { architecture?: { output_modalities?: unknown } }).architecture?.output_modalities;
        if (Array.isArray(modalities) && !modalities.includes('image')) return [];
        return [id];
    });
}
