import * as client from 'openid-client';
import { OAuthTokens, ClientRegistrationResponse } from './types.js';

/**
 * Cached configurations per provider (issuer:clientId -> Configuration)
 */
const configCache = new Map<string, client.Configuration>();

/**
 * Helper to convert openid-client token response to our OAuthTokens type
 */
function toOAuthTokens(response: client.TokenEndpointResponse): OAuthTokens {
  const accessToken = response.access_token;
  const refreshToken = response.refresh_token ?? null;

  // Calculate expires_at from expires_in
  const expiresIn = response.expires_in ?? 3600;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  // Parse scopes from space-separated string
  let scopes: string[] | undefined;
  if (response.scope) {
    scopes = response.scope.split(' ').filter(s => s.length > 0);
  }

  return OAuthTokens.parse({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    token_type: 'Bearer',
    scopes,
  });
}

/**
 * Discover authorization server metadata and create configuration
 */
export async function discoverConfiguration(
  issuerUrl: string,
  clientId: string
): Promise<client.Configuration> {
  const cacheKey = `${issuerUrl}:${clientId}`;

  const cached = configCache.get(cacheKey);
  if (cached) {
    console.log(`[OAuth] Using cached configuration for ${issuerUrl}`);
    return cached;
  }

  console.log(`[OAuth] Discovering authorization server metadata for ${issuerUrl}...`);
  const config = await client.discovery(
    new URL(issuerUrl),
    clientId,
    undefined, // no client_secret (PKCE flow)
    client.None() // PKCE doesn't require client authentication
  );

  configCache.set(cacheKey, config);
  console.log(`[OAuth] Discovery complete for ${issuerUrl}`);
  return config;
}

/**
 * Create configuration from static endpoints (no discovery)
 */
export function createStaticConfiguration(
  authorizationEndpoint: string,
  tokenEndpoint: string,
  clientId: string,
  revocationEndpoint?: string
): client.Configuration {
  console.log(`[OAuth] Creating static configuration (no discovery)`);

  const issuer = new URL(authorizationEndpoint).origin;

  // Create Configuration with static metadata
  const serverMetadata: client.ServerMetadata = {
    issuer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    revocation_endpoint: revocationEndpoint,
  };

  return new client.Configuration(
    serverMetadata,
    clientId,
    undefined, // no client_secret
    client.None() // PKCE auth
  );
}

/**
 * Register client via Dynamic Client Registration (RFC 7591)
 * Returns both the Configuration and the registration response (for persistence)
 */
export async function registerClient(
  issuerUrl: string,
  redirectUris: string[],
  scopes: string[],
  clientName: string = 'RowboatX Desktop App'
): Promise<{ config: client.Configuration; registration: ClientRegistrationResponse }> {
  console.log(`[OAuth] Registering client via DCR at ${issuerUrl}...`);
  const config = await client.dynamicClientRegistration(
    new URL(issuerUrl),
    {
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none', // PKCE flow
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: clientName,
      scope: scopes.join(' '),
    },
    client.None()
  );

  const metadata = config.clientMetadata();
  console.log(`[OAuth] DCR complete, client_id: ${metadata.client_id}`);

  // Extract registration response for persistence
  const registration = ClientRegistrationResponse.parse({
    client_id: metadata.client_id,
    client_secret: metadata.client_secret,
    client_id_issued_at: metadata.client_id_issued_at,
    client_secret_expires_at: metadata.client_secret_expires_at,
  });

  // Cache the configuration
  const cacheKey = `${issuerUrl}:${metadata.client_id}`;
  configCache.set(cacheKey, config);

  return { config, registration };
}

/**
 * Generate PKCE code verifier and challenge
 */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  return { verifier, challenge };
}

/**
 * Generate random state for CSRF protection
 */
export function generateState(): string {
  return client.randomState();
}

/**
 * Build authorization URL with PKCE
 */
export function buildAuthorizationUrl(
  config: client.Configuration,
  params: {
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    state: string;
  }
): URL {
  return client.buildAuthorizationUrl(config, {
    redirect_uri: params.redirectUri,
    scope: params.scope,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    state: params.state,
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  config: client.Configuration,
  callbackUrl: URL,
  codeVerifier: string,
  expectedState: string
): Promise<OAuthTokens> {
  console.log(`[OAuth] Exchanging authorization code for tokens...`);

  const response = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState,
  });

  console.log(`[OAuth] Token exchange successful`);
  return toOAuthTokens(response);
}

/**
 * Refresh access token using refresh token
 * Preserves existing scopes if not returned by server
 */
export async function refreshTokens(
  config: client.Configuration,
  refreshToken: string,
  existingScopes?: string[]
): Promise<OAuthTokens> {
  console.log(`[OAuth] Refreshing access token...`);

  const response = await client.refreshTokenGrant(config, refreshToken);

  const tokens = toOAuthTokens(response);

  // Preserve existing scopes if server didn't return them
  if (!tokens.scopes && existingScopes) {
    tokens.scopes = existingScopes;
  }

  console.log(`[OAuth] Token refresh successful`);
  return tokens;
}

/**
 * Check if tokens are expired
 */
export function isTokenExpired(tokens: OAuthTokens): boolean {
  const now = Math.floor(Date.now() / 1000);
  return tokens.expires_at <= now;
}

/**
 * Clear configuration cache for a specific provider or all providers
 */
export function clearConfigCache(issuerUrl?: string, clientId?: string): void {
  if (issuerUrl && clientId) {
    configCache.delete(`${issuerUrl}:${clientId}`);
    console.log(`[OAuth] Cleared configuration cache for ${issuerUrl}`);
  } else {
    configCache.clear();
    console.log(`[OAuth] Cleared all configuration cache`);
  }
}

/**
 * Get cached configuration if available
 */
export function getCachedConfiguration(issuerUrl: string, clientId: string): client.Configuration | undefined {
  return configCache.get(`${issuerUrl}:${clientId}`);
}

// Re-export Configuration type for external use
export type { Configuration } from 'openid-client';

