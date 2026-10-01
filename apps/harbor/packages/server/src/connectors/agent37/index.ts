import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { AGENT37_API, Agent37Error, agent37Api, instanceUrl, type InstanceUrl } from './api.js';
import { Agent37Connector } from './connector.js';

// The Agent37 platform (spec §8 Connectors, 2026-10-01): checking an agent's
// Agent37 key, and running its connector. Agent37 has no /me, so listing the
// workspace's instances is the check: it is the cheapest call on the hosting
// API and wakes nothing (https://www.agent37.com/docs/agents-api/instances).
// `base` and `instance` are Agent37's, or a stand-in in tests.

export function agent37Platform(base = AGENT37_API, instance: InstanceUrl = instanceUrl): ConnectorPlatform {
  return {
    async verify(secret) {
      try {
        await agent37Api(secret, base, instance).instances();
      } catch (err) {
        if (err instanceof Agent37Error && err.rejectsKey) throw new HarborError('invalid_request', `Agent37 did not accept this key: ${err.message}`);
        throw new HarborError('invalid_request', `Agent37 could not check this key: ${(err as Error).message}`);
      }
    },
    start(env) {
      return new Agent37Connector(env, async () => agent37Api(await env.credential(), base, instance)).start();
    },
  };
}
