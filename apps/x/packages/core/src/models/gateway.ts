import { ProviderV2 } from '@ai-sdk/provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';
import { IClientRegistrationRepo } from '../auth/client-repo.js';
import { getProviderConfig } from '../auth/providers.js';
import * as oauthClient from '../auth/oauth-client.js';
import { ROWBOAT_AI_GATEWAY_BASE_URL } from '../config/env.js';

async function getAccessToken(): Promise<string> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const { tokens } = await oauthRepo.read('rowboat');
    if (!tokens) {
        throw new Error('Not signed into Rowboat');
    }

    if (!oauthClient.isTokenExpired(tokens)) {
        return tokens.access_token;
    }

    if (!tokens.refresh_token) {
        throw new Error('Rowboat token expired and no refresh token available. Please sign in again.');
    }

    const providerConfig = getProviderConfig('rowboat');
    if (providerConfig.discovery.mode !== 'issuer') {
        throw new Error('Rowboat provider requires issuer discovery mode');
    }

    const clientRepo = container.resolve<IClientRegistrationRepo>('clientRegistrationRepo');
    const registration = await clientRepo.getClientRegistration('rowboat');
    if (!registration) {
        throw new Error('Rowboat client not registered. Please sign in again.');
    }

    const config = await oauthClient.discoverConfiguration(
        providerConfig.discovery.issuer,
        registration.client_id,
    );

    const refreshed = await oauthClient.refreshTokens(
        config,
        tokens.refresh_token,
        tokens.scopes,
    );
    await oauthRepo.upsert('rowboat', { tokens: refreshed });

    return refreshed.access_token;
}

export async function getGatewayProvider(): Promise<ProviderV2> {
    const accessToken = await getAccessToken();
    return createOpenRouter({
        baseURL: ROWBOAT_AI_GATEWAY_BASE_URL,
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
    const response = await fetch(`${ROWBOAT_AI_GATEWAY_BASE_URL}/models`, {
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
