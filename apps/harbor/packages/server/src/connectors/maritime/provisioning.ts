import type { HostingProvider, ProvisionInput } from '../../core/hosting.js';
import { MARITIME_API, MaritimeError, maritimeApi, type CreateAgentInput, type MaritimeApi } from './api.js';

// Managed Maritime agents (spec §8 Maritime, 2026-10-26): Rowboat's own
// account creates and owns the VM, so the app can offer "Create an agent"
// without a key from the person. Each Rowboat agent is one Maritime end user
// (`/docs/sdk/end-users`), named by a key Rowboat mints, so the end user's
// agent is created exactly once however often the call is repeated, the LLM
// cap applies per agent, and deleting the end user takes the agent with it.
// What each kind needs on Maritime is what was measured on 2026-10-26 (the
// plan's section 11): Hermes from a pinned current image with the PATH the
// image's wrapper needs, the coding agents from Maritime's templates, Claude
// Code with the person's Anthropic key as the template requires.

/** The Hermes image Rowboat runs on Maritime: Maritime's own template is v0.14.0, too old for `hermes chat --format stream-json`. */
export const HERMES_IMAGE = 'nousresearch/hermes-agent:v0.22.5';
/** Maritime launches the image's wrapper with a PATH that lacks the hermes binary (measured 2026-10-26). */
const HERMES_PATH = '/opt/hermes/bin:/opt/hermes/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

export interface MaritimeProvisionerOptions {
  /** Rowboat's `mk_` key for its Maritime account: deploy, secrets and manage scopes. */
  apiKey: string;
  base?: string;
  /** The monthly AI spend each managed agent may draw from Rowboat's credits, in cents; none = no cap set. */
  llmCapCents?: number;
}

/** What Maritime is asked to create for each kind. */
export function creationFor(kind: string, input: { name: string; anthropicApiKey?: string; env: ProvisionInput['env'] }): CreateAgentInput {
  const env = [...input.env];
  if (kind === 'hermes') {
    return { name: input.name, framework: 'hermes', imageName: HERMES_IMAGE, useMaritimeLlm: true, env: [{ key: 'PATH', value: HERMES_PATH, secret: false }, ...env] };
  }
  if (kind === 'codex') return { name: input.name, templateId: 'codex', env };
  if (kind === 'claude-code') {
    return {
      name: input.name,
      templateId: 'claude_code',
      env: [...(input.anthropicApiKey ? [{ key: 'ANTHROPIC_API_KEY', value: input.anthropicApiKey, secret: true }] : []), { key: 'IS_SANDBOX', value: '1', secret: false }, ...env],
    };
  }
  throw new MaritimeError(0, undefined, `Rowboat does not run ${kind} on Maritime`);
}

/** A Maritime agent name: unique per account, so the display name plus the hosting's own id. */
export function agentNameFor(displayName: string, hostingId: string): string {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent';
  return `${slug}-${hostingId.slice(-8).toLowerCase()}`;
}

export function maritimeProvisioner(options: MaritimeProvisionerOptions): HostingProvider {
  const api: MaritimeApi = maritimeApi(options.apiKey, options.base ?? MARITIME_API);
  return {
    async provision(input) {
      await api.upsertEndUser(input.externalUserId, { displayName: input.displayName, tags: ['rowboat'] });
      const created = await api.createEndUserAgent(input.externalUserId, creationFor(input.kind, { name: agentNameFor(input.displayName, input.hostingId), ...(input.anthropicApiKey ? { anthropicApiKey: input.anthropicApiKey } : {}), env: input.env }));
      if (options.llmCapCents !== undefined && options.llmCapCents > 0) {
        await api.setEndUserPolicy(input.externalUserId, { llm_spend_cap_cents_per_month: Math.round(options.llmCapCents) });
      }
      return { externalId: created.id };
    },
    async status(externalId) {
      let agent;
      try {
        agent = await api.agent(externalId);
      } catch (err) {
        if (err instanceof MaritimeError && err.gone) return 'gone';
        throw err;
      }
      if (agent.status === 'deploying') return 'deploying';
      if (agent.status === 'error') return 'error';
      return 'up';
    },
    async check(externalId) {
      try {
        const run = await api.exec(externalId, ['sh', '-c', 'echo rowboat-ready'], { detached: false, timeoutSeconds: 60 });
        return run.status !== 'running' && (run.exitCode ?? 1) === 0 && (run.stdout ?? '').includes('rowboat-ready');
      } catch (err) {
        if (err instanceof MaritimeError && err.rejectsKey) throw err;
        return false;
      }
    },
    async deprovision(externalUserId) {
      await api.deleteEndUser(externalUserId);
    },
    credential() {
      return options.apiKey;
    },
  };
}
