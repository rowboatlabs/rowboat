import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { AGENT37_API, Agent37Error, agent37Api, instanceUrl, type InstanceUrl } from './api.js';
import { Agent37Connector } from './connector.js';

// The Agent37 platform (spec §8 Connectors, 2026-10-01): checking an agent's
// Agent37 key, and running its connector. Agent37 has no /me, so listing the
// workspace's instances is the check: it is the cheapest call on the hosting
// API and wakes nothing (https://www.agent37.com/docs/agents-api/instances).
// It also creates an instance for its agent when the owner asks (2026-10-02),
// with a monthly cap on managed model spend (Agent37's defaults to $0, which
// refuses every turn) and auto-sleep, which the connector wakes on a mention.
// `base` and `instance` are Agent37's, or a stand-in in tests.

/** The system template a new instance runs, per kind (https://www.agent37.com/docs/agents-api/templates). */
const TEMPLATE_FOR: Record<string, string> = { hermes: 'agent37-hermes', openclaw: 'agent37-openclaw' };

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
    async createInstance(secret, agent, input) {
      const template = TEMPLATE_FOR[agent.agentKind ?? ''];
      if (!template) throw new HarborError('invalid_request', `Agent37 has no instance for ${agent.agentKind ?? 'this kind of agent'}`);
      try {
        const created = await agent37Api(secret, base, instance).createInstance({
          template,
          name: input.name,
          monthlyCapMicros: Math.round(input.monthlyBudgetUsd * 1_000_000),
          autoSleep: input.autoSleep,
          metadata: { rowboat_agent: agent.id },
        });
        return { id: created.id, label: created.name ? `${created.name} (${created.id})` : created.id };
      } catch (err) {
        if (err instanceof Agent37Error) throw new HarborError('invalid_request', `Agent37 did not create the instance: ${err.message}`);
        throw err;
      }
    },
    start(env) {
      return new Agent37Connector(env, async () => agent37Api(await env.credential(), base, instance)).start();
    },
  };
}
