import { WorkDir } from '../config/config.js';
import fs from 'fs/promises';
import path from 'path';
import { OAuthTokens } from './types.js';
import z from 'zod';

const ProviderConnectionSchema = z.object({
  tokens: OAuthTokens.nullable().optional(),
  clientId: z.string().nullable().optional(),
  clientSecret: z.string().nullable().optional(),
  /**
   * `byok` (default for absent) — user provides their own client_id+secret;
   * tokens stored locally; refresh handled locally via openid-client.
   * `rowboat` — signed-in user; client_id+secret never on the desktop;
   * tokens stored locally but refresh goes through the api.
   */
  mode: z.enum(['byok', 'rowboat']).optional(),
  error: z.string().nullable().optional(),
  /**
   * `rowboat` only. One session, two uses (2026-09-14): the Rowboat account
   * is ALSO the identity every managed Spaces org trusts, so a person who
   * joins a space while choosing to stay signed out of the app still holds
   * a session here. `spacesOnly: true` marks that state — the tokens exist,
   * but the app's own features (gateway models, billing, connectors) treat
   * the user as signed out until they sign in from settings, which clears
   * the flag without a second browser trip. Absent = an ordinary sign-in.
   */
  spacesOnly: z.boolean().optional(),
});

export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

/**
 * THE reading of the `rowboat` record — every "is the user signed in?"
 * answer in the app comes through these two, nowhere else (one session,
 * two uses). `rowboatSession` = a session exists at all (the identity Spaces
 * uses); `isAppSignIn` = that session is the app's, not spaces-only.
 */
export function rowboatSession(connection: ProviderConnection): { tokens: OAuthTokens; spacesOnly: boolean; error?: string } | null {
  if (!connection.tokens) return null;
  return {
    tokens: connection.tokens,
    spacesOnly: connection.spacesOnly === true,
    ...(connection.error ? { error: connection.error } : {}),
  };
}

export function isAppSignIn(connection: ProviderConnection): boolean {
  const session = rowboatSession(connection);
  return session !== null && !session.spacesOnly;
}

const OAuthConfigSchema = z.object({
  version: z.number().optional(),
  providers: z.record(z.string(), ProviderConnectionSchema),
});

const ClientFacingConfigSchema = z.record(z.string(), z.object({
  connected: z.boolean(),
  error: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
}));

const LegacyOauthConfigSchema = z.record(z.string(), OAuthTokens);

const DEFAULT_CONFIG: z.infer<typeof OAuthConfigSchema> = {
  version: 2,
  providers: {},
};

export interface IOAuthRepo {
  read(provider: string): Promise<z.infer<typeof ProviderConnectionSchema>>;
  upsert(provider: string, connection: Partial<z.infer<typeof ProviderConnectionSchema>>): Promise<void>;
  delete(provider: string): Promise<void>;
  getClientFacingConfig(): Promise<z.infer<typeof ClientFacingConfigSchema>>;
}

export class FSOAuthRepo implements IOAuthRepo {
  private readonly configPath = path.join(WorkDir, 'config', 'oauth.json');

  constructor() {
    this.ensureConfigFile();
  }

  private async ensureConfigFile(): Promise<void> {
    try {
      await fs.access(this.configPath);
    } catch {
      await fs.writeFile(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    }
  }

  private normalizeConfig(payload: unknown): { config: z.infer<typeof OAuthConfigSchema>; migrated: boolean } {
    // check if payload conforms to updated schema
    const result = OAuthConfigSchema.safeParse(payload);
    if (result.success) {
      return { config: result.data, migrated: false };
    }

    // otherwise attempt to parse as legacy schema
    const legacyConfig = LegacyOauthConfigSchema.parse(payload);
    const updatedConfig: z.infer<typeof OAuthConfigSchema> = {
      version: 2,
      providers: {},
    };
    for (const [provider, tokens] of Object.entries(legacyConfig)) {
      updatedConfig.providers[provider] = {
        tokens,
      };
    }
    return { config: updatedConfig, migrated: true };
  }

  private async readConfig(): Promise<z.infer<typeof OAuthConfigSchema>> {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(content);
      const { config, migrated } = this.normalizeConfig(parsed);
      if (migrated) {
        await this.writeConfig(config);
      }
      return config;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private async writeConfig(config: z.infer<typeof OAuthConfigSchema>): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  async read(provider: string): Promise<z.infer<typeof ProviderConnectionSchema>> {
    const config = await this.readConfig();
    return config.providers[provider] ?? {};
  }
  async upsert(provider: string, connection: Partial<z.infer<typeof ProviderConnectionSchema>>): Promise<void> {
    const config = await this.readConfig();
    config.providers[provider] = { ...config.providers[provider] ?? {}, ...connection };
    await this.writeConfig(config);
  }

  async delete(provider: string): Promise<void> {
    const config = await this.readConfig();
    delete config.providers[provider];
    await this.writeConfig(config);
  }

  async getClientFacingConfig(): Promise<z.infer<typeof ClientFacingConfigSchema>> {
    const config = await this.readConfig();
    const clientFacingConfig: z.infer<typeof ClientFacingConfigSchema> = {};
    for (const [provider, providerConfig] of Object.entries(config.providers)) {
      clientFacingConfig[provider] = {
        // The settings/sidebar sign-in prompts key off this: for rowboat it
        // is the app sign-in (a spaces-only session reads as not connected).
        connected: provider === 'rowboat' ? isAppSignIn(providerConfig) : !!providerConfig.tokens,
        error: providerConfig.error,
        clientId: providerConfig.clientId ?? null,
      };
    }
    return ClientFacingConfigSchema.parse(clientFacingConfig);
  } 
}