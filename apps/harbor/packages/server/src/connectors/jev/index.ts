import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { jevApi, OPENROUTER_API } from './api.js';
import { JevConnector } from './connector.js';

// Jev (spec §8 Jev, 2026-10-07): the agent Harbor itself is. Its key is the
// deployment's OpenRouter key, HARBOR_JEV_OPENROUTER_KEY, read at each
// message so a missing key leaves Jev idle rather than broken. No one sets a
// credential for it. `base` is OpenRouter's API, or a stand-in in tests.

export function jevApiKey(): string | undefined {
  return process.env.HARBOR_JEV_OPENROUTER_KEY?.trim() || undefined;
}

export function jevPlatform(base = OPENROUTER_API): ConnectorPlatform {
  return {
    async verify() {
      throw new HarborError('invalid_request', 'Jev runs on Rowboat’s own key: it takes no credential');
    },
    start(env) {
      return new JevConnector(env, () => {
        const key = jevApiKey();
        return key ? jevApi(key, base) : undefined;
      }).start();
    },
  };
}
