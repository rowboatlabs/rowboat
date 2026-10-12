import { integrationPlatform } from '../commands.js';
import type { ConnectorPlatform } from '../platforms.js';
import { AttioApi } from './client.js';

export function attioPlatform(baseUrl?: string): ConnectorPlatform {
  return integrationPlatform({
    label: 'Attio',
    client: (secret) => new AttioApi(secret, baseUrl),
    check: (api) => api.check(),
    commands: [],
  });
}
