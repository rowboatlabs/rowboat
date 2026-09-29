import type { AgentKey, AgentKeySecret, AgentListing, Member } from '@rowboat/spaces-protocol';
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

export class Agents {
  constructor(
    private readonly k: Kernel,
    private readonly spaces: Spaces,
  ) {}

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
    return agents.map((agent) => ({ agent, keys: keys.filter((k) => k.agentId === agent.id) }));
  }

  /** Add an agent: the caller owns it and gets its first key, shown this once. */
  async add(ctx: ActorCtx, displayName: string): Promise<{ agent: Member; key: AgentKeySecret }> {
    enforce(canAddAgent(await this.actor(ctx)));
    const agent = await this.spaces.createAgent({ displayName, ownerId: ctx.memberId });
    return { agent, key: await this.mint(ctx, agent.id) };
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
