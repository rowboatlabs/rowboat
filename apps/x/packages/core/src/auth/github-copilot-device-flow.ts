import { OAuthTokens } from './types.js';

/**
 * GitHub Copilot Device Flow OAuth
 * Implements RFC 8628 - OAuth 2.0 Device Authorization Grant
 * 
 * Reference: https://docs.github.com/en/developers/apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

const GITHUB_DEVICE_CODE_ENDPOINT = 'https://github.com/login/device/code';
const GITHUB_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const DEFAULT_POLLING_INTERVAL = 5000; // 5 seconds

/**
 * Request a device code from GitHub
 */
export async function requestDeviceCode(
  clientId: string,
  scopes: string[] = ['read:user', 'user:email']
): Promise<DeviceCodeResponse> {
  console.log('[GitHub Copilot] Requesting device code...');

  const response = await fetch(GITHUB_DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: scopes.join(' '),
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to request device code: ${response.statusText}`);
  }

  const data = await response.json() as DeviceCodeResponse;
  console.log(`[GitHub Copilot] Device code received. User code: ${data.user_code}`);
  console.log(`[GitHub Copilot] Verification URI: ${data.verification_uri}`);

  return data;
}

/**
 * Poll GitHub for the access token
 * This should be called after the user authenticates
 */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  expiresAt: number,
  onStatusChange?: (status: 'pending' | 'expired' | 'success' | 'error') => void,
): Promise<OAuthTokens> {
  console.log('[GitHub Copilot] Polling for token...');

  const pollingInterval = DEFAULT_POLLING_INTERVAL;

  while (Date.now() < expiresAt) {
    try {
      const response = await fetch(GITHUB_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.statusText}`);
      }

      const data = await response.json() as DeviceTokenResponse;

      if (data.error) {
        if (data.error === 'authorization_pending') {
          console.log('[GitHub Copilot] Authorization pending, polling again...');
          onStatusChange?.('pending');
          await new Promise(resolve => setTimeout(resolve, pollingInterval));
          continue;
        } else if (data.error === 'slow_down') {
          console.log('[GitHub Copilot] Rate limited, increasing interval...');
          await new Promise(resolve => setTimeout(resolve, pollingInterval * 2));
          continue;
        } else if (data.error === 'expired_token') {
          console.error('[GitHub Copilot] Device code expired');
          onStatusChange?.('expired');
          throw new Error('Device code expired. Please try again.');
        } else {
          console.error(`[GitHub Copilot] Token error: ${data.error}`);
          onStatusChange?.('error');
          throw new Error(`Authentication failed: ${data.error_description || data.error}`);
        }
      }

      if (!data.access_token) {
        throw new Error('No access token in response');
      }

      const expiresIn = data.expires_in ?? 3600;
      const tokens = OAuthTokens.parse({
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? null,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        token_type: data.token_type ?? 'Bearer',
        scopes: data.scope ? data.scope.split(' ') : undefined,
      });

      console.log('[GitHub Copilot] Successfully obtained access token');
      onStatusChange?.('success');
      return tokens;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Device code expired')) {
        throw error;
      }
      console.error('[GitHub Copilot] Polling error:', error);
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }
  }

  throw new Error('Device code expired before authentication completed');
}

/**
 * Complete GitHub Copilot authentication flow
 * Returns the device code response for display and a promise for the tokens
 */
export async function startGitHubCopilotAuth(
  clientId: string,
  scopes?: string[]
): Promise<{
  deviceCode: DeviceCodeResponse;
  tokenPromise: Promise<OAuthTokens>;
}> {
  const deviceCode = await requestDeviceCode(clientId, scopes);

  // Start polling in the background
  const tokenPromise = pollForToken(
    clientId,
    deviceCode.device_code,
    Date.now() + deviceCode.expires_in * 1000,
  );

  return {
    deviceCode,
    tokenPromise,
  };
}
