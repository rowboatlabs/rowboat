import { shell } from 'electron';
import { createAuthServer } from './auth-server.js';
import * as oauthClient from '@x/core/dist/auth/oauth-client.js';
import type { Configuration } from '@x/core/dist/auth/oauth-client.js';
import { getProviderConfig, getAvailableProviders } from '@x/core/dist/auth/providers.js';
import container from '@x/core/dist/di/container.js';
import { IOAuthRepo } from '@x/core/dist/auth/repo.js';
import { IClientRegistrationRepo } from '@x/core/dist/auth/client-repo.js';
import { triggerSync as triggerGmailSync } from '@x/core/dist/knowledge/sync_gmail.js';
import { triggerSync as triggerCalendarSync } from '@x/core/dist/knowledge/sync_calendar.js';
import { triggerSync as triggerFirefliesSync } from '@x/core/dist/knowledge/sync_fireflies.js';
import { emitOAuthEvent } from './ipc.js';

const REDIRECT_URI = 'http://localhost:8080/oauth/callback';

// Store active OAuth flows (state -> { codeVerifier, provider, config })
const activeFlows = new Map<string, { 
  codeVerifier: string; 
  provider: string;
  config: Configuration;
}>();

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
 * Get or create OAuth configuration for a provider
 */
async function getProviderConfiguration(provider: string): Promise<Configuration> {
  const config = getProviderConfig(provider);

  if (config.discovery.mode === 'issuer') {
    if (config.client.mode === 'static') {
      // Discover endpoints, use static client ID
      console.log(`[OAuth] ${provider}: Discovery from issuer with static client ID`);
      return await oauthClient.discoverConfiguration(
        config.discovery.issuer,
        config.client.clientId
      );
    } else {
      // DCR mode - check for existing registration or register new
      console.log(`[OAuth] ${provider}: Discovery from issuer with DCR`);
      const clientRepo = getClientRegistrationRepo();
      const existingRegistration = await clientRepo.getClientRegistration(provider);
      
      if (existingRegistration) {
        console.log(`[OAuth] ${provider}: Using existing DCR registration`);
        return await oauthClient.discoverConfiguration(
          config.discovery.issuer,
          existingRegistration.client_id
        );
      }

      // Register new client
      const scopes = config.scopes || [];
      const { config: oauthConfig, registration } = await oauthClient.registerClient(
        config.discovery.issuer,
        [REDIRECT_URI],
        scopes
      );
      
      // Save registration for future use
      await clientRepo.saveClientRegistration(provider, registration);
      console.log(`[OAuth] ${provider}: DCR registration saved`);
      
      return oauthConfig;
    }
  } else {
    // Static endpoints mode
    if (config.client.mode !== 'static') {
      throw new Error('DCR requires discovery mode "issuer", not "static"');
    }
    
    console.log(`[OAuth] ${provider}: Using static endpoints (no discovery)`);
    return oauthClient.createStaticConfiguration(
      config.discovery.authorizationEndpoint,
      config.discovery.tokenEndpoint,
      config.client.clientId,
      config.discovery.revocationEndpoint
    );
  }
}

/**
 * Initiate OAuth flow for a provider
 */
export async function connectProvider(provider: string): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[OAuth] Starting connection flow for ${provider}...`);
    const oauthRepo = getOAuthRepo();
    const providerConfig = getProviderConfig(provider);

    // Get or create OAuth configuration
    const config = await getProviderConfiguration(provider);

    // Generate PKCE codes
    const { verifier: codeVerifier, challenge: codeChallenge } = await oauthClient.generatePKCE();
    const state = oauthClient.generateState();

    // Get scopes from config
    const scopes = providerConfig.scopes || [];

    // Store flow state
    activeFlows.set(state, { codeVerifier, provider, config });

    // Build authorization URL
    const authUrl = oauthClient.buildAuthorizationUrl(config, {
      redirectUri: REDIRECT_URI,
      scope: scopes.join(' '),
      codeChallenge,
      state,
    });

    // Declare timeout variable (will be set after server is created)
    let cleanupTimeout: NodeJS.Timeout;

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
        // Build callback URL for token exchange
        const callbackUrl = new URL(`${REDIRECT_URI}?code=${code}&state=${receivedState}`);
        
        // Exchange code for tokens
        console.log(`[OAuth] Exchanging authorization code for tokens (${provider})...`);
        const tokens = await oauthClient.exchangeCodeForTokens(
          flow.config,
          callbackUrl,
          flow.codeVerifier,
          state
        );

        // Save tokens
        console.log(`[OAuth] Token exchange successful for ${provider}`);
        await oauthRepo.saveTokens(provider, tokens);

        // Trigger immediate sync for relevant providers
        if (provider === 'google') {
          triggerGmailSync();
          triggerCalendarSync();
        } else if (provider === 'fireflies-ai') {
          triggerFirefliesSync();
        }

        // Emit success event to renderer
        emitOAuthEvent({ provider, success: true });
      } catch (error) {
        console.error('OAuth token exchange failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        emitOAuthEvent({ provider, success: false, error: errorMessage });
        throw error;
      } finally {
        // Clean up
        activeFlows.delete(state);
        server.close();
        clearTimeout(cleanupTimeout);
      }
    });

    // Set timeout to clean up abandoned flows (5 minutes)
    // This prevents memory leaks if user never completes the OAuth flow
    cleanupTimeout = setTimeout(() => {
      if (activeFlows.has(state)) {
        console.log(`[OAuth] Cleaning up abandoned OAuth flow for ${provider} (timeout)`);
        activeFlows.delete(state);
        server.close();
        emitOAuthEvent({ provider, success: false, error: 'OAuth flow timed out' });
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Open in system browser (shares cookies/sessions with user's regular browser)
    shell.openExternal(authUrl.toString());

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
    
    let tokens = await oauthRepo.getTokens(provider);
    if (!tokens) {
      return null;
    }

    // Check if token needs refresh
    if (oauthClient.isTokenExpired(tokens)) {
      if (!tokens.refresh_token) {
        // No refresh token, need to reconnect
        return null;
      }

      try {
        // Get configuration for refresh
        const config = await getProviderConfiguration(provider);
        
        // Refresh token, preserving existing scopes
        const existingScopes = tokens.scopes;
        tokens = await oauthClient.refreshTokens(config, tokens.refresh_token, existingScopes);
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
