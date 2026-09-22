import { Hono, type Context } from 'hono';
import { routes } from '@rowboat/spaces-protocol';
import type { z } from 'zod';
import { authenticateRequest, protectedResourceMetadata, wwwAuthenticate, type AuthIdentity, type OrgAuth } from './auth.js';
import { consentPageHtml } from './consent.js';
import { HarborError } from './errors.js';
import { publicOrigin } from './origin.js';
import type { HarborService } from './service.js';

// The render face: every route in the protocol's api.ts, nothing more. Bodies
// and queries are validated with the contract schemas; responses are validated
// too before they leave, so contract drift fails loudly in the stub instead of
// silently in a client.

type Env = { Variables: { memberId: string; identity?: AuthIdentity } };
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Uploads only (raw-bytes route). 100MB across the board — dogfood decision 2026-08-24. */
const DEFAULT_MAX_BLOB_BYTES = 100 * 1024 * 1024;

function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new HarborError('invalid_request', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return r.data;
}

async function body<S extends z.ZodType>(c: Context<Env>, schema: S): Promise<z.infer<S>> {
  const len = Number(c.req.header('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) throw new HarborError('payload_too_large', 'request body too large');
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HarborError('invalid_request', 'body is not valid JSON');
  }
  return parseWith(schema, raw);
}

/** Outbound contract check: the stub refuses to send a shape the schemas don't bless. */
function reply<S extends z.ZodType>(c: Context<Env>, schema: S, data: z.infer<S>) {
  const r = schema.safeParse(data);
  if (!r.success) throw new HarborError('internal', `response failed contract validation: ${r.error.message}`);
  return c.json(r.data as object);
}

function actor(c: Context<Env>): { memberId: string } {
  return { memberId: c.get('memberId') };
}

export function buildHttpApp(deps: {
  service: HarborService;
  auth: OrgAuth;
  /** Mounts the login/consent page (Supabase-flagship glue; consent.ts). */
  consent?: { issuer: string; publishableKey: string };
  /** Upload cap for the raw-bytes blob route (default 100MB). */
  maxBlobBytes?: number;
}): Hono<Env> {
  const { service, auth, consent } = deps;
  const maxBlobBytes = deps.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
  const app = new Hono<Env>();

  app.onError((err, c) => {
    const e = err instanceof HarborError ? err : new HarborError('internal', 'unexpected error');
    if (!(err instanceof HarborError)) console.error('[harbor] internal error:', err);
    // RFC 9728: 401s point clients at the resource metadata so any MCP-style
    // client can find the OAuth dance mechanically.
    if (e.code === 'unauthorized' && auth.metadata()) c.header('WWW-Authenticate', wwwAuthenticate(publicOrigin(c)));
    return c.json(e.toBody(), e.status as 400);
  });

  // RFC 9728 protected-resource metadata: the org names its authorization
  // server here (the org is only ever a resource server — spec §4). 404 under
  // the dev driver, which has no AS.
  app.get('/.well-known/oauth-protected-resource', (c) => {
    const meta = auth.metadata();
    if (!meta) throw new HarborError('not_found', 'no authorization server configured (dev auth)');
    return c.json(protectedResourceMetadata(publicOrigin(c), meta.authorizationServers));
  });

  // The human moment of the OAuth dance (pre-auth by nature — the person is
  // here to GET a session). The AS's authorize endpoint redirects browsers
  // here with an authorization_id.
  if (consent) {
    app.get('/oauth/consent', (c) =>
      c.html(consentPageHtml({ ...consent, orgName: service.org.name })),
    );
  }

  // Auth on everything under /v1 except pre-auth invite resolution (spec §4)
  // and the health probe. Accept-invite is the one route whose caller is
  // legitimately authenticated-but-not-yet-a-member: it gets the identity and
  // the handler runs the bind ceremony instead.
  app.use('/v1/*', async (c, next) => {
    if (c.req.path === routes.resolveInvite.path || c.req.path === '/v1/health') return next();
    const credentials = { authorization: c.req.header('authorization'), queryToken: new URL(c.req.url).searchParams.get('token') };
    if (c.req.path === routes.acceptInvite.path) {
      const { identity, member } = await authenticateRequest(auth, credentials, { allowUnmapped: true });
      c.set('identity', identity);
      if (member) c.set('memberId', member.id);
      return next();
    }
    c.set('memberId', (await authenticateRequest(auth, credentials)).member.id);
    return next();
  });

  app.get('/v1/health', (c) => c.json({ ok: true, org: { name: service.org.name, address: service.org.address } }));

  app.get(routes.me.path, async (c) => reply(c, routes.me.response, { member: await service.me(actor(c)) }));

  // --- spaces & membership ---------------------------------------------------

  app.get(routes.listSpaces.path, async (c) => {
    // Any present value counts as true (coerce semantics; clients send the flag only when they mean it).
    const q = parseWith(routes.listSpaces.query, {
      ...(c.req.query('includeDirect') !== undefined ? { includeDirect: c.req.query('includeDirect') } : {}),
    });
    const spaces = await service.listSpaces(actor(c), { includeDirect: q.includeDirect ?? false });
    return reply(c, routes.listSpaces.response, { spaces });
  });

  app.post(routes.createSpace.path, async (c) => {
    const input = await body(c, routes.createSpace.request);
    return reply(c, routes.createSpace.response, { space: await service.createSpace(actor(c), input.name) });
  });

  app.post('/v1/spaces/:spaceId/rename', async (c) => {
    const { spaceId } = parseWith(routes.renameSpace.params, c.req.param());
    const input = await body(c, routes.renameSpace.request);
    return reply(c, routes.renameSpace.response, { space: await service.renameSpace(actor(c), spaceId, input) });
  });

  app.post(routes.openDirect.path, async (c) => {
    const input = await body(c, routes.openDirect.request);
    return reply(c, routes.openDirect.response, await service.openDirect(actor(c), input.memberId));
  });

  app.post(routes.registerPush.path, async (c) => {
    const input = await body(c, routes.registerPush.request);
    return reply(c, routes.registerPush.response, await service.registerPush(actor(c), input));
  });

  app.post(routes.unregisterPush.path, async (c) => {
    const input = await body(c, routes.unregisterPush.request);
    return reply(c, routes.unregisterPush.response, await service.unregisterPush(actor(c), input));
  });

  app.get('/v1/spaces/:spaceId/members', async (c) => {
    const { spaceId } = parseWith(routes.listMembers.params, c.req.param());
    return reply(c, routes.listMembers.response, { members: await service.listMembers(actor(c), spaceId) });
  });

  app.get(routes.listOrgMembers.path, async (c) => {
    return reply(c, routes.listOrgMembers.response, { members: await service.listOrgMembers(actor(c)) });
  });

  app.post('/v1/spaces/:spaceId/leave', async (c) => {
    const { spaceId } = parseWith(routes.leaveSpace.params, c.req.param());
    await service.leaveSpace(actor(c), spaceId);
    return reply(c, routes.leaveSpace.response, { left: true });
  });

  // --- invites ---------------------------------------------------------------

  app.post(routes.createInvite.path, async (c) => {
    const input = await body(c, routes.createInvite.request);
    return reply(c, routes.createInvite.response, await service.createInvite(actor(c), input.spaceId, input.expiresInHours));
  });

  app.post(routes.resolveInvite.path, async (c) => {
    const input = await body(c, routes.resolveInvite.request);
    return reply(c, routes.resolveInvite.response, await service.resolveInvite(input.token));
  });

  app.post(routes.acceptInvite.path, async (c) => {
    const input = await body(c, routes.acceptInvite.request);
    // Existing member (dev driver, or a mapped identity joining another
    // space) → plain accept. Unmapped identity → the bind ceremony.
    const memberId = c.get('memberId');
    const result = memberId
      ? await service.acceptInvite({ memberId }, input.token)
      : await service.bindInvite(c.get('identity')!, input.token);
    return reply(c, routes.acceptInvite.response, result);
  });

  // The invite link's landing (2026-09-15): a browser-opened /join/<token>
  // hands the invite into the app as rowboat://open?type=spaces&org=…&invite=…
  // — the same deep-link grammar as the org link landings below, the org
  // named by its address — and shows what is being joined meanwhile (invite
  // resolution is pre-auth by design, spec §4). A dead invite says so and
  // launches nothing.
  app.get('/join/:token', async (c) => {
    const token = c.req.param('token');
    const resolved = await service.resolveInvite(token);
    if (resolved.state !== 'ok') return c.html(invitePage({ state: resolved.state }), 410);
    const deep = `rowboat://open?type=spaces&org=${encodeURIComponent(service.org.address)}&invite=${encodeURIComponent(token)}`;
    return c.html(invitePage({ state: 'ok', space: resolved.space.name, org: resolved.org.name, invitedBy: resolved.invitedBy, deep }));
  });

  // --- link landings ---------------------------------------------------------
  // Every org link (ids.ts grammar) opened in a browser lands here and is
  // handed into the app as a rowboat:// deep link, the org named by its
  // address. Nothing is looked up and nothing is rendered about the target,
  // so a link says nothing to someone who cannot open it. The app itself
  // intercepts these URLs before they ever reach a browser.
  const landing = (target: URLSearchParams) => {
    target.set('org', service.org.address);
    const deep = `rowboat://open?type=spaces&${target.toString()}`;
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open in Rowboat</title>` +
      `<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#222;background:#fafafa}` +
      `main{text-align:center;padding:2rem}a.b{display:inline-block;margin-top:1rem;padding:.6rem 1.1rem;border-radius:8px;background:#111;color:#fff;text-decoration:none}</style>` +
      `<main><p>This link opens in Rowboat.</p><a class="b" href="${deep}">Open in Rowboat</a></main>` +
      `<script>location.replace(${JSON.stringify(deep)})</script>`;
  };
  app.get('/', (c) => c.html(landing(new URLSearchParams())));
  app.get('/s/:spaceId', (c) => c.html(landing(new URLSearchParams({ spaceId: c.req.param('spaceId') }))));
  app.get('/s/:spaceId/m/:messageId', (c) =>
    c.html(landing(new URLSearchParams({ spaceId: c.req.param('spaceId'), messageId: c.req.param('messageId') }))),
  );
  app.get('/s/:spaceId/a/:assetId', (c) =>
    c.html(landing(new URLSearchParams({ spaceId: c.req.param('spaceId'), assetId: c.req.param('assetId') }))),
  );
  app.get('/u/:memberId', (c) => c.html(landing(new URLSearchParams({ memberId: c.req.param('memberId') }))));

  // --- assets ----------------------------------------------------------------

  app.get('/v1/spaces/:spaceId/assets', async (c) => {
    const { spaceId } = parseWith(routes.listAssets.params, c.req.param());
    // NOTE: any present value counts as true (z.coerce.boolean; clients send the flag only when they mean it).
    const q = parseWith(routes.listAssets.query, {
      ...(c.req.query('includeDeleted') !== undefined ? { includeDeleted: c.req.query('includeDeleted') } : {}),
    });
    const entries = await service.listAssets(actor(c), spaceId, q.includeDeleted ?? false);
    return reply(c, routes.listAssets.response, { entries });
  });

  app.post('/v1/spaces/:spaceId/assets', async (c) => {
    const { spaceId } = parseWith(routes.createAsset.params, c.req.param());
    const input = await body(c, routes.createAsset.request);
    return reply(c, routes.createAsset.response, await service.createAsset(actor(c), spaceId, input));
  });

  app.post('/v1/spaces/:spaceId/assets/move', async (c) => {
    const { spaceId } = parseWith(routes.moveAsset.params, c.req.param());
    const input = await body(c, routes.moveAsset.request);
    // 200 for both outcomes, conflict included (same posture as propose).
    return reply(c, routes.moveAsset.response, await service.moveAsset(actor(c), spaceId, input));
  });

  app.post('/v1/spaces/:spaceId/assets/delete', async (c) => {
    const { spaceId } = parseWith(routes.deleteAsset.params, c.req.param());
    const input = await body(c, routes.deleteAsset.request);
    return reply(c, routes.deleteAsset.response, await service.deleteAsset(actor(c), spaceId, input));
  });

  app.post('/v1/spaces/:spaceId/assets/restore', async (c) => {
    const { spaceId } = parseWith(routes.restoreAsset.params, c.req.param());
    const input = await body(c, routes.restoreAsset.request);
    return reply(c, routes.restoreAsset.response, await service.restoreAsset(actor(c), spaceId, input));
  });

  app.get('/v1/spaces/:spaceId/assets/:assetId', async (c) => {
    const { spaceId, assetId } = parseWith(routes.readAsset.params, c.req.param());
    const q = parseWith(routes.readAsset.query, {
      ...(c.req.query('version') !== undefined ? { version: c.req.query('version') } : {}),
    });
    return reply(c, routes.readAsset.response, await service.readAsset(actor(c), spaceId, assetId, q.version));
  });

  app.post('/v1/spaces/:spaceId/changes', async (c) => {
    const { spaceId } = parseWith(routes.proposeChange.params, c.req.param());
    const input = await body(c, routes.proposeChange.request);
    // 200 for all three outcomes, conflict included (CONTRACT.md decision 6).
    return reply(c, routes.proposeChange.response, await service.proposeChange(actor(c), spaceId, input));
  });

  app.get('/v1/spaces/:spaceId/history', async (c) => {
    const { spaceId } = parseWith(routes.assetHistory.params, c.req.param());
    const q = parseWith(routes.assetHistory.query, {
      ...(c.req.query('assetId') !== undefined ? { assetId: c.req.query('assetId') } : {}),
      ...(c.req.query('beforeOffset') !== undefined ? { beforeOffset: c.req.query('beforeOffset') } : {}),
      ...(c.req.query('limit') !== undefined ? { limit: c.req.query('limit') } : {}),
    });
    const changeSets = await service.assetHistory(actor(c), spaceId, q);
    return reply(c, routes.assetHistory.response, { changeSets });
  });

  app.get('/v1/spaces/:spaceId/diff', async (c) => {
    const { spaceId } = parseWith(routes.diff.params, c.req.param());
    const q = parseWith(routes.diff.query, {
      assetId: c.req.query('assetId'),
      from: c.req.query('from'),
      to: c.req.query('to'),
    });
    const unified = await service.diff(actor(c), spaceId, q.assetId, q.from, q.to);
    return reply(c, routes.diff.response, { unified });
  });

  // --- blobs -----------------------------------------------------------------

  // Phase 1 of every upload: raw bytes in, {hash, size, mime} out (spec §6).
  // The x-blob-sha256 header is the client's claim of the address; the service
  // recomputes and refuses a mismatch, so a truncated body can't be stored.
  app.put('/v1/spaces/:spaceId/blobs', async (c) => {
    const { spaceId } = parseWith(routes.uploadBlob.params, c.req.param());
    const declared = c.req.header('x-blob-sha256')?.toLowerCase();
    if (!declared || !/^[0-9a-f]{64}$/.test(declared)) {
      throw new HarborError('invalid_request', 'x-blob-sha256 header (sha256 hex of the body) is required');
    }
    const claimedLen = Number(c.req.header('content-length') ?? '0');
    if (claimedLen > maxBlobBytes) {
      throw new HarborError('payload_too_large', `blob exceeds the ${maxBlobBytes}-byte upload limit`);
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > maxBlobBytes) {
      throw new HarborError('payload_too_large', `blob exceeds the ${maxBlobBytes}-byte upload limit`);
    }
    const blob = await service.uploadBlob(actor(c), spaceId, bytes, {
      declaredSha256: declared,
      ...(c.req.header('content-type') ? { declaredMime: c.req.header('content-type') } : {}),
    });
    return reply(c, routes.uploadBlob.response, { blob });
  });

  // The bytes back: 302 to a presigned URL (S3-family drivers) or a direct
  // stream (disk/memory). Immutable by address → cache forever, privately.
  app.get('/v1/spaces/:spaceId/blobs/:hash', async (c) => {
    const { spaceId, hash } = parseWith(routes.getBlob.params, c.req.param());
    const q = parseWith(routes.getBlob.query, {
      ...(c.req.query('name') !== undefined ? { name: c.req.query('name') } : {}),
    });
    const result = await service.downloadBlob(actor(c), spaceId, hash, q.name);
    if (result.url) {
      // Do not cache the redirect itself beyond the presign window.
      c.header('cache-control', 'private, max-age=240');
      return c.redirect(result.url, 302);
    }
    c.header('content-type', result.blob.mime);
    c.header('content-length', String(result.blob.size));
    c.header('content-disposition', result.disposition);
    c.header('cache-control', 'private, max-age=31536000, immutable');
    c.header('x-content-type-options', 'nosniff');
    c.header('content-security-policy', "default-src 'none'");
    const bytes = result.bytes!;
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  });

  // --- feed ------------------------------------------------------------------

  app.get('/v1/spaces/:spaceId/topics', async (c) => {
    const { spaceId } = parseWith(routes.listTopics.params, c.req.param());
    // NOTE: any present value counts as true (z.coerce.boolean coerces "false" to true;
    // clients send the flag only when they mean it).
    const q = parseWith(routes.listTopics.query, {
      ...(c.req.query('includeArchived') !== undefined ? { includeArchived: c.req.query('includeArchived') } : {}),
    });
    const topics = await service.listTopics(actor(c), spaceId, q.includeArchived ?? false);
    return reply(c, routes.listTopics.response, { topics });
  });

  app.get('/v1/spaces/:spaceId/search', async (c) => {
    const { spaceId } = parseWith(routes.search.params, c.req.param());
    const q = parseWith(routes.search.query, {
      q: c.req.query('q'),
      ...(c.req.query('kinds') !== undefined ? { kinds: c.req.query('kinds') } : {}),
      ...(c.req.query('limit') !== undefined ? { limit: c.req.query('limit') } : {}),
    });
    const results = await service.search(actor(c), spaceId, q.q, {
      ...(q.kinds !== undefined ? { kinds: q.kinds } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    return reply(c, routes.search.response, results);
  });

  app.get('/v1/spaces/:spaceId/stream', async (c) => {
    const { spaceId } = parseWith(routes.listStream.params, c.req.param());
    const q = parseWith(routes.listStream.query, {
      ...(c.req.query('beforeOffset') !== undefined ? { beforeOffset: c.req.query('beforeOffset') } : {}),
      ...(c.req.query('afterOffset') !== undefined ? { afterOffset: c.req.query('afterOffset') } : {}),
      ...(c.req.query('aroundOffset') !== undefined ? { aroundOffset: c.req.query('aroundOffset') } : {}),
      ...(c.req.query('limit') !== undefined ? { limit: c.req.query('limit') } : {}),
    });
    return reply(c, routes.listStream.response, await service.listStream(actor(c), spaceId, q));
  });

  app.get('/v1/spaces/:spaceId/messages/:messageId', async (c) => {
    const { spaceId, messageId } = parseWith(routes.getMessage.params, c.req.param());
    return reply(c, routes.getMessage.response, { message: await service.getMessage(actor(c), spaceId, messageId) });
  });

  app.get('/v1/spaces/:spaceId/threads/:rootMessageId', async (c) => {
    const { spaceId, rootMessageId } = parseWith(routes.listThread.params, c.req.param());
    const q = parseWith(routes.listThread.query, {
      ...(c.req.query('beforeOffset') !== undefined ? { beforeOffset: c.req.query('beforeOffset') } : {}),
      ...(c.req.query('afterOffset') !== undefined ? { afterOffset: c.req.query('afterOffset') } : {}),
      ...(c.req.query('aroundOffset') !== undefined ? { aroundOffset: c.req.query('aroundOffset') } : {}),
      ...(c.req.query('limit') !== undefined ? { limit: c.req.query('limit') } : {}),
    });
    return reply(c, routes.listThread.response, await service.listThread(actor(c), spaceId, rootMessageId, q));
  });

  app.post('/v1/spaces/:spaceId/topics', async (c) => {
    const { spaceId } = parseWith(routes.createTopic.params, c.req.param());
    const input = await body(c, routes.createTopic.request);
    return reply(c, routes.createTopic.response, await service.createTopic(actor(c), spaceId, input));
  });

  app.post('/v1/spaces/:spaceId/messages', async (c) => {
    const { spaceId } = parseWith(routes.postMessage.params, c.req.param());
    const input = await body(c, routes.postMessage.request);
    return reply(c, routes.postMessage.response, await service.postMessage(actor(c), spaceId, input));
  });

  app.post('/v1/spaces/:spaceId/messages/:messageId/delete', async (c) => {
    const { spaceId, messageId } = parseWith(routes.deleteMessage.params, c.req.param());
    const input = await body(c, routes.deleteMessage.request);
    const message = await service.deleteMessage(actor(c), spaceId, messageId, input);
    return reply(c, routes.deleteMessage.response, { message });
  });

  app.post('/v1/spaces/:spaceId/messages/:messageId/edit', async (c) => {
    const { spaceId, messageId } = parseWith(routes.editMessage.params, c.req.param());
    const input = await body(c, routes.editMessage.request);
    const message = await service.editMessage(actor(c), spaceId, messageId, input);
    return reply(c, routes.editMessage.response, { message });
  });

  app.post('/v1/spaces/:spaceId/messages/:messageId/reactions', async (c) => {
    const { spaceId, messageId } = parseWith(routes.reactToMessage.params, c.req.param());
    const input = await body(c, routes.reactToMessage.request);
    const message = await service.reactToMessage(actor(c), spaceId, messageId, input);
    return reply(c, routes.reactToMessage.response, { message });
  });

  app.post('/v1/spaces/:spaceId/messages/:messageId/poll/votes', async (c) => {
    const { spaceId, messageId } = parseWith(routes.votePoll.params, c.req.param());
    const input = await body(c, routes.votePoll.request);
    const message = await service.votePoll(actor(c), spaceId, messageId, input);
    return reply(c, routes.votePoll.response, { message });
  });

  app.post('/v1/spaces/:spaceId/messages/:messageId/poll/end', async (c) => {
    const { spaceId, messageId } = parseWith(routes.endPoll.params, c.req.param());
    const input = await body(c, routes.endPoll.request);
    const message = await service.endPoll(actor(c), spaceId, messageId, input);
    return reply(c, routes.endPoll.response, { message });
  });

  app.post('/v1/spaces/:spaceId/topics/:topicId', async (c) => {
    const { spaceId, topicId } = parseWith(routes.manageTopic.params, c.req.param());
    const input = await body(c, routes.manageTopic.request);
    const topic = await service.manageTopic(actor(c), spaceId, topicId, input);
    return reply(c, routes.manageTopic.response, { topic });
  });

  // --- read state ------------------------------------------------------------

  app.post('/v1/spaces/:spaceId/read', async (c) => {
    const { spaceId } = parseWith(routes.markRead.params, c.req.param());
    const input = await body(c, routes.markRead.request);
    return reply(c, routes.markRead.response, await service.markRead(actor(c), spaceId, input));
  });

  app.post('/v1/spaces/:spaceId/threads/:rootMessageId/follow', async (c) => {
    const { spaceId, rootMessageId } = parseWith(routes.followThread.params, c.req.param());
    const input = await body(c, routes.followThread.request);
    return reply(
      c,
      routes.followThread.response,
      await service.followThread(actor(c), spaceId, rootMessageId, input.following),
    );
  });

  app.get(routes.unread.path, async (c) => reply(c, routes.unread.response, await service.unread(actor(c))));

  app.get(routes.activity.path, async (c) => {
    const q = parseWith(routes.activity.query, {
      ...(c.req.query('kinds') !== undefined ? { kinds: c.req.query('kinds') } : {}),
      ...(c.req.query('spaceId') !== undefined ? { spaceId: c.req.query('spaceId') } : {}),
      ...(c.req.query('unread') !== undefined ? { unread: c.req.query('unread') } : {}),
      ...(c.req.query('cursor') !== undefined ? { cursor: c.req.query('cursor') } : {}),
      ...(c.req.query('limit') !== undefined ? { limit: c.req.query('limit') } : {}),
    });
    return reply(c, routes.activity.response, await service.activity(actor(c), q));
  });
  app.post(routes.markActivitySeen.path, async (c) => {
    const input = await body(c, routes.markActivitySeen.request);
    return reply(c, routes.markActivitySeen.response, await service.markActivitySeen(actor(c), input.at));
  });
  app.post(routes.readAll.path, async (c) => {
    const input = await body(c, routes.readAll.request);
    return reply(c, routes.readAll.response, await service.readAll(actor(c), input));
  });

  return app;
}

const DOWNLOAD_URL = 'https://github.com/rowboatlabs/rowboat/releases/latest';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

type InvitePage =
  | { state: 'ok'; space: string; org: string; invitedBy?: string; deep: string }
  | { state: 'expired' | 'revoked' };

/** The /join landing: launch the app with the invite, or say why not. */
function invitePage(page: InvitePage): string {
  const style =
    `<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#222;background:#fafafa}` +
    `main{text-align:center;padding:2rem;max-width:26rem}h1{font-size:1.25rem;margin:0 0 .25rem}p{margin:.25rem 0}.m{color:#666}` +
    `a.b{display:inline-block;margin-top:1rem;padding:.6rem 1.1rem;border-radius:8px;background:#111;color:#fff;text-decoration:none}` +
    `.s{margin-top:1.25rem;font-size:13px;color:#666}.s a{color:inherit}</style>`;
  const head = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">`;
  if (page.state !== 'ok') {
    const why = page.state === 'expired' ? 'This invite has expired.' : 'This invite was revoked.';
    return `${head}<title>Invite ${page.state}</title>${style}<main><h1>${why}</h1><p class="m">Ask whoever sent it for a new link.</p></main>`;
  }
  const by = page.invitedBy ? `<p class="m">Invited by ${escapeHtml(page.invitedBy)}</p>` : '';
  return (
    `${head}<title>Join ${escapeHtml(page.space)} on ${escapeHtml(page.org)}</title>${style}<main>` +
    `<h1>You're invited to ${escapeHtml(page.space)}</h1><p class="m">on ${escapeHtml(page.org)}</p>${by}` +
    `<a class="b" href="${page.deep}">Open in Rowboat</a>` +
    `<p class="s">Don't have Rowboat? <a href="${DOWNLOAD_URL}">Download it</a>, then open this link again.</p></main>` +
    `<script>location.replace(${JSON.stringify(page.deep)})</script>`
  );
}
