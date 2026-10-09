import type { ActivityKind, ActivityPage } from '@rowboat/spaces-protocol';
import {
  routes,
  type AcceptInviteResult,
  type Asset,
  type BlobInfo,
  type ChangeSet,
  type CreateAsset,
  type CreateAssetResult,
  type DeleteAssetResult,
  type CreateInviteResult,
  type AgentKey,
  type AgentCredential,
  type AgentHook,
  type AgentKeySecret,
  type AgentListing,
  type ConnectorCapabilities,
  type Approval,
  type Invocation,
  type InvocationOptionValues,
  type Member,
  type Membership,
  type StreamEvent,
  type Message,
  type MoveAssetResult,
  type ProposeChange,
  type ProposeChangeResult,
  type ReadAssetResult,
  type ResolveInviteResult,
  type RestoreAssetResult,
  type Routes,
  type SearchKind,
  type SearchResults,
  type Space,
  type Topic,
  type TopicListing,
  type UnreadSnapshot,
} from '@rowboat/spaces-protocol';
import type { z } from 'zod';

// Typed client for one org's render face. Thin by design: every method is one
// route from the protocol's api.ts, request/response validated with the
// contract schemas — the same drift tripwire the stub server runs, from the
// other side of the wire.
//
// One client for every app that speaks to Harbor: the desktop's core and the
// phone, which kept its own copy until 2026-10-09, and a browser next (the
// Spaces web-app plan). So it uses only what all of them have — fetch,
// WebSocket, WebCrypto — and React Native, which lacks WebCrypto, passes its
// own sha256Hex.

export interface SpacesApiError {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * The shortest honest description of why the socket never answered: the
 * errno when there is one (undici nests it — sometimes an AggregateError over
 * ::1 and 127.0.0.1 — under `cause`), else the deepest message we can find.
 */
function describeTransportFailure(err: unknown): string {
  let cur: unknown = err;
  for (let depth = 0; cur instanceof Error && depth < 4; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
    if (cur instanceof AggregateError && cur.errors.length > 0) {
      cur = cur.errors[0];
      continue;
    }
    if (cur.cause === undefined) break;
    cur = cur.cause;
  }
  if (cur instanceof Error && cur.message) return cur.message;
  return err instanceof Error ? err.message : String(err);
}

export class SpacesRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, body: SpacesApiError) {
    super(body.message);
    this.name = 'SpacesRequestError';
    this.status = status;
    this.code = body.code;
    this.retryable = body.retryable;
  }
}

/**
 * A live token source. `forceRefresh` is the 401 path: the token we just used
 * was rejected, get a genuinely new one (orgs.ts refreshes + persists).
 */
export type SpacesTokenProvider = (opts?: { forceRefresh?: boolean }) => Promise<string>;

export interface ActivityQueryInput {
  kinds?: ActivityKind[];
  spaceId?: string;
  unread?: boolean;
  cursor?: string;
  limit?: number;
}

export interface SpacesClientOptions {
  /** e.g. http://localhost:4272 — scheme + host[:port], no trailing slash. */
  baseUrl: string;
  /** Static bearer (dev tokens, tests) or a provider (OAuth orgs — always fresh). */
  token: string | SpacesTokenProvider;
  fetchImpl?: typeof fetch;
  /** Lowercase hex SHA-256 of a blob's bytes; WebCrypto unless given. */
  sha256Hex?: (bytes: Uint8Array) => Promise<string>;
}

async function webCryptoSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

type NewMessage = z.infer<Routes['postMessage']['request']>;
type CreateTopicInput = z.infer<Routes['createTopic']['request']>;
type ManageTopicAction = z.infer<Routes['manageTopic']['request']>;
type ReactInput = z.infer<Routes['reactToMessage']['request']>;
type DeleteMessageInput = z.infer<Routes['deleteMessage']['request']>;
type EditMessageInput = z.infer<Routes['editMessage']['request']>;
type VotePollInput = z.infer<Routes['votePoll']['request']>;
type EndPollInput = z.infer<Routes['endPoll']['request']>;
type DecideApprovalInput = z.infer<Routes['decideApproval']['request']>;

/** One page of a message list (protocol listStream / listThread query): at most one of the three offsets. */
export interface MessageWindowOpts {
  beforeOffset?: number;
  afterOffset?: number;
  aroundOffset?: number;
  limit?: number;
}

export class SpacesClient {
  private readonly baseUrl: string;
  private readonly token: string | SpacesTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly sha256Hex: (bytes: Uint8Array) => Promise<string>;

  constructor(options: SpacesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    // Wrapped, not stored bare: a browser's fetch called as this client's
    // method throws "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sha256Hex = options.sha256Hex ?? webCryptoSha256Hex;
  }

  private async currentToken(opts?: { forceRefresh?: boolean }): Promise<string> {
    return typeof this.token === 'string' ? this.token : this.token(opts);
  }

  /**
   * Every request crosses here. A transport failure (nothing listening,
   * DNS, reset — undici's bare `TypeError: fetch failed`) becomes a
   * SpacesRequestError that names the org and the cause, so an org that is
   * down reads as such all the way up to the app's logs instead of as an
   * anonymous "fetch failed" with the errno dropped at the first serializer.
   */
  private async transport(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (err) {
      throw new SpacesRequestError(0, {
        code: 'unreachable',
        message: `Rowboat org at ${this.baseUrl} is unreachable (${describeTransportFailure(err)})`,
        retryable: true,
      });
    }
  }

  private async request<S extends z.ZodType>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    responseSchema: S,
    body?: unknown,
    auth = true,
  ): Promise<z.infer<S>> {
    const send = async (token: string | undefined) =>
      this.transport(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    let res = await send(auth ? await this.currentToken() : undefined);
    // One forced-refresh retry on 401 when the token source is live (an
    // access token can be revoked before its expiry says so).
    if (res.status === 401 && auth && typeof this.token !== 'string') {
      res = await send(await this.currentToken({ forceRefresh: true }));
    }
    return this.parse(res, responseSchema);
  }

  /** A PUT whose body is the bytes themselves (a blob, a profile image): `request` without the JSON. */
  private async putBytes<S extends z.ZodType>(
    path: string,
    responseSchema: S,
    bytes: Uint8Array,
    headers: Record<string, string>,
  ): Promise<z.infer<S>> {
    const send = async (token: string) =>
      this.transport(`${this.baseUrl}${path}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, ...headers },
        body: bytes as unknown as BodyInit,
      });
    let res = await send(await this.currentToken());
    if (res.status === 401 && typeof this.token !== 'string') {
      res = await send(await this.currentToken({ forceRefresh: true }));
    }
    return this.parse(res, responseSchema);
  }

  /** An error body becomes a SpacesRequestError; a success must match the route's schema. */
  private async parse<S extends z.ZodType>(res: Response, responseSchema: S): Promise<z.infer<S>> {
    const json = (await res.json().catch(() => undefined)) as unknown;
    if (!res.ok) {
      const parsed = (json ?? {}) as Partial<SpacesApiError>;
      throw new SpacesRequestError(res.status, {
        code: parsed.code ?? 'internal',
        message: parsed.message ?? `request failed with ${res.status}`,
        retryable: parsed.retryable ?? false,
      });
    }
    const result = responseSchema.safeParse(json);
    if (!result.success) {
      throw new SpacesRequestError(res.status, {
        code: 'internal',
        message: `response failed contract validation: ${result.error.message}`,
        retryable: false,
      });
    }
    return result.data;
  }

  private space(spaceId: string, rest: string): string {
    return `/v1/spaces/${encodeURIComponent(spaceId)}${rest}`;
  }

  // --- health ---------------------------------------------------------------

  /** Also the connectivity probe for "org unreachable" states. */
  async health(): Promise<{ ok: boolean; org: { name: string; address: string } }> {
    const res = await this.transport(`${this.baseUrl}/v1/health`);
    if (!res.ok) throw new SpacesRequestError(res.status, { code: 'internal', message: 'health check failed', retryable: true });
    return (await res.json()) as { ok: boolean; org: { name: string; address: string } };
  }

  // --- identity -------------------------------------------------------------

  /** Who this token is on the org — the only client-side source of our memberId under OAuth. */
  async me(): Promise<{ member: Member }> {
    return this.request('GET', routes.me.path, routes.me.response);
  }

  // --- profile images (CONTRACT.md, 2026-10-02) ------------------------------

  /** Your avatar on this org; the body is the image itself. */
  async setAvatar(image: { bytes: Uint8Array; mime: string }): Promise<Member> {
    return (await this.putBytes(routes.setAvatar.path, routes.setAvatar.response, image.bytes, { 'content-type': image.mime })).member;
  }

  async clearAvatar(): Promise<Member> {
    return (await this.request('DELETE', routes.clearAvatar.path, routes.clearAvatar.response)).member;
  }

  /** The org's logo URL, or undefined when none is set. */
  async getOrgLogo(): Promise<string | undefined> {
    return (await this.request('GET', routes.getOrgLogo.path, routes.getOrgLogo.response)).logoUrl;
  }

  /** Admins only (the org refuses anyone else). */
  async setOrgLogo(image: { bytes: Uint8Array; mime: string }): Promise<string> {
    return (await this.putBytes(routes.setOrgLogo.path, routes.setOrgLogo.response, image.bytes, { 'content-type': image.mime })).logoUrl;
  }

  async clearOrgLogo(): Promise<void> {
    await this.request('DELETE', routes.clearOrgLogo.path, routes.clearOrgLogo.response);
  }

  // --- push (CONTRACT.md, the push bullet) -----------------------------------

  /** Register this device's push token and the member's level. */
  async registerPush(input: { token: string; level: 'off' | 'mentions' | 'dms' | 'all' }): Promise<{ ok: true }> {
    return this.request('POST', routes.registerPush.path, routes.registerPush.response, input);
  }

  async unregisterPush(token: string): Promise<{ ok: true }> {
    return this.request('POST', routes.unregisterPush.path, routes.unregisterPush.response, { token });
  }

  // --- spaces & membership --------------------------------------------------

  /** Shared spaces by default; `includeDirect` adds the member's DMs (api.ts listSpaces). */
  async listSpaces(opts: { includeDirect?: boolean } = {}): Promise<Space[]> {
    return (await this.listing(opts)).spaces;
  }

  /** The listing whole: the spaces, and whether the org is a group chat (absent from older servers). */
  async listing(opts: { includeDirect?: boolean } = {}): Promise<{ spaces: Space[]; groupChat?: boolean }> {
    const qs = opts.includeDirect ? '?includeDirect=true' : '';
    return this.request('GET', `${routes.listSpaces.path}${qs}`, routes.listSpaces.response);
  }

  /** Get-or-create the DM with another member — idempotent from either side (api.ts openDirect). */
  async openDirect(memberId: string): Promise<{ space: Space; created: boolean }> {
    return this.request('POST', routes.openDirect.path, routes.openDirect.response, { memberId });
  }

  async browseSpaces() {
    try {
      const result = await this.request('GET', routes.browseSpaces.path, routes.browseSpaces.response);
      return { supported: true as const, ...result };
    } catch (error) {
      if (error instanceof SpacesRequestError && error.status === 404) {
        return { supported: false as const, spaces: [] };
      }
      throw error;
    }
  }

  async joinSpace(spaceId: string) {
    return this.request('POST', this.space(spaceId, '/join'), routes.joinSpace.response);
  }

  async createSpace(name: string, visibility?: Space['visibility']): Promise<Space> {
    return (await this.request('POST', routes.createSpace.path, routes.createSpace.response, { name, ...(visibility ? { visibility } : {}) })).space;
  }

  /** Rename a shared space (api.ts renameSpace). Identical name = idempotent no-op. */
  async renameSpace(spaceId: string, name: string): Promise<Space> {
    return (
      await this.request('POST', this.space(spaceId, '/rename'), routes.renameSpace.response, {
        name,
        actingMode: 'direct',
      })
    ).space;
  }

  /** The agents this member manages, with their keys' metadata (api.ts listAgents). */
  async listAgents(): Promise<AgentListing[]> {
    return (await this.request('GET', routes.listAgents.path, routes.listAgents.response)).agents;
  }

  /**
   * Add an agent this member owns; the response carries its first key's
   * secret, the only time it is shown. `kind`/`connection` say what it is and
   * how Harbor reaches it (2026-09-30); a platform agent (Replicas) also
   * brings the platform's `credential`, which Harbor checks and seals, and an
   * Agent37 agent its `instance` (2026-10-05).
   */
  async addAgent(input: { displayName: string; kind?: string; connection?: string; credential?: string; instance?: string }): Promise<{ agent: Member; key: AgentKeySecret }> {
    return this.request('POST', routes.createAgent.path, routes.createAgent.response, input);
  }

  /** Replace a platform agent's credential (owner only); Harbor checks it with the platform first. */
  async setAgentCredential(agentId: string, secret: string): Promise<AgentCredential> {
    return (await this.request('PUT', `/v1/agents/${encodeURIComponent(agentId)}/credential`, routes.setAgentCredential.response, { secret })).credential;
  }

  /** Point a platform agent's alerts at a space; the address is returned this once (api.ts setAgentHook). */
  async setAgentHook(agentId: string, spaceId: string): Promise<{ hook: AgentHook; url: string }> {
    return this.request('PUT', `/v1/agents/${encodeURIComponent(agentId)}/hook`, routes.setAgentHook.response, { spaceId });
  }

  async clearAgentHook(agentId: string): Promise<void> {
    await this.request('DELETE', `/v1/agents/${encodeURIComponent(agentId)}/hook`, routes.clearAgentHook.response);
  }

  async createAgentKey(agentId: string): Promise<AgentKeySecret> {
    return (await this.request('POST', `/v1/agents/${encodeURIComponent(agentId)}/keys`, routes.createAgentKey.response)).key;
  }

  async revokeAgentKey(agentId: string, keyId: string): Promise<AgentKey> {
    return (
      await this.request('POST', `/v1/agents/${encodeURIComponent(agentId)}/keys/${encodeURIComponent(keyId)}/revoke`, routes.revokeAgentKey.response)
    ).key;
  }

  /** Add existing org members, people or agents, to a space the caller is in (api.ts addMembers). */
  async addMembers(spaceId: string, memberIds: string[]): Promise<Membership[]> {
    return (
      await this.request('POST', this.space(spaceId, '/members'), routes.addMembers.response, {
        memberIds,
        actingMode: 'direct',
      })
    ).memberships;
  }

  async listMembers(spaceId: string): Promise<Member[]> {
    return (await this.request('GET', this.space(spaceId, '/members'), routes.listMembers.response)).members;
  }

  /** The org roster: every member, people and agents, sorted by displayName (api.ts listOrgMembers; org-wide since 2026-09-29). */
  async listOrgMembers(): Promise<Member[]> {
    return (await this.request('GET', routes.listOrgMembers.path, routes.listOrgMembers.response)).members;
  }

  async leaveSpace(spaceId: string): Promise<void> {
    await this.request('POST', this.space(spaceId, '/leave'), routes.leaveSpace.response, {});
  }

  // --- invites --------------------------------------------------------------

  async createInvite(spaceId: string, expiresInHours?: number): Promise<CreateInviteResult> {
    return this.request('POST', routes.createInvite.path, routes.createInvite.response, {
      spaceId,
      ...(expiresInHours !== undefined ? { expiresInHours } : {}),
    });
  }

  /** Pre-auth: works before the org has been added. */
  async resolveInvite(token: string): Promise<ResolveInviteResult> {
    return this.request('POST', routes.resolveInvite.path, routes.resolveInvite.response, { token }, false);
  }

  async acceptInvite(token: string): Promise<AcceptInviteResult> {
    return this.request('POST', routes.acceptInvite.path, routes.acceptInvite.response, { token });
  }

  // --- assets ---------------------------------------------------------------

  async listAssets(spaceId: string, opts: { includeDeleted?: boolean } = {}): Promise<Asset[]> {
    const qs = opts.includeDeleted ? '?includeDeleted=true' : '';
    return (await this.request('GET', this.space(spaceId, `/assets${qs}`), routes.listAssets.response)).entries;
  }

  /** Birth: the one call that names a file by path. The result carries the id every later call uses. */
  async createAsset(spaceId: string, input: CreateAsset): Promise<CreateAssetResult> {
    return this.request('POST', this.space(spaceId, '/assets'), routes.createAsset.response, input);
  }

  /** Move or rename. Conflict comes back as a value (the file changed meanwhile). */
  async moveAsset(spaceId: string, input: z.infer<Routes['moveAsset']['request']>): Promise<MoveAssetResult> {
    return this.request('POST', this.space(spaceId, '/assets/move'), routes.moveAsset.response, input);
  }

  /** Delete to trash — nothing is destroyed; restore undoes it. */
  async deleteAsset(spaceId: string, input: z.infer<Routes['deleteAsset']['request']>): Promise<DeleteAssetResult> {
    return this.request('POST', this.space(spaceId, '/assets/delete'), routes.deleteAsset.response, input);
  }

  async restoreAsset(spaceId: string, input: z.infer<Routes['restoreAsset']['request']>): Promise<RestoreAssetResult> {
    return this.request('POST', this.space(spaceId, '/assets/restore'), routes.restoreAsset.response, input);
  }

  async readAsset(spaceId: string, assetId: string, version?: number): Promise<ReadAssetResult> {
    const qs = version !== undefined ? `?version=${version}` : '';
    return this.request('GET', this.space(spaceId, `/assets/${encodeURIComponent(assetId)}${qs}`), routes.readAsset.response);
  }

  /** All three outcomes come back as values — a conflict is a result, not an exception. */
  async proposeChange(spaceId: string, input: ProposeChange): Promise<ProposeChangeResult> {
    return this.request('POST', this.space(spaceId, '/changes'), routes.proposeChange.response, input);
  }

  async assetHistory(
    spaceId: string,
    opts: { assetId?: string; beforeOffset?: number; limit?: number } = {},
  ): Promise<ChangeSet[]> {
    const q = new URLSearchParams();
    if (opts.assetId !== undefined) q.set('assetId', opts.assetId);
    if (opts.beforeOffset !== undefined) q.set('beforeOffset', String(opts.beforeOffset));
    if (opts.limit !== undefined) q.set('limit', String(opts.limit));
    const qs = q.size > 0 ? `?${q}` : '';
    return (await this.request('GET', this.space(spaceId, `/history${qs}`), routes.assetHistory.response)).changeSets;
  }

  async diff(spaceId: string, assetId: string, from: number, to: number): Promise<string> {
    const q = new URLSearchParams({ assetId, from: String(from), to: String(to) });
    return (await this.request('GET', this.space(spaceId, `/diff?${q}`), routes.diff.response)).unified;
  }

  // --- blobs ----------------------------------------------------------------

  /**
   * Upload phase 1 (spec §6): raw bytes → {hash, size, mime}. The client-side
   * sha256 rides as x-blob-sha256 so a truncated body can never be stored
   * under a healthy address. Idempotent — re-uploading the same bytes is a
   * no-op with the same hash.
   */
  async uploadBlob(spaceId: string, bytes: Uint8Array, opts: { declaredMime?: string } = {}): Promise<BlobInfo> {
    const hash = await this.sha256Hex(bytes);
    const headers = { 'x-blob-sha256': hash, ...(opts.declaredMime ? { 'content-type': opts.declaredMime } : {}) };
    return (await this.putBytes(this.space(spaceId, '/blobs'), routes.uploadBlob.response, bytes, headers)).blob;
  }

  /**
   * The bytes back. The org either streams or 302s to a presigned URL; fetch
   * follows the redirect, so this client never knows which driver served it.
   */
  async fetchBlob(spaceId: string, hash: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const send = async (token: string) =>
      this.transport(`${this.baseUrl}${this.space(spaceId, `/blobs/${hash}`)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    let res = await send(await this.currentToken());
    if (res.status === 401 && typeof this.token !== 'string') {
      res = await send(await this.currentToken({ forceRefresh: true }));
    }
    if (!res.ok) {
      const parsed = ((await res.json().catch(() => undefined)) ?? {}) as Partial<SpacesApiError>;
      throw new SpacesRequestError(res.status, {
        code: parsed.code ?? 'internal',
        message: parsed.message ?? `blob fetch failed with ${res.status}`,
        retryable: parsed.retryable ?? false,
      });
    }
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mime: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  // --- feed -----------------------------------------------------------------

  async listTopics(spaceId: string, includeArchived = false): Promise<TopicListing[]> {
    const qs = includeArchived ? '?includeArchived=true' : '';
    return (await this.request('GET', this.space(spaceId, `/topics${qs}`), routes.listTopics.response)).topics;
  }

  /** Categorized space search (protocol search.ts): messages / topics / assets, top-N each. */
  async search(
    spaceId: string,
    opts: { q: string; kinds?: SearchKind[]; limit?: number },
  ): Promise<SearchResults> {
    const qs = new URLSearchParams({ q: opts.q });
    if (opts.kinds !== undefined) qs.set('kinds', opts.kinds.join(','));
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    return this.request('GET', this.space(spaceId, `/search?${qs.toString()}`), routes.search.response);
  }

  /** A page request: newest by default, back from `beforeOffset`, forward from `afterOffset`, or landing around `aroundOffset` (at most one). */
  private windowQuery(opts?: MessageWindowOpts): string {
    const q = new URLSearchParams();
    if (opts?.beforeOffset !== undefined) q.set('beforeOffset', String(opts.beforeOffset));
    if (opts?.afterOffset !== undefined) q.set('afterOffset', String(opts.afterOffset));
    if (opts?.aroundOffset !== undefined) q.set('aroundOffset', String(opts.aroundOffset));
    if (opts?.limit !== undefined) q.set('limit', String(opts.limit));
    return q.size > 0 ? `?${q.toString()}` : '';
  }

  /** The stream (roots only), windowed newest-first: without beforeOffset the LATEST page — never the full history. */
  async listStream(
    spaceId: string,
    opts?: MessageWindowOpts,
  ): Promise<{ messages: Message[]; topics: Topic[]; hasMore: boolean; hasMoreAfter?: boolean; readOffset: number; events: StreamEvent[] }> {
    return this.request('GET', this.space(spaceId, `/stream${this.windowQuery(opts)}`), routes.listStream.response);
  }

  /** One flat thread: root + topic row (null = plain thread) + windowed replies. A reply id resolves to its root. */
  /** One message by id, folded — a reply carries its threadRoot. */
  async getMessage(spaceId: string, messageId: string): Promise<Message> {
    return (
      await this.request('GET', this.space(spaceId, `/messages/${encodeURIComponent(messageId)}`), routes.getMessage.response)
    ).message;
  }

  async listThread(
    spaceId: string,
    rootMessageId: string,
    opts?: MessageWindowOpts,
  ): Promise<{
    root: Message;
    topic: Topic | null;
    messages: Message[];
    hasMore: boolean;
    hasMoreAfter?: boolean;
    readOffset: number | null;
    following: boolean;
  }> {
    return this.request(
      'GET',
      this.space(spaceId, `/threads/${encodeURIComponent(rootMessageId)}${this.windowQuery(opts)}`),
      routes.listThread.response,
    );
  }

  // --- read state -----------------------------------------------------------
  // The org owns the cursors (offsets, per member); these are pass-throughs.

  /** Advance the stream mark (no threadRootId) or a followed thread's. Monotone; null = not following. */
  async markRead(spaceId: string, input: { threadRootId?: string; offset: number }): Promise<{ readOffset: number }> {
    return this.request('POST', this.space(spaceId, '/read'), routes.markRead.response, input);
  }

  async followThread(
    spaceId: string,
    rootMessageId: string,
    following: boolean,
  ): Promise<{ following: boolean; readOffset: number }> {
    return this.request(
      'POST',
      this.space(spaceId, `/threads/${encodeURIComponent(rootMessageId)}/follow`),
      routes.followThread.response,
      { following },
    );
  }

  /** The unread snapshot: every space with its cursor, unread roots, and unread followed threads. */
  async unread(): Promise<UnreadSnapshot> {
    return this.request('GET', routes.unread.path, routes.unread.response);
  }

  /** Activity: everything that involves the member, newest first, cursor paged (layer 3, 2026-09-10). */
  async activity(query: ActivityQueryInput = {}): Promise<ActivityPage> {
    const params = new URLSearchParams();
    if (query.kinds && query.kinds.length > 0) params.set('kinds', query.kinds.join(','));
    if (query.spaceId !== undefined) params.set('spaceId', query.spaceId);
    if (query.unread !== undefined) params.set('unread', String(query.unread));
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const qs = params.toString();
    return this.request('GET', `${routes.activity.path}${qs ? `?${qs}` : ''}`, routes.activity.response);
  }

  /** Reactions through `at` read as seen in Activity. Monotone. */
  async markActivitySeen(at: string): Promise<{ seenAt: string }> {
    return this.request('POST', routes.markActivitySeen.path, routes.markActivitySeen.response, { at });
  }

  async readAll(input: { spaceId?: string } = {}): Promise<{ spaces: Array<{ spaceId: string; readOffset: number }>; threads: number; seenAt: string }> {
    return this.request('POST', routes.readAll.path, routes.readAll.response, input);
  }

  /** A root (no threadRoot) or a reply (threadRoot) — never creates a topic. */
  async postMessage(spaceId: string, input: NewMessage): Promise<{ message: Message; invocations: Invocation[] }> {
    return this.request('POST', this.space(spaceId, '/messages'), routes.postMessage.response, input);
  }

  /** A space's agent invocations, newest first (api.ts listInvocations; one thread's with threadRootId). */
  async listInvocations(spaceId: string, threadRootId?: string): Promise<Invocation[]> {
    const q = threadRootId ? `?threadRootId=${encodeURIComponent(threadRootId)}` : '';
    return (await this.request('GET', this.space(spaceId, `/invocations${q}`), routes.listInvocations.response)).invocations;
  }

  /** Cancel a queued invocation, or stop a running one (api.ts cancelInvocation). */
  async cancelInvocation(invocationId: string): Promise<Invocation> {
    return (await this.request('POST', `/v1/invocations/${encodeURIComponent(invocationId)}/cancel`, routes.cancelInvocation.response)).invocation;
  }

  /** What an agent's connector declared, and the defaults its owner set for those options (api.ts getAgentCapabilities). */
  async getAgentCapabilities(agentId: string): Promise<{ capabilities: ConnectorCapabilities; defaults: InvocationOptionValues }> {
    return this.request('GET', `/v1/agents/${encodeURIComponent(agentId)}/capabilities`, routes.getAgentCapabilities.response);
  }

  /** Set an agent's option defaults: its owner only; `{}` clears them. */
  async setAgentOptionDefaults(agentId: string, defaults: InvocationOptionValues): Promise<InvocationOptionValues> {
    return (
      await this.request('PUT', `/v1/agents/${encodeURIComponent(agentId)}/option-defaults`, routes.setAgentOptionDefaults.response, { defaults })
    ).defaults;
  }

  /** The deliberate ceremony: promote a thread (rootMessageId) or post + annotate (body). */
  async createTopic(spaceId: string, input: CreateTopicInput): Promise<{ topic: Topic; rootMessage: Message }> {
    return this.request('POST', this.space(spaceId, '/topics'), routes.createTopic.response, input);
  }

  /** Author-only tombstone (idempotent). Returns the deleted message (body '', deletedAt set). */
  async deleteMessage(spaceId: string, messageId: string, input: DeleteMessageInput): Promise<Message> {
    return (
      await this.request(
        'POST',
        this.space(spaceId, `/messages/${encodeURIComponent(messageId)}/delete`),
        routes.deleteMessage.response,
        input,
      )
    ).message;
  }

  /** Author-only body rewrite (identical body = no-op). Returns the edited message. */
  async editMessage(spaceId: string, messageId: string, input: EditMessageInput): Promise<Message> {
    return (
      await this.request(
        'POST',
        this.space(spaceId, `/messages/${encodeURIComponent(messageId)}/edit`),
        routes.editMessage.response,
        input,
      )
    ).message;
  }

  /** Toggle a reaction (idempotent). Returns the message with reactions folded. */
  async reactToMessage(spaceId: string, messageId: string, input: ReactInput): Promise<Message> {
    return (
      await this.request(
        'POST',
        this.space(spaceId, `/messages/${encodeURIComponent(messageId)}/reactions`),
        routes.reactToMessage.response,
        input,
      )
    ).message;
  }

  /** Decide an agent's approval (spec §8 part 4): a person acting directly; the first decision wins. */
  async decideApproval(spaceId: string, approvalId: string, input: DecideApprovalInput): Promise<Approval> {
    return (
      await this.request('POST', this.space(spaceId, `/approvals/${encodeURIComponent(approvalId)}/decide`), routes.decideApproval.response, input)
    ).approval;
  }

  /** Toggle a poll vote (idempotent; single-select add moves the vote). Returns the message with votes folded. */
  async votePoll(spaceId: string, messageId: string, input: VotePollInput): Promise<Message> {
    return (
      await this.request(
        'POST',
        this.space(spaceId, `/messages/${encodeURIComponent(messageId)}/poll/votes`),
        routes.votePoll.response,
        input,
      )
    ).message;
  }

  /** End a poll early (author-only; idempotent once closed). Returns the message with endedAt set. */
  async endPoll(spaceId: string, messageId: string, input: EndPollInput): Promise<Message> {
    return (
      await this.request(
        'POST',
        this.space(spaceId, `/messages/${encodeURIComponent(messageId)}/poll/end`),
        routes.endPoll.response,
        input,
      )
    ).message;
  }

  async manageTopic(spaceId: string, topicId: string, action: ManageTopicAction): Promise<Topic> {
    return (
      await this.request(
        'POST',
        this.space(spaceId, `/topics/${encodeURIComponent(topicId)}`),
        routes.manageTopic.response,
        action,
      )
    ).topic;
  }
}
