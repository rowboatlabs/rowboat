import { mentionsAsText, mentionToken, ownerSetsUp, superAgentMayCreate, type Approval, type ApprovalAction, type ApprovalRequest, type Member, type SuperAgentResult } from '@rowboat/spaces-protocol';
import { HarborError } from '../errors.js';
import { canSuperAgentCreate, canSuperAgentDelete, enforce } from '../policy.js';
import { approvalCardBody } from './approval-card.js';
import type { Feed } from './feed.js';
import type { Hosting } from './hosting.js';
import type { Invocations } from './invocations.js';
import type { ActorCtx, Kernel } from './kernel.js';
import type { Spaces } from './spaces.js';

// Super agents (spec §4 Agent members, 2026-11-02): an agent an admin lets
// create agents to hand work to, any the Agents page offers but a local one,
// and delete the managed ones it created when allowed. What it creates is its
// owner's, so no agent escapes every owner. A request is a card in the thread
// the agent is working in, raised by Harbor on the agent's turn but holding
// none, for its owner alone:
// - an agent Rowboat runs on its trial credit needs nothing more, so its card
//   is an approval (Allow once, Deny) that Harbor applies, recording the
//   outcome; without approval Harbor acts at once;
// - every other needs the owner's details (a key, an instance, setting it up
//   where it runs), so its card is a setup card: the owner completes it by
//   adding the agent in the app with the card as `request`, or denies it.

const KIND_LABELS: Record<string, string> = {
  hermes: 'Hermes', codex: 'Codex', 'claude-code': 'Claude Code', openclaw: 'OpenClaw', custom: 'custom agent',
  cursor: 'Cursor', opencode: 'OpenCode', pi: 'Pi', 'muse-code': 'Muse Code', posthog: 'PostHog bot', cal: 'Cal.com bot', attio: 'Attio bot',
};
const CONNECTION_LABELS: Record<string, string> = {
  plugin: 'its Hermes plugin', contract: 'the agent contract', replicas: 'Replicas', agent37: 'Agent37', conductor: 'Conductor', maritime: 'Maritime',
  posthog: 'PostHog', cal: 'Cal.com', attio: 'Attio',
};
const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

/** What the owner gives on a setup card, in a few words. */
function setupNeeds(kind: string, connection: string | undefined): string {
  if (connection === undefined) return 'adds an Anthropic API key';
  if (connection === 'plugin' || connection === 'contract') return 'connects it where it runs, with the key the card shows them once';
  if (connection === 'agent37') return 'adds an Agent37 key and picks or creates its instance';
  if (connection === 'maritime') return 'adds a Maritime key and picks the agent';
  return `adds a ${CONNECTION_LABELS[connection] ?? connection} key`;
}

export class SuperAgents {
  constructor(
    private readonly k: Kernel,
    private readonly hosting: Hosting,
    private readonly spaces: Spaces,
    private readonly feed: Feed,
    private readonly invocations: Invocations,
  ) {}

  async create(ctx: ActorCtx, input: { spaceId: string; threadRootId: string; displayName: string; kind: string; connection?: string; reason: string }): Promise<SuperAgentResult> {
    const superAgent = await this.caller(ctx);
    enforce(canSuperAgentCreate(superAgent));
    if (!superAgentMayCreate(input.kind, input.connection)) {
      throw new HarborError('invalid_request', `a super agent can’t create ${input.kind}${input.connection ? ` on ${input.connection}` : ''}: see create_agent for what it can`);
    }
    const space = await this.k.requireMember(ctx, input.spaceId);
    // The new agent joins this space so the super agent can hand it work: a DM takes no third member.
    if (space.kind !== 'shared') throw new HarborError('invalid_request', 'a new agent joins a shared space; ask in one');
    const displayName = input.displayName.trim();
    const action: ApprovalAction = { kind: 'create_agent', displayName, agentKind: input.kind, ...(input.connection ? { connection: input.connection } : {}) };
    const setup = ownerSetsUp(action);
    if (!setup && superAgent.superAgent?.approval === 'never') return { status: 'done', ...(await this.createNow(superAgent, input.spaceId, action)) };
    const owner = await this.k.store.getMember(superAgent.ownerId!);
    const ownerName = owner?.displayName ?? 'its owner';
    const what = input.connection ? `${kindLabel(input.kind)} on ${CONNECTION_LABELS[input.connection] ?? input.connection}` : kindLabel(input.kind);
    const request: ApprovalRequest = setup
      ? {
          requestKey: `super-agent:${this.k.ulid()}`,
          title: `Set up ${displayName}, a ${what}`,
          detail: `${displayName} will belong to ${ownerName} and join ${space.name} once ${ownerName} ${setupNeeds(input.kind, input.connection)} on this card.`,
          reason: input.reason,
          choices: ['deny'],
        }
      : {
          requestKey: `super-agent:${this.k.ulid()}`,
          title: `Create a ${what} agent named ${displayName}`,
          detail: `${displayName} (${what}) will belong to ${ownerName}, join ${space.name}, and start on Rowboat’s trial credit.`,
          reason: input.reason,
          choices: ['allow_once', 'deny'],
        };
    return { status: 'pending', approval: await this.ask(ctx, superAgent, owner, input, request, action) };
  }

  /**
   * The owner adding an agent with a setup card as `request` (2026-11-02),
   * checked before anything is created: the card is open, theirs to complete,
   * and asks for an agent reached the way this one is (`connection`, or
   * undefined for one Rowboat runs). The name and kind are theirs to change.
   */
  async assertSetup(ctx: ActorCtx, requestId: string, connection: string | undefined): Promise<Approval> {
    const found = await this.k.store.getApproval(requestId);
    if (!found?.action || found.action.kind !== 'create_agent' || !ownerSetsUp(found.action)) throw new HarborError('not_found', 'no such setup request');
    const superAgent = await this.k.store.getMember(found.agentId);
    if (superAgent?.ownerId !== ctx.memberId) throw new HarborError('forbidden', 'only the agent’s owner can set this up');
    if (found.state !== 'open') throw new HarborError('invalid_request', `this request is already ${found.state}`);
    if (found.action.connection !== connection) throw new HarborError('invalid_request', 'this request is for an agent reached another way');
    return found;
  }

  /** The agent is added: the card records it, and the agent joins the card's space for the super agent to hand it work. */
  async completeSetup(ctx: ActorCtx, request: Approval, agent: Member): Promise<Approval> {
    const done = await this.invocations.fulfilRequest(request.id, ctx.memberId, { agentId: agent.id });
    await this.join(request.agentId, request.conversation.spaceId, agent.id);
    return done;
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
    await this.join(superAgent.id, spaceId, agent.id);
    return { agent, hosting };
  }

  /** The super agent brings the new agent into the space, best effort: the agent exists either way, and its owner can add it from its page. */
  private async join(superAgentId: string, spaceId: string, agentId: string): Promise<void> {
    try {
      await this.spaces.addMembers({ memberId: superAgentId, agent: true }, spaceId, { memberIds: [agentId], actingMode: 'direct' });
    } catch {
      // left the space, or the space is gone
    }
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
    const body = `${to}${request.choices.includes('allow_once') ? approvalCardBody(superAgent.displayName, request) : setupCardBody(superAgent.displayName, request)}`;
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

/** A setup card's text, for clients that can't show the card: what it asks for, and that it is set up in Rowboat. */
function setupCardBody(agentName: string, request: ApprovalRequest): string {
  const plain = (text: string) => mentionsAsText(text, new Map()).replace(/\s+/g, ' ').trim();
  const parts = [`**${plain(request.title)}**`, plain(request.detail)];
  if (request.reason) parts.push(`Why: ${plain(request.reason)}`);
  parts.push(`_${plain(agentName)} is waiting for this to be set up on its card in Rowboat._`);
  return parts.join('\n\n');
}
