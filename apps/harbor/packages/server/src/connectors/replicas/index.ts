import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { REPLICAS_API, ReplicasError, replicasApi } from './api.js';
import { ReplicasConnector, type FollowTiming } from './connector.js';

// The Replicas platform (spec §8 Connectors, 2026-09-30): checking an agent's
// Replicas key, and running its connector. `base` is Replicas's API, or a
// stand-in in tests.

export function replicasPlatform(base = REPLICAS_API, timing?: FollowTiming): ConnectorPlatform {
  return {
    async verify(secret) {
      try {
        await replicasApi(secret, base).environments();
      } catch (err) {
        if (err instanceof ReplicasError && err.rejectsKey) throw new HarborError('invalid_request', `Replicas did not accept this key: ${err.message}`);
        throw new HarborError('invalid_request', `Replicas could not check this key: ${(err as Error).message}`);
      }
    },
    start(env) {
      return new ReplicasConnector(env, async () => replicasApi(await env.credential(), base), timing).start();
    },
  };
}
