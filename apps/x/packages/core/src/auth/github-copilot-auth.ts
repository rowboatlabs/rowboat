/**
 * GitHub Copilot Authentication Service
 * 
 * Handles Device Flow OAuth authentication with GitHub and token management
 * for GitHub Copilot LLM access.
 */

import container from '../di/container.js';
import { IOAuthRepo } from './repo.js';
import { OAuthTokens } from './types.js';
import { getProviderConfig } from './providers.js';
import * as deviceFlow from './github-copilot-device-flow.js';
import * as oauthClient from './oauth-client.js';

const PROVIDER_NAME = 'github-copilot';

/**
 * Start GitHub Copilot authentication flow
 * 
 * Returns device code info for display and a promise for the tokens
 * The promise will resolve once the user authenticates on GitHub
 */
export async function startGitHubCopilotAuthentication(): Promise<{
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  tokenPromise: Promise<void>;
}> {
  console.log('[GitHub Copilot] Starting Device Flow authentication...');

  const config = await getProviderConfig(PROVIDER_NAME);
  if (config.discovery.mode !== 'static') {
    throw new Error('GitHub Copilot provider requires static discovery mode');
  }

  if (config.client.mode !== 'static') {
    throw new Error('GitHub Copilot provider requires static client mode');
  }

  const clientId = config.client.clientId;
  if (!clientId) {
    throw new Error('GitHub Copilot provider requires a client ID');
  }

  // Start Device Flow
  const { deviceCode, tokenPromise } = await deviceFlow.startGitHubCopilotAuth(
    clientId,
    config.scopes
  );

  // Handle token polling in the background
  const authPromise = tokenPromise
    .then(async (tokens) => {
      console.log('[GitHub Copilot] Authentication successful, saving tokens...');
      const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
      await oauthRepo.upsert(PROVIDER_NAME, {
        tokens,
        clientId,
      });
      console.log('[GitHub Copilot] Tokens saved successfully');
    })
    .catch((error) => {
      console.error('[GitHub Copilot] Authentication failed:', error);
      const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
      // Save error state
      oauthRepo.upsert(PROVIDER_NAME, {
        error: error instanceof Error ? error.message : 'Unknown error',
      }).catch(console.error);
      throw error;
    });

  return {
    userCode: deviceCode.user_code,
    verificationUri: deviceCode.verification_uri,
    expiresIn: deviceCode.expires_in,
    tokenPromise: authPromise,
  };
}

/**
 * Get GitHub Copilot access token
 * 
 * Retrieves the saved token and refreshes it if expired.
 * Note: GitHub Device Flow may not support refresh tokens, so expired tokens
 * will require re-authentication via Device Flow.
 */
export async function getGitHubCopilotAccessToken(): Promise<string> {
  const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
  const connection = await oauthRepo.read(PROVIDER_NAME);

  if (!connection.tokens) {
    throw new Error(
      'GitHub Copilot not authenticated. Please authenticate first using Device Flow.'
    );
  }

  // Check if token is expired
  if (!oauthClient.isTokenExpired(connection.tokens)) {
    return connection.tokens.access_token;
  }

  // Token is expired
  // GitHub Device Flow may not support refresh tokens
  // If we have a refresh token, try to use it; otherwise, we need re-authentication
  if (connection.tokens.refresh_token) {
    console.log('[GitHub Copilot] Token expired, attempting refresh...');
    try {
      const config = await getProviderConfig(PROVIDER_NAME);
      if (config.discovery.mode !== 'static') {
        throw new Error('Invalid provider config');
      }

      // For Device Flow, refresh tokens might not be supported
      // This is a fallback in case GitHub adds support
      const clientId = config.client.mode === 'static' ? config.client.clientId : null;
      if (!clientId) {
        throw new Error('Cannot refresh without client ID');
      }

      // Create static config for refresh
      const staticConfig = oauthClient.createStaticConfiguration(
        config.discovery.authorizationEndpoint,
        config.discovery.tokenEndpoint,
        clientId
      );

      const refreshed = await oauthClient.refreshTokens(
        staticConfig,
        connection.tokens.refresh_token,
        connection.tokens.scopes
      );

      await oauthRepo.upsert(PROVIDER_NAME, { tokens: refreshed });
      console.log('[GitHub Copilot] Token refreshed successfully');
      return refreshed.access_token;
    } catch (error) {
      console.error('[GitHub Copilot] Token refresh failed:', error);
      // Fall through to re-authentication error
    }
  }

  // Token is expired and we cannot refresh
  throw new Error(
    'GitHub Copilot token expired. Please authenticate again using Device Flow.'
  );
}

/**
 * Check if GitHub Copilot is authenticated
 */
export async function isGitHubCopilotAuthenticated(): Promise<boolean> {
  const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
  const connection = await oauthRepo.read(PROVIDER_NAME);
  return !!connection.tokens;
}

/**
 * Get GitHub Copilot authentication status
 */
export async function getGitHubCopilotAuthStatus(): Promise<{
  authenticated: boolean;
  expiresAt?: number;
  error?: string;
}> {
  const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
  const connection = await oauthRepo.read(PROVIDER_NAME);

  if (!connection.tokens) {
    return {
      authenticated: false,
      error: connection.error ?? undefined,
    };
  }

  return {
    authenticated: true,
    expiresAt: connection.tokens.expires_at,
  };
}

/**
 * Disconnect GitHub Copilot (remove stored tokens)
 */
export async function disconnectGitHubCopilot(): Promise<void> {
  console.log('[GitHub Copilot] Disconnecting...');
  const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
  await oauthRepo.delete(PROVIDER_NAME);
  console.log('[GitHub Copilot] Disconnected successfully');
}
