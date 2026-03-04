import { WorkDir } from '../config/config.js';
import fs from 'fs/promises';
import path from 'path';
import { OAuthTokens } from './types.js';
import z from 'zod';

const ProviderConnectionSchema = z.object({
  tokens: OAuthTokens.nullable().optional(),
  clientId: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

const OAuthConfigSchema = z.object({
  version: z.number().optional(),
  providers: z.record(z.string(), ProviderConnectionSchema),
});

const ClientFacingConfigSchema = z.record(z.string(), z.object({
  connected: z.boolean(),
  error: z.string().nullable().optional(),
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
        connected: !!providerConfig.tokens,
        error: providerConfig.error,
      };
    }
    return clientFacingConfig;
  } 
}