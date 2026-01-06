/**
 * OAuth 2.0 provider configuration
 */
export interface OAuthProviderConfig {
  name: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
}

/**
 * Get Google OAuth provider configuration
 */
export function getGoogleProviderConfig(): OAuthProviderConfig {
  // TODO: Replace with actual Google OAuth client ID
  const GOOGLE_CLIENT_ID = '797410052581-ibmmvqec0l68stv5fmgh0juqfvbg08fc.apps.googleusercontent.com'

  return {
    name: 'google',
    clientId: GOOGLE_CLIENT_ID,
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  };
}

/**
 * Get list of all configured OAuth providers
 */
export function getAvailableProviders(): string[] {
  return ['google'];
  // Future: Add more providers here
  // return ['google', 'github', 'microsoft'];
}

/**
 * Get provider configuration by name
 */
export function getProviderConfig(providerName: string): OAuthProviderConfig {
  switch (providerName) {
    case 'google':
      return getGoogleProviderConfig();
    default:
      throw new Error(`Unknown OAuth provider: ${providerName}`);
  }
}

