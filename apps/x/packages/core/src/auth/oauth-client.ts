import * as client from 'openid-client';
import {
  OAuthTokens,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
} from './types.js';

/**
 * Cached configurations per provider (issuer:clientId -> Configuration)
 */
const configCache = new Map<string, client.Configuration>();

function configurationCacheKey(issuerUrl: string, clientId: string, hasSecret = false): string {
  return `${issuerUrl}:${clientId}:${hasSecret ? 'secret' : 'none'}`;
}

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
  clientId: string,
  clientSecret?: string
): Promise<client.Configuration> {
  const cacheKey = configurationCacheKey(issuerUrl, clientId, Boolean(clientSecret));

  const cached = configCache.get(cacheKey);
  if (cached) {
    console.log(`[OAuth] Using cached configuration for ${issuerUrl}`);
    return cached;
  }
  console.log(`[OAuth] Discovering authorization server metadata for ${issuerUrl}...`);
  const config = await client.discovery(
    new URL(issuerUrl),
    clientId,
    clientSecret ?? undefined,
    clientSecret ? client.ClientSecretPost(clientSecret) : client.None(),
    {
      execute: [client.allowInsecureRequests],
    }
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
  revocationEndpoint?: string,
  clientSecret?: string
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
    clientSecret ?? undefined,
    clientSecret ? client.ClientSecretPost(clientSecret) : client.None()
  );
}

/**
 * Register a public PKCE client against an explicit RFC 7591 endpoint.
 *
 * Some providers expose registration_endpoint only in RFC 8414 authorization
 * server metadata, not in OpenID discovery. Keeping the POST isolated also
 * makes the trust boundary and request shape independently testable.
 */
export async function registerClientAtEndpoint(
  registrationEndpoint: string,
  request: ClientRegistrationRequest,
): Promise<ClientRegistrationResponse> {
  const response = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`Dynamic client registration failed (${response.status}): ${detail}`);
  }
  return ClientRegistrationResponse.parse(await response.json());
}

/**
 * Register client via Dynamic Client Registration (RFC 7591)
 * Returns both the Configuration and the registration response (for persistence)
 */
export async function registerClient(
  issuerUrl: string,
  redirectUris: string[],
  scopes: string[],
  clientName: string = 'RowboatX Desktop App',
  registrationEndpoint?: string,
): Promise<{ config: client.Configuration; registration: ClientRegistrationResponse }> {
  console.log(`[OAuth] Registering client via DCR at ${issuerUrl}...`);

  // Some OAuth servers publish Dynamic Client Registration only in their
  // RFC 8414 authorization-server document, while their OpenID discovery
  // document omits registration_endpoint. openid-client's convenience DCR
  // helper uses OpenID discovery and therefore cannot register those valid
  // providers. When the provider advertises an explicit endpoint, perform the
  // standard RFC 7591 POST and then use ordinary discovery for auth/token URLs.
  if (registrationEndpoint) {
    const registration = await registerClientAtEndpoint(registrationEndpoint, {
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: clientName,
      scope: scopes.join(' '),
    });
    // This is a public desktop PKCE client. Ignore any unexpected secret in a
    // registration response rather than changing the token auth method.
    const config = await discoverConfiguration(issuerUrl, registration.client_id);
    const cacheKey = configurationCacheKey(issuerUrl, registration.client_id);
    configCache.set(cacheKey, config);
    return { config, registration };
  }

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
    client.None(),
    {
      execute: [client.allowInsecureRequests],
    },
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
  const cacheKey = configurationCacheKey(issuerUrl, metadata.client_id);
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
  params: Record<string, string>
): URL {
  return client.buildAuthorizationUrl(config, {
    code_challenge_method: 'S256',
    ...params,
  });
}

/** Return RFC 8707 token-endpoint parameters for a protected resource. */
export function resourceParameters(resource?: string): Record<string, string> | undefined {
  return resource ? { resource } : undefined;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  config: client.Configuration,
  callbackUrl: URL,
  codeVerifier: string,
  expectedState: string,
  resource?: string,
): Promise<OAuthTokens> {
  console.log(`[OAuth] Exchanging authorization code for tokens...`);

  const response = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState,
  }, resourceParameters(resource));

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
  existingScopes?: string[],
  resource?: string,
): Promise<OAuthTokens> {
  console.log(`[OAuth] Refreshing access token...`);

  const response = await client.refreshTokenGrant(
    config,
    refreshToken,
    resourceParameters(resource),
  );

  const tokens = toOAuthTokens(response);

  // Preserve existing scopes if server didn't return them
  if (!tokens.scopes && existingScopes) {
    tokens.scopes = existingScopes;
  }

  // Preserve existing refresh token if server didn't return it
  if (!tokens.refresh_token) {
    tokens.refresh_token = refreshToken;
  }

  console.log(`[OAuth] Token refresh successful`);
  return tokens;
}

const EXPIRY_MARGIN_SECONDS = 60;

/**
 * Check if tokens are expired. Treats tokens as expired EXPIRY_MARGIN_SECONDS
 * before the real expiry to absorb clock skew and in-flight request latency.
 */
export function isTokenExpired(tokens: OAuthTokens): boolean {
  const now = Math.floor(Date.now() / 1000);
  return tokens.expires_at <= now + EXPIRY_MARGIN_SECONDS;
}

/**
 * Clear configuration cache for a specific provider or all providers
 */
export function clearConfigCache(issuerUrl?: string, clientId?: string): void {
  if (issuerUrl && clientId) {
    configCache.delete(configurationCacheKey(issuerUrl, clientId));
    configCache.delete(configurationCacheKey(issuerUrl, clientId, true));
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
  return configCache.get(configurationCacheKey(issuerUrl, clientId))
    ?? configCache.get(configurationCacheKey(issuerUrl, clientId, true));
}

// Re-export Configuration type for external use
export type { Configuration } from 'openid-client';
