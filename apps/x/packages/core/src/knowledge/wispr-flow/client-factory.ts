import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import container from '../../di/container.js';
import type { IOAuthRepo } from '../../auth/repo.js';
import type { IClientRegistrationRepo } from '../../auth/client-repo.js';
import { getProviderConfig } from '../../auth/providers.js';
import * as oauthClient from '../../auth/oauth-client.js';
import type { Configuration } from '../../auth/oauth-client.js';
import type { OAuthTokens } from '../../auth/types.js';

const PROVIDER_NAME = 'wispr-flow';
const MCP_URL = 'https://api.wisprflow.ai/connect/mcp';

type ClientCache = {
  config: Configuration | null;
  client: Client | null;
  tokens: OAuthTokens | null;
};

/**
 * Authenticated client for Wispr Flow's OAuth-protected MCP connector. Tokens
 * and DCR registrations use Rowboat's existing OAuth repositories; this
 * client never reads Wispr's desktop session, Keychain, or private local data.
 */
export class WisprFlowClientFactory {
  private static cache: ClientCache = { config: null, client: null, tokens: null };

  static async hasCredentials(): Promise<boolean> {
    const repo = container.resolve<IOAuthRepo>('oauthRepo');
    const { tokens } = await repo.read(PROVIDER_NAME);
    if (!tokens && this.cache.client) await this.clearCache();
    return Boolean(tokens);
  }

  static async getClient(): Promise<Client | null> {
    const repo = container.resolve<IOAuthRepo>('oauthRepo');
    const connection = await repo.read(PROVIDER_NAME);
    const tokens = connection.tokens;
    if (!tokens) {
      await this.clearCache();
      return null;
    }

    const config = await this.getConfiguration();
    if (oauthClient.isTokenExpired(tokens)) {
      if (!tokens.refresh_token) {
        await repo.upsert(PROVIDER_NAME, {
          error: 'Wispr Flow access expired. Please reconnect.',
        });
        await this.clearCache();
        return null;
      }
      try {
        const refreshed = await oauthClient.refreshTokens(
          config,
          tokens.refresh_token,
          tokens.scopes,
          MCP_URL,
        );
        await repo.upsert(PROVIDER_NAME, { tokens: refreshed, error: null });
        await this.replaceClient(refreshed);
        return this.cache.client;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Wispr Flow token refresh failed';
        await repo.upsert(PROVIDER_NAME, { error: message });
        await this.clearCache();
        return null;
      }
    }

    if (this.cache.client && this.cache.tokens?.access_token === tokens.access_token) {
      return this.cache.client;
    }
    await this.replaceClient(tokens);
    return this.cache.client;
  }

  static async clearCache(): Promise<void> {
    if (this.cache.client) {
      await this.cache.client.close().catch(() => undefined);
    }
    this.cache = { config: null, client: null, tokens: null };
  }

  private static async getConfiguration(): Promise<Configuration> {
    if (this.cache.config) return this.cache.config;
    const provider = await getProviderConfig(PROVIDER_NAME);
    if (provider.discovery.mode !== 'issuer' || provider.client.mode !== 'dcr') {
      throw new Error('Wispr Flow OAuth must use issuer discovery and DCR');
    }
    const registrations = container.resolve<IClientRegistrationRepo>('clientRegistrationRepo');
    const registration = await registrations.getClientRegistration(PROVIDER_NAME);
    if (!registration) {
      throw new Error('Wispr Flow is not registered. Connect it in Rowboat Settings first.');
    }
    this.cache.config = await oauthClient.discoverConfiguration(
      provider.discovery.issuer,
      registration.client_id,
    );
    return this.cache.config;
  }

  private static async replaceClient(tokens: OAuthTokens): Promise<void> {
    if (this.cache.client) {
      await this.cache.client.close().catch(() => undefined);
    }
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    });
    const client = new Client({ name: 'rowboat-wispr-flow', version: '1.0.0' });
    try {
      await client.connect(transport);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
    this.cache.tokens = tokens;
    this.cache.client = client;
  }
}
