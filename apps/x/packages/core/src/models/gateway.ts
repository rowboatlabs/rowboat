import { ProviderV2 } from '@ai-sdk/provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getAccessToken } from '../auth/tokens.js';
import { API_URL } from '../config/env.js';
import { isGitHubCopilotAuthenticated } from '../auth/github-copilot-auth.js';

const authedFetch: typeof fetch = async (input, init) => {
    const token = await getAccessToken();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
};

export async function getGatewayProvider(): Promise<ProviderV2> {
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
    
    const providers: ProviderSummary[] = [{
        id: 'rowboat',
        name: 'Rowboat',
        models,
    }];

    // Add GitHub Copilot models always so they appear in UI
    providers.push({
        id: "github-copilot",
        name: "GitHub Copilot Student",
        models: [
            { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
            { id: "gpt-5-mini", name: "GPT-5 mini" },
            { id: "grok-code-fast-1", name: "Grok Code Fast 1" },
            { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
            { id: "gemini-3-flash-preview", name: "Gemini 3 Flash (Preview)" },
            { id: "gpt-5.2", name: "GPT-5.2" },
            { id: "gpt-4.1", name: "GPT-4.1" },
            { id: "gpt-4o", name: "GPT-4o" },
            { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)" },
            { id: "gpt-5.2-codex", name: "GPT-5.2-Codex" },
            { id: "gpt-5.3-codex", name: "GPT-5.3-Codex" },
            { id: "gemini-2.5-pro-preview", name: "Gemini 2.5 Pro (Preview)" }
        ],
    });

    return { providers };
}
