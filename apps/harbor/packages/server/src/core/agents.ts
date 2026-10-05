import { HARBOR_RUN_CONNECTIONS, INSTANCE_CONNECTIONS, isAgentPair, type AgentCredential, type AgentKey, type AgentKeySecret, type AgentListing, type InvocationOptionValues, type Member } from '@rowboat/spaces-protocol';
import { hashAgentKey, mintAgentKeySecret } from '../agent-keys.js';
import { HarborError } from '../errors.js';
import { agentsManagedBy, canAddAgent, canCreateAgentKey, canRevokeAgentKey, enforce } from '../policy.js';
import type { StoredAgentKey } from '../store.js';
import type { Kernel, ActorCtx } from './kernel.js';
import type { Spaces } from './spaces.js';

// Agent members and their keys (spec §4 Agent members, 2026-09-29). Any
// person adds an agent and owns it; the owner alone creates its keys; the
// owner or an admin revokes them. A key is a bearer secret presented as the
// agent itself — auth.ts resolves it on every face — and the org keeps only
// its hash. Render face only: a secret never passes through a tool.
//
// An agent's kind and connection (2026-09-30) are set here and never change.
// A platform connection's credential is checked and stored by the connector
// host (connectors/host.ts), which seals it for this org; this module keeps
// the rules: who may set it, and that only a platform agent has one.

/** What the connector host does for agent creation. Absent = this org runs no connectors. */
/** What a platform credential is checked against: the agent's kind and, for an instance connection, its instance. */
export interface CredentialTarget {
  kind: string;
  instance?: string;
}

export interface AgentConnectorHooks {
  verify(connection: string, secret: string, target: CredentialTarget): Promise<void>;
  save(agentId: string, secret: string, setBy: string): Promise<AgentCredential>;
  added(agent: Member): void;
}

export class Agents {
  private hooks: AgentConnectorHooks | undefined;

  constructor(
    private readonly k: Kernel,
    private readonly spaces: Spaces,
  ) {}

  attachConnectors(hooks: AgentConnectorHooks): void {
    this.hooks = hooks;
  }

  private async actor(ctx: ActorCtx): Promise<Member> {
    const member = await this.k.store.getMember(ctx.memberId);
    if (!member) throw new HarborError('not_a_member', 'not a member of this org');
    return member;
  }

  private async agent(agentId: string): Promise<Member> {
    const agent = await this.k.store.getMember(agentId);
    if (!agent || agent.kind !== 'agent') throw new HarborError('not_found', 'no such agent');
    return agent;
  }

  /** The agents the caller manages, each with its keys (never their secrets). */
  async list(ctx: ActorCtx): Promise<AgentListing[]> {
    const actor = await this.actor(ctx);
    const agents = await this.k.store.listAgents(agentsManagedBy(actor) === 'all' ? null : actor.id);
    const keys = await this.k.store.listAgentKeys(agents.map((a) => a.id));
    const credentials = await this.k.store.listAgentCredentials(agents.map((a) => a.id));
    return agents.map((agent) => {
      const stored = credentials.find((c) => c.agentId === agent.id);
      const { agentId: _agentId, sealed: _sealed, ...credential } = stored ?? ({} as never);
      return { agent, keys: keys.filter((k) => k.agentId === agent.id), ...(stored ? { credential } : {}) };
    });
  }

  /**
   * Add an agent: the caller owns it and gets its first key, shown this once.
   * A platform agent's credential is checked with the platform first, so a
   * refused key creates nothing.
   */
  async add(
    ctx: ActorCtx,
    input: { displayName: string; kind: string; connection: string; credential?: string; instance?: string },
  ): Promise<{ agent: Member; key: AgentKeySecret }> {
    enforce(canAddAgent(await this.actor(ctx)));
    if (!isAgentPair(input.kind, input.connection)) {
      throw new HarborError('invalid_request', `${input.kind} through ${input.connection} is not a kind of agent this Harbor knows`);
    }
    const platform = HARBOR_RUN_CONNECTIONS.includes(input.connection);
    if (platform && input.credential === undefined) throw new HarborError('invalid_request', `a ${input.connection} agent needs its ${input.connection} key`);
    if (!platform && input.credential !== undefined) throw new HarborError('invalid_request', 'only an agent Harbor reaches through a platform takes a credential');
    // An instance connection's agent is one instance on the platform (2026-10-05): named at Add, never after.
    const onInstance = INSTANCE_CONNECTIONS.includes(input.connection);
    if (onInstance && input.instance === undefined) throw new HarborError('invalid_request', `a ${input.connection} agent is one ${input.connection} instance: name it`);
    if (!onInstance && input.instance !== undefined) throw new HarborError('invalid_request', `a ${input.connection} agent runs on no instance of its own`);
    if (platform) {
      if (!this.hooks) throw new HarborError('invalid_request', `this Harbor runs no ${input.connection} connector`);
      await this.hooks.verify(input.connection, input.credential!, { kind: input.kind, ...(input.instance ? { instance: input.instance } : {}) });
    }
    const agent = await this.spaces.createAgent({
      displayName: input.displayName,
      ownerId: ctx.memberId,
      agentKind: input.kind,
      agentConnection: input.connection,
      ...(input.instance ? { agentInstance: input.instance } : {}),
    });
    if (platform) await this.hooks!.save(agent.id, input.credential!, ctx.memberId);
    const key = await this.mint(ctx, agent.id);
    this.hooks?.added(agent);
    return { agent, key };
  }

  /** Replace a platform agent's credential: the owner only, checked with the platform first; clears a rejection. */
  async setCredential(ctx: ActorCtx, agentId: string, secret: string): Promise<AgentCredential> {
    const agent = await this.agent(agentId);
    enforce(canCreateAgentKey(await this.actor(ctx), agent));
    const connection = agent.agentConnection ?? '';
    if (!HARBOR_RUN_CONNECTIONS.includes(connection)) throw new HarborError('invalid_request', 'only an agent Harbor reaches through a platform has a credential');
    if (!this.hooks) throw new HarborError('invalid_request', `this Harbor runs no ${connection} connector`);
    this.k.guardWrite();
    // The new key must still reach the agent's own instance.
    await this.hooks.verify(connection, secret, { kind: agent.agentKind ?? '', ...(agent.agentInstance ? { instance: agent.agentInstance } : {}) });
    return this.hooks.save(agentId, secret, ctx.memberId);
  }

  /**
   * Set the agent's option defaults (spec §8 Invocation options, 2026-10-01):
   * the owner only, like its keys; each for an option its connector declared,
   * a declared choice or a toggle's value. Replaces them all.
   */
  async setOptionDefaults(ctx: ActorCtx, agentId: string, defaults: InvocationOptionValues): Promise<InvocationOptionValues> {
    const agent = await this.agent(agentId);
    enforce(canCreateAgentKey(await this.actor(ctx), agent));
    this.k.guardWrite();
    const declared = (await this.k.store.getAgentCapabilities(agentId))?.options ?? [];
    for (const [key, value] of Object.entries(defaults)) {
      const option = declared.find((o) => o.key === key);
      if (!option) throw new HarborError('invalid_request', `${agent.displayName} has no option "${key}"`);
      const fits = option.type === 'toggle' ? typeof value === 'boolean' : typeof value === 'string' && option.choices.some((c) => c.id === value);
      if (!fits) throw new HarborError('invalid_request', `that is not one of ${option.label}'s choices`);
    }
    await this.k.store.putAgentOptionDefaults(agentId, defaults, ctx.memberId, this.k.now());
    return defaults;
  }

  /** Another key, for rotation: create, switch the agent over, revoke the old one. */
  async createKey(ctx: ActorCtx, agentId: string): Promise<AgentKeySecret> {
    enforce(canCreateAgentKey(await this.actor(ctx), await this.agent(agentId)));
    this.k.guardWrite();
    return this.mint(ctx, agentId);
  }

  /** Revoke a key. Idempotent: a revoked key keeps its first revocation time. */
  async revokeKey(ctx: ActorCtx, agentId: string, keyId: string): Promise<AgentKey> {
    enforce(canRevokeAgentKey(await this.actor(ctx), await this.agent(agentId)));
    const key = await this.k.store.getAgentKey(keyId);
    if (!key || key.agentId !== agentId) throw new HarborError('not_found', 'no such key for this agent');
    await this.k.store.revokeAgentKey(keyId, this.k.now());
    const { hash: _hash, ...revoked } = (await this.k.store.getAgentKey(keyId))!;
    return revoked;
  }

  private async mint(ctx: ActorCtx, agentId: string): Promise<AgentKeySecret> {
    const secret = mintAgentKeySecret();
    const key: StoredAgentKey = { id: this.k.ulid(), agentId, hash: hashAgentKey(secret), createdBy: ctx.memberId, createdAt: this.k.now() };
    await this.k.store.putAgentKey(key);
    const { hash: _hash, ...metadata } = key;
    return { ...metadata, secret };
  }
}
