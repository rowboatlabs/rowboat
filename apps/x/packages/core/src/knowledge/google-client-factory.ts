import { OAuth2Client } from 'google-auth-library';
import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';
import { IClientRegistrationRepo } from '../auth/client-repo.js';
import { getProviderConfig } from '../auth/providers.js';
import * as oauthClient from '../auth/oauth-client.js';
import type { Configuration } from '../auth/oauth-client.js';
import { OAuthTokens } from '../auth/types.js';

/**
 * Factory for creating and managing Google OAuth2Client instances.
 * Handles caching, token refresh, and client reuse for Google API SDKs.
 */
export class GoogleClientFactory {
    private static readonly PROVIDER_NAME = 'google';
    private static cache: {
        config: Configuration | null;
        client: OAuth2Client | null;
        tokens: OAuthTokens | null;
        clientId: string | null;
        clientSecret: string | null;
    } = {
        config: null,
        client: null,
        tokens: null,
        clientId: null,
        clientSecret: null,
    };

    private static async resolveCredentials(): Promise<{ clientId: string; clientSecret?: string }> {
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
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const { tokens } = await oauthRepo.read(this.PROVIDER_NAME);

        if (!tokens) {
            this.clearCache();
            return null;
        }

        // Initialize config cache if needed
        try {
            await this.initializeConfigCache();
        } catch (error) {
            console.error("[OAuth] Failed to initialize Google OAuth configuration:", error);
            this.clearCache();
            return null;
        }
        if (!this.cache.config) {
            return null;
        }

        // Check if token is expired
        if (oauthClient.isTokenExpired(tokens)) {
            // Token expired, try to refresh
            if (!tokens.refresh_token) {
                console.log("[OAuth] Token expired and no refresh token available for Google.");
                await oauthRepo.upsert(this.PROVIDER_NAME, { error: 'Missing refresh token. Please reconnect.' });
                this.clearCache();
                return null;
            }

            try {
                console.log(`[OAuth] Token expired, refreshing access token...`);
                const existingScopes = tokens.scopes;
                const refreshedTokens = await oauthClient.refreshTokens(
                    this.cache.config,
                    tokens.refresh_token,
                    existingScopes
                );
                await oauthRepo.upsert(this.PROVIDER_NAME, { tokens: refreshedTokens });

                // Update cached tokens and recreate client
                this.cache.tokens = refreshedTokens;
                if (!this.cache.clientId) {
                    const creds = await this.resolveCredentials();
                    this.cache.clientId = creds.clientId;
                    this.cache.clientSecret = creds.clientSecret ?? null;
                }
                this.cache.client = this.createClientFromTokens(refreshedTokens, this.cache.clientId, this.cache.clientSecret ?? undefined);
                console.log(`[OAuth] Token refreshed successfully`);
                return this.cache.client;
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to refresh token for Google';
                await oauthRepo.upsert(this.PROVIDER_NAME, { error: message });
                console.error("[OAuth] Failed to refresh token for Google:", error);
                this.clearCache();
                return null;
            }
        }

        // Reuse client if tokens haven't changed
        if (this.cache.client && this.cache.tokens && this.cache.tokens.access_token === tokens.access_token) {
            return this.cache.client;
        }

        // Create new client with current tokens
        console.log(`[OAuth] Creating new OAuth2Client instance`);
        this.cache.tokens = tokens;
        if (!this.cache.clientId) {
            const creds = await this.resolveCredentials();
            this.cache.clientId = creds.clientId;
            this.cache.clientSecret = creds.clientSecret ?? null;
        }
        this.cache.client = this.createClientFromTokens(tokens, this.cache.clientId, this.cache.clientSecret ?? undefined);
        return this.cache.client;
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
        console.log(`[OAuth] Clearing Google auth cache`);
        this.cache.config = null;
        this.cache.client = null;
        this.cache.tokens = null;
        this.cache.clientId = null;
        this.cache.clientSecret = null;
    }

    /**
     * Initialize cached configuration (called once)
     */
    private static async initializeConfigCache(): Promise<void> {
        const { clientId, clientSecret } = await this.resolveCredentials();

        if (this.cache.config && this.cache.clientId === clientId && this.cache.clientSecret === (clientSecret ?? null)) {
            return; // Already initialized for these credentials
        }

        if (this.cache.clientId && (this.cache.clientId !== clientId || this.cache.clientSecret !== (clientSecret ?? null))) {
            this.clearCache();
        }

        console.log(`[OAuth] Initializing Google OAuth configuration...`);
        const providerConfig = await getProviderConfig(this.PROVIDER_NAME);

        if (providerConfig.discovery.mode === 'issuer') {
            if (providerConfig.client.mode === 'static') {
                // Discover endpoints, use static client ID
                console.log(`[OAuth] Discovery mode: issuer with static client ID`);
                this.cache.config = await oauthClient.discoverConfiguration(
                    providerConfig.discovery.issuer,
                    clientId,
                    clientSecret
                );
            } else {
                // DCR mode - need existing registration
                console.log(`[OAuth] Discovery mode: issuer with DCR`);
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

            console.log(`[OAuth] Using static endpoints (no discovery)`);
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
        console.log(`[OAuth] Google OAuth configuration initialized`);
    }

    /**
     * Create OAuth2Client from OAuthTokens
     */
    private static createClientFromTokens(tokens: OAuthTokens, clientId: string, clientSecret?: string): OAuth2Client {
        const client = new OAuth2Client(
            clientId,
            clientSecret ?? undefined,
            undefined  // redirect_uri not needed for token usage
        );

        // Set credentials
        client.setCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || undefined,
            expiry_date: tokens.expires_at * 1000, // Convert from seconds to milliseconds
            scope: tokens.scopes?.join(' ') || undefined,
        });

        return client;
    }
}
