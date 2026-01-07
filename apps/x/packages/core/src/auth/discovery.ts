import { z } from 'zod';

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * Also compatible with OpenID Connect Discovery
 */
export const AuthorizationServerMetadataSchema = z.object({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  registration_endpoint: z.url().optional(), // Indicates DCR support
  revocation_endpoint: z.url().optional(),
  jwks_uri: z.url().optional(),
  scopes_supported: z.array(z.string()).optional(),
  response_types_supported: z.array(z.string()).optional(),
  grant_types_supported: z.array(z.string()).optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(), // For PKCE
});

export type AuthorizationServerMetadata = z.infer<typeof AuthorizationServerMetadataSchema>;

/**
 * Discover OAuth 2.0 authorization server metadata
 * Tries RFC 8414 endpoint first, falls back to OIDC Discovery
 */
export async function discoverAuthorizationServer(issuer: string): Promise<AuthorizationServerMetadata> {
  // Remove trailing slash from issuer
  const baseUrl = issuer.replace(/\/$/, '');

  // Try RFC 8414 endpoint first
  const rfc8414Url = `${baseUrl}/.well-known/oauth-authorization-server`;
  try {
    const response = await fetch(rfc8414Url);
    if (response.ok) {
      console.log(`[OAuth Discovery] Using RFC 8414 endpoint for ${issuer}`);
      const metadata = await response.json();
      return AuthorizationServerMetadataSchema.parse(metadata);
    }
  } catch {
    // Fall through to OIDC Discovery
  }

  // Fallback to OpenID Connect Discovery
  const oidcUrl = `${baseUrl}/.well-known/openid-configuration`;
  try {
    console.log(`[OAuth Discovery] Falling back to OIDC discovery for ${issuer}`);
    const response = await fetch(oidcUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch discovery document: ${response.status} ${response.statusText}`);
    }
    const metadata = await response.json();
    return AuthorizationServerMetadataSchema.parse(metadata);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues.map(issue => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `${path}: ${issue.message}`;
      }).join(', ');
      throw new Error(
        `Invalid authorization server metadata from ${issuer}: ${errorMessages}`
      );
    }
    throw new Error(
      `Failed to discover authorization server metadata from ${issuer}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Construct metadata from static endpoints
 */
export function createStaticMetadata(
  authorizationEndpoint: string,
  tokenEndpoint: string,
  revocationEndpoint?: string
): AuthorizationServerMetadata {
  console.log(`[OAuth Discovery] Using static endpoints (no discovery)`);
  return AuthorizationServerMetadataSchema.parse({
    issuer: new URL(authorizationEndpoint).origin,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    revocation_endpoint: revocationEndpoint,
  });
}

