import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';
import { IClientRegistrationRepo } from '../auth/client-repo.js';
import { getProviderConfig } from '../auth/providers.js';
import * as oauthClient from '../auth/oauth-client.js';
import type { Configuration } from '../auth/oauth-client.js';
import { OAuthTokens } from '../auth/types.js';

const FIREFLIES_MCP_URL = 'https://api.fireflies.ai/mcp';

/**
 * Factory for creating and managing Fireflies MCP client instances.
 * Handles OAuth token management and client creation for Fireflies API.
 */
export class FirefliesClientFactory {
    private static readonly PROVIDER_NAME = 'fireflies-ai';
    private static cache: {
        config: Configuration | null;
        client: Client | null;
        tokens: OAuthTokens | null;
    } = {
        config: null,
        client: null,
        tokens: null,
    };

    /**
     * Get or create MCP Client for Fireflies, reusing cached instance when possible
     */
    static async getClient(): Promise<Client | null> {
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const tokens = await oauthRepo.getTokens(this.PROVIDER_NAME);

        if (!tokens) {
            this.clearCache();
            return null;
        }

        // Initialize config cache if needed (for token refresh)
        await this.initializeConfigCache();
        if (!this.cache.config) {
            return null;
        }

        // Check if token is expired
        if (oauthClient.isTokenExpired(tokens)) {
            // Token expired, try to refresh
            if (!tokens.refresh_token) {
                console.log("[Fireflies] Token expired and no refresh token available.");
                this.clearCache();
                return null;
            }

            try {
                console.log(`[Fireflies] Token expired, refreshing access token...`);
                const existingScopes = tokens.scopes;
                const refreshedTokens = await oauthClient.refreshTokens(
                    this.cache.config,
                    tokens.refresh_token,
                    existingScopes
                );
                await oauthRepo.saveTokens(this.PROVIDER_NAME, refreshedTokens);

                // Update cached tokens and recreate client
                this.cache.tokens = refreshedTokens;
                
                // Close existing client if any
                if (this.cache.client) {
                    await this.cache.client.close().catch(() => {});
                }
                
                this.cache.client = await this.createMcpClient(refreshedTokens);
                console.log(`[Fireflies] Token refreshed successfully`);
                return this.cache.client;
            } catch (error) {
                console.error("[Fireflies] Failed to refresh token:", error);
                this.clearCache();
                return null;
            }
        }

        // Reuse client if tokens haven't changed
        if (this.cache.client && this.cache.tokens && this.cache.tokens.access_token === tokens.access_token) {
            return this.cache.client;
        }

        // Create new client with current tokens
        console.log(`[Fireflies] Creating new MCP client instance`);
        this.cache.tokens = tokens;
        
        // Close existing client if any
        if (this.cache.client) {
            await this.cache.client.close().catch(() => {});
        }
        
        this.cache.client = await this.createMcpClient(tokens);
        return this.cache.client;
    }

    /**
     * Check if credentials are available
     */
    static async hasValidCredentials(): Promise<boolean> {
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const isConnected = await oauthRepo.isConnected(this.PROVIDER_NAME);

        if (!isConnected) {
            return false;
        }

        const tokens = await oauthRepo.getTokens(this.PROVIDER_NAME);
        return tokens !== null;
    }

    /**
     * Clear cache (useful for testing or when credentials are revoked)
     */
    static async clearCache(): Promise<void> {
        console.log(`[Fireflies] Clearing auth cache`);
        
        if (this.cache.client) {
            await this.cache.client.close().catch(() => {});
        }
        
        this.cache.config = null;
        this.cache.client = null;
        this.cache.tokens = null;
    }

    /**
     * Initialize cached configuration (called once)
     */
    private static async initializeConfigCache(): Promise<void> {
        if (this.cache.config) {
            return; // Already initialized
        }

        console.log(`[Fireflies] Initializing OAuth configuration...`);
        const providerConfig = getProviderConfig(this.PROVIDER_NAME);

        if (providerConfig.discovery.mode === 'issuer') {
            if (providerConfig.client.mode === 'static') {
                // Discover endpoints, use static client ID
                console.log(`[Fireflies] Discovery mode: issuer with static client ID`);
                this.cache.config = await oauthClient.discoverConfiguration(
                    providerConfig.discovery.issuer,
                    providerConfig.client.clientId
                );
            } else {
                // DCR mode - need existing registration
                console.log(`[Fireflies] Discovery mode: issuer with DCR`);
                const clientRepo = container.resolve<IClientRegistrationRepo>('clientRegistrationRepo');
                const existingRegistration = await clientRepo.getClientRegistration(this.PROVIDER_NAME);
                
                if (!existingRegistration) {
                    throw new Error('Fireflies client not registered. Please connect account first.');
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
            
            console.log(`[Fireflies] Using static endpoints (no discovery)`);
            this.cache.config = oauthClient.createStaticConfiguration(
                providerConfig.discovery.authorizationEndpoint,
                providerConfig.discovery.tokenEndpoint,
                providerConfig.client.clientId,
                providerConfig.discovery.revocationEndpoint
            );
        }

        console.log(`[Fireflies] OAuth configuration initialized`);
    }

    /**
     * Create MCP client with OAuth authentication
     */
    private static async createMcpClient(tokens: OAuthTokens): Promise<Client> {
        const url = new URL(FIREFLIES_MCP_URL);
        
        // Create transport with Authorization header
        const requestInit: RequestInit = {
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
            },
        };

        const transport = new StreamableHTTPClientTransport(url, { requestInit });

        const client = new Client({
            name: 'rowboatx-fireflies',
            version: '1.0.0',
        });

        await client.connect(transport);
        console.log(`[Fireflies] MCP client connected`);
        
        return client;
    }
}

