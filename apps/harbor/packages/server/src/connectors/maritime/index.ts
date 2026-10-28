import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { MARITIME_API, MaritimeError, maritimeApi } from './api.js';
import { MaritimeConnector, type PollTiming } from './connector.js';
import { kindOfAgent, RUNTIMES } from './runtimes.js';

// The Maritime platform (spec §8 Connectors, Maritime, 2026-10-26): checking
// an agent's Maritime key, and running its connector. A Maritime agent is one
// VM with a persistent volume, so a Rowboat agent is that one agent, named by
// its Maritime id when it is added: the check reads the agent on the key and
// confirms it runs the agent's kind. An agent made from an image says nothing
// about its runtime, so it is taken at the person's word and the first turn
// says so if the CLI is not there. `base` is Maritime's API, or a stand-in in
// tests.

export function maritimePlatform(base = MARITIME_API, timing?: PollTiming): ConnectorPlatform {
  return {
    async verify(secret, target) {
      if (!target.instance) throw new HarborError('invalid_request', 'a Maritime agent is one Maritime agent: name its id');
      if (!RUNTIMES[target.kind]) throw new HarborError('invalid_request', `Harbor does not drive ${target.kind} on Maritime`);
      let agent;
      try {
        agent = await maritimeApi(secret, base).agent(target.instance);
      } catch (err) {
        if (err instanceof MaritimeError && err.rejectsKey) throw new HarborError('invalid_request', `Maritime did not accept this key: ${err.message}`);
        if (err instanceof MaritimeError && err.gone) throw new HarborError('invalid_request', `This Maritime key does not reach an agent ${target.instance}`);
        throw new HarborError('invalid_request', `Maritime could not check this key: ${(err as Error).message}`);
      }
      const runs = kindOfAgent(agent);
      if (runs && runs !== target.kind) {
        throw new HarborError('invalid_request', `The Maritime agent ${agent.name || agent.id} runs ${runs}, not ${target.kind}`);
      }
    },
    start(env) {
      return new MaritimeConnector(env, async () => maritimeApi(await env.credential(), base), timing).start();
    },
  };
}
