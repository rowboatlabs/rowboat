import { shell } from 'electron';
import type { Server } from 'http';
import { createAuthServer } from './auth-server.js';
import * as oauthClient from '@x/core/dist/auth/oauth-client.js';
import type { Configuration } from '@x/core/dist/auth/oauth-client.js';
import { getProviderConfig, getAvailableProviders } from '@x/core/dist/auth/providers.js';
import {
  clearProviderClientIdOverride,
  getProviderClientIdOverride,
  hasProviderClientIdOverride,
  setProviderClientIdOverride,
} from '@x/core/dist/auth/provider-client-id.js';
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

// Module-level state for tracking the active OAuth flow
interface ActiveOAuthFlow {
  provider: string;
  state: string;
  server: Server;
  cleanupTimeout: NodeJS.Timeout;
}

let activeFlow: ActiveOAuthFlow | null = null;

/**
 * Cancel any active OAuth flow, cleaning up resources
 */
function cancelActiveFlow(reason: string = 'cancelled'): void {
  if (!activeFlow) {
    return;
  }

  console.log(`[OAuth] Cancelling active flow for ${activeFlow.provider}: ${reason}`);

  clearTimeout(activeFlow.cleanupTimeout);
  activeFlow.server.close();
  activeFlows.delete(activeFlow.state);

  // Only emit event for user-visible cancellations
  if (reason !== 'new_flow_started') {
    emitOAuthEvent({
      provider: activeFlow.provider,
      success: false,
      error: `OAuth flow ${reason}`
    });
  }

  activeFlow = null;
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
 * Get or create OAuth configuration for a provider
 */
async function getProviderConfiguration(provider: string): Promise<Configuration> {
  const config = getProviderConfig(provider);
  const resolveClientId = (): string => {
    const override = getProviderClientIdOverride(provider);
    if (override) {
      return override;
    }
    if (config.client.mode === 'static' && config.client.clientId) {
      return config.client.clientId;
    }
    throw new Error(`${provider} client ID not configured. Please provide a client ID.`);
  };

  if (config.discovery.mode === 'issuer') {
    if (config.client.mode === 'static') {
      // Discover endpoints, use static client ID
      console.log(`[OAuth] ${provider}: Discovery from issuer with static client ID`);
      const clientId = resolveClientId();
      return await oauthClient.discoverConfiguration(
        config.discovery.issuer,
        clientId
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
    const clientId = resolveClientId();
    return oauthClient.createStaticConfiguration(
      config.discovery.authorizationEndpoint,
      config.discovery.tokenEndpoint,
      clientId,
      config.discovery.revocationEndpoint
    );
  }
}

/**
 * Initiate OAuth flow for a provider
 */
export async function connectProvider(provider: string, clientId?: string): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[OAuth] Starting connection flow for ${provider}...`);

    // Cancel any existing flow before starting a new one
    cancelActiveFlow('new_flow_started');

    const oauthRepo = getOAuthRepo();
    const providerConfig = getProviderConfig(provider);

    if (provider === 'google') {
      const trimmedClientId = clientId?.trim();
      if (!trimmedClientId) {
        return { success: false, error: 'Google client ID is required to connect.' };
      }
      setProviderClientIdOverride(provider, trimmedClientId);
    }

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
        if (activeFlow && activeFlow.state === state) {
          clearTimeout(activeFlow.cleanupTimeout);
          activeFlow.server.close();
          activeFlow = null;
        }
      }
    });

    // Set timeout to clean up abandoned flows (2 minutes)
    // This prevents memory leaks if user never completes the OAuth flow
    const cleanupTimeout = setTimeout(() => {
      if (activeFlow?.state === state) {
        console.log(`[OAuth] Cleaning up abandoned OAuth flow for ${provider} (timeout)`);
        cancelActiveFlow('timed_out');
      }
    }, 2 * 60 * 1000); // 2 minutes

    // Store complete flow state for cleanup
    activeFlow = {
      provider,
      state,
      server,
      cleanupTimeout,
    };

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
    if (provider === 'google') {
      clearProviderClientIdOverride(provider);
    }
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
    if (provider === 'google' && !hasProviderClientIdOverride(provider)) {
      return { isConnected: false };
    }
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
    const filteredProviders = providers.filter((provider) =>
      provider === 'google' ? hasProviderClientIdOverride(provider) : true
    );
    return { providers: filteredProviders };
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
