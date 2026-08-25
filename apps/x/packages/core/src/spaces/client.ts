import { createHash } from 'node:crypto';
import {
  routes,
  type AcceptInviteResult,
  type BlobInfo,
  type ChangeSet,
  type DeleteAssetResult,
  type CreateInviteResult,
  type Member,
  type Message,
  type MoveAssetResult,
  type ProposeChange,
  type ProposeChangeResult,
  type ReadAssetResult,
  type ResolveInviteResult,
  type RestoreAssetResult,
  type Routes,
  type Space,
  type Topic,
  type TopicListing,
} from '@rowboat/spaces-protocol';
import type { z } from 'zod';

// Typed client for one org's render face. Thin by design: every method is one
// route from the protocol's api.ts, request/response validated with the
// contract schemas — the same drift tripwire the stub server runs, from the
// other side of the wire.

export interface SpacesApiError {
  code: string;
  message: string;
  retryable: boolean;
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

export interface SpacesClientOptions {
  /** e.g. http://localhost:4272 — scheme + host[:port], no trailing slash. */
  baseUrl: string;
  /** Static bearer (dev tokens, tests) or a provider (OAuth orgs — always fresh). */
  token: string | SpacesTokenProvider;
  fetchImpl?: typeof fetch;
}

type NewTopicMessage = z.infer<Routes['postMessage']['request']>;
type ManageTopicAction = z.infer<Routes['manageTopic']['request']>;
type ReactInput = z.infer<Routes['reactToMessage']['request']>;
type DeleteMessageInput = z.infer<Routes['deleteMessage']['request']>;

export class SpacesClient {
  private readonly baseUrl: string;
  private readonly token: string | SpacesTokenProvider;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SpacesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async currentToken(opts?: { forceRefresh?: boolean }): Promise<string> {
    return typeof this.token === 'string' ? this.token : this.token(opts);
  }

  private async request<S extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    responseSchema: S,
    body?: unknown,
    auth = true,
  ): Promise<z.infer<S>> {
    const send = async (token: string | undefined) =>
      this.fetchImpl(`${this.baseUrl}${path}`, {
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
    const res = await this.fetchImpl(`${this.baseUrl}/v1/health`);
    if (!res.ok) throw new SpacesRequestError(res.status, { code: 'internal', message: 'health check failed', retryable: true });
    return (await res.json()) as { ok: boolean; org: { name: string; address: string } };
  }

  // --- identity -------------------------------------------------------------

  /** Who this token is on the org — the only client-side source of our memberId under OAuth. */
  async me(): Promise<{ member: Member }> {
    return this.request('GET', routes.me.path, routes.me.response);
  }

  // --- spaces & membership --------------------------------------------------

  async listSpaces(): Promise<Space[]> {
    return (await this.request('GET', routes.listSpaces.path, routes.listSpaces.response)).spaces;
  }

  async createSpace(name: string): Promise<Space> {
    return (await this.request('POST', routes.createSpace.path, routes.createSpace.response, { name })).space;
  }

  async listMembers(spaceId: string): Promise<Member[]> {
    return (await this.request('GET', this.space(spaceId, '/members'), routes.listMembers.response)).members;
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

  async listAssets(
    spaceId: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<Array<{ path: string; version: number; updatedAt: string; blob?: BlobInfo; state?: 'deleted' }>> {
    const qs = opts.includeDeleted ? '?includeDeleted=true' : '';
    return (await this.request('GET', this.space(spaceId, `/assets${qs}`), routes.listAssets.response)).entries;
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

  async readAsset(spaceId: string, path: string, version?: number): Promise<ReadAssetResult> {
    const q = new URLSearchParams({ path, ...(version !== undefined ? { version: String(version) } : {}) });
    return this.request('GET', this.space(spaceId, `/asset?${q}`), routes.readAsset.response);
  }

  /** All three outcomes come back as values — a conflict is a result, not an exception. */
  async proposeChange(spaceId: string, input: ProposeChange): Promise<ProposeChangeResult> {
    return this.request('POST', this.space(spaceId, '/changes'), routes.proposeChange.response, input);
  }

  async assetHistory(
    spaceId: string,
    opts: { path?: string; beforeOffset?: number; limit?: number } = {},
  ): Promise<ChangeSet[]> {
    const q = new URLSearchParams();
    if (opts.path !== undefined) q.set('path', opts.path);
    if (opts.beforeOffset !== undefined) q.set('beforeOffset', String(opts.beforeOffset));
    if (opts.limit !== undefined) q.set('limit', String(opts.limit));
    const qs = q.size > 0 ? `?${q}` : '';
    return (await this.request('GET', this.space(spaceId, `/history${qs}`), routes.assetHistory.response)).changeSets;
  }

  async diff(spaceId: string, path: string, from: number, to: number): Promise<string> {
    const q = new URLSearchParams({ path, from: String(from), to: String(to) });
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
    const hash = createHash('sha256').update(bytes).digest('hex');
    const send = async (token: string) =>
      this.fetchImpl(`${this.baseUrl}${this.space(spaceId, '/blobs')}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'x-blob-sha256': hash,
          ...(opts.declaredMime ? { 'content-type': opts.declaredMime } : {}),
        },
        body: bytes as unknown as BodyInit,
      });
    let res = await send(await this.currentToken());
    if (res.status === 401 && typeof this.token !== 'string') {
      res = await send(await this.currentToken({ forceRefresh: true }));
    }
    const json = (await res.json().catch(() => undefined)) as unknown;
    if (!res.ok) {
      const parsed = (json ?? {}) as Partial<SpacesApiError>;
      throw new SpacesRequestError(res.status, {
        code: parsed.code ?? 'internal',
        message: parsed.message ?? `upload failed with ${res.status}`,
        retryable: parsed.retryable ?? false,
      });
    }
    const result = routes.uploadBlob.response.safeParse(json);
    if (!result.success) {
      throw new SpacesRequestError(res.status, {
        code: 'internal',
        message: `response failed contract validation: ${result.error.message}`,
        retryable: false,
      });
    }
    return result.data.blob;
  }

  /**
   * The bytes back. The org either streams or 302s to a presigned URL; fetch
   * follows the redirect, so this client never knows which driver served it.
   */
  async fetchBlob(spaceId: string, hash: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const send = async (token: string) =>
      this.fetchImpl(`${this.baseUrl}${this.space(spaceId, `/blobs/${hash}`)}`, {
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

  /** Windowed, newest-first: without beforeOffset the LATEST page — never the full history. */
  async listMessages(
    spaceId: string,
    topicId: string,
    opts?: { beforeOffset?: number; limit?: number },
  ): Promise<{ topic: Topic; messages: Message[]; hasMore: boolean }> {
    const q = new URLSearchParams();
    if (opts?.beforeOffset !== undefined) q.set('beforeOffset', String(opts.beforeOffset));
    if (opts?.limit !== undefined) q.set('limit', String(opts.limit));
    const qs = q.size > 0 ? `?${q.toString()}` : '';
    return this.request(
      'GET',
      this.space(spaceId, `/topics/${encodeURIComponent(topicId)}/messages${qs}`),
      routes.listMessages.response,
    );
  }

  async postMessage(spaceId: string, input: NewTopicMessage): Promise<{ topic: Topic; message: Message }> {
    return this.request('POST', this.space(spaceId, '/messages'), routes.postMessage.response, input);
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
