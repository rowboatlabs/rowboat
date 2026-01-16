import { z } from 'zod';

/**
 * OAuth 2.0 tokens structure
 */
export const OAuthTokens = z.object({
  access_token: z.string(),
  refresh_token: z.string().nullable(),
  expires_at: z.number(), // Unix timestamp
  token_type: z.literal('Bearer').optional(),
  scopes: z.array(z.string()).optional(), // Granted scopes from OAuth response
});

export type OAuthTokens = z.infer<typeof OAuthTokens>;

/**
 * Client Registration Request (RFC 7591)
 */
export const ClientRegistrationRequest = z.object({
  redirect_uris: z.array(z.url()),
  token_endpoint_auth_method: z.string().optional(), // e.g., "none" for PKCE
  grant_types: z.array(z.string()).optional(), // e.g., ["authorization_code", "refresh_token"]
  response_types: z.array(z.string()).optional(), // e.g., ["code"]
  client_name: z.string().optional(),
  scope: z.string().optional(), // Space-separated scopes
});

export type ClientRegistrationRequest = z.infer<typeof ClientRegistrationRequest>;

/**
 * Client Registration Response (RFC 7591)
 */
export const ClientRegistrationResponse = z.object({
  client_id: z.string(),
  client_secret: z.string().optional(), // Not used with PKCE
  client_id_issued_at: z.number().optional(),
  client_secret_expires_at: z.number().optional(),
  registration_access_token: z.string().optional(), // For client management
  registration_client_uri: z.url().optional(), // For client management
});

export type ClientRegistrationResponse = z.infer<typeof ClientRegistrationResponse>;

