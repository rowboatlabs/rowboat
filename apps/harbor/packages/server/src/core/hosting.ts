import {
  LLM_PROVIDERS,
  MARITIME_AGENTS,
  TRIAL_KINDS,
  type AgentCredential,
  type AgentHosting,
  type AgentKeySecret,
  type HostingEnvVar,
  type HostingConsole,
  type HostingExecution,
  type HostingFileEntry,
  type HostingFunding,
  type HostingLogLine,
  type HostingMachine,
  type HostingPowerAction,
  type HostingSize,
  type HostingSkill,
  type HostingSpend,
  type HostingTrigger,
  type HostingUsage,
  type LlmProvider,
  type Member,
} from '@rowboat/spaces-protocol';
import type { BillingAccounts } from '../billing.js';
import { HarborError } from '../errors.js';
import { canAddAgent, canRevokeAgentKey, canSuperAgentCreate, canSuperAgentDelete, enforce } from '../policy.js';
import { credentialHint } from '../sealing.js';
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
//
// Who pays for the model (2026-10-27): a new Hermes or Codex starts on
// Rowboat's trial credit, the platform's funded LLM under the cap the
// deployment sets, there to try the agent; Claude Code starts on its owner's
// Anthropic key. The trial is one-shot. It closes when the platform reports
// the cap reached (the connector asks before each turn and says so in the
// thread), when thirty days pass, or the moment the owner adds a key, and
// closing it sets the platform's cap for the agent to zero so nothing renews
// next month. The owner's key goes to the agent's environment on the
// platform with what its runtime needs to use it; Harbor keeps the provider
// and the key's last characters.
//
// A sign-in instead of a key (2026-10-30): Codex's owner can sign it in to
// their ChatGPT plan from the Terminal tab, which Harbor cannot see happen,
// and Codex honours the sign-in only on its built-in provider while the
// platform's config names its proxy. Asked, Harbor has the runtime say
// whether a sign-in is there; found, the agent runs on it from then on, the
// trial closed `sign_in`, and the turn script forces Codex's own provider
// (it asks before every turn not on a key, so the record follows the VM).
//
// Billing (2026-11-04, "billing" in Main): on a deployment that bills, there
// is no trial. An agent bills to its creator's Rowboat account, the one the
// desktop app bills to: created only if the creator's plan has room (the
// free plan has one), its machine billed at the platform's own cost, read
// back per agent every hour, and a Hermes's model calls through Rowboat's LLM
// gateway on its owner's credits. Codex runs on its owner's ChatGPT plan or
// OpenAI key and Claude Code on its owner's Anthropic key, as before. Before
// a turn, an owner without credits gets the agent's sentence, not a turn.

export interface ProvisionInput {
  hostingId: string;
  /** The end-user key Rowboat names the agent by on the platform: creation is exactly-once under it. */
  externalUserId: string;
  displayName: string;
  kind: string;
  anthropicApiKey?: string;
  env: Array<{ key: string; value: string; secret?: boolean }>;
  /** On Rowboat's trial credit, so under the deployment's cap; false for an agent its owner's plan or keys pay for. */
  trial: boolean;
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
  /** What the end user's agent cost the platform account over a range: its machine, and model calls the platform served. */
  usage(externalUserId: string, from: string, to: string): Promise<{ machineCents: number; llmCents: number }>;
  /** The platform credential the agent's connector presents: the deployment's own key. */
  credential(): string;
  /** The management calls on one agent's VM, by the platform's id for it. */
  manage(externalId: string, externalUserId: string): HostingOps;
}

/**
 * Managing one VM (the management area, 2026-10-27): what the platform lets
 * Harbor do to a managed agent's machine on the deployment's own key. Shapes
 * are the protocol's; the provider turns the platform's into them. A platform
 * refusal is thrown as a PlatformRefusal, which the rules turn into
 * `invalid_request` with the platform's sentence.
 */
export interface HostingOps {
  machine(): Promise<HostingMachine>;
  env(): Promise<HostingEnvVar[]>;
  setEnv(key: string, value: string, secret: boolean): Promise<void>;
  deleteEnv(key: string): Promise<void>;
  power(action: HostingPowerAction): Promise<HostingMachine>;
  run(command: string, timeoutSeconds: number): Promise<HostingExecution>;
  execution(executionId: string): Promise<HostingExecution>;
  cancel(executionId: string): Promise<HostingExecution>;
  /** A way into the VM's shell: the platform's terminal socket and a token that opens it for `ttlSeconds`. */
  console(ttlSeconds: number): Promise<HostingConsole>;
  logs(opts: { limit: number; before?: string; level?: string }): Promise<{ logs: HostingLogLine[]; nextBefore?: string }>;
  files(path: string): Promise<HostingFileEntry[]>;
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  skills(q?: string): Promise<HostingSkill[]>;
  installSkill(name: string): Promise<void>;
  removeSkill(name: string): Promise<void>;
  triggers(): Promise<HostingTrigger[]>;
  createTrigger(input: { type: string; config: Record<string, unknown>; enabled?: boolean }): Promise<void>;
  updateTrigger(triggerId: string, input: { config?: Record<string, unknown>; enabled?: boolean }): Promise<void>;
  deleteTrigger(triggerId: string): Promise<void>;
  /** What the agent has drawn on Rowboat's credit this period, as the platform counts it. */
  spend(): Promise<HostingSpend>;
  /** The owner's own key into the agent's environment, with what its runtime needs to use it, applied. */
  setLlm(input: { kind: string; provider: LlmProvider; apiKey: string; model?: string }): Promise<void>;
  /** Rowboat's LLM gateway on a key billed to the owner (2026-11-04), with what the runtime needs to use it, applied. */
  useGateway(input: { kind: string; baseUrl: string; apiKey: string; model?: string }): Promise<void>;
  /** Model-independent MCP access (2026-11-11): omit the key when updating only the endpoint. */
  useComposio(input: { url: string; apiKey?: string }): Promise<void>;
  /** Nothing on the platform's own model credit (2026-11-04): the agent runs on what its owner brings. */
  withoutPlatformLlm(): Promise<void>;
  /** The machine's size, the platform's range and its estimated cost per memory size (2026-11-04). */
  size(): Promise<Omit<HostingSize, 'resizable' | 'reason' | 'upgradeUrl'>>;
  /** A new size, applied by restarting the machine. */
  resize(input: { memMb: number; diskGb: number }): Promise<void>;
  /** A trial over with no key: the platform's cap for this agent goes to zero, for good; the platform then keeps it asleep. */
  stopFunding(): Promise<void>;
  /** The platform's cap for this agent lifted, so it may wake: for a check on an agent a closed trial holds asleep. */
  liftCap(): Promise<void>;
  /** Whether the runtime on the VM holds a sign-in to a plan of its owner's, as the runtime itself reports it; nothing for a kind without one. */
  signIn(kind: string): Promise<'chatgpt' | undefined>;
  /** The sign-in found is what the agent runs on from now: the proxy token replaced by a dud, the provider recorded for the turn script, the platform's config pointed at the runtime's own provider, the cap lifted. */
  useSignIn(input: { kind: string }): Promise<void>;
  /** The sign-in removed from the VM, and the provider cleared for the turn script. */
  signOut(kind: string): Promise<void>;
}

/** The platform said no, in its own words; `gone` when it no longer has the thing asked about. */
export class PlatformRefusal extends Error {
  constructor(
    message: string,
    readonly gone = false,
  ) {
    super(message);
  }
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
/** What a Codex on its owner's ChatGPT plan answers, as a failed turn, when the sign-in is found gone. */
export const SIGN_IN_GONE_MESSAGE = "My owner's ChatGPT sign-in is gone. Sign in again from my Terminal tab, or add an API key on my page.";
/** The kinds whose owner can sign in to a plan from the Terminal (2026-10-30): Codex's `codex login`. */
const SIGN_IN_KINDS: ReadonlySet<string> = new Set(['codex']);

/** What a billed Codex answers, as a failed turn, until its owner signs it in or adds a key (2026-11-04). */
export const NEEDS_OWN_LLM_MESSAGE = 'I run on my owner\'s ChatGPT plan or OpenAI key. My owner needs to sign me in from my Terminal tab (`codex login --device-auth`), or add an OpenAI key on my page.';
/** What a billed agent answers, as a failed turn, when its owner's Rowboat plan has no credits left (2026-11-04). */
export function outOfCreditsMessage(upgradeUrl: string | undefined): string {
  return `My owner's Rowboat plan is out of credits. ${upgradeUrl ? `They can upgrade at ${upgradeUrl}` : 'They can upgrade their plan'}, or add their own API key on my page.`;
}
/** The gateway's refusals, as Hermes passes them on in a failed turn: the same news, said the agent's way. */
const GATEWAY_REFUSAL = /not enough credits|upgrade required|subscription not active/i;
/** The model the gateway serves a Hermes by default: its own choice, as for the desktop app's "Auto" (2026-11-04). */
const GATEWAY_MODEL = 'Auto';
/** How often each billed agent's machine cost is read from the platform and reported (2026-11-04). */
const SETTLE_EVERY_MS = 60 * 60_000;
/** A month's last hour is reported again for this long into the next month, so nothing billed at its end is missed. */
const SETTLE_LOOKBACK_MS = 2 * 24 * 60 * 60_000;

/** How long a trial lasts if nothing closes it first. */
const TRIAL_MS = 30 * 24 * 60 * 60_000;

/** What the agent answers, as a failed turn, once its trial is over: its owner reads it in the thread. */
export function trialOverMessage(reason: 'exhausted' | 'expired'): string {
  return reason === 'exhausted'
    ? "I've used up my Rowboat trial credit. My owner needs to add an API key on my page for me to keep going."
    : 'My Rowboat trial has ended. My owner needs to add an API key on my page for me to keep going.';
}

const EXTERNAL_PREFIX = 'rowboat-';
/** A file read through the page is text, and at most this long; longer is cut and flagged. */
const FILE_READ_MAX = 1_000_000;
/** The default for a command run from the page; the route caps at an hour. */
const COMMAND_TIMEOUT_S = 600;
/** How long a console token opens the VM's terminal for (2026-10-30): the socket, once open, outlives it. */
const CONSOLE_TTL_S = 900;
/** The kinds whose VM has skills and triggers the platform manages (Hermes's gateway runs both). */
const SKILLED_KINDS: ReadonlySet<string> = new Set(['hermes']);

function publicShape(row: StoredAgentHosting): AgentHosting {
  return {
    provider: row.provider,
    status: row.status,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    ...(row.error ? { error: row.error } : {}),
    funding: row.funding,
    ...(row.trial ? { trial: row.trial } : {}),
    ...(row.llm ? { llm: row.llm } : {}),
    createdBy: row.createdBy,
    ...(row.billingCustomer ? { billed: true as const } : {}),
    ...(row.requestedBy ? { requestedBy: row.requestedBy } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class Hosting {
  private provider: HostingProvider | undefined;
  private hooks: HostingHooks | undefined;
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  private trialMs = TRIAL_MS;
  private billing: BillingAccounts | undefined;
  private settledAt = 0;
  private settleEveryMs = SETTLE_EVERY_MS;
  private composioConfigured = new Set<string>();

  constructor(
    private readonly k: Kernel,
    private readonly spaces: Spaces,
    private readonly agents: Agents,
  ) {}

  /** Absent = this Harbor runs no managed hosting (no platform key in the deployment). */
  attach(provider: HostingProvider, hooks: HostingHooks, options: { trialMs?: number; billing?: BillingAccounts; settleEveryMs?: number } = {}): void {
    this.provider = provider;
    this.hooks = hooks;
    if (options.trialMs !== undefined) this.trialMs = options.trialMs;
    if (options.settleEveryMs !== undefined) this.settleEveryMs = options.settleEveryMs;
    this.billing = options.billing;
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
  async kinds(ctx: ActorCtx): Promise<{ kinds: string[]; billed?: true; upgradeUrl?: string }> {
    const actor = await this.k.store.getMember(ctx.memberId);
    if (!actor) throw new HarborError('not_a_member', 'not a member of this server');
    if (!this.provider) return { kinds: [] };
    if (!this.billing) return { kinds: [...MARITIME_AGENTS] };
    const upgradeUrl = await this.billing.upgradeUrl();
    return { kinds: [...MARITIME_AGENTS], billed: true, ...(upgradeUrl ? { upgradeUrl } : {}) };
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
    /** The super agent whose setup card this completes (2026-11-02): it may delete what it asked for. */
    requestedBy?: string,
  ): Promise<{ agent: Member; key: AgentKeySecret; hosting: AgentHosting }> {
    const actor = await this.k.store.getMember(ctx.memberId);
    if (!actor) throw new HarborError('not_a_member', 'not a member of this server');
    enforce(canAddAgent(actor));
    const { agent, hosting } = await this.provision(ctx.memberId, input, requestedBy);
    const key = await this.agents.createKey(ctx, agent.id);
    return { agent, key, hosting };
  }

  /**
   * A super agent's create that needs nothing from its owner (spec §4 Agent
   * members, 2026-11-02): an agent on Rowboat's trial credit, its owner's,
   * recorded as asked for by it, and a channel agent so it can be handed
   * work. No key is minted: Harbor's connector holds what it needs, and the
   * owner makes one on its page if they want one.
   */
  async createForSuperAgent(superAgent: Member, input: { displayName: string; kind: string }): Promise<{ agent: Member; hosting: AgentHosting }> {
    enforce(canSuperAgentCreate(superAgent));
    if (!(TRIAL_KINDS as readonly string[]).includes(input.kind)) throw new HarborError('invalid_request', `${input.kind} needs its owner to set it up`);
    return this.provision(superAgent.ownerId!, input, superAgent.id);
  }

  private async provision(
    ownerId: string,
    input: { displayName: string; kind: string; anthropicApiKey?: string; env?: Array<{ key: string; value: string; secret?: boolean }> },
    requestedBy?: string,
  ): Promise<{ agent: Member; hosting: AgentHosting }> {
    if (!this.provider || !this.hooks) throw new HarborError('invalid_request', 'this Harbor runs no managed hosting');
    if (!(MARITIME_AGENTS as readonly string[]).includes(input.kind)) throw new HarborError('invalid_request', `${input.kind} is not a kind of agent Rowboat can create`);
    if (input.kind === 'claude-code' && !input.anthropicApiKey) throw new HarborError('invalid_request', 'Claude Code needs your Anthropic API key');
    const displayName = input.displayName.trim();
    if (!displayName) throw new HarborError('invalid_request', 'an agent needs a name');
    this.k.guardWrite();
    const billing = this.billing;
    // On a deployment that bills (2026-11-04), the agent bills to its owner's Rowboat account: their subject at the issuer.
    const billingCustomer = billing ? billing.accountFor(await this.k.store.listIdentitiesOf(ownerId)) : undefined;
    if (billing && !billingCustomer) throw new HarborError('invalid_request', 'An agent Rowboat runs bills to its owner\'s Rowboat account, and its owner has none here');

    const id = this.k.ulid();
    const now = this.k.now();
    // Claude Code runs on the key it was given from the start. Without billing, the rest on Rowboat's trial credit, for a
    // while; with it (2026-11-04), Hermes on its owner's Rowboat credits and Codex on its owner's ChatGPT plan or key.
    const funding: Pick<StoredAgentHosting, 'funding' | 'trial' | 'llm'> = input.anthropicApiKey
      ? { funding: 'own', llm: { provider: 'anthropic', keyHint: credentialHint(input.anthropicApiKey), setBy: ownerId, setAt: now } }
      : billing
        ? { funding: input.kind === 'hermes' ? 'credits' : 'own' }
        : { funding: 'trial', trial: { endsAt: new Date(Date.parse(now) + this.trialMs).toISOString() } };
    let row: StoredAgentHosting = {
      id,
      provider: 'maritime',
      status: 'creating',
      externalUserId: `${EXTERNAL_PREFIX}${id.toLowerCase()}`,
      kind: input.kind,
      displayName,
      ...funding,
      createdBy: ownerId,
      ...(requestedBy ? { requestedBy } : {}),
      ...(billingCustomer ? { billingCustomer } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.k.store.putHosting(row);

    // The plan has room, or nothing is created (2026-11-04): the free plan has one managed agent, a paid plan any number.
    if (billing && billingCustomer) {
      let registered: { ok: true } | { ok: false; limit: number };
      try {
        registered = await billing.registerAgent(billingCustomer, { ref: row.externalUserId, kind: input.kind, name: displayName });
      } catch (err) {
        const message = `Rowboat billing: ${(err as Error).message}`.slice(0, 1000);
        await this.k.store.putHosting({ ...row, status: 'failed', error: message, updatedAt: this.k.now() });
        throw new HarborError('invalid_request', message);
      }
      if (!registered.ok) {
        const upgrade = await billing.upgradeUrl();
        const message = `Your Rowboat plan includes ${registered.limit} agent${registered.limit === 1 ? '' : 's'} Rowboat runs. ${upgrade ? `Upgrade at ${upgrade} to create more.` : 'Upgrade your plan to create more.'}`;
        await this.k.store.putHosting({ ...row, status: 'failed', error: message, updatedAt: this.k.now() });
        throw new HarborError('invalid_request', message);
      }
    }

    let externalId: string;
    try {
      ({ externalId } = await this.provider.provision({
        hostingId: id,
        externalUserId: row.externalUserId,
        displayName,
        kind: input.kind,
        ...(input.anthropicApiKey ? { anthropicApiKey: input.anthropicApiKey } : {}),
        env: input.env ?? [],
        trial: row.funding === 'trial',
      }));
    } catch (err) {
      const message = (err as Error).message.slice(0, 1000);
      await this.k.store.putHosting({ ...row, status: 'failed', error: message, updatedAt: this.k.now() });
      if (billing && billingCustomer) await billing.unregisterAgent(billingCustomer, row.externalUserId).catch((e) => console.log('[harbor] hosting: could not unregister a failed creation', { id, error: (e as Error).message }));
      throw new HarborError('invalid_request', `Maritime: ${message}`);
    }

    const agent = await this.spaces.createAgent({
      displayName,
      ownerId,
      agentKind: input.kind,
      agentConnection: 'maritime',
      agentInstance: externalId,
    });
    await this.hooks.save(agent.id, this.provider.credential(), ownerId);
    row = { ...row, agentId: agent.id, externalId, status: 'deploying', updatedAt: this.k.now() };
    await this.k.store.putHosting(row);
    return { agent, hosting: publicShape(row) };
  }

  /** Delete a managed agent's hosting: the owner. Keys go now; the platform's resources in the background. */
  async deleteManaged(ctx: ActorCtx, agentId: string): Promise<AgentHosting> {
    const actor = await this.k.store.getMember(ctx.memberId);
    if (!actor) throw new HarborError('not_a_member', 'not a member of this server');
    const agent = await this.k.store.getMember(agentId);
    if (!agent || agent.kind !== 'agent') throw new HarborError('not_found', 'no such agent');
    enforce(canRevokeAgentKey(actor, agent));
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row) throw new HarborError('not_found', 'this agent is not one Rowboat hosts');
    return this.remove(agentId, row);
  }

  /** Account deletion (2026-11-09): every managed agent the person owns goes with them, so nothing keeps billing. */
  async deleteOwnedBy(ownerId: string): Promise<void> {
    for (const agent of await this.k.store.listAgents(ownerId)) {
      const row = await this.k.store.getAgentHosting(agent.id);
      if (row) await this.remove(agent.id, row);
    }
  }

  /** A super agent's delete (2026-11-02): only one an admin let delete, and only an agent it created. */
  async deleteForSuperAgent(superAgent: Member, agentId: string): Promise<AgentHosting> {
    const row = await this.k.store.getAgentHosting(agentId);
    enforce(canSuperAgentDelete(superAgent, row?.requestedBy));
    if (!row) throw new HarborError('not_found', 'this agent is not one Rowboat hosts');
    return this.remove(agentId, row);
  }

  private async remove(agentId: string, row: StoredAgentHosting): Promise<AgentHosting> {
    if (row.status === 'deleted' || row.status === 'deleting') return publicShape(row);
    this.k.guardWrite();
    const at = this.k.now();
    for (const key of await this.k.store.listAgentKeys([agentId])) if (!key.revokedAt) await this.k.store.revokeAgentKey(key.id, at);
    // The gateway key goes now too (2026-11-04); the worker revokes it again before the platform is told, should this fail.
    const customer = await this.gatewayCustomer(row);
    if (this.billing && customer) {
      await this.billing.revokeGatewayKey(customer, row.externalUserId).catch((err) => console.log('[harbor] hosting: gateway key not revoked yet', { id: row.id, error: (err as Error).message }));
    }
    await this.hooks?.stop(agentId);
    const next: StoredAgentHosting = { ...row, status: 'deleting', updatedAt: at };
    delete next.error;
    await this.k.store.putHosting(next);
    void this.tick();
    return publicShape(next);
  }

  // --- managing the VM (the management area, 2026-10-27) ----------------------------------

  /**
   * The managed agent behind `agentId` for the actor to manage: the owner or
   * an admin, a hosting that reached the platform, and the provider's calls on
   * it. `kinds` narrows to agents whose VM has the feature (skills, triggers).
   */
  private async managed(ctx: ActorCtx, agentId: string, kinds?: ReadonlySet<string>): Promise<{ row: StoredAgentHosting; ops: HostingOps }> {
    const actor = await this.k.store.getMember(ctx.memberId);
    if (!actor) throw new HarborError('not_a_member', 'not a member of this server');
    const agent = await this.k.store.getMember(agentId);
    if (!agent || agent.kind !== 'agent') throw new HarborError('not_found', 'no such agent');
    enforce(canRevokeAgentKey(actor, agent));
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row) throw new HarborError('not_found', 'this agent is not one Rowboat hosts');
    if (!this.provider) throw new HarborError('invalid_request', 'this Harbor runs no managed hosting');
    if (!row.externalId || row.status === 'creating') throw new HarborError('invalid_request', 'the agent is still being created');
    if (row.status === 'deleting' || row.status === 'deleted') throw new HarborError('invalid_request', 'the agent has been deleted from the platform');
    if (kinds && !kinds.has(row.kind)) throw new HarborError('invalid_request', `${row.kind} agents have none on Maritime`);
    return { row, ops: this.provider.manage(row.externalId, row.externalUserId) };
  }

  /** A platform call, with its refusal turned into Harbor's error. */
  private async platform<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PlatformRefusal) throw new HarborError(err.gone ? 'not_found' : 'invalid_request', `Maritime: ${err.message.slice(0, 500)}`);
      throw err;
    }
  }

  /**
   * The page's one read: the hosting, the machine as the platform sees it
   * (none while it is still being set up), the environment, and on a trial
   * what it has drawn so far. A trial the platform reports at its cap is
   * closed here and now, so the page says so and nothing renews.
   */
  async get(ctx: ActorCtx, agentId: string): Promise<{ hosting: AgentHosting; machine?: HostingMachine; env: HostingEnvVar[]; spend?: HostingSpend; usage?: HostingUsage }> {
    const { row, ops } = await this.managed(ctx, agentId);
    const [machine, env, spend, usage] = await this.platform(() =>
      Promise.all([
        ops.machine().catch(() => undefined),
        ops.env(),
        row.funding === 'trial' ? ops.spend().catch(() => undefined) : Promise.resolve(undefined),
        row.billingCustomer ? this.monthUsage(row).catch(() => undefined) : Promise.resolve(undefined),
      ]),
    );
    let hosting = row;
    if (spend?.limitReached && row.funding === 'trial' && !row.trial?.closedAt) hosting = await this.endTrial(row, ops, 'exhausted');
    return { hosting: publicShape(hosting), ...(machine ? { machine } : {}), env, ...(spend ? { spend } : {}), ...(usage ? { usage } : {}) };
  }

  /** What a billed agent has cost the platform account this calendar month, for its page (2026-11-04). */
  private async monthUsage(row: StoredAgentHosting): Promise<HostingUsage> {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const u = await this.provider!.usage(row.externalUserId, start, now.toISOString());
    return { periodStart: start, machineCents: u.machineCents, llmCents: u.llmCents };
  }

  /**
   * The owner's own key (2026-10-27): the end of the trial, and the only way
   * out of it. The key goes to the platform, which takes the proxy token and
   * the cap with it (the provider's doing), then the record says `own`; a
   * failure before the record leaves the trial as it was, and a retry does
   * the same again. Also how a key is replaced.
   * The agent's gateway identity is independent of model configuration
   * (spec §8 Maritime, amended 2026-11-11).
   */
  async setLlm(ctx: ActorCtx, agentId: string, input: { provider: LlmProvider; apiKey: string; model?: string }): Promise<AgentHosting> {
    const { row, ops } = await this.managed(ctx, agentId);
    const allowed = LLM_PROVIDERS[row.kind] ?? [];
    if (input.provider === 'chatgpt') throw new HarborError('invalid_request', 'a ChatGPT plan takes no key: sign in from the Terminal tab');
    if (!allowed.includes(input.provider)) throw new HarborError('invalid_request', `${row.kind} does not run on ${input.provider}; it takes ${allowed.join(', ')}`);
    const apiKey = input.apiKey.trim();
    if (apiKey.length < 8) throw new HarborError('invalid_request', 'that is not an API key');
    const model = input.model?.trim() || undefined;
    this.k.guardWrite();
    // Codex honours a ChatGPT sign-in over a key on its built-in provider: the sign-in goes first, so the key is what it runs on.
    if (row.llm?.provider === 'chatgpt') await this.platform(() => ops.signOut(row.kind));
    await this.platform(() => ops.setLlm({ kind: row.kind, provider: input.provider, apiKey, ...(model ? { model } : {}) }));
    const at = this.k.now();
    const next: StoredAgentHosting = {
      ...row,
      funding: 'own',
      ...(row.trial ? { trial: row.trial.closedAt ? row.trial : { ...row.trial, closedAt: at, closedReason: 'own_key' } } : {}),
      llm: { provider: input.provider, keyHint: credentialHint(apiKey), ...(model ? { model } : {}), setBy: ctx.memberId, setAt: at },
      updatedAt: at,
    };
    await this.k.store.putHosting(next);
    return publicShape(next);
  }

  /** For the agent's connector before a turn: on Rowboat's trial credit, and whether that is over; nothing for an agent Rowboat does not host. */
  async fundingOf(agentId: string): Promise<{ funding: HostingFunding; trialOver?: 'exhausted' | 'expired' } | undefined> {
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row || row.status !== 'ready') return undefined;
    const reason = row.trial?.closedReason;
    return { funding: row.funding, ...(row.funding === 'trial' && (reason === 'exhausted' || reason === 'expired') ? { trialOver: reason } : {}) };
  }

  /**
   * For the agent's connector before a turn (2026-11-04): on a deployment that
   * bills, the agent's sentence when its owner's plan has no credits left, so
   * the VM is not woken for a turn that cannot be paid for. A billing outage
   * lets the turn through: the gateway still refuses a model call without
   * credits, and an outage must not stop every agent.
   */
  async turnRefusal(agentId: string): Promise<string | undefined> {
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row || !this.billing || !row.billingCustomer) return undefined;
    try {
      const answer = await this.billing.authorize(row.billingCustomer);
      if (answer.ok) return undefined;
    } catch (err) {
      console.log('[harbor] hosting: billing did not answer before a turn; letting it run', { id: row.id, error: (err as Error).message });
      return undefined;
    }
    return outOfCreditsMessage(await this.billing.upgradeUrl());
  }

  /**
   * A failed turn's reason, said the owner's way (2026-11-04): the gateway's
   * refusal for want of credits, and a billed Codex that has nothing to run
   * on yet. Anything else is the runtime's own reason, unchanged.
   */
  async explainFailure(agentId: string, failure: string, signIn?: 'chatgpt' | 'none'): Promise<string> {
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row || !this.billing || !row.billingCustomer) return failure;
    if (row.funding === 'credits' && GATEWAY_REFUSAL.test(failure)) return outOfCreditsMessage(await this.billing.upgradeUrl());
    if (row.kind === 'codex' && row.funding === 'own' && !row.llm && signIn !== 'chatgpt') return NEEDS_OWN_LLM_MESSAGE;
    return failure;
  }

  /** The connector saw the platform at the cap: the trial is over, for good. */
  async closeTrial(agentId: string, reason: 'exhausted' | 'expired'): Promise<void> {
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row || !this.provider || row.funding !== 'trial' || row.trial?.closedAt || !row.externalId) return;
    await this.endTrial(row, this.provider.manage(row.externalId, row.externalUserId), reason);
  }

  /** The platform first, so nothing more goes on Rowboat's credit even if the record is not reached. */
  private async endTrial(row: StoredAgentHosting, ops: HostingOps, reason: 'exhausted' | 'expired'): Promise<StoredAgentHosting> {
    await ops.stopFunding();
    const at = this.k.now();
    const next: StoredAgentHosting = { ...row, trial: { ...(row.trial ?? { endsAt: at }), closedAt: at, closedReason: reason }, updatedAt: at };
    await this.k.store.putHosting(next);
    return next;
  }

  /**
   * A sign-in from the Terminal (2026-10-30), asked about by the page when a
   * Terminal session ends or by its button: Harbor has the runtime say whether
   * one is there, and the record follows. A closed trial holds the cap at zero
   * and the platform keeps the VM asleep, so the cap is lifted for the asking
   * and put back when nothing is found.
   */
  async checkSignIn(ctx: ActorCtx, agentId: string): Promise<{ hosting: AgentHosting; signedIn: boolean }> {
    const { row, ops } = await this.managed(ctx, agentId);
    if (!SIGN_IN_KINDS.has(row.kind)) throw new HarborError('invalid_request', `${row.kind} has no sign-in to a plan; it takes a key`);
    this.k.guardWrite();
    const held = row.funding === 'trial' && !!row.trial?.closedAt;
    if (held) await this.platform(() => ops.liftCap());
    let found: 'chatgpt' | undefined;
    try {
      found = await this.platform(() => ops.signIn(row.kind));
    } finally {
      if (held && !found) await this.platform(() => ops.stopFunding()).catch(() => undefined);
    }
    const next = await this.recordSignIn(row, ops, ctx.memberId, found, true);
    return { hosting: publicShape(next), signedIn: found !== undefined };
  }

  /** The owner signs the agent out: the sign-in goes from the VM, and the agent answers nothing until a key or a new sign-in. */
  async revokeSignIn(ctx: ActorCtx, agentId: string): Promise<AgentHosting> {
    const { row, ops } = await this.managed(ctx, agentId);
    if (!SIGN_IN_KINDS.has(row.kind)) throw new HarborError('invalid_request', `${row.kind} has no sign-in to a plan; it takes a key`);
    this.k.guardWrite();
    await this.platform(() => ops.signOut(row.kind));
    return publicShape(await this.recordSignIn(row, ops, ctx.memberId, undefined));
  }

  /** The connector saw the turn script's own answer on the sign-in: the record follows it, and says whether it moved. */
  async observeSignIn(agentId: string, state: 'chatgpt' | 'none'): Promise<'adopted' | 'dropped' | undefined> {
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row || !this.provider || row.status !== 'ready' || !row.externalId || !SIGN_IN_KINDS.has(row.kind)) return undefined;
    const found = state === 'chatgpt' ? 'chatgpt' : undefined;
    const next = await this.recordSignIn(row, this.provider.manage(row.externalId, row.externalUserId), row.createdBy, found);
    if (next === row) return undefined;
    return found ? 'adopted' : 'dropped';
  }

  /**
   * The record after what the VM said: on the sign-in from now (the platform set up for it first), or no longer on
   * it; untouched when it already said so, except that an outright ask (`reapply`) sets the VM up again, so a later
   * fix to that setup (the model line, 2026-11-01) reaches an agent signed in before it.
   */
  private async recordSignIn(row: StoredAgentHosting, ops: HostingOps, by: string, found: 'chatgpt' | undefined, reapply = false): Promise<StoredAgentHosting> {
    const at = this.k.now();
    if (found) {
      const already = row.funding === 'own' && row.llm?.provider === found;
      if (already && !reapply) return row;
      await this.platform(() => ops.useSignIn({ kind: row.kind }));
      if (already) return row;
      const next: StoredAgentHosting = {
        ...row,
        funding: 'own',
        ...(row.trial ? { trial: row.trial.closedAt ? row.trial : { ...row.trial, closedAt: at, closedReason: 'sign_in' } } : {}),
        llm: { provider: found, keyHint: '', setBy: by, setAt: at },
        updatedAt: at,
      };
      await this.k.store.putHosting(next);
      return next;
    }
    if (row.llm?.provider !== 'chatgpt') return row;
    const { llm: _gone, ...rest } = row;
    const next: StoredAgentHosting = { ...rest, updatedAt: at };
    await this.k.store.putHosting(next);
    return next;
  }

  /**
   * The machine's size (2026-11-04): the platform's numbers, and whether the
   * owner may change it. Only an agent that bills to its owner may grow, since
   * otherwise Rowboat pays for it; on the free plan it keeps the smallest size
   * the platform offers.
   */
  async size(ctx: ActorCtx, agentId: string): Promise<HostingSize> {
    const { row, ops } = await this.managed(ctx, agentId);
    const size = await this.platform(() => ops.size());
    return { ...size, ...(await this.resizeRefusal(row)) };
  }

  /** Resize the machine (2026-11-04): within the platform's range and the owner's plan; it restarts to apply. */
  async resize(ctx: ActorCtx, agentId: string, input: { memMb: number; diskGb: number }): Promise<HostingSize> {
    const { row, ops } = await this.managed(ctx, agentId);
    const current = await this.platform(() => ops.size());
    const refusal = await this.resizeRefusal(row);
    if (!refusal.resizable) throw new HarborError('invalid_request', refusal.reason ?? 'this agent cannot be resized');
    if (!current.memOptions.some((o) => o.memMb === input.memMb)) throw new HarborError('invalid_request', `memory must be one of ${current.memOptions.map((o) => `${o.memMb} MB`).join(', ')}`);
    if (current.maxDiskGb !== undefined && input.diskGb > current.maxDiskGb) throw new HarborError('invalid_request', `disk can be at most ${current.maxDiskGb} GB`);
    this.k.guardWrite();
    await this.platform(() => ops.resize(input));
    return { ...(await this.platform(() => ops.size())), ...refusal };
  }

  private async resizeRefusal(row: StoredAgentHosting): Promise<Pick<HostingSize, 'resizable' | 'reason' | 'upgradeUrl'>> {
    if (!this.billing || !row.billingCustomer) return { resizable: false, reason: 'A bigger machine is for agents that bill to their owner’s Rowboat plan.' };
    const plan = await this.billing.planOf(row.billingCustomer).catch(() => undefined);
    if (plan === undefined || plan === 'free') {
      const upgradeUrl = await this.billing.upgradeUrl();
      return { resizable: false, reason: 'The free plan runs agents on the smallest machine. Upgrade for a bigger one.', ...(upgradeUrl ? { upgradeUrl } : {}) };
    }
    return { resizable: true };
  }

  async setEnv(ctx: ActorCtx, agentId: string, key: string, value: string, secret: boolean): Promise<HostingEnvVar[]> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    await this.platform(() => ops.setEnv(key, value, secret));
    return this.platform(() => ops.env());
  }

  async deleteEnv(ctx: ActorCtx, agentId: string, key: string): Promise<HostingEnvVar[]> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    await this.platform(() => ops.deleteEnv(key));
    return this.platform(() => ops.env());
  }

  async power(ctx: ActorCtx, agentId: string, action: HostingPowerAction): Promise<HostingMachine> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    return this.platform(() => ops.power(action));
  }

  async run(ctx: ActorCtx, agentId: string, command: string, timeoutSeconds = COMMAND_TIMEOUT_S): Promise<HostingExecution> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    return this.platform(() => ops.run(command, timeoutSeconds));
  }

  async execution(ctx: ActorCtx, agentId: string, executionId: string): Promise<HostingExecution> {
    const { ops } = await this.managed(ctx, agentId);
    return this.platform(() => ops.execution(executionId));
  }

  /** A console into the VM (2026-10-30): a token good for CONSOLE_TTL_S, minted anew on each call, for the owner or an admin. */
  async console(ctx: ActorCtx, agentId: string): Promise<HostingConsole> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    return this.platform(() => ops.console(CONSOLE_TTL_S));
  }

  async cancel(ctx: ActorCtx, agentId: string, executionId: string): Promise<HostingExecution> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    return this.platform(() => ops.cancel(executionId));
  }

  async logs(ctx: ActorCtx, agentId: string, opts: { limit?: number; before?: string; level?: string }): Promise<{ logs: HostingLogLine[]; nextBefore?: string }> {
    const { ops } = await this.managed(ctx, agentId);
    return this.platform(() => ops.logs({ limit: opts.limit ?? 100, ...(opts.before ? { before: opts.before } : {}), ...(opts.level ? { level: opts.level } : {}) }));
  }

  async files(ctx: ActorCtx, agentId: string, path: string): Promise<{ path: string; entries: HostingFileEntry[] }> {
    const { ops } = await this.managed(ctx, agentId);
    const entries = await this.platform(() => ops.files(path));
    return { path, entries };
  }

  async readFile(ctx: ActorCtx, agentId: string, path: string): Promise<{ path: string; content: string; truncated: boolean }> {
    const { ops } = await this.managed(ctx, agentId);
    const content = await this.platform(() => ops.readFile(path));
    if (content === undefined) throw new HarborError('not_found', 'no such file on the agent');
    return { path, content: content.slice(0, FILE_READ_MAX), truncated: content.length > FILE_READ_MAX };
  }

  async writeFile(ctx: ActorCtx, agentId: string, path: string, content: string): Promise<void> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    await this.platform(() => ops.writeFile(path, content));
  }

  async mkdir(ctx: ActorCtx, agentId: string, path: string): Promise<void> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    await this.platform(() => ops.mkdir(path));
  }

  async moveFile(ctx: ActorCtx, agentId: string, from: string, to: string): Promise<void> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    await this.platform(() => ops.move(from, to));
  }

  async deleteFile(ctx: ActorCtx, agentId: string, path: string): Promise<void> {
    const { ops } = await this.managed(ctx, agentId);
    this.k.guardWrite();
    await this.platform(() => ops.deleteFile(path));
  }

  async skills(ctx: ActorCtx, agentId: string, q?: string): Promise<HostingSkill[]> {
    const { ops } = await this.managed(ctx, agentId, SKILLED_KINDS);
    return this.platform(() => ops.skills(q));
  }

  async installSkill(ctx: ActorCtx, agentId: string, name: string): Promise<HostingSkill[]> {
    const { ops } = await this.managed(ctx, agentId, SKILLED_KINDS);
    this.k.guardWrite();
    await this.platform(() => ops.installSkill(name));
    return this.platform(() => ops.skills());
  }

  async removeSkill(ctx: ActorCtx, agentId: string, name: string): Promise<HostingSkill[]> {
    const { ops } = await this.managed(ctx, agentId, SKILLED_KINDS);
    this.k.guardWrite();
    await this.platform(() => ops.removeSkill(name));
    return this.platform(() => ops.skills());
  }

  async triggers(ctx: ActorCtx, agentId: string): Promise<HostingTrigger[]> {
    const { ops } = await this.managed(ctx, agentId, SKILLED_KINDS);
    return this.platform(() => ops.triggers());
  }

  async createTrigger(ctx: ActorCtx, agentId: string, input: { type: string; config: Record<string, unknown>; enabled?: boolean }): Promise<HostingTrigger[]> {
    const { ops } = await this.managed(ctx, agentId, SKILLED_KINDS);
    this.k.guardWrite();
    await this.platform(() => ops.createTrigger(input));
    return this.platform(() => ops.triggers());
  }

  async updateTrigger(ctx: ActorCtx, agentId: string, triggerId: string, input: { config?: Record<string, unknown>; enabled?: boolean }): Promise<HostingTrigger[]> {
    const { ops } = await this.managed(ctx, agentId, SKILLED_KINDS);
    this.k.guardWrite();
    await this.platform(() => ops.updateTrigger(triggerId, input));
    return this.platform(() => ops.triggers());
  }

  async deleteTrigger(ctx: ActorCtx, agentId: string, triggerId: string): Promise<HostingTrigger[]> {
    const { ops } = await this.managed(ctx, agentId, SKILLED_KINDS);
    this.k.guardWrite();
    await this.platform(() => ops.deleteTrigger(triggerId));
    return this.platform(() => ops.triggers());
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
    // Billed machines (2026-11-04): every agent the platform may still be charging for, once an hour.
    if (this.billing && Date.now() - this.settledAt >= this.settleEveryMs) {
      this.settledAt = Date.now();
      for (const row of await this.k.store.listHostingsByStatus(['deploying', 'checking', 'ready', 'failed'])) {
        if (!row.billingCustomer || !row.externalId) continue;
        try {
          await this.settle(provider, row, this.billing, row.billingCustomer);
        } catch (err) {
          console.log('[harbor] hosting: machine cost not reported', { id: row.id, error: (err as Error).message });
        }
      }
    }
    for (const row of await this.k.store.listHostingsByStatus(['ready'])) {
      if (this.billing && row.externalId && !this.composioConfigured.has(row.id)) {
        try {
          await this.prepareComposio(provider, row);
        } catch {
          console.log('[harbor] hosting: Composio setup will retry', { id: row.id });
        }
      }
      // A trial that ran out of time, with credit left or not, is over.
      if (row.funding !== 'trial' || !row.trial || row.trial.closedAt || !row.externalId || Date.parse(row.trial.endsAt) > Date.now()) continue;
      try {
        await this.endTrial(row, provider.manage(row.externalId, row.externalUserId), 'expired');
      } catch (err) {
        console.log('[harbor] hosting: could not end an expired trial', { id: row.id, error: (err as Error).message });
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
        await this.fundOnReady(provider, row);
        await this.move(row, 'ready');
        const agent = row.agentId ? await this.k.store.getMember(row.agentId) : undefined;
        if (agent) this.hooks?.added(agent);
        return;
      }
      if (age > CHECK_TIMEOUT_MS) return this.fail(row, 'The agent deployed but took no command for 10 minutes.');
      return;
    }
    if (row.status === 'deleting') {
      // Billed (2026-11-04): the machine's last cost reported while the platform still has it, the gateway key
      // revoked, then the agent off the platform and out of its owner's plan. Each is safe to repeat on a retry.
      const billing = this.billing && row.billingCustomer ? { accounts: this.billing, customer: row.billingCustomer } : undefined;
      if (billing && row.externalId) {
        await this.settle(provider, row, billing.accounts, billing.customer).catch((err) => console.log('[harbor] hosting: last machine cost not reported', { id: row.id, error: (err as Error).message }));
      }
      const customer = await this.gatewayCustomer(row);
      if (this.billing && customer) await this.billing.revokeGatewayKey(customer, row.externalUserId);
      await provider.deprovision(row.externalUserId);
      if (billing) await billing.accounts.unregisterAgent(billing.customer, row.externalUserId);
      await this.move(row, 'deleted');
    }
  }

  /**
   * A billed agent's model access once its machine answers (2026-11-04): a
   * Hermes on Rowboat's gateway, a Codex with the platform's own model
   * credit taken away until its owner brings theirs.
   * Done before `ready`, so no turn runs on the platform's credit.
   */
  private async fundOnReady(provider: HostingProvider, row: StoredAgentHosting): Promise<void> {
    if (!this.billing || !row.externalId) return;
    const ops = provider.manage(row.externalId, row.externalUserId);
    await this.prepareComposio(provider, row, !!row.billingCustomer);
    if (row.billingCustomer && row.funding !== 'credits' && !row.llm) {
      await ops.withoutPlatformLlm();
    }
  }

  /**
   * 2026-11-11: each managed runtime with a Rowboat owner gets an identity for
   * Composio and, when selected, model calls. Check metadata once per Harbor boot
   * to upgrade existing VMs without reading redacted secrets. A missing key
   * needs a mint; existing keys survive restarts and model changes.
   */
  private async prepareComposio(provider: HostingProvider, row: StoredAgentHosting, initial = false): Promise<void> {
    const billing = this.billing;
    if (!billing || !row.externalId || this.composioConfigured.has(row.id)) return;
    const customer = await this.gatewayCustomer(row);
    if (!customer) return;
    const ops = provider.manage(row.externalId, row.externalUserId);
    const env = await ops.env();
    const hasKey = env.some(v => v.key === 'ROWBOAT_GATEWAY_KEY' && v.secret);
    const url = env.find(v => v.key === 'ROWBOAT_COMPOSIO_MCP_URL');
    if (initial || !hasKey) {
      const { key } = await billing.mintGatewayKey(customer, { ref: row.externalUserId, name: row.displayName });
      // 2026-11-11: install the model credential first. A partial setup must
      // never leave a credit-funded model using the key that mint just rotated.
      if (row.funding === 'credits') {
        const model = !initial ? env.find(v => v.key === 'ROWBOAT_LLM_MODEL')?.value : undefined;
        await ops.useGateway({ kind: row.kind, baseUrl: billing.gatewayUrl, apiKey: key, model: model ?? GATEWAY_MODEL });
      }
      await ops.useComposio({ url: billing.composioMcpUrl, apiKey: key });
    } else if (url?.value !== billing.composioMcpUrl || url.secret) {
      await ops.useComposio({ url: billing.composioMcpUrl });
    }
    this.composioConfigured.add(row.id);
  }

  /**
   * 2026-11-11: pre-billing agents have no billingCustomer. Resolve their
   * creator/owner's Rowboat identity for tool access without enrolling the
   * legacy hosting in billing.
   */
  private async gatewayCustomer(row: StoredAgentHosting): Promise<string | undefined> {
    if (!this.billing) return undefined;
    return row.billingCustomer ?? this.billing.accountFor(await this.k.store.listIdentitiesOf(row.createdBy));
  }

  /**
   * Report a billed agent's machine cost (2026-11-04): the platform's own
   * running total for the calendar month (UTC), at cost, which the backend
   * debits only for what is new. In a month's first days the month before is
   * reported once more, so its last hour is not lost. The platform's model
   * spend is added: a billed agent should have none, and whatever there is
   * was spent on the owner's behalf.
   */
  private async settle(provider: HostingProvider, row: StoredAgentHosting, billing: BillingAccounts, customer: string): Promise<void> {
    const now = new Date();
    const month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const periods: Array<[number, number]> = [[month, now.getTime()]];
    if (now.getTime() - month < SETTLE_LOOKBACK_MS) periods.unshift([Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1), month]);
    for (const [start, end] of periods) {
      if (end <= Date.parse(row.createdAt)) continue;
      const periodStart = new Date(start).toISOString();
      const usage = await provider.usage(row.externalUserId, periodStart, new Date(end).toISOString());
      await billing.reportHosting(customer, { ref: row.externalUserId, periodStart, totalCents: usage.machineCents + usage.llmCents });
    }
  }

  private async move(row: StoredAgentHosting, status: StoredAgentHosting['status']): Promise<void> {
    if (await this.movedOn(row)) return;
    const next: StoredAgentHosting = { ...row, status, updatedAt: this.k.now() };
    delete next.error;
    await this.k.store.putHosting(next);
  }

  private async fail(row: StoredAgentHosting, error: string): Promise<void> {
    if (await this.movedOn(row)) return;
    await this.k.store.putHosting({ ...row, status: 'failed', error: error.slice(0, 1000), updatedAt: this.k.now() });
  }

  /**
   * The row changed while the platform answered (2026-11-02): a delete landed
   * during a check, say. The worker's stale copy must not write over it, or
   * a deleted agent reads ready and its machine is never removed.
   */
  private async movedOn(row: StoredAgentHosting): Promise<boolean> {
    if (!row.agentId) return false;
    const current = await this.k.store.getAgentHosting(row.agentId);
    return current !== undefined && current.status !== row.status;
  }
}
