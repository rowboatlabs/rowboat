import { z } from 'zod';
import { getRowboatConfig } from '../config/rowboat.js';

/**
 * Discovery configuration - how to get OAuth endpoints
 */
const DiscoverySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('issuer'),
    issuer: z.url().describe('The issuer base url. To discover the endpoints, the client will fetch the .well-known/oauth-authorization-server from this url.'),
  }),
  z.object({
    mode: z.literal('static'),
    authorizationEndpoint: z.url(),
    tokenEndpoint: z.url(),
    revocationEndpoint: z.url().optional(),
  }),
]);

/**
 * Client configuration - how to get client credentials
 */
const ClientSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('static'),
    clientId: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal('dcr'),
    // If omitted, should be discovered from auth-server metadata as `registration_endpoint`
    registrationEndpoint: z.url().optional(),
  }),
]);

/**
 * Provider configuration schema
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ProviderConfigSchema = z.record(
  z.string(),
  z.object({
    discovery: DiscoverySchema,
    client: ClientSchema,
    scopes: z.array(z.string()).optional(),
  })
);

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProviderConfigEntry = ProviderConfig[string];

/**
 * Azure Entra application (client) ID for the Microsoft / Outlook connection.
 * A multi-tenant "Mobile and desktop applications" public client — PKCE +
 * loopback redirect, NO client secret. Overridable via env for development.
 */
const MICROSOFT_CLIENT_ID =
  process.env.ROWBOAT_MICROSOFT_CLIENT_ID || 'd3f3bc8b-47a3-4674-b039-fa947053990d';

/**
 * All configured OAuth providers
 */
const providerConfigs: ProviderConfig = {
  rowboat: {
    discovery: {
      mode: 'issuer',
      issuer: "TBD",
    },
    client: {
      mode: 'dcr',
    },
    scopes: [
      "openid",
      "email",
      "profile",
    ],
  },
  google: {
    discovery: {
      mode: 'issuer',
      issuer: 'https://accounts.google.com',
    },
    client: {
      mode: 'static',
    },
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar.events.readonly',
      // Per-file Drive access (non-restricted): the user grants read/write to a
      // specific doc by choosing it in the Google Picker. Enough to export/
      // download and write back, without the restricted full-drive scope.
      'https://www.googleapis.com/auth/drive.file',
    ],
  },
  'fireflies-ai': {
    discovery: {
      mode: 'issuer',
      issuer: 'https://api.fireflies.ai/.well-known/oauth-authorization-server',
    },
    client: {
      mode: 'dcr',
    },
    scopes: [
      'profile',
      'email',
    ]
  },
  microsoft: {
    // Static endpoints, no OIDC discovery: the Microsoft identity platform's
    // /common discovery document carries a `{tenantid}` templated issuer that
    // openid-client's issuer validation rejects. Static config never fetches
    // it. We also deliberately do NOT request `openid`/`profile` — with no
    // id_token in the response, openid-client skips all ID-token validation;
    // account identity comes from Graph /me instead.
    discovery: {
      mode: 'static',
      authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      // No revocationEndpoint — the MS identity platform v2 has none. Users
      // revoke consent at account.live.com/consent/Manage (personal) or
      // myapps.microsoft.com (work/school).
    },
    client: {
      mode: 'static',
      clientId: MICROSOFT_CLIENT_ID,
    },
    // Fully-qualified Graph scopes: MS echoes these forms back in the token
    // response `scope` field (offline_access is granted but never echoed), so
    // requesting them fully-qualified keeps the persisted-scope check simple.
    scopes: [
      'offline_access',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/Calendars.Read',
    ],
  },
};

/**
 * Get provider configuration by name
 */
export async function getProviderConfig(providerName: string): Promise<ProviderConfigEntry> {
  const config = providerConfigs[providerName];
  if (!config) {
    throw new Error(`Unknown OAuth provider: ${providerName}`);
  }
  if (providerName === 'rowboat') {
    const rowboatConfig = await getRowboatConfig();
    config.discovery = {
      mode: 'issuer',
      issuer: `${rowboatConfig.supabaseUrl}/auth/v1/.well-known/oauth-authorization-server`,
    }
  }
  return config;
}

/**
 * Get list of all configured OAuth providers
 */
export function getAvailableProviders(): string[] {
  return Object.keys(providerConfigs);
}
