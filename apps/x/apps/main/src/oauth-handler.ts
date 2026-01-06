import { BrowserWindow } from 'electron';
import { randomBytes } from 'crypto';
import { createAuthServer } from './auth-server.js';
import { generateCodeVerifier, generateCodeChallenge } from '@x/core/dist/auth/pkce.js';
import { createOAuthService } from '@x/core/dist/auth/oauth.js';
import { getAvailableProviders } from '@x/core/dist/auth/providers.js';
import container from '@x/core/dist/di/container.js';
import { IOAuthRepo } from '@x/core/dist/auth/repo.js';

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
 * Initiate OAuth flow for a provider
 */
export async function connectProvider(provider: string): Promise<{ success: boolean; error?: string }> {
  try {
    const oauthService = createOAuthService(provider);
    const oauthRepo = getOAuthRepo();

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
        const tokens = await oauthService.exchangeCodeForTokens(
          code,
          flow.codeVerifier,
          REDIRECT_URI
        );

        // Save tokens
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
    const oauthService = createOAuthService(provider);
    
    let tokens = await oauthRepo.getTokens(provider);
    if (!tokens) {
      return null;
    }

    // Check if token needs refresh
    if (oauthService.isTokenExpired(tokens)) {
      if (!tokens.refresh_token) {
        // No refresh token, need to reconnect
        return null;
      }

      try {
        // Refresh token, preserving existing scopes
        const existingScopes = (tokens).scopes;
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

