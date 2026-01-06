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

