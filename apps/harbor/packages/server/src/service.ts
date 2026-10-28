import type { z } from 'zod';
import type { BlobStore } from './blobs.js';
import { Agents, type AgentConnectorHooks } from './core/agents.js';
import { AgentPresence } from './core/agent-presence.js';
import { Hosting, type HostingHooks, type HostingProvider } from './core/hosting.js';
import { Assets } from './core/assets.js';
import { Images } from './core/images.js';
import { Feed } from './core/feed.js';
import { approvalCardBody } from './core/approval-card.js';
import { Invocations } from './core/invocations.js';
import { Kernel, type ActorCtx, type BindIdentity, type OrgInfo } from './core/kernel.js';
import { ReadState } from './core/read-state.js';
import { Spaces } from './core/spaces.js';
import type { AddMembersInput, ArchiveSpaceInput, CreateInviteInput, RemoveMemberInput, RenameSpaceInput, SetDefaultSpaceInput, SetMemberRoleInput, SetSpaceVisibilityInput, UpdateOrgSettingsInput } from './core/spaces.js';
import type { CreateTopicInput, DeleteMessageInput, EditMessageInput, EndPollInput, ManageTopicAction, NewMessage, PageOpts, ReactInput, VotePollInput } from './core/feed.js';
import type { MarkReadInput, UnreadSnapshot } from './core/read-state.js';
import type { SpaceHub } from './hub.js';
import type { Notifier } from './notify.js';
import type { PushLevel, Store, StoredEvent } from './store.js';
import type {
  ActingMode,
  AcceptInviteResult,
  ActivityKind,
  ActivityPage,
  Asset,
  BlobInfo,
  ChangeSet,
  CreateAsset,
  CreateAssetResult,
  CreateInviteResult,
  DeleteAssetResult,
  Member,
  OrgSettings,
  UpdateProfile,
  AgentKey,
  AgentCredential,
  AgentHosting,
  HostingPowerAction, LlmProvider,
  AgentHook,
  AgentKeySecret,
  AgentListing,
  ConnectorCapabilities,
  Approval,
  ApprovalClose,
  ApprovalDecision,
  ApprovalRequest,
  Invocation,
  InvocationOptionValues,
  InvocationUpdate,
  Membership,
  StreamEvent,
  Message,
  MoveAssetResult,
  PresenceState,
  ProposeChange,
  ProposeChangeResult,
  ReadAssetResult,
  ResolveInviteResult,
  RestoreAssetResult,
  Routes,
  SearchKind,
  SearchResults,
  Space,
  Topic,
  TopicListing,
} from '@rowboat/spaces-protocol';

// The one service core (spec §9: one core, three doors). REST (http.ts), the
// live face (ws.ts) and MCP (mcp.ts) are thin projections over this class;
// neither has a privileged path. The class is a facade: the work lives in
// core/ — one aggregate per file over a shared Kernel (the space lock, the
// log, the access gate) — and every public method here delegates to it, so
// the faces and the tests see one object with one surface. Add a feature in
// its aggregate; add its delegate here.

export type { ActorCtx, BindIdentity, OrgInfo } from './core/kernel.js';
export type { ActingMode };

export class HarborService {
  private readonly k: Kernel;
  private readonly spaces: Spaces;
  private readonly assets: Assets;
  private readonly images: Images;
  private readonly feed: Feed;
  private readonly readState: ReadState;
  private readonly agents: Agents;
  private readonly hosting: Hosting;
  private readonly invocations: Invocations;
  private readonly presence: AgentPresence;

  constructor(
    store: Store,
    hub: SpaceHub,
    org: OrgInfo,
    /** Absent = uploads unconfigured on this org (routes refuse loudly, everything else works). */
    blobs?: BlobStore,
    /** Absent = no notifications on this org (notify.ts: frames + push). */
    notifier?: Notifier,
    /** Test knob: how long an agent may be away before it is announced offline (default 15s). */
    options: { presenceGraceMs?: number } = {},
  ) {
    this.k = new Kernel(store, hub, org);
    this.spaces = new Spaces(this.k, blobs);
    this.assets = new Assets(this.k, blobs);
    this.images = new Images(this.k, blobs);
    this.invocations = new Invocations(this.k);
    this.feed = new Feed(this.k, this.assets, notifier, this.invocations);
    this.readState = new ReadState(this.k, this.spaces, this.feed);
    this.agents = new Agents(this.k, this.spaces);
    this.hosting = new Hosting(this.k, this.spaces, this.agents);
    this.presence = new AgentPresence(this.k, options.presenceGraceMs);
  }

  /** The kernel's clock, for code outside the core that stamps rows (connectors/host.ts). */
  now(): string {
    return this.k.now();
  }

  /** The connector host, for creating agents Harbor reaches through a platform (runtime.ts). */
  attachConnectors(hooks: AgentConnectorHooks): void {
    this.agents.attachConnectors(hooks);
  }

  /** Managed hosting (spec §8 Maritime, 2026-10-26): the platform Rowboat's own account creates agents on, when the deployment has its key (runtime.ts). */
  attachHosting(provider: HostingProvider, hooks: HostingHooks, options: { trialMs?: number } = {}): void {
    this.hosting.attach(provider, hooks, options);
  }
  /** The hosting worker: follows each managed agent from creation to ready, and through deletion. */
  startHosting(tickMs?: number): void {
    this.hosting.start(tickMs);
  }
  stopHosting(): Promise<void> {
    return this.hosting.stop();
  }

  /** Jev, the agent Harbor itself is (spec §8 Jev, 2026-10-07): created once per org, when the deployment has its key (runtime.ts). */
  ensureJev(): Promise<Member | undefined> {
    return this.agents.ensureJev();
  }

  /** The org this service serves — `address` is set once the listener knows its port (server.ts). */
  get org(): OrgInfo {
    return this.k.org;
  }

  /** Over-limit means read-only, never lockout (spec §4). Flip via the control plane; here a knob for tests. */
  get readOnly(): boolean {
    return this.k.readOnly;
  }
  set readOnly(value: boolean) {
    this.k.readOnly = value;
  }

  // --- the kernel (core/kernel.ts) -------------------------------------------------
  requireMember(ctx: ActorCtx, spaceId: string): Promise<Space> {
    return this.k.requireMember(ctx, spaceId);
  }

  // --- spaces & membership (core/spaces.ts) ----------------------------------------
  me(ctx: ActorCtx): Promise<Member> {
    return this.spaces.me(ctx);
  }
  updateProfile(ctx: ActorCtx, input: UpdateProfile): Promise<Member> {
    return this.spaces.updateProfile(ctx, input);
  }
  createAgent(input: { displayName: string; ownerId?: string }): Promise<Member> {
    return this.spaces.createAgent(input);
  }

  // --- invocations (core/invocations.ts) -------------------------------------------
  listAgentInvocations(ctx: ActorCtx): Promise<Invocation[]> {
    return this.invocations.listForAgent(ctx);
  }
  acknowledgeInvocation(ctx: ActorCtx, invocationId: string): Promise<Invocation> {
    return this.invocations.acknowledge(ctx, invocationId);
  }
  updateInvocation(ctx: ActorCtx, invocationId: string, update: InvocationUpdate): Promise<Invocation> {
    return this.invocations.update(ctx, invocationId, update);
  }
  declareCapabilities(ctx: ActorCtx, capabilities: ConnectorCapabilities): Promise<ConnectorCapabilities> {
    return this.invocations.declareCapabilities(ctx, capabilities);
  }
  getAgentOptionDefaults(agentId: string): Promise<InvocationOptionValues> {
    return this.invocations.optionDefaults(agentId);
  }
  renameAgent(ctx: ActorCtx, agentId: string, input: { displayName: string }): Promise<Member> {
    return this.agents.rename(ctx, agentId, input);
  }
  setAgentPersonal(ctx: ActorCtx, agentId: string, input: { personal: boolean }): Promise<Member> {
    return this.agents.setPersonal(ctx, agentId, input);
  }

  setAgentOptionDefaults(ctx: ActorCtx, agentId: string, defaults: InvocationOptionValues): Promise<InvocationOptionValues> {
    return this.agents.setOptionDefaults(ctx, agentId, defaults);
  }
  getAgentCapabilities(agentId: string): Promise<ConnectorCapabilities> {
    return this.invocations.capabilities(agentId);
  }
  listInvocations(ctx: ActorCtx, spaceId: string, threadRootId?: string): Promise<Invocation[]> {
    return this.invocations.listForSpace(ctx, spaceId, threadRootId);
  }
  cancelInvocation(ctx: ActorCtx, invocationId: string): Promise<Invocation> {
    return this.invocations.cancel(ctx, invocationId);
  }

  // --- agents and their keys (core/agents.ts) --------------------------------------
  async listAgents(ctx: ActorCtx): Promise<AgentListing[]> {
    const listing = await this.agents.list(ctx);
    const hosting = await this.hosting.listFor(listing.map((l) => l.agent.id));
    return listing.map((l) => (hosting.has(l.agent.id) ? { ...l, hosting: hosting.get(l.agent.id)! } : l));
  }
  /** The kinds of agent this Harbor creates on Rowboat's own platform account: none without the deployment's key. */
  managedAgentKinds(ctx: ActorCtx): Promise<string[]> {
    return this.hosting.kinds(ctx);
  }
  /** Create a managed agent on the platform Rowboat's account runs (spec §8 Maritime, 2026-10-26). */
  createManagedAgent(
    ctx: ActorCtx,
    input: { displayName: string; kind: string; anthropicApiKey?: string; env?: Array<{ key: string; value: string; secret?: boolean }>; personal?: boolean },
  ): Promise<{ agent: Member; key: AgentKeySecret; hosting: AgentHosting }> {
    return this.hosting.createManaged(ctx, input);
  }
  /** Delete a managed agent's hosting: the owner or an admin; its keys go now, the platform's resources in the background. */
  deleteManagedAgent(ctx: ActorCtx, agentId: string): Promise<AgentHosting> {
    return this.hosting.deleteManaged(ctx, agentId);
  }
  /** Managing a managed agent's VM (the management area, 2026-10-27): the owner or an admin, through the deployment's key. */
  getHosting(ctx: ActorCtx, agentId: string) {
    return this.hosting.get(ctx, agentId);
  }
  /** The owner's own provider key for a managed agent, the end of its trial (2026-10-27). */
  setHostingLlm(ctx: ActorCtx, agentId: string, input: { provider: LlmProvider; apiKey: string; model?: string }) {
    return this.hosting.setLlm(ctx, agentId, input);
  }
  /** For a managed agent's connector before a turn: on Rowboat's trial credit, and whether that is over. */
  hostingFundingOf(agentId: string) {
    return this.hosting.fundingOf(agentId);
  }
  closeHostingTrial(agentId: string, reason: 'exhausted' | 'expired') {
    return this.hosting.closeTrial(agentId, reason);
  }
  setHostingEnv(ctx: ActorCtx, agentId: string, key: string, value: string, secret: boolean) {
    return this.hosting.setEnv(ctx, agentId, key, value, secret);
  }
  deleteHostingEnv(ctx: ActorCtx, agentId: string, key: string) {
    return this.hosting.deleteEnv(ctx, agentId, key);
  }
  hostingPower(ctx: ActorCtx, agentId: string, action: HostingPowerAction) {
    return this.hosting.power(ctx, agentId, action);
  }
  runHostingCommand(ctx: ActorCtx, agentId: string, command: string, timeoutSeconds?: number) {
    return this.hosting.run(ctx, agentId, command, timeoutSeconds);
  }
  getHostingCommand(ctx: ActorCtx, agentId: string, executionId: string) {
    return this.hosting.execution(ctx, agentId, executionId);
  }
  cancelHostingCommand(ctx: ActorCtx, agentId: string, executionId: string) {
    return this.hosting.cancel(ctx, agentId, executionId);
  }
  getHostingLogs(ctx: ActorCtx, agentId: string, opts: { limit?: number; before?: string; level?: string }) {
    return this.hosting.logs(ctx, agentId, opts);
  }
  listHostingFiles(ctx: ActorCtx, agentId: string, path: string) {
    return this.hosting.files(ctx, agentId, path);
  }
  readHostingFile(ctx: ActorCtx, agentId: string, path: string) {
    return this.hosting.readFile(ctx, agentId, path);
  }
  writeHostingFile(ctx: ActorCtx, agentId: string, path: string, content: string) {
    return this.hosting.writeFile(ctx, agentId, path, content);
  }
  makeHostingDir(ctx: ActorCtx, agentId: string, path: string) {
    return this.hosting.mkdir(ctx, agentId, path);
  }
  moveHostingFile(ctx: ActorCtx, agentId: string, from: string, to: string) {
    return this.hosting.moveFile(ctx, agentId, from, to);
  }
  deleteHostingFile(ctx: ActorCtx, agentId: string, path: string) {
    return this.hosting.deleteFile(ctx, agentId, path);
  }
  listHostingSkills(ctx: ActorCtx, agentId: string, q?: string) {
    return this.hosting.skills(ctx, agentId, q);
  }
  installHostingSkill(ctx: ActorCtx, agentId: string, name: string) {
    return this.hosting.installSkill(ctx, agentId, name);
  }
  removeHostingSkill(ctx: ActorCtx, agentId: string, name: string) {
    return this.hosting.removeSkill(ctx, agentId, name);
  }
  listHostingTriggers(ctx: ActorCtx, agentId: string) {
    return this.hosting.triggers(ctx, agentId);
  }
  createHostingTrigger(ctx: ActorCtx, agentId: string, input: { type: string; config: Record<string, unknown>; enabled?: boolean }) {
    return this.hosting.createTrigger(ctx, agentId, input);
  }
  updateHostingTrigger(ctx: ActorCtx, agentId: string, triggerId: string, input: { config?: Record<string, unknown>; enabled?: boolean }) {
    return this.hosting.updateTrigger(ctx, agentId, triggerId, input);
  }
  deleteHostingTrigger(ctx: ActorCtx, agentId: string, triggerId: string) {
    return this.hosting.deleteTrigger(ctx, agentId, triggerId);
  }
  addAgent(
    ctx: ActorCtx,
    input: { displayName: string; kind: string; connection: string; credential?: string; instance?: string; personal?: boolean },
  ): Promise<{ agent: Member; key: AgentKeySecret }> {
    return this.agents.add(ctx, input);
  }
  setAgentCredential(ctx: ActorCtx, agentId: string, secret: string): Promise<AgentCredential> {
    return this.agents.setCredential(ctx, agentId, secret);
  }
  setAgentHook(ctx: ActorCtx, agentId: string, spaceId: string): Promise<{ hook: AgentHook; token: string }> {
    return this.agents.setHook(ctx, agentId, spaceId);
  }
  clearAgentHook(ctx: ActorCtx, agentId: string): Promise<void> {
    return this.agents.clearHook(ctx, agentId);
  }
  /** An alert at an agent's address (spec §8 Alerts, 2026-10-03), posted by the agent in its space; false when it has nothing to say. */
  async receiveAgentHook(agentId: string, token: string, payload: unknown): Promise<boolean> {
    const alert = await this.agents.hookAlert(agentId, token, payload);
    if (!alert) return false;
    await this.feed.postMessage({ memberId: agentId, agent: true }, alert.spaceId, { body: alert.body, actingMode: 'direct' });
    return true;
  }
  createAgentKey(ctx: ActorCtx, agentId: string): Promise<AgentKeySecret> {
    return this.agents.createKey(ctx, agentId);
  }
  revokeAgentKey(ctx: ActorCtx, agentId: string, keyId: string): Promise<AgentKey> {
    return this.agents.revokeKey(ctx, agentId, keyId);
  }
  listSpaces(ctx: ActorCtx, opts: { includeDirect?: boolean } = {}): Promise<Space[]> {
    return this.spaces.listSpaces(ctx, opts);
  }
  isGroupChat(): Promise<boolean> {
    return this.spaces.isGroupChat();
  }
  browseSpaces(ctx: ActorCtx): Promise<Array<{ space: Space; joined: boolean }>> {
    return this.spaces.browseSpaces(ctx);
  }
  joinSpace(ctx: ActorCtx, spaceId: string): Promise<{ space: Space; membership: Membership }> {
    return this.spaces.joinSpace(ctx, spaceId);
  }
  createSpace(ctx: ActorCtx, name: string, visibility: Space['visibility'] = 'private', opts: { isDefault?: boolean } = {}): Promise<Space> {
    return this.spaces.createSpace(ctx, name, visibility, opts);
  }
  renameSpace(ctx: ActorCtx, spaceId: string, input: RenameSpaceInput): Promise<Space> {
    return this.spaces.renameSpace(ctx, spaceId, input);
  }
  archiveSpace(ctx: ActorCtx, spaceId: string, input: ArchiveSpaceInput): Promise<Space> {
    return this.spaces.archiveSpace(ctx, spaceId, input);
  }
  unarchiveSpace(ctx: ActorCtx, spaceId: string, input: ArchiveSpaceInput): Promise<Space> {
    return this.spaces.unarchiveSpace(ctx, spaceId, input);
  }
  setDefaultSpace(ctx: ActorCtx, spaceId: string, input: SetDefaultSpaceInput): Promise<Space> {
    return this.spaces.setDefaultSpace(ctx, spaceId, input);
  }
  deleteSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    return this.spaces.deleteSpace(ctx, spaceId);
  }
  setSpaceVisibility(ctx: ActorCtx, spaceId: string, input: SetSpaceVisibilityInput): Promise<Space> {
    return this.spaces.setSpaceVisibility(ctx, spaceId, input);
  }
  removeMember(ctx: ActorCtx, spaceId: string, memberId: string, input: RemoveMemberInput): Promise<{ removed: boolean }> {
    return this.spaces.removeMember(ctx, spaceId, memberId, input);
  }
  removeOrgMember(ctx: ActorCtx, memberId: string, input: RemoveMemberInput): Promise<Member> {
    return this.spaces.removeOrgMember(ctx, memberId, input);
  }
  setMemberRole(ctx: ActorCtx, memberId: string, input: SetMemberRoleInput): Promise<Member> {
    return this.spaces.setMemberRole(ctx, memberId, input);
  }
  getOrgSettings(ctx: ActorCtx): Promise<OrgSettings> {
    return this.spaces.getOrgSettings(ctx);
  }
  updateOrgSettings(ctx: ActorCtx, input: UpdateOrgSettingsInput): Promise<OrgSettings> {
    return this.spaces.updateOrgSettings(ctx, input);
  }
  openDirect(ctx: ActorCtx, otherMemberId: string): Promise<{ space: Space; created: boolean }> {
    return this.spaces.openDirect(ctx, otherMemberId);
  }
  listMembers(ctx: ActorCtx, spaceId: string): Promise<Member[]> {
    return this.spaces.listMembers(ctx, spaceId);
  }
  listOrgMembers(ctx: ActorCtx): Promise<Member[]> {
    return this.spaces.listOrgMembers(ctx);
  }
  /** Of these members, the agents whose connector is connected now (local agents, 2026-10-28). */
  onlineAgents(members: readonly Member[]): string[] {
    return this.presence.online(members);
  }
  /** A live connection opened or closed for a member (ws.ts): an agent's presence follows its connections. */
  liveOpened(memberId: string): Promise<void> {
    return this.presence.opened(memberId);
  }
  liveClosed(memberId: string): void {
    this.presence.closed(memberId);
  }
  /** Drop the presence timers (runtime close). */
  closePresence(): void {
    this.presence.close();
  }
  addMembers(ctx: ActorCtx, spaceId: string, input: AddMembersInput): Promise<Membership[]> {
    return this.spaces.addMembers(ctx, spaceId, input);
  }
  leaveSpace(ctx: ActorCtx, spaceId: string): Promise<void> {
    return this.spaces.leaveSpace(ctx, spaceId);
  }
  createInvite(ctx: ActorCtx, input: CreateInviteInput): Promise<CreateInviteResult> {
    return this.spaces.createInvite(ctx, input);
  }
  resolveInvite(token: string): Promise<ResolveInviteResult> {
    return this.spaces.resolveInvite(token);
  }
  bindInvite(identity: BindIdentity, token: string): Promise<AcceptInviteResult> {
    return this.spaces.bindInvite(identity, token);
  }
  acceptInvite(ctx: ActorCtx, token: string): Promise<AcceptInviteResult> {
    return this.spaces.acceptInvite(ctx, token);
  }
  registerPush(ctx: ActorCtx, input: { token: string; level: PushLevel }): Promise<{ ok: true }> {
    return this.spaces.registerPush(ctx, input);
  }
  unregisterPush(ctx: ActorCtx, input: { token: string }): Promise<{ ok: true }> {
    return this.spaces.unregisterPush(ctx, input);
  }
  deactivateSelf(ctx: ActorCtx): Promise<void> {
    return this.spaces.deactivateSelf(ctx);
  }
  publishPresence(
    ctx: ActorCtx,
    spaceId: string,
    state: PresenceState,
    threadRootId?: string,
  ): Promise<void> {
    return this.spaces.publishPresence(ctx, spaceId, state, threadRootId);
  }
  publishWhiteboard(ctx: ActorCtx, spaceId: string, boardId: string, payload: unknown): Promise<void> {
    return this.spaces.publishWhiteboard(ctx, spaceId, boardId, payload);
  }
  replay(ctx: ActorCtx, spaceId: string, afterOffset?: number): Promise<{ head: number; events: StoredEvent[] }> {
    return this.spaces.replay(ctx, spaceId, afterOffset);
  }

  // --- files (core/assets.ts) ------------------------------------------------------
  listAssets(ctx: ActorCtx, spaceId: string, includeDeleted = false): Promise<Asset[]> {
    return this.assets.listAssets(ctx, spaceId, includeDeleted);
  }
  readAsset(ctx: ActorCtx, spaceId: string, assetId: string, version?: number): Promise<ReadAssetResult> {
    return this.assets.readAsset(ctx, spaceId, assetId, version);
  }
  createAsset(ctx: ActorCtx, spaceId: string, input: CreateAsset): Promise<CreateAssetResult> {
    return this.assets.createAsset(ctx, spaceId, input);
  }
  moveAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['moveAsset']['request']>,
  ): Promise<MoveAssetResult> {
    return this.assets.moveAsset(ctx, spaceId, input);
  }
  deleteAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['deleteAsset']['request']>,
  ): Promise<DeleteAssetResult> {
    return this.assets.deleteAsset(ctx, spaceId, input);
  }
  restoreAsset(
    ctx: ActorCtx,
    spaceId: string,
    input: z.infer<Routes['restoreAsset']['request']>,
  ): Promise<RestoreAssetResult> {
    return this.assets.restoreAsset(ctx, spaceId, input);
  }
  uploadBlob(
    ctx: ActorCtx,
    spaceId: string,
    bytes: Uint8Array,
    opts: { declaredSha256: string; declaredMime?: string },
  ): Promise<BlobInfo> {
    return this.assets.uploadBlob(ctx, spaceId, bytes, opts);
  }
  setAvatar(ctx: ActorCtx, bytes: Uint8Array, origin: string): Promise<Member> {
    return this.images.setAvatar(ctx, bytes, origin);
  }
  clearAvatar(ctx: ActorCtx): Promise<Member> {
    return this.images.clearAvatar(ctx);
  }
  orgLogoUrl(ctx: ActorCtx, origin: string): Promise<string | undefined> {
    return this.images.orgLogoUrl(ctx, origin);
  }
  setOrgLogo(ctx: ActorCtx, bytes: Uint8Array, origin: string): Promise<{ logoUrl: string }> {
    return this.images.setOrgLogo(ctx, bytes, origin);
  }
  clearOrgLogo(ctx: ActorCtx): Promise<Record<string, never>> {
    return this.images.clearOrgLogo(ctx);
  }
  getImage(ctx: ActorCtx, hash: string, opts?: { inline?: boolean }): Promise<{ blob: BlobInfo; url?: string; bytes?: Uint8Array; stream?: ReadableStream<Uint8Array> }> {
    return this.images.getImage(ctx, hash, opts);
  }
  downloadBlob(
    ctx: ActorCtx,
    spaceId: string,
    hash: string,
    name?: string,
    opts?: { expiresInSeconds?: number; inline?: boolean; attachment?: boolean },
  ): Promise<{ blob: BlobInfo; disposition: string; url?: string; bytes?: Uint8Array; stream?: ReadableStream<Uint8Array> }> {
    return this.assets.downloadBlob(ctx, spaceId, hash, name, opts);
  }
  proposeChange(ctx: ActorCtx, spaceId: string, input: ProposeChange): Promise<ProposeChangeResult> {
    return this.assets.proposeChange(ctx, spaceId, input);
  }
  assetHistory(
    ctx: ActorCtx,
    spaceId: string,
    opts: { assetId?: string; beforeOffset?: number; limit?: number },
  ): Promise<ChangeSet[]> {
    return this.assets.assetHistory(ctx, spaceId, opts);
  }
  diff(ctx: ActorCtx, spaceId: string, assetId: string, from: number, to: number): Promise<string> {
    return this.assets.diff(ctx, spaceId, assetId, from, to);
  }

  // --- the feed (core/feed.ts) -----------------------------------------------------
  listTopics(ctx: ActorCtx, spaceId: string, includeArchived = false): Promise<TopicListing[]> {
    return this.feed.listTopics(ctx, spaceId, includeArchived);
  }
  listStream(
    ctx: ActorCtx,
    spaceId: string,
    opts?: PageOpts & { replies?: boolean },
  ): Promise<{ messages: Message[]; topics: Topic[]; threadRoots: Message[]; hasMore: boolean; hasMoreAfter: boolean; readOffset: number; events: StreamEvent[] }> {
    return this.feed.listStream(ctx, spaceId, opts);
  }
  listThread(
    ctx: ActorCtx,
    spaceId: string,
    rootMessageId: string,
    opts?: PageOpts,
  ): Promise<{
    root: Message;
    topic: Topic | null;
    messages: Message[];
    hasMore: boolean;
    hasMoreAfter: boolean;
    readOffset: number | null;
    following: boolean;
  }> {
    return this.feed.listThread(ctx, spaceId, rootMessageId, opts);
  }
  getMessage(ctx: ActorCtx, spaceId: string, messageId: string): Promise<Message> {
    return this.feed.getMessage(ctx, spaceId, messageId);
  }
  postMessage(ctx: ActorCtx, spaceId: string, input: NewMessage): Promise<{ message: Message; invocations: Invocation[] }> {
    return this.feed.postMessage(ctx, spaceId, input);
  }
  /**
   * A connector's answer to one of its agent's invocations: posted in its
   * thread and marked done in one transaction, or not at all if the
   * invocation has already finished (spec §8 Connectors, 2026-09-30).
   * In-process only; nothing on the wire takes `finishes`.
   */
  async answerInvocation(ctx: ActorCtx, invocationId: string, body: string): Promise<{ message: Message; invocations: Invocation[] }> {
    const invocation = await this.invocations.ownInvocation(ctx, invocationId);
    const { spaceId, threadRootId } = invocation.conversation;
    return this.feed.postMessage(ctx, spaceId, { body, threadRoot: threadRootId, actingMode: 'direct' }, { finishes: invocationId });
  }

  /**
   * Jev's tags for one message (spec §8 Jev, 2026-10-07): a reply in its
   * thread whose mentions take that message's hand-off depth, so an agent
   * and Jev passing work back and forth stop at the hop limit. In-process
   * only, like `finishes`.
   */
  async relayMentions(ctx: ActorCtx, spaceId: string, messageId: string, body: string): Promise<{ message: Message; invocations: Invocation[] }> {
    const message = await this.feed.getMessage(ctx, spaceId, messageId);
    return this.feed.postMessage(ctx, spaceId, { body, threadRoot: message.threadRoot ?? message.id, actingMode: 'direct' }, { relayOf: messageId });
  }
  /** The depth an agent this message mentions is invoked at: what Jev checks before it tags an agent. */
  async messageHandOffDepth(ctx: ActorCtx, spaceId: string, messageId: string): Promise<number> {
    await this.k.requireReadableSpace(ctx, spaceId);
    return this.k.store.getMessageHops(spaceId, messageId);
  }

  // --- approvals (core/invocations.ts, spec §8 part 4, 2026-10-01) ----------------------

  /** The connector raises an approval: the agent's card in the invocation's thread, with the approval on it. Idempotent by requestKey. */
  async requestApproval(ctx: ActorCtx, invocationId: string, request: ApprovalRequest): Promise<{ approval: Approval; message: Message }> {
    const invocation = await this.invocations.ownInvocation(ctx, invocationId);
    const { spaceId, threadRootId } = invocation.conversation;
    const raised = async () => {
      const existing = await this.invocations.findApproval(invocationId, request.requestKey);
      return existing ? { approval: existing, message: await this.feed.getMessage(ctx, spaceId, existing.messageId) } : undefined;
    };
    const already = await raised();
    if (already) return already;
    const agent = await this.k.store.getMember(ctx.memberId);
    const body = approvalCardBody(agent?.displayName ?? 'The agent', request);
    try {
      const { message } = await this.feed.postMessage(ctx, spaceId, { body, threadRoot: threadRootId, actingMode: 'direct' }, { approval: { invocationId, request } });
      return { approval: message.approval!, message };
    } catch (err) {
      // The same request raised twice at once: the unique key let one through.
      const raced = await raised();
      if (raced) return raced;
      throw err;
    }
  }
  decideApproval(ctx: ActorCtx, spaceId: string, approvalId: string, input: ApprovalDecision & { actingMode: ActingMode }): Promise<Approval> {
    return this.invocations.decideApproval(ctx, spaceId, approvalId, input);
  }
  closeApproval(ctx: ActorCtx, approvalId: string, close: ApprovalClose): Promise<Approval> {
    return this.invocations.closeApproval(ctx, approvalId, close);
  }
  applyApproval(ctx: ActorCtx, approvalId: string): Promise<Approval> {
    return this.invocations.applyApproval(ctx, approvalId);
  }
  listApprovalDecisions(ctx: ActorCtx): Promise<Approval[]> {
    return this.invocations.listDecisionsForAgent(ctx);
  }
  createTopic(
    ctx: ActorCtx,
    spaceId: string,
    input: CreateTopicInput,
  ): Promise<{ topic: Topic; rootMessage: Message }> {
    return this.feed.createTopic(ctx, spaceId, input);
  }
  migrateMentions(opts: { force?: boolean } = {}): Promise<{ messages: number; titles: number; restamped: number }> {
    return this.feed.migrateMentions(opts);
  }
  deleteMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: DeleteMessageInput,
  ): Promise<Message> {
    return this.feed.deleteMessage(ctx, spaceId, messageId, input);
  }
  editMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: EditMessageInput,
  ): Promise<Message> {
    return this.feed.editMessage(ctx, spaceId, messageId, input);
  }
  reactToMessage(ctx: ActorCtx, spaceId: string, messageId: string, input: ReactInput): Promise<Message> {
    return this.feed.reactToMessage(ctx, spaceId, messageId, input);
  }
  votePoll(ctx: ActorCtx, spaceId: string, messageId: string, input: VotePollInput): Promise<Message> {
    return this.feed.votePoll(ctx, spaceId, messageId, input);
  }
  endPoll(ctx: ActorCtx, spaceId: string, messageId: string, input: EndPollInput): Promise<Message> {
    return this.feed.endPoll(ctx, spaceId, messageId, input);
  }
  manageTopic(ctx: ActorCtx, spaceId: string, topicId: string, action: ManageTopicAction): Promise<Topic> {
    return this.feed.manageTopic(ctx, spaceId, topicId, action);
  }
  search(
    ctx: ActorCtx,
    spaceId: string,
    rawQuery: string,
    opts?: { kinds?: SearchKind[]; limit?: number },
  ): Promise<SearchResults> {
    return this.feed.search(ctx, spaceId, rawQuery, opts);
  }

  // --- read state & activity (core/read-state.ts) ----------------------------------
  markRead(ctx: ActorCtx, spaceId: string, input: MarkReadInput): Promise<{ readOffset: number }> {
    return this.readState.markRead(ctx, spaceId, input);
  }
  followThread(
    ctx: ActorCtx,
    spaceId: string,
    rootMessageId: string,
    following: boolean,
  ): Promise<{ following: boolean; readOffset: number }> {
    return this.readState.followThread(ctx, spaceId, rootMessageId, following);
  }
  activity(
    ctx: ActorCtx,
    q: { kinds?: ActivityKind[]; spaceId?: string; unread?: boolean; cursor?: string; limit?: number },
  ): Promise<ActivityPage> {
    return this.readState.activity(ctx, q);
  }
  markActivitySeen(ctx: ActorCtx, at: string): Promise<{ seenAt: string }> {
    return this.readState.markActivitySeen(ctx, at);
  }
  readAll(ctx: ActorCtx, input: { spaceId?: string }): Promise<{ spaces: Array<{ spaceId: string; readOffset: number }>; threads: number; seenAt: string }> {
    return this.readState.readAll(ctx, input);
  }
  unread(ctx: ActorCtx): Promise<UnreadSnapshot> {
    return this.readState.unread(ctx);
  }
}
