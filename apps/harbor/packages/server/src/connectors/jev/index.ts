import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { jevApi, OPENROUTER_API, type JevApi } from './api.js';
import { JevConnector } from './connector.js';

// Jev (spec §8 Jev, 2026-10-07): the agent Harbor itself is. Its key is the
// deployment's OpenRouter key, HARBOR_JEV_OPENROUTER_KEY, read at each
// message so a missing key leaves Jev idle rather than broken. No one sets a
// credential for it. `base` is OpenRouter's API, or a stand-in in tests.

export function jevApiKey(): string | undefined {
  return process.env.HARBOR_JEV_OPENROUTER_KEY?.trim() || undefined;
}

/** The deployment's Jev, or undefined without its key: read at each use, like the connector's. */
export function jevApiFromEnv(base = OPENROUTER_API): () => JevApi | undefined {
  return () => {
    const key = jevApiKey();
    return key ? jevApi(key, base) : undefined;
  };
}

export function jevPlatform(base = OPENROUTER_API): ConnectorPlatform {
  return {
    async verify() {
      throw new HarborError('invalid_request', 'Jev runs on Rowboat’s own key: it takes no credential');
    },
    start(env) {
      return new JevConnector(env, jevApiFromEnv(base)).start();
    },
  };
}
