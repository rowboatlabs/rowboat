import { WorkDir } from '../config/config.js';
import fs from 'fs/promises';
import path from 'path';
import { OAuthTokens } from './types.js';

export interface IOAuthRepo {
  getTokens(provider: string): Promise<OAuthTokens | null>;
  saveTokens(provider: string, tokens: OAuthTokens): Promise<void>;
  clearTokens(provider: string): Promise<void>;
  isConnected(provider: string): Promise<boolean>;
  getConnectedProviders(): Promise<string[]>;
}

type OAuthStorage = {
  [provider: string]: OAuthTokens;
};

export class FSOAuthRepo implements IOAuthRepo {
  private readonly configPath = path.join(WorkDir, 'config', 'oauth.json');

  constructor() {
    this.ensureConfigFile();
  }

  private async ensureConfigFile(): Promise<void> {
    try {
      await fs.access(this.configPath);
    } catch {
      // File doesn't exist, create it with empty object
      await fs.writeFile(this.configPath, JSON.stringify({}, null, 2));
    }
  }

  private async readConfig(): Promise<OAuthStorage> {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(content);
      return parsed as OAuthStorage;
    } catch {
      return {};
    }
  }

  private async writeConfig(config: OAuthStorage): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  async getTokens(provider: string): Promise<OAuthTokens | null> {
    const config = await this.readConfig();
    const tokens = config[provider];
    if (!tokens) {
      return null;
    }
    
    // Validate tokens structure
    try {
      return OAuthTokens.parse(tokens);
    } catch {
      // Invalid tokens, remove them
      await this.clearTokens(provider);
      return null;
    }
  }

  async saveTokens(provider: string, tokens: OAuthTokens): Promise<void> {
    const config = await this.readConfig();
    config[provider] = tokens;
    await this.writeConfig(config);
  }

  async clearTokens(provider: string): Promise<void> {
    const config = await this.readConfig();
    delete config[provider];
    await this.writeConfig(config);
  }

  async isConnected(provider: string): Promise<boolean> {
    const tokens = await this.getTokens(provider);
    if (!tokens) {
      return false;
    }
    
    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    return tokens.expires_at > now;
  }

  async getConnectedProviders(): Promise<string[]> {
    const config = await this.readConfig();
    const connected: string[] = [];
    
    for (const provider of Object.keys(config)) {
      if (await this.isConnected(provider)) {
        connected.push(provider);
      }
    }
    
    return connected;
  }
}

