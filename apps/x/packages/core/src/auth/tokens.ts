import container from '../di/container.js';
import { IOAuthRepo } from './repo.js';
import { IClientRegistrationRepo } from './client-repo.js';
import { getProviderConfig } from './providers.js';
import * as oauthClient from './oauth-client.js';
import { OAuthTokens } from './types.js';

let refreshInFlight: Promise<OAuthTokens> | null = null;

async function performRefresh(tokens: OAuthTokens): Promise<OAuthTokens> {
    console.log("Refreshing rowboat access token");
    if (!tokens.refresh_token) {
        throw new Error('Rowboat token expired and no refresh token available. Please sign in again.');
    }

    const providerConfig = await getProviderConfig('rowboat');
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

    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    await oauthRepo.upsert('rowboat', { tokens: refreshed });

    return refreshed;
}

export async function getAccessToken(): Promise<string> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const { tokens } = await oauthRepo.read('rowboat');
    if (!tokens) {
        throw new Error('Not signed into Rowboat');
    }

    if (!oauthClient.isTokenExpired(tokens)) {
        return tokens.access_token;
    }

    if (!refreshInFlight) {
        refreshInFlight = performRefresh(tokens).finally(() => {
            refreshInFlight = null;
        });
    }
    const refreshed = await refreshInFlight;
    return refreshed.access_token;
}
