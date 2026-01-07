import { OAuth2Client } from 'google-auth-library';
import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';
import { IClientRegistrationRepo } from '../auth/client-repo.js';
import { getProviderConfig } from '../auth/providers.js';
import { OAuthService } from '../auth/oauth.js';
import { discoverAuthorizationServer, createStaticMetadata, AuthorizationServerMetadata } from '../auth/discovery.js';
import { OAuthTokens } from '../auth/types.js';

/**
 * Factory for creating and managing Google OAuth2Client instances.
 * Handles caching, token refresh, and client reuse for Google API SDKs.
 */
export class GoogleClientFactory {
    private static readonly PROVIDER_NAME = 'google';
    private static cache: {
        metadata: AuthorizationServerMetadata | null;
        clientId: string | null;
        client: OAuth2Client | null;
        tokens: OAuthTokens | null;
    } = {
        metadata: null,
        clientId: null,
        client: null,
        tokens: null,
    };

    /**
     * Get or create OAuth2Client, reusing cached instance when possible
     */
    static async getClient(): Promise<OAuth2Client | null> {
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const tokens = await oauthRepo.getTokens(this.PROVIDER_NAME);

        if (!tokens) {
            this.clearCache();
            return null;
        }

        // Initialize auth cache if needed
        await this.initializeAuthCache();
        if (!this.cache.metadata || !this.cache.clientId) {
            return null;
        }

        // Check if token is expired
        const now = Math.floor(Date.now() / 1000);
        if (tokens.expires_at <= now) {
            // Token expired, try to refresh
            if (!tokens.refresh_token) {
                console.log("Token expired and no refresh token available for Google.");
                this.clearCache();
                return null;
            }

            try {
                console.log(`[OAuth] Token expired, refreshing access token...`);
                const config = getProviderConfig(this.PROVIDER_NAME);
                const scopes = config.scopes || [];
                const oauthService = new OAuthService(this.cache.metadata, this.cache.clientId, scopes);

                const existingScopes = tokens.scopes;
                const refreshedTokens = await oauthService.refreshAccessToken(tokens.refresh_token, existingScopes);
                await oauthRepo.saveTokens(this.PROVIDER_NAME, refreshedTokens);

                // Update cached tokens and recreate client
                this.cache.tokens = refreshedTokens;
                this.cache.client = this.createClientFromTokens(refreshedTokens, this.cache.clientId);
                console.log(`[OAuth] Token refreshed successfully`);
                return this.cache.client;
            } catch (error) {
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
        this.cache.client = this.createClientFromTokens(tokens, this.cache.clientId);
        return this.cache.client;
    }

    /**
     * Check if credentials are available and have required scopes
     */
    static async hasValidCredentials(requiredScopes: string | string[]): Promise<boolean> {
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const isConnected = await oauthRepo.isConnected(this.PROVIDER_NAME);

        if (!isConnected) {
            return false;
        }

        const tokens = await oauthRepo.getTokens(this.PROVIDER_NAME);
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
        this.cache.client = null;
        this.cache.tokens = null;
    }

    /**
     * Initialize cached metadata and client ID (called once)
     */
    private static async initializeAuthCache(): Promise<void> {
        if (this.cache.metadata && this.cache.clientId) {
            return; // Already initialized
        }

        console.log(`[OAuth] Initializing Google auth cache...`);
        const config = getProviderConfig(this.PROVIDER_NAME);

        // Get metadata
        let metadata: AuthorizationServerMetadata;
        if (config.discovery.mode === 'issuer') {
            console.log(`[OAuth] Discovery mode: issuer (${config.discovery.issuer})`);
            metadata = await discoverAuthorizationServer(config.discovery.issuer);
        } else {
            console.log(`[OAuth] Discovery mode: static endpoints`);
            metadata = createStaticMetadata(
                config.discovery.authorizationEndpoint,
                config.discovery.tokenEndpoint,
                config.discovery.revocationEndpoint
            );
        }

        // Get client ID
        let clientId: string;
        if (config.client.mode === 'static') {
            if (!config.client.clientId) {
                throw new Error('Static client mode requires clientId in provider configuration for Google');
            }
            console.log(`[OAuth] Client mode: static (using configured clientId)`);
            clientId = config.client.clientId;
        } else {
            console.log(`[OAuth] Client mode: DCR (Dynamic Client Registration)`);
            const clientRepo = container.resolve<IClientRegistrationRepo>('clientRegistrationRepo');
            const registrationEndpoint = config.client.registrationEndpoint || metadata.registration_endpoint;
            if (!registrationEndpoint) {
                throw new Error('Google provider does not support Dynamic Client Registration');
            }

            const existingRegistration = await clientRepo.getClientRegistration(this.PROVIDER_NAME);
            if (!existingRegistration) {
                throw new Error('Google client not registered. Please connect account first.');
            }
            console.log(`[OAuth] Using existing DCR client registration`);
            clientId = existingRegistration.client_id;
        }

        // Store in cache
        this.cache.metadata = metadata;
        this.cache.clientId = clientId;
        console.log(`[OAuth] Google auth cache initialized`);
    }

    /**
     * Create OAuth2Client from OAuthTokens
     */
    private static createClientFromTokens(tokens: OAuthTokens, clientId: string): OAuth2Client {
        // Create OAuth2Client directly (PKCE flow doesn't use client secret)
        const client = new OAuth2Client(
            clientId,
            undefined, // client_secret not needed for PKCE
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

