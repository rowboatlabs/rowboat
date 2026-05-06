import { OAuth2Client } from 'google-auth-library';
import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';
import { IClientRegistrationRepo } from '../auth/client-repo.js';
import { getProviderConfig } from '../auth/providers.js';
import * as oauthClient from '../auth/oauth-client.js';
import type { Configuration } from '../auth/oauth-client.js';
import { OAuthTokens } from '../auth/types.js';
import {
    ReconnectRequiredError,
    refreshTokensViaBackend,
} from '../auth/google-backend-oauth.js';

type Mode = 'byok' | 'rowboat';

/**
 * Factory for creating and managing Google OAuth2Client instances.
 * Handles caching, token refresh, and client reuse for Google API SDKs.
 *
 * Two connection modes share the same `oauth.json` provider entry:
 *   - `byok`    user supplied client_id+secret; refresh runs locally via
 *               openid-client; OAuth2Client built with creds.
 *   - `rowboat` signed-in user; client_id+secret never on the desktop;
 *               refresh goes through the api at /v1/google-oauth/refresh;
 *               OAuth2Client built without creds and without refresh_token
 *               (we own all refreshes — see note below).
 *
 * **Auto-refresh disabled in rowboat mode:** google-auth-library's
 * OAuth2Client will, on a 401 from a Google API call, try to refresh using
 * the refresh_token + client secret it has on hand. In rowboat mode we have
 * no secret, so that would 401-loop. We block this by passing only
 * access_token + expiry_date in setCredentials (no refresh_token), which
 * leaves the library nothing to refresh with. Our proactive expiry check
 * in getClient() is the only refresh path.
 */
export class GoogleClientFactory {
    private static readonly PROVIDER_NAME = 'google';
    private static cache: {
        mode: Mode | null;
        config: Configuration | null;
        client: OAuth2Client | null;
        tokens: OAuthTokens | null;
        clientId: string | null;
        clientSecret: string | null;
    } = {
        mode: null,
        config: null,
        client: null,
        tokens: null,
        clientId: null,
        clientSecret: null,
    };

    /**
     * Promise singleton so a burst of getClient() calls during the brief
     * expiry window all wait on a single refresh round-trip rather than
     * fanning out parallel refreshes.
     */
    private static refreshInFlight: Promise<OAuth2Client | null> | null = null;

    private static async resolveByokCredentials(): Promise<{ clientId: string; clientSecret?: string }> {
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const connection = await oauthRepo.read(this.PROVIDER_NAME);
        if (!connection.clientId) {
            await oauthRepo.upsert(this.PROVIDER_NAME, { error: 'Google client ID missing. Please reconnect.' });
            throw new Error('Google client ID missing. Please reconnect.');
        }
        return { clientId: connection.clientId, clientSecret: connection.clientSecret ?? undefined };
    }

    /**
     * Get or create OAuth2Client, reusing cached instance when possible
     */
    static async getClient(): Promise<OAuth2Client | null> {
        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }

        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const connection = await oauthRepo.read(this.PROVIDER_NAME);
        const tokens = connection.tokens ?? null;
        const mode: Mode = connection.mode ?? 'byok';

        if (!tokens) {
            this.clearCache();
            return null;
        }

        // Mode flipped (e.g. user disconnected then reconnected differently) — invalidate.
        if (this.cache.mode && this.cache.mode !== mode) {
            this.clearCache();
        }

        // BYOK needs an openid-client Configuration for local refresh; rowboat doesn't.
        if (mode === 'byok') {
            try {
                await this.initializeConfigCache();
            } catch (error) {
                console.error('[OAuth] Failed to initialize Google OAuth configuration:', error);
                this.clearCache();
                return null;
            }
            if (!this.cache.config) {
                return null;
            }
        }

        // Check expiry against the cached tokens. Note: oauthClient.isTokenExpired
        // applies a small clock-skew margin so we refresh slightly before real
        // expiry — keeps long-running calls from racing the boundary.
        if (oauthClient.isTokenExpired(tokens)) {
            if (!tokens.refresh_token) {
                console.log('[OAuth] Token expired and no refresh token available for Google.');
                await oauthRepo.upsert(this.PROVIDER_NAME, { error: 'Missing refresh token. Please reconnect.' });
                this.clearCache();
                return null;
            }

            this.refreshInFlight = this.refreshAndBuild(tokens, mode).finally(() => {
                this.refreshInFlight = null;
            });
            return this.refreshInFlight;
        }

        // Reuse client if tokens haven't changed
        if (this.cache.client && this.cache.tokens && this.cache.tokens.access_token === tokens.access_token && this.cache.mode === mode) {
            return this.cache.client;
        }

        // Build a fresh client for current tokens
        return this.buildAndCacheClient(tokens, mode);
    }

    private static async refreshAndBuild(tokens: OAuthTokens, mode: Mode): Promise<OAuth2Client | null> {
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');

        try {
            console.log(`[OAuth] Token expired, refreshing via ${mode}...`);
            const existingScopes = tokens.scopes;

            let refreshedTokens: OAuthTokens;
            if (mode === 'rowboat') {
                refreshedTokens = await refreshTokensViaBackend(tokens.refresh_token!, existingScopes);
            } else {
                if (!this.cache.config) {
                    // Should not happen — initializeConfigCache ran above for byok.
                    throw new Error('Google OAuth config not initialized');
                }
                refreshedTokens = await oauthClient.refreshTokens(this.cache.config, tokens.refresh_token!, existingScopes);
            }

            await oauthRepo.upsert(this.PROVIDER_NAME, { tokens: refreshedTokens, error: null });
            console.log('[OAuth] Token refreshed successfully');
            return this.buildAndCacheClient(refreshedTokens, mode);
        } catch (error) {
            if (error instanceof ReconnectRequiredError) {
                console.log('[OAuth] Reconnect required for Google');
                await oauthRepo.upsert(this.PROVIDER_NAME, { error: 'Reconnect Google' });
                this.clearCache();
                return null;
            }
            const message = error instanceof Error ? error.message : 'Failed to refresh token for Google';
            await oauthRepo.upsert(this.PROVIDER_NAME, { error: message });
            console.error('[OAuth] Failed to refresh token for Google:', error);
            this.clearCache();
            return null;
        }
    }

    private static async buildAndCacheClient(tokens: OAuthTokens, mode: Mode): Promise<OAuth2Client> {
        if (mode === 'byok' && !this.cache.clientId) {
            const creds = await this.resolveByokCredentials();
            this.cache.clientId = creds.clientId;
            this.cache.clientSecret = creds.clientSecret ?? null;
        }

        const client = mode === 'rowboat'
            ? this.createRowboatClient(tokens)
            : this.createByokClient(tokens, this.cache.clientId!, this.cache.clientSecret ?? undefined);

        this.cache.mode = mode;
        this.cache.tokens = tokens;
        this.cache.client = client;
        return client;
    }

    /**
     * Check if credentials are available and have required scopes
     */
    static async hasValidCredentials(requiredScopes: string | string[]): Promise<boolean> {
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const { tokens } = await oauthRepo.read(this.PROVIDER_NAME);
        if (!tokens) {
            return false;
        }

        // Check if required scope(s) are present
        const scopesArray = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
        if (!tokens.scopes || tokens.scopes.length === 0) {
            return false;
        }
        return scopesArray.every(scope => tokens.scopes!.includes(scope));
    }

    /**
     * Clear cache (useful for testing or when credentials are revoked)
     */
    static clearCache(): void {
        console.log('[OAuth] Clearing Google auth cache');
        this.cache.mode = null;
        this.cache.config = null;
        this.cache.client = null;
        this.cache.tokens = null;
        this.cache.clientId = null;
        this.cache.clientSecret = null;
    }

    /**
     * Initialize cached configuration for BYOK mode (rowboat doesn't need it).
     */
    private static async initializeConfigCache(): Promise<void> {
        const { clientId, clientSecret } = await this.resolveByokCredentials();

        if (this.cache.config && this.cache.clientId === clientId && this.cache.clientSecret === (clientSecret ?? null)) {
            return; // Already initialized for these credentials
        }

        if (this.cache.clientId && (this.cache.clientId !== clientId || this.cache.clientSecret !== (clientSecret ?? null))) {
            this.clearCache();
        }

        console.log('[OAuth] Initializing Google OAuth configuration...');
        const providerConfig = await getProviderConfig(this.PROVIDER_NAME);

        if (providerConfig.discovery.mode === 'issuer') {
            if (providerConfig.client.mode === 'static') {
                // Discover endpoints, use static client ID
                console.log('[OAuth] Discovery mode: issuer with static client ID');
                this.cache.config = await oauthClient.discoverConfiguration(
                    providerConfig.discovery.issuer,
                    clientId,
                    clientSecret
                );
            } else {
                // DCR mode - need existing registration
                console.log('[OAuth] Discovery mode: issuer with DCR');
                const clientRepo = container.resolve<IClientRegistrationRepo>('clientRegistrationRepo');
                const existingRegistration = await clientRepo.getClientRegistration(this.PROVIDER_NAME);

                if (!existingRegistration) {
                    throw new Error('Google client not registered. Please connect account first.');
                }

                this.cache.config = await oauthClient.discoverConfiguration(
                    providerConfig.discovery.issuer,
                    existingRegistration.client_id
                );
            }
        } else {
            // Static endpoints
            if (providerConfig.client.mode !== 'static') {
                throw new Error('DCR requires discovery mode "issuer", not "static"');
            }

            console.log('[OAuth] Using static endpoints (no discovery)');
            this.cache.config = oauthClient.createStaticConfiguration(
                providerConfig.discovery.authorizationEndpoint,
                providerConfig.discovery.tokenEndpoint,
                clientId,
                providerConfig.discovery.revocationEndpoint,
                clientSecret
            );
        }

        this.cache.clientId = clientId;
        this.cache.clientSecret = clientSecret ?? null;
        console.log('[OAuth] Google OAuth configuration initialized');
    }

    /** BYOK OAuth2Client — has client_id + secret + refresh_token. */
    private static createByokClient(tokens: OAuthTokens, clientId: string, clientSecret?: string): OAuth2Client {
        const client = new OAuth2Client(clientId, clientSecret ?? undefined, undefined);
        client.setCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || undefined,
            expiry_date: tokens.expires_at * 1000,
            scope: tokens.scopes?.join(' ') || undefined,
        });
        return client;
    }

    /**
     * Rowboat OAuth2Client — no client_id/secret, no refresh_token.
     * Library auto-refresh is disabled by absence of refresh_token; our
     * proactive refresh in getClient() is the only refresh path.
     */
    private static createRowboatClient(tokens: OAuthTokens): OAuth2Client {
        const client = new OAuth2Client();
        client.setCredentials({
            access_token: tokens.access_token,
            expiry_date: tokens.expires_at * 1000,
            scope: tokens.scopes?.join(' ') || undefined,
        });
        return client;
    }
}
