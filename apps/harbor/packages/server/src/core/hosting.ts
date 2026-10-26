import { MARITIME_AGENTS, type AgentCredential, type AgentHosting, type AgentKeySecret, type Member } from '@rowboat/spaces-protocol';
import { HarborError } from '../errors.js';
import { canAddAgent, canRevokeAgentKey, enforce } from '../policy.js';
import type { StoredAgentHosting } from '../store.js';
import type { Agents } from './agents.js';
import type { ActorCtx, Kernel } from './kernel.js';
import type { Spaces } from './spaces.js';

// Managed agents (spec §8 Maritime, 2026-10-26): agents Rowboat's own account
// on a platform runs, created from the app rather than connected to. A
// person asks for a kind and a name; Harbor writes the intent, asks the
// platform for the agent, makes the member with the platform's id as its
// instance and the deployment's platform key sealed as its credential (so
// the connector reaches it like any platform agent), and hands back the
// member with its first key. A worker then follows the platform until the
// agent takes a command, and marks it ready; deleting runs the same way in
// reverse. The platform calls are a HostingProvider's; this module keeps the
// rules and the records.

export interface ProvisionInput {
  hostingId: string;
  /** The end-user key Rowboat names the agent by on the platform: creation is exactly-once under it. */
  externalUserId: string;
  displayName: string;
  kind: string;
  anthropicApiKey?: string;
  env: Array<{ key: string; value: string; secret?: boolean }>;
}

export interface HostingProvider {
  /** Create the agent on the platform, exactly once per `externalUserId`, and name it. */
  provision(input: ProvisionInput): Promise<{ externalId: string }>;
  /** Where the platform's agent stands. `up` includes asleep: a sleeping agent answers a command. */
  status(externalId: string): Promise<'deploying' | 'up' | 'error' | 'gone'>;
  /** Whether the agent takes a command yet. */
  check(externalId: string): Promise<boolean>;
  /** Remove the agent and its end user from the platform; done when absent. */
  deprovision(externalUserId: string): Promise<void>;
  /** The platform credential the agent's connector presents: the deployment's own key. */
  credential(): string;
}

/** What the connector host does for managed agents: seal their credential, start and stop their connector. */
export interface HostingHooks {
  save(agentId: string, secret: string, setBy: string): Promise<AgentCredential>;
  added(agent: Member): void;
  stop(agentId: string): Promise<void>;
}

/** A creation the platform never answered for: failed after this long, so the row never sits in `creating` forever. */
const CREATING_TIMEOUT_MS = 10 * 60_000;
/** How long a platform may take to deploy a new agent before the hosting fails. Maritime's builds take one to three minutes. */
const DEPLOY_TIMEOUT_MS = 20 * 60_000;
/** How long a deployed agent may refuse a command before the hosting fails. */
const CHECK_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_TICK_MS = 10_000;

const EXTERNAL_PREFIX = 'rowboat-';

function publicShape(row: StoredAgentHosting): AgentHosting {
  return {
    provider: row.provider,
    status: row.status,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class Hosting {
  private provider: HostingProvider | undefined;
  private hooks: HostingHooks | undefined;
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;

  constructor(
    private readonly k: Kernel,
    private readonly spaces: Spaces,
    private readonly agents: Agents,
  ) {}

  /** Absent = this Harbor runs no managed hosting (no platform key in the deployment). */
  attach(provider: HostingProvider, hooks: HostingHooks): void {
    this.provider = provider;
    this.hooks = hooks;
  }

  get available(): boolean {
    return this.provider !== undefined;
  }

  /** The worker: every tick drives each unfinished hosting one step. */
  start(tickMs = DEFAULT_TICK_MS): void {
    if (this.timer || !this.provider || this.k.readOnly) return;
    this.timer = setInterval(() => void this.tick(), tickMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ticking;
  }

  /** The kinds this Harbor creates, for a member: the platform's when a provider is attached, none otherwise. */
  async kinds(ctx: ActorCtx): Promise<string[]> {
    const actor = await this.k.store.getMember(ctx.memberId);
    if (!actor) throw new HarborError('not_a_member', 'not a member of this org');
    return this.provider ? [...MARITIME_AGENTS] : [];
  }

  /** A managed agent's hosting, for each of these agents, as its owner sees it. */
  async listFor(agentIds: string[]): Promise<Map<string, AgentHosting>> {
    const rows = await this.k.store.listAgentHostings(agentIds);
    return new Map(rows.filter((r) => r.agentId).map((r) => [r.agentId!, publicShape(r)]));
  }

  /**
   * Create a managed agent: the intent is written first, the platform asked,
   * then the member made with the platform's id and the deployment's key, so
   * nothing the platform created can go unrecorded.
   */
  async createManaged(
    ctx: ActorCtx,
    input: { displayName: string; kind: string; anthropicApiKey?: string; env?: Array<{ key: string; value: string; secret?: boolean }> },
  ): Promise<{ agent: Member; key: AgentKeySecret; hosting: AgentHosting }> {
    const actor = await this.k.store.getMember(ctx.memberId);
    if (!actor) throw new HarborError('not_a_member', 'not a member of this org');
    enforce(canAddAgent(actor));
    if (!this.provider || !this.hooks) throw new HarborError('invalid_request', 'this Harbor runs no managed hosting');
    if (!(MARITIME_AGENTS as readonly string[]).includes(input.kind)) throw new HarborError('invalid_request', `${input.kind} is not a kind of agent Rowboat can create`);
    if (input.kind === 'claude-code' && !input.anthropicApiKey) throw new HarborError('invalid_request', 'Claude Code needs your Anthropic API key');
    const displayName = input.displayName.trim();
    if (!displayName) throw new HarborError('invalid_request', 'an agent needs a name');
    this.k.guardWrite();

    const id = this.k.ulid();
    const now = this.k.now();
    let row: StoredAgentHosting = {
      id,
      provider: 'maritime',
      status: 'creating',
      externalUserId: `${EXTERNAL_PREFIX}${id.toLowerCase()}`,
      kind: input.kind,
      displayName,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    };
    await this.k.store.putHosting(row);

    let externalId: string;
    try {
      ({ externalId } = await this.provider.provision({
        hostingId: id,
        externalUserId: row.externalUserId,
        displayName,
        kind: input.kind,
        ...(input.anthropicApiKey ? { anthropicApiKey: input.anthropicApiKey } : {}),
        env: input.env ?? [],
      }));
    } catch (err) {
      const message = (err as Error).message.slice(0, 1000);
      await this.k.store.putHosting({ ...row, status: 'failed', error: message, updatedAt: this.k.now() });
      throw new HarborError('invalid_request', `Maritime: ${message}`);
    }

    const agent = await this.spaces.createAgent({
      displayName,
      ownerId: ctx.memberId,
      agentKind: input.kind,
      agentConnection: 'maritime',
      agentInstance: externalId,
    });
    await this.hooks.save(agent.id, this.provider.credential(), ctx.memberId);
    row = { ...row, agentId: agent.id, externalId, status: 'deploying', updatedAt: this.k.now() };
    await this.k.store.putHosting(row);
    const key = await this.agents.createKey(ctx, agent.id);
    return { agent, key, hosting: publicShape(row) };
  }

  /** Delete a managed agent's hosting: the owner or an admin. Keys go now; the platform's resources in the background. */
  async deleteManaged(ctx: ActorCtx, agentId: string): Promise<AgentHosting> {
    const actor = await this.k.store.getMember(ctx.memberId);
    if (!actor) throw new HarborError('not_a_member', 'not a member of this org');
    const agent = await this.k.store.getMember(agentId);
    if (!agent || agent.kind !== 'agent') throw new HarborError('not_found', 'no such agent');
    enforce(canRevokeAgentKey(actor, agent));
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row) throw new HarborError('not_found', 'this agent is not one Rowboat hosts');
    if (row.status === 'deleted' || row.status === 'deleting') return publicShape(row);
    this.k.guardWrite();
    const at = this.k.now();
    for (const key of await this.k.store.listAgentKeys([agentId])) if (!key.revokedAt) await this.k.store.revokeAgentKey(key.id, at);
    await this.hooks?.stop(agentId);
    const next: StoredAgentHosting = { ...row, status: 'deleting', updatedAt: at };
    delete next.error;
    await this.k.store.putHosting(next);
    void this.tick();
    return publicShape(next);
  }

  // --- the worker ------------------------------------------------------------------------

  private tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.drive()
      .catch((err) => console.log('[harbor] hosting: tick failed', (err as Error).message))
      .finally(() => {
        this.ticking = undefined;
      });
    return this.ticking;
  }

  private async drive(): Promise<void> {
    const provider = this.provider;
    if (!provider || this.k.readOnly) return;
    for (const row of await this.k.store.listHostingsByStatus(['creating', 'deploying', 'checking', 'deleting'])) {
      try {
        await this.step(provider, row);
      } catch (err) {
        console.log('[harbor] hosting: step failed', { id: row.id, status: row.status, error: (err as Error).message });
      }
    }
  }

  private async step(provider: HostingProvider, row: StoredAgentHosting): Promise<void> {
    const age = Date.now() - Date.parse(row.updatedAt);
    const since = Date.now() - Date.parse(row.createdAt);
    if (row.status === 'creating') {
      // The request that wrote this row is still running, or died with it: nothing to drive, only a deadline.
      if (since > CREATING_TIMEOUT_MS) await this.fail(row, 'The platform never answered for this agent. Create it again.');
      return;
    }
    if (row.status === 'deploying') {
      const status = await provider.status(row.externalId!);
      if (status === 'up') return this.move(row, 'checking');
      if (status === 'error') return this.fail(row, 'Maritime reports the agent in an error state after deploying.');
      if (status === 'gone') return this.fail(row, 'Maritime no longer has this agent.');
      if (since > DEPLOY_TIMEOUT_MS) return this.fail(row, 'Maritime did not finish deploying this agent in 20 minutes.');
      return;
    }
    if (row.status === 'checking') {
      if (await provider.check(row.externalId!)) {
        await this.move(row, 'ready');
        const agent = row.agentId ? await this.k.store.getMember(row.agentId) : undefined;
        if (agent) this.hooks?.added(agent);
        return;
      }
      if (age > CHECK_TIMEOUT_MS) return this.fail(row, 'The agent deployed but took no command for 10 minutes.');
      return;
    }
    if (row.status === 'deleting') {
      await provider.deprovision(row.externalUserId);
      await this.move(row, 'deleted');
    }
  }

  private async move(row: StoredAgentHosting, status: StoredAgentHosting['status']): Promise<void> {
    const next: StoredAgentHosting = { ...row, status, updatedAt: this.k.now() };
    delete next.error;
    await this.k.store.putHosting(next);
  }

  private async fail(row: StoredAgentHosting, error: string): Promise<void> {
    await this.k.store.putHosting({ ...row, status: 'failed', error: error.slice(0, 1000), updatedAt: this.k.now() });
  }
}
