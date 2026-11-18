import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { MARITIME_API, MaritimeError, maritimeApi } from './api.js';
import { MaritimeConnector, type PollTiming } from './connector.js';
import { kindOfAgent, RUNTIMES } from './runtimes.js';
import { listMaritimeAgents } from './setup.js';
import { MaritimeWorkerHost, type WorkerHostOptions } from './worker-host.js';

// The Maritime platform (spec §8 Connectors, Maritime, 2026-10-26): checking
// an agent's Maritime key, and running its connector. A Maritime agent is one
// VM with a persistent volume, so a Rowboat agent is that one agent, named by
// its Maritime id when it is added: the check reads the agent on the key and
// confirms it runs the agent's kind. An agent made from an image says nothing
// about its runtime, so it is taken at the person's word and the first turn
// says so if the CLI is not there. `base` is Maritime's API, or a stand-in in
// tests. For the kinds in worker mode (the agent worker, 2026-11-05), the
// connector starts the worker on the box instead of running the turns.

/** Which kinds the worker drives on the box, and how it is started (HARBOR_MARITIME_WORKER_* in a deployment). */
export interface MaritimeWorkerMode extends WorkerHostOptions {
  kinds: string[];
}

export function workerModeFromEnv(): MaritimeWorkerMode {
  const kinds = (process.env.HARBOR_MARITIME_WORKER_KINDS ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const ttl = Number(process.env.HARBOR_MARITIME_WORKER_TTL_SECONDS);
  const idle = Number(process.env.HARBOR_MARITIME_WORKER_IDLE_SECONDS);
  return {
    kinds,
    ...(Number.isFinite(ttl) && ttl > 0 ? { ttlSeconds: ttl } : {}),
    ...(Number.isFinite(idle) && idle > 0 ? { idleSeconds: idle } : {}),
  };
}

export function maritimePlatform(base = MARITIME_API, timing?: PollTiming, worker: MaritimeWorkerMode = workerModeFromEnv()): ConnectorPlatform {
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
    setup: { list: (secret) => listMaritimeAgents(secret, fetch, base) },
    start(env) {
      const api = async () => maritimeApi(await env.credential(), base);
      // Worker mode (2026-11-05): the worker on the box does the turns; Harbor wakes the box and starts it.
      if (worker.kinds.includes(env.agent.agentKind ?? '')) return new MaritimeWorkerHost(env, api, worker).start();
      return new MaritimeConnector(env, api, timing).start();
    },
  };
}
