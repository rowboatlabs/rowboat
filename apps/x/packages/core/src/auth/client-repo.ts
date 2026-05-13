import { WorkDir } from '../config/config.js';
import fs from 'fs/promises';
import path from 'path';
import { ClientRegistrationResponse } from './types.js';

export const DEFAULT_CALLBACK_PORT = 8080;

export interface IClientRegistrationRepo {
  getClientRegistration(provider: string): Promise<ClientRegistrationResponse | null>;
  /** Returns the port that was used when DCR-registering this provider, or DEFAULT_CALLBACK_PORT if not stored. */
  getRegisteredPort(provider: string): Promise<number>;
  saveClientRegistration(provider: string, registration: ClientRegistrationResponse, port: number): Promise<void>;
  clearClientRegistration(provider: string): Promise<void>;
}

// _registeredPort is our private field — stripped by Zod when we parse the RFC response fields
type StoredEntry = Record<string, unknown> & { _registeredPort?: number };

type ClientRegistrationStorage = {
  [provider: string]: StoredEntry;
};

export class FSClientRegistrationRepo implements IClientRegistrationRepo {
  private readonly configPath = path.join(WorkDir, 'config', 'oauth-clients.json');

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

  private async readConfig(): Promise<ClientRegistrationStorage> {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(content);
      return parsed as ClientRegistrationStorage;
    } catch {
      return {};
    }
  }

  private async writeConfig(config: ClientRegistrationStorage): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  async getClientRegistration(provider: string): Promise<ClientRegistrationResponse | null> {
    const config = await this.readConfig();
    const entry = config[provider];
    if (!entry) {
      return null;
    }

    // Validate registration structure (Zod strips unknown fields like _registeredPort)
    try {
      return ClientRegistrationResponse.parse(entry);
    } catch {
      // Invalid registration, remove it
      await this.clearClientRegistration(provider);
      return null;
    }
  }

  async getRegisteredPort(provider: string): Promise<number> {
    const config = await this.readConfig();
    return config[provider]?._registeredPort ?? DEFAULT_CALLBACK_PORT;
  }

  async saveClientRegistration(provider: string, registration: ClientRegistrationResponse, port: number): Promise<void> {
    const config = await this.readConfig();
    config[provider] = { ...registration, _registeredPort: port };
    await this.writeConfig(config);
  }

  async clearClientRegistration(provider: string): Promise<void> {
    const config = await this.readConfig();
    delete config[provider];
    await this.writeConfig(config);
  }
}

