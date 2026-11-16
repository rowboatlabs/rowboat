import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { CONDUCTOR_API, ConductorError, conductorApi } from './api.js';
import { ConductorConnector, type PollTiming } from './connector.js';

// The Conductor platform (spec §8 Connectors, 2026-10-06): checking an agent's
// Conductor key, and running its connector. `base` is Conductor's API, or a
// stand-in in tests.

export function conductorPlatform(base = CONDUCTOR_API, timing?: PollTiming): ConnectorPlatform {
  return {
    async verify(secret) {
      try {
        await conductorApi(secret, base).me();
      } catch (err) {
        if (err instanceof ConductorError && err.rejectsKey) throw new HarborError('invalid_request', `Conductor did not accept this key: ${err.message}`);
        throw new HarborError('invalid_request', `Conductor could not check this key: ${(err as Error).message}`);
      }
    },
    start(env) {
      return new ConductorConnector(env, async () => conductorApi(await env.credential(), base), timing).start();
    },
  };
}
