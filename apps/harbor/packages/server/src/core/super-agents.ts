import { mentionToken, SUPER_AGENT_KINDS, type Approval, type ApprovalAction, type ApprovalRequest, type Member, type SuperAgentResult } from '@rowboat/spaces-protocol';
import { HarborError } from '../errors.js';
import { canSuperAgentCreate, canSuperAgentDelete, enforce } from '../policy.js';
import { approvalCardBody } from './approval-card.js';
import type { Feed } from './feed.js';
import type { Hosting } from './hosting.js';
import type { Invocations } from './invocations.js';
import type { ActorCtx, Kernel } from './kernel.js';
import type { Spaces } from './spaces.js';

// Super agents (spec §4 Agent members, 2026-11-02): an agent an admin lets
// create managed agents to hand work to, and delete the ones it created when
// allowed. What it creates is its owner's, so no agent escapes every owner.
// With approval (the default) a request is a card in the thread the agent is
// working in, raised by Harbor on the agent's turn but holding none: the
// owner decides it there, and Harbor applies it and records the outcome on
// the card. Without approval Harbor acts at once.

const KIND_LABELS: Record<string, string> = { hermes: 'Hermes', codex: 'Codex' };

export class SuperAgents {
  constructor(
    private readonly k: Kernel,
    private readonly hosting: Hosting,
    private readonly spaces: Spaces,
    private readonly feed: Feed,
    private readonly invocations: Invocations,
  ) {}

  async create(ctx: ActorCtx, input: { spaceId: string; threadRootId: string; displayName: string; kind: string; reason: string }): Promise<SuperAgentResult> {
    const superAgent = await this.caller(ctx);
    enforce(canSuperAgentCreate(superAgent));
    if (!(SUPER_AGENT_KINDS as readonly string[]).includes(input.kind)) throw new HarborError('invalid_request', `a super agent can create ${SUPER_AGENT_KINDS.join(' or ')}, not ${input.kind}`);
    const space = await this.k.requireMember(ctx, input.spaceId);
    // The new agent joins this space so the super agent can hand it work: a DM takes no third member.
    if (space.kind !== 'shared') throw new HarborError('invalid_request', 'a new agent joins a shared space; ask in one');
    const displayName = input.displayName.trim();
    const action: ApprovalAction = { kind: 'create_agent', displayName, agentKind: input.kind };
    if (superAgent.superAgent?.approval === 'never') return { status: 'done', ...(await this.createNow(superAgent, input.spaceId, action)) };
    const owner = await this.k.store.getMember(superAgent.ownerId!);
    const request: ApprovalRequest = {
      requestKey: `super-agent:${this.k.ulid()}`,
      title: `Create a ${KIND_LABELS[input.kind] ?? input.kind} agent named ${displayName}`,
      detail: `${displayName} (${KIND_LABELS[input.kind] ?? input.kind}) will belong to ${owner?.displayName ?? 'its owner'}, join ${space.name}, and start on Rowboat’s trial credit.`,
      reason: input.reason,
      choices: ['allow_once', 'deny'],
    };
    return { status: 'pending', approval: await this.ask(ctx, superAgent, owner, input, request, action) };
  }

  async delete(ctx: ActorCtx, input: { spaceId: string; threadRootId: string; agentId: string; reason: string }): Promise<SuperAgentResult> {
    const superAgent = await this.caller(ctx);
    const row = await this.k.store.getAgentHosting(input.agentId);
    enforce(canSuperAgentDelete(superAgent, row?.requestedBy));
    const target = await this.k.store.getMember(input.agentId);
    if (!target || !row) throw new HarborError('not_found', 'no such agent');
    await this.k.requireMember(ctx, input.spaceId);
    const action: ApprovalAction = { kind: 'delete_agent', agentId: target.id };
    if (superAgent.superAgent?.approval === 'never') {
      return { status: 'done', agent: target, hosting: await this.hosting.deleteForSuperAgent(superAgent, target.id) };
    }
    const owner = await this.k.store.getMember(superAgent.ownerId!);
    const request: ApprovalRequest = {
      requestKey: `super-agent:${this.k.ulid()}`,
      title: `Delete the agent ${target.displayName}`,
      detail: `${target.displayName} (${KIND_LABELS[row.kind] ?? row.kind}), which ${superAgent.displayName} created. Its keys stop at once and its machine is removed.`,
      reason: input.reason,
      choices: ['allow_once', 'deny'],
    };
    return { status: 'pending', approval: await this.ask(ctx, superAgent, owner, input, request, action) };
  }

  /**
   * Apply a decided request (service.decideApproval, after the decision's
   * commit, since the platform is called): an allowed one is carried out with
   * the rights the super agent has now, and its outcome or error goes on the
   * card. Anything else is returned as it is.
   */
  async apply(approval: Approval): Promise<Approval> {
    if (!approval.action || approval.state !== 'allowed' || approval.appliedAt) return approval;
    const superAgent = await this.k.store.getMember(approval.agentId);
    try {
      if (!superAgent) throw new HarborError('not_found', 'the agent that asked is gone');
      if (approval.action.kind === 'create_agent') {
        const { agent } = await this.createNow(superAgent, approval.conversation.spaceId, approval.action);
        return await this.invocations.recordOutcome(approval.id, { agentId: agent.id });
      }
      await this.hosting.deleteForSuperAgent(superAgent, approval.action.agentId);
      return await this.invocations.recordOutcome(approval.id, { agentId: approval.action.agentId });
    } catch (err) {
      return this.invocations.recordOutcome(approval.id, { error: (err as Error).message.slice(0, 1000) });
    }
  }

  private async createNow(superAgent: Member, spaceId: string, action: Extract<ApprovalAction, { kind: 'create_agent' }>) {
    const { agent, hosting } = await this.hosting.createForSuperAgent(superAgent, { displayName: action.displayName, kind: action.agentKind });
    // Best effort: the agent exists whether or not the super agent is still in the space to bring it in.
    try {
      await this.spaces.addMembers({ memberId: superAgent.id, agent: true }, spaceId, { memberIds: [agent.id], actingMode: 'direct' });
    } catch {
      // the owner adds it from its page
    }
    return { agent, hosting };
  }

  /** The card, on the super agent's turn in the thread it names, addressed to its owner. */
  private async ask(
    ctx: ActorCtx,
    superAgent: Member,
    owner: Member | undefined,
    where: { spaceId: string; threadRootId: string },
    request: ApprovalRequest,
    action: ApprovalAction,
  ): Promise<Approval> {
    const turn = (await this.k.store.listSpaceInvocations(where.spaceId, where.threadRootId, 50)).find(
      (i) => i.agentId === superAgent.id && (i.state === 'working' || i.state === 'waiting'),
    );
    if (!turn) throw new HarborError('invalid_request', 'ask in the thread you are working in: pass its spaceId and threadRootId');
    const to = owner ? `${mentionToken({ kind: 'member', id: owner.id, label: owner.displayName })} ` : '';
    const body = `${to}${approvalCardBody(superAgent.displayName, request)}`;
    const { message } = await this.feed.postMessage(ctx, where.spaceId, { body, threadRoot: turn.conversation.threadRootId, actingMode: 'direct' }, { approval: { invocationId: turn.id, request, action } });
    return message.approval!;
  }

  private async caller(ctx: ActorCtx): Promise<Member> {
    const member = await this.k.store.getMember(ctx.memberId);
    if (!member) throw new HarborError('not_a_member', 'not a member of this org');
    if (!ctx.agent) throw new HarborError('forbidden', 'only an agent, on its own key, can do this');
    return member;
  }
}
