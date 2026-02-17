import { WorkDir } from '../config/config.js';
import fs from 'fs/promises';
import path from 'path';
import { OAuthTokens } from './types.js';
import z from 'zod';

const ProviderConnectionSchema = z.object({
  tokens: OAuthTokens,
  clientId: z.string().optional(),
  error: z.string().optional(),
});

const OAuthConfigSchema = z.object({
  version: z.number().optional(),
  providers: z.record(z.string(), ProviderConnectionSchema),
});

const ClientFacingConfigSchema = z.record(z.string(), z.object({
  connected: z.boolean(),
  error: z.string().optional(),
}));

const LegacyOauthConfigSchema = z.record(z.string(), OAuthTokens);

const DEFAULT_CONFIG: z.infer<typeof OAuthConfigSchema> = {
  version: 2,
  providers: {},
};

export interface IOAuthRepo {
  getTokens(provider: string): Promise<OAuthTokens | null>;
  saveTokens(provider: string, tokens: OAuthTokens): Promise<void>;
  clearTokens(provider: string): Promise<void>;
  getClientId(provider: string): Promise<string | null>;
  setClientId(provider: string, clientId: string): Promise<void>;
  setError(provider: string, errorMessage: string): Promise<void>;
  clearError(provider: string): Promise<void>;
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

  async getTokens(provider: string): Promise<OAuthTokens | null> {
    const config = await this.readConfig();
    const tokens = config.providers[provider]?.tokens;
    return tokens ?? null;
  }

  async saveTokens(provider: string, tokens: OAuthTokens): Promise<void> {
    const config = await this.readConfig();
    if (config.providers[provider]) {
      delete config.providers[provider];
    }
    config.providers[provider] = {
      tokens,
    };
    await this.writeConfig(config);
  }

  async clearTokens(provider: string): Promise<void> {
    const config = await this.readConfig();
    delete config.providers[provider];
    await this.writeConfig(config);
  }

  async getClientId(provider: string): Promise<string | null> {
    const config = await this.readConfig();
    const clientId = config.providers[provider]?.clientId;
    return clientId ?? null;
  }

  async setClientId(provider: string, clientId: string): Promise<void> {
    const config = await this.readConfig();
    if (!config.providers[provider]) {
      throw new Error(`Provider ${provider} not found`);
    }
    config.providers[provider].clientId = clientId;
    await this.writeConfig(config);
  }

  async clearClientId(provider: string): Promise<void> {
    const config = await this.readConfig();
    if (!config.providers[provider]) {
      throw new Error(`Provider ${provider} not found`);
    }
    delete config.providers[provider].clientId;
    await this.writeConfig(config);
  }

  async setError(provider: string, errorMessage: string): Promise<void> {
    const config = await this.readConfig();
    if (!config.providers[provider]) {
      throw new Error(`Provider ${provider} not found`);
    }
    config.providers[provider].error = errorMessage;
    await this.writeConfig(config);
  }

  async clearError(provider: string): Promise<void> {
    const config = await this.readConfig();
    if (!config.providers[provider]) {
      throw new Error(`Provider ${provider} not found`);
    }
    delete config.providers[provider].error;
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