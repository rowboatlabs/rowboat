import {
  LLM_PROVIDERS,
  MARITIME_AGENTS,
  type AgentCredential,
  type AgentHosting,
  type AgentKeySecret,
  type HostingEnvVar,
  type HostingExecution,
  type HostingFileEntry,
  type HostingFunding,
  type HostingLogLine,
  type HostingMachine,
  type HostingPowerAction,
  type HostingSkill,
  type HostingSpend,
  type HostingTrigger,
  type LlmProvider,
  type Member,
} from '@rowboat/spaces-protocol';
import { HarborError } from '../errors.js';
import { canAddAgent, canRevokeAgentKey, enforce } from '../policy.js';
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
  /** The management calls on one agent's VM, by the platform's id for it. */
  manage(externalId: string): HostingOps;
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
  /** Nothing more on Rowboat's credit: the platform's cap for this agent goes to zero, for good. */
  stopFunding(): Promise<void>;
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

  constructor(
    private readonly k: Kernel,
    private readonly spaces: Spaces,
    private readonly agents: Agents,
  ) {}

  /** Absent = this Harbor runs no managed hosting (no platform key in the deployment). */
  attach(provider: HostingProvider, hooks: HostingHooks, options: { trialMs?: number } = {}): void {
    this.provider = provider;
    this.hooks = hooks;
    if (options.trialMs !== undefined) this.trialMs = options.trialMs;
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
    // Claude Code runs on the key it was given from the start; the rest on Rowboat's trial credit, for a while.
    const funding: Pick<StoredAgentHosting, 'funding' | 'trial' | 'llm'> = input.anthropicApiKey
      ? { funding: 'own', llm: { provider: 'anthropic', keyHint: credentialHint(input.anthropicApiKey), setBy: ctx.memberId, setAt: now } }
      : { funding: 'trial', trial: { endsAt: new Date(Date.parse(now) + this.trialMs).toISOString() } };
    let row: StoredAgentHosting = {
      id,
      provider: 'maritime',
      status: 'creating',
      externalUserId: `${EXTERNAL_PREFIX}${id.toLowerCase()}`,
      kind: input.kind,
      displayName,
      ...funding,
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

  // --- managing the VM (the management area, 2026-10-27) ----------------------------------

  /**
   * The managed agent behind `agentId` for the actor to manage: the owner or
   * an admin, a hosting that reached the platform, and the provider's calls on
   * it. `kinds` narrows to agents whose VM has the feature (skills, triggers).
   */
  private async managed(ctx: ActorCtx, agentId: string, kinds?: ReadonlySet<string>): Promise<{ row: StoredAgentHosting; ops: HostingOps }> {
    const actor = await this.k.store.getMember(ctx.memberId);
    if (!actor) throw new HarborError('not_a_member', 'not a member of this org');
    const agent = await this.k.store.getMember(agentId);
    if (!agent || agent.kind !== 'agent') throw new HarborError('not_found', 'no such agent');
    enforce(canRevokeAgentKey(actor, agent));
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row) throw new HarborError('not_found', 'this agent is not one Rowboat hosts');
    if (!this.provider) throw new HarborError('invalid_request', 'this Harbor runs no managed hosting');
    if (!row.externalId || row.status === 'creating') throw new HarborError('invalid_request', 'the agent is still being created');
    if (row.status === 'deleting' || row.status === 'deleted') throw new HarborError('invalid_request', 'the agent has been deleted from the platform');
    if (kinds && !kinds.has(row.kind)) throw new HarborError('invalid_request', `${row.kind} agents have none on Maritime`);
    return { row, ops: this.provider.manage(row.externalId) };
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
  async get(ctx: ActorCtx, agentId: string): Promise<{ hosting: AgentHosting; machine?: HostingMachine; env: HostingEnvVar[]; spend?: HostingSpend }> {
    const { row, ops } = await this.managed(ctx, agentId);
    const [machine, env, spend] = await this.platform(() =>
      Promise.all([ops.machine().catch(() => undefined), ops.env(), row.funding === 'trial' ? ops.spend().catch(() => undefined) : Promise.resolve(undefined)]),
    );
    let hosting = row;
    if (spend?.limitReached && row.funding === 'trial' && !row.trial?.closedAt) hosting = await this.endTrial(row, ops, 'exhausted');
    return { hosting: publicShape(hosting), ...(machine ? { machine } : {}), env, ...(spend ? { spend } : {}) };
  }

  /**
   * The owner's own key (2026-10-27): the end of the trial, and the only way
   * out of it. The key goes to the platform, the funding stops there, then
   * the record says `own`; a failure before the record leaves the trial as it
   * was, and a retry does the same again. Also how a key is replaced.
   */
  async setLlm(ctx: ActorCtx, agentId: string, input: { provider: LlmProvider; apiKey: string; model?: string }): Promise<AgentHosting> {
    const { row, ops } = await this.managed(ctx, agentId);
    const allowed = LLM_PROVIDERS[row.kind] ?? [];
    if (!allowed.includes(input.provider)) throw new HarborError('invalid_request', `${row.kind} does not run on ${input.provider}; it takes ${allowed.join(', ')}`);
    const apiKey = input.apiKey.trim();
    if (apiKey.length < 8) throw new HarborError('invalid_request', 'that is not an API key');
    const model = input.model?.trim() || undefined;
    this.k.guardWrite();
    await this.platform(() => ops.setLlm({ kind: row.kind, provider: input.provider, apiKey, ...(model ? { model } : {}) }));
    if (row.funding === 'trial' && !row.trial?.closedAt) await this.platform(() => ops.stopFunding());
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

  /** The connector saw the platform at the cap: the trial is over, for good. */
  async closeTrial(agentId: string, reason: 'exhausted' | 'expired'): Promise<void> {
    const row = await this.k.store.getAgentHosting(agentId);
    if (!row || !this.provider || row.funding !== 'trial' || row.trial?.closedAt || !row.externalId) return;
    await this.endTrial(row, this.provider.manage(row.externalId), reason);
  }

  /** The platform first, so nothing more goes on Rowboat's credit even if the record is not reached. */
  private async endTrial(row: StoredAgentHosting, ops: HostingOps, reason: 'exhausted' | 'expired'): Promise<StoredAgentHosting> {
    await ops.stopFunding();
    const at = this.k.now();
    const next: StoredAgentHosting = { ...row, trial: { ...(row.trial ?? { endsAt: at }), closedAt: at, closedReason: reason }, updatedAt: at };
    await this.k.store.putHosting(next);
    return next;
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
    // A trial that ran out of time, with credit left or not, is over.
    for (const row of await this.k.store.listHostingsByStatus(['ready'])) {
      if (row.funding !== 'trial' || !row.trial || row.trial.closedAt || !row.externalId || Date.parse(row.trial.endsAt) > Date.now()) continue;
      try {
        await this.endTrial(row, provider.manage(row.externalId), 'expired');
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
