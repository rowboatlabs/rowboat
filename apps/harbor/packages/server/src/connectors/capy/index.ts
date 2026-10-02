import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { CAPY_API, CapyError, capyApi } from './api.js';
import { CapyConnector, type FollowTiming } from './connector.js';

// The Capy platform (spec §8 Connectors, 2026-10-02): checking an agent's
// Capy key, and running its connector. Listing the projects the key reaches
// is the check; it starts nothing billable. Capy creates its machines per
// thread, so there is no instance to create. `base` is Capy's API, or a
// stand-in in tests.

export function capyPlatform(base = CAPY_API, timing?: FollowTiming): ConnectorPlatform {
  return {
    async verify(secret) {
      try {
        await capyApi(secret, base).projects();
      } catch (err) {
        if (err instanceof CapyError && err.rejectsKey) throw new HarborError('invalid_request', `Capy did not accept this key: ${err.message}`);
        throw new HarborError('invalid_request', `Capy could not check this key: ${(err as Error).message}`);
      }
    },
    start(env) {
      return new CapyConnector(env, async () => capyApi(await env.credential(), base), timing).start();
    },
  };
}
