import { Hono, type Context } from 'hono';
import { routes } from '@rowboat/spaces-protocol';
import type { z } from 'zod';
import type { AuthDriver, AuthIdentity } from './auth.js';
import { consentPageHtml } from './consent.js';
import { HarborError } from './errors.js';
import { publicOrigin } from './origin.js';
import type { HarborService } from './service.js';
import type { Store } from './store.js';

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
  store: Store;
  auth: AuthDriver;
  /** Mounts the login/consent page (Supabase-flagship glue; consent.ts). */
  consent?: { issuer: string; publishableKey: string };
  /** Upload cap for the raw-bytes blob route (default 100MB). */
  maxBlobBytes?: number;
}): Hono<Env> {
  const { service, store, auth, consent } = deps;
  const maxBlobBytes = deps.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
  const app = new Hono<Env>();

  app.onError((err, c) => {
    const e = err instanceof HarborError ? err : new HarborError('internal', 'unexpected error');
    if (!(err instanceof HarborError)) console.error('[harbor] internal error:', err);
    // RFC 9728: 401s point clients at the resource metadata so any MCP-style
    // client can find the OAuth dance mechanically.
    if (e.code === 'unauthorized' && auth.metadata?.()) {
      const origin = publicOrigin(c);
      c.header('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
    }
    return c.json(e.toBody(), e.status as 400);
  });

  // RFC 9728 protected-resource metadata: the org names its authorization
  // server here (the org is only ever a resource server — spec §4). 404 under
  // the dev driver, which has no AS.
  app.get('/.well-known/oauth-protected-resource', (c) => {
    const meta = auth.metadata?.();
    if (!meta) throw new HarborError('not_found', 'no authorization server configured (dev auth)');
    const origin = publicOrigin(c);
    return c.json({
      resource: origin,
      authorization_servers: meta.authorizationServers,
      bearer_methods_supported: ['header'],
    });
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
    const identity = await auth.authenticate(c.req.header('authorization'), new URL(c.req.url).searchParams.get('token'));
    if (c.req.path === routes.acceptInvite.path) {
      c.set('identity', identity);
      try {
        c.set('memberId', (await auth.resolveMember(store, identity)).id);
      } catch (err) {
        if (!(err instanceof HarborError) || err.code !== 'not_a_member') throw err;
      }
      return next();
    }
    const member = await auth.resolveMember(store, identity);
    c.set('memberId', member.id);
    return next();
  });

  app.get('/v1/health', (c) => c.json({ ok: true, org: { name: service.org.name, address: service.org.address } }));

  app.get(routes.me.path, async (c) => {
    const member = await store.getMember(c.get('memberId'));
    if (!member) throw new HarborError('not_found', 'member not found');
    return reply(c, routes.me.response, { member });
  });

  // --- spaces & membership ---------------------------------------------------

  app.get(routes.listSpaces.path, async (c) =>
    reply(c, routes.listSpaces.response, { spaces: await service.listSpaces(actor(c)) }),
  );

  app.post(routes.createSpace.path, async (c) => {
    const input = await body(c, routes.createSpace.request);
    return reply(c, routes.createSpace.response, { space: await service.createSpace(actor(c), input.name) });
  });

  app.get('/v1/spaces/:spaceId/members', async (c) => {
    const { spaceId } = parseWith(routes.listMembers.params, c.req.param());
    return reply(c, routes.listMembers.response, { members: await service.listMembers(actor(c), spaceId) });
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

  // Human-shareable invite link target. The app intercepts these URLs; anyone
  // else gets a plain page naming the space (resolution is pre-auth by design).
  app.get('/join/:token', async (c) => {
    const resolved = await service.resolveInvite(c.req.param('token'));
    if (resolved.state !== 'ok') return c.text(`This invite is ${resolved.state}.`, 410);
    const by = resolved.invitedBy ? ` by ${resolved.invitedBy}` : '';
    return c.text(
      `You're invited${by} to the space "${resolved.space.name}" on ${resolved.org.name}.\n` +
        `Open this link in Rowboat to join.\n`,
    );
  });

  // --- assets ----------------------------------------------------------------

  app.get('/v1/spaces/:spaceId/assets', async (c) => {
    const { spaceId } = parseWith(routes.listAssets.params, c.req.param());
    const entries = await service.listAssets(actor(c), spaceId);
    return reply(c, routes.listAssets.response, { entries });
  });

  app.get('/v1/spaces/:spaceId/asset', async (c) => {
    const { spaceId } = parseWith(routes.readAsset.params, c.req.param());
    const q = parseWith(routes.readAsset.query, {
      path: c.req.query('path'),
      ...(c.req.query('version') !== undefined ? { version: c.req.query('version') } : {}),
    });
    return reply(c, routes.readAsset.response, await service.readAsset(actor(c), spaceId, q.path, q.version));
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
      ...(c.req.query('path') !== undefined ? { path: c.req.query('path') } : {}),
      ...(c.req.query('beforeOffset') !== undefined ? { beforeOffset: c.req.query('beforeOffset') } : {}),
      ...(c.req.query('limit') !== undefined ? { limit: c.req.query('limit') } : {}),
    });
    const changeSets = await service.assetHistory(actor(c), spaceId, q);
    return reply(c, routes.assetHistory.response, { changeSets });
  });

  app.get('/v1/spaces/:spaceId/diff', async (c) => {
    const { spaceId } = parseWith(routes.diff.params, c.req.param());
    const q = parseWith(routes.diff.query, {
      path: c.req.query('path'),
      from: c.req.query('from'),
      to: c.req.query('to'),
    });
    const unified = await service.diff(actor(c), spaceId, q.path, q.from, q.to);
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

  app.get('/v1/spaces/:spaceId/topics/:topicId/messages', async (c) => {
    const { spaceId, topicId } = parseWith(routes.listMessages.params, c.req.param());
    return reply(c, routes.listMessages.response, await service.listMessages(actor(c), spaceId, topicId));
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

  app.post('/v1/spaces/:spaceId/messages/:messageId/reactions', async (c) => {
    const { spaceId, messageId } = parseWith(routes.reactToMessage.params, c.req.param());
    const input = await body(c, routes.reactToMessage.request);
    const message = await service.reactToMessage(actor(c), spaceId, messageId, input);
    return reply(c, routes.reactToMessage.response, { message });
  });

  app.post('/v1/spaces/:spaceId/topics/:topicId', async (c) => {
    const { spaceId, topicId } = parseWith(routes.manageTopic.params, c.req.param());
    const input = await body(c, routes.manageTopic.request);
    const topic = await service.manageTopic(actor(c), spaceId, topicId, input);
    return reply(c, routes.manageTopic.response, { topic });
  });

  return app;
}
