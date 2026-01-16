import { WorkDir } from '../config/config.js';
import fs from 'fs/promises';
import path from 'path';
import { ClientRegistrationResponse } from './types.js';

export interface IClientRegistrationRepo {
  getClientRegistration(provider: string): Promise<ClientRegistrationResponse | null>;
  saveClientRegistration(provider: string, registration: ClientRegistrationResponse): Promise<void>;
  clearClientRegistration(provider: string): Promise<void>;
}

type ClientRegistrationStorage = {
  [provider: string]: ClientRegistrationResponse;
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
    const registration = config[provider];
    if (!registration) {
      return null;
    }

    // Validate registration structure
    try {
      return ClientRegistrationResponse.parse(registration);
    } catch {
      // Invalid registration, remove it
      await this.clearClientRegistration(provider);
      return null;
    }
  }

  async saveClientRegistration(provider: string, registration: ClientRegistrationResponse): Promise<void> {
    const config = await this.readConfig();
    config[provider] = registration;
    await this.writeConfig(config);
  }

  async clearClientRegistration(provider: string): Promise<void> {
    const config = await this.readConfig();
    delete config[provider];
    await this.writeConfig(config);
  }
}

