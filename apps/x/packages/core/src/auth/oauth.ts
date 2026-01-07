import { AuthorizationServerMetadata } from './discovery.js';
import { OAuthTokens, ClientRegistrationRequest, ClientRegistrationResponse } from './types.js';

/**
 * Generic OAuth 2.0 service with PKCE support
 */
export class OAuthService {
  constructor(
    private metadata: AuthorizationServerMetadata,
    private clientId: string,
    private scopes: string[]
  ) {}

  /**
   * Build authorization URL with PKCE parameters
   */
  buildAuthorizationUrl(
    codeChallenge: string,
    state: string,
    redirectUri: string
  ): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${this.metadata.authorization_endpoint}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens using PKCE
   */
  async exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });

    const response = await fetch(this.metadata.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    // Calculate expires_at from expires_in if provided
    const expiresIn = data.expires_in || 3600; // Default to 1 hour
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    // Extract granted scopes from response (may be space-separated string or array)
    let scopes: string[] | undefined;
    if (data.scope) {
      if (typeof data.scope === 'string') {
        scopes = data.scope.split(' ').filter((s: string) => s.length > 0);
      } else if (Array.isArray(data.scope)) {
        scopes = data.scope;
      }
    }

    return OAuthTokens.parse({
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expires_at: expiresAt,
      token_type: data.token_type || 'Bearer',
      scopes,
    });
  }

  /**
   * Refresh access token using refresh token
   * Preserves existing scopes since refresh responses typically don't include them
   */
  async refreshAccessToken(refreshToken: string, existingScopes?: string[]): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(this.metadata.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    // Calculate expires_at from expires_in if provided
    const expiresIn = data.expires_in || 3600;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    // Extract scopes from refresh response if provided, otherwise preserve existing scopes
    let scopes: string[] | undefined = existingScopes;
    if (data.scope) {
      if (typeof data.scope === 'string') {
        scopes = data.scope.split(' ').filter((s: string) => s.length > 0);
      } else if (Array.isArray(data.scope)) {
        scopes = data.scope;
      }
    }

    return OAuthTokens.parse({
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken, // Some providers don't return new refresh token
      expires_at: expiresAt,
      token_type: data.token_type || 'Bearer',
      scopes,
    });
  }

  /**
   * Check if tokens are expired
   */
  isTokenExpired(tokens: OAuthTokens): boolean {
    const now = Math.floor(Date.now() / 1000);
    return tokens.expires_at <= now;
  }

  /**
   * Register client using Dynamic Client Registration (RFC 7591)
   */
  async registerClient(
    redirectUris: string[],
    scopes: string[]
  ): Promise<ClientRegistrationResponse> {
    if (!this.metadata.registration_endpoint) {
      throw new Error('Provider does not support Dynamic Client Registration');
    }

    const registrationRequest: ClientRegistrationRequest = {
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none', // PKCE doesn't need client secret
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'RowboatX Desktop App',
      scope: scopes.join(' '),
    };

    const response = await fetch(this.metadata.registration_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(registrationRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Client registration failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return ClientRegistrationResponse.parse(data);
  }
}

