import { BrowserWindow } from 'electron';
import { randomBytes } from 'crypto';
import { createAuthServer } from './auth-server.js';
import { generateCodeVerifier, generateCodeChallenge } from '@x/core/dist/auth/pkce.js';
import { OAuthService } from '@x/core/dist/auth/oauth.js';
import { getProviderConfig, getAvailableProviders } from '@x/core/dist/auth/providers.js';
import { discoverAuthorizationServer, createStaticMetadata, AuthorizationServerMetadata } from '@x/core/dist/auth/discovery.js';
import container from '@x/core/dist/di/container.js';
import { IOAuthRepo } from '@x/core/dist/auth/repo.js';
import { IClientRegistrationRepo } from '@x/core/dist/auth/client-repo.js';

const REDIRECT_URI = 'http://localhost:8080/oauth/callback';

// Store active OAuth flows (state -> { codeVerifier, provider })
const activeFlows = new Map<string, { codeVerifier: string; provider: string }>();

/**
 * Generate a random state string for CSRF protection
 */
function generateState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Get OAuth repository from DI container
 */
function getOAuthRepo(): IOAuthRepo {
  return container.resolve<IOAuthRepo>('oauthRepo');
}

/**
 * Get client registration repository from DI container
 */
function getClientRegistrationRepo(): IClientRegistrationRepo {
  return container.resolve<IClientRegistrationRepo>('clientRegistrationRepo');
}

/**
 * Discover or get provider metadata
 */
async function getProviderMetadata(provider: string): Promise<AuthorizationServerMetadata> {
  const config = getProviderConfig(provider);

  if (config.discovery.mode === 'issuer') {
    // Discover endpoints from well-known
    console.log(`[OAuth] Discovering metadata for ${provider} from issuer: ${config.discovery.issuer}`);
    return await discoverAuthorizationServer(config.discovery.issuer);
  } else {
    // Use static endpoints
    console.log(`[OAuth] Using static metadata for ${provider} (no discovery)`);
    return createStaticMetadata(
      config.discovery.authorizationEndpoint,
      config.discovery.tokenEndpoint,
      config.discovery.revocationEndpoint
    );
  }
}

/**
 * Get or register client ID based on provider configuration
 */
async function getOrRegisterClient(
  provider: string,
  metadata: AuthorizationServerMetadata,
  scopes: string[]
): Promise<string> {
  const config = getProviderConfig(provider);
  const clientRepo = getClientRegistrationRepo();

  if (config.client.mode === 'static') {
    // Use static client ID
    if (!config.client.clientId) {
      throw new Error('Static client mode requires clientId in provider configuration');
    }
    console.log(`[OAuth] Using static client ID for ${provider}`);
    return config.client.clientId;
  } else {
    // DCR mode - check if registration endpoint exists
    const registrationEndpoint = config.client.registrationEndpoint || metadata.registration_endpoint;
    
    if (!registrationEndpoint) {
      throw new Error('Provider does not support Dynamic Client Registration (no registration_endpoint found)');
    }

    // Check for existing registered client
    const existingRegistration = await clientRepo.getClientRegistration(provider);
    if (existingRegistration) {
      console.log(`[OAuth] Using existing DCR client registration for ${provider}`);
      return existingRegistration.client_id;
    }

    // Register new client - create temporary service just for registration
    // We need to pass a dummy clientId, but it won't be used for registration
    console.log(`[OAuth] Registering new client via DCR for ${provider}...`);
    const tempService = new OAuthService(metadata, 'temp', scopes);
    const registration = await tempService.registerClient([REDIRECT_URI], scopes);
    
    // Save registration
    await clientRepo.saveClientRegistration(provider, registration);
    console.log(`[OAuth] DCR registration successful for ${provider}, client_id: ${registration.client_id}`);
    
    return registration.client_id;
  }
}

/**
 * Initiate OAuth flow for a provider
 */
export async function connectProvider(provider: string): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[OAuth] Starting connection flow for ${provider}...`);
    const oauthRepo = getOAuthRepo();
    const config = getProviderConfig(provider);

    // Validate configuration combinations
    if (config.discovery.mode === 'static' && config.client.mode === 'dcr') {
      throw new Error('DCR requires discovery mode "issuer", not "static"');
    }

    // Get provider metadata (discover or use static)
    const metadata = await getProviderMetadata(provider);

    // Get scopes from config or use empty array
    const scopes = config.scopes || [];

    // Get or register client ID
    const clientId = await getOrRegisterClient(provider, metadata, scopes);

    // Create OAuth service with metadata and client ID
    const oauthService = new OAuthService(metadata, clientId, scopes);

    // Generate PKCE codes
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Store flow state
    activeFlows.set(state, { codeVerifier, provider });

    // Create callback server
    const { server } = await createAuthServer(8080, async (code, receivedState) => {
      // Validate state
      if (receivedState !== state) {
        throw new Error('Invalid state parameter - possible CSRF attack');
      }

      const flow = activeFlows.get(state);
      if (!flow || flow.provider !== provider) {
        throw new Error('Invalid OAuth flow state');
      }

      try {
        // Exchange code for tokens
        console.log(`[OAuth] Exchanging authorization code for tokens (${provider})...`);
        const tokens = await oauthService.exchangeCodeForTokens(
          code,
          flow.codeVerifier,
          REDIRECT_URI
        );

        // Save tokens
        console.log(`[OAuth] Token exchange successful for ${provider}`);
        await oauthRepo.saveTokens(provider, tokens);
      } catch (error) {
        console.error('OAuth token exchange failed:', error);
        throw error;
      } finally {
        // Clean up
        activeFlows.delete(state);
        server.close();
      }
    });

    // Build authorization URL
    const authUrl = oauthService.buildAuthorizationUrl(codeChallenge, state, REDIRECT_URI);

    // Open browser window
    const authWindow = new BrowserWindow({
      width: 600,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    authWindow.loadURL(authUrl);

    // Clean up on window close
    authWindow.on('closed', () => {
      activeFlows.delete(state);
      server.close();
    });

    // Wait for callback (server will handle it)
    return { success: true };
  } catch (error) {
    console.error('OAuth connection failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Disconnect a provider (clear tokens)
 */
export async function disconnectProvider(provider: string): Promise<{ success: boolean }> {
  try {
    const oauthRepo = getOAuthRepo();
    await oauthRepo.clearTokens(provider);
    return { success: true };
  } catch (error) {
    console.error('OAuth disconnect failed:', error);
    return { success: false };
  }
}

/**
 * Check if a provider is connected
 */
export async function isConnected(provider: string): Promise<{ isConnected: boolean }> {
  try {
    const oauthRepo = getOAuthRepo();
    const connected = await oauthRepo.isConnected(provider);
    return { isConnected: connected };
  } catch (error) {
    console.error('OAuth connection check failed:', error);
    return { isConnected: false };
  }
}

/**
 * Get access token for a provider (internal use only)
 * Refreshes token if expired
 */
export async function getAccessToken(provider: string): Promise<string | null> {
  try {
    const oauthRepo = getOAuthRepo();
    const config = getProviderConfig(provider);
    
    let tokens = await oauthRepo.getTokens(provider);
    if (!tokens) {
      return null;
    }

    // Get provider metadata
    const metadata = await getProviderMetadata(provider);
    
    // Get client ID (static or registered)
    const clientId = await getOrRegisterClient(provider, metadata, config.scopes || []);
    
    // Create OAuth service
    const scopes = config.scopes || [];
    const oauthService = new OAuthService(metadata, clientId, scopes);

    // Check if token needs refresh
    if (oauthService.isTokenExpired(tokens)) {
      if (!tokens.refresh_token) {
        // No refresh token, need to reconnect
        return null;
      }

      try {
        // Refresh token, preserving existing scopes
        const existingScopes = tokens.scopes;
        tokens = await oauthService.refreshAccessToken(tokens.refresh_token, existingScopes);
        await oauthRepo.saveTokens(provider, tokens);
      } catch (error) {
        console.error('Token refresh failed:', error);
        return null;
      }
    }

    return tokens.access_token;
  } catch (error) {
    console.error('Get access token failed:', error);
    return null;
  }
}

/**
 * Get list of connected providers
 */
export async function getConnectedProviders(): Promise<{ providers: string[] }> {
  try {
    const oauthRepo = getOAuthRepo();
    const providers = await oauthRepo.getConnectedProviders();
    return { providers };
  } catch (error) {
    console.error('Get connected providers failed:', error);
    return { providers: [] };
  }
}

/**
 * Get list of available providers
 */
export function listProviders(): { providers: string[] } {
  return { providers: getAvailableProviders() };
}

