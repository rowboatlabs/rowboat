import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OidcAuthDriver } from '../src/auth-oidc.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { agentClient, callStructured, liveClient, restClient, startFakeAs, type FakeAs } from './helpers.js';

// The oidc driver against a local fake AS (helpers.ts): RFC 8414 discovery +
// JWKS + JWTs we mint ourselves, so CI never needs a real IdP. (jose's
// refetch-on-unknown-kid key rotation is library behavior, deliberately not
// re-tested here.) The live E2E against a real Supabase stack is a manual
// step, per the OAuth plan.

describe('oidc auth driver', () => {
  let as: FakeAs;
  let harbor: RunningHarbor;

  beforeAll(async () => {
    as = await startFakeAs();
    harbor = await startHarbor({
      auth: new OidcAuthDriver({ issuer: as.issuer }),
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'harsh', displayName: 'Harsh' },
      ],
      seedSpaces: [{ name: 'Roadboard', creator: 'ramnique' }],
    });
    // Stand-in for the invite ceremony (not built yet): map identities directly.
    await harbor.store.putIdentity(as.issuer, 'sub-ramnique', 'ramnique');
  });

  afterAll(async () => {
    await harbor.close();
    await new Promise<void>((resolve) => as.server.close(() => resolve()));
  });

  it('serves RFC 9728 protected-resource metadata naming the AS', async () => {
    const res = await fetch(`${harbor.url}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { resource: string; authorization_servers: string[] };
    expect(meta.authorization_servers).toEqual([as.issuer]);
  });

  it('does NOT serve resource metadata under the dev driver', async () => {
    const dev = await startHarbor({});
    const res = await fetch(`${dev.url}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(404);
    await dev.close();
  });

  it('valid token + mapped identity → the member, on the render face', async () => {
    const rest = restClient(harbor, await as.mint({}));
    const spaces = await rest.get('/v1/spaces');
    expect(spaces.status).toBe(200);
    expect(spaces.body.spaces.map((s: { name: string }) => s.name)).toEqual(['Roadboard']);
  });

  it('valid token with an UNMAPPED identity → 403 not_a_member (never auto-creates)', async () => {
    const rest = restClient(harbor, await as.mint({ sub: 'sub-stranger' }));
    const res = await rest.get('/v1/spaces');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_a_member');
    expect(await harbor.store.getMemberByIdentity(as.issuer, 'sub-stranger')).toBeUndefined();
  });

  it('expired token → 401', async () => {
    const rest = restClient(harbor, await as.mint({ exp: Math.floor(Date.now() / 1000) - 60 }));
    const res = await rest.get('/v1/spaces');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('wrong issuer → 401 (issuer is pinned)', async () => {
    const rest = restClient(harbor, await as.mint({ iss: 'http://evil.example' }));
    const res = await rest.get('/v1/spaces');
    expect(res.status).toBe(401);
  });

  it('garbage token → 401 with WWW-Authenticate pointing at resource metadata', async () => {
    const res = await fetch(`${harbor.url}/v1/spaces`, { headers: { authorization: 'Bearer nonsense' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource');
  });

  it('MCP face: attribution lands on the MAPPED member, not the raw sub', async () => {
    const agent = await agentClient(harbor, await as.mint({}), { agentName: 'Test Agent' });
    const listed = await callStructured<{ spaces: Array<{ id: string; name: string }> }>(agent, 'list_spaces', {});
    const spaceId = listed.spaces[0]!.id;
    const posted = await callStructured<{ messageId: string }>(agent, 'post_message', {
      spaceId,
      body: 'hello from oidc',
    });
    const thread = await callStructured<{
      root: { author: { memberId: string; agentName?: string } };
    }>(agent, 'read_thread', { spaceId, rootMessageId: posted.messageId });
    expect(thread.root.author.memberId).toBe('ramnique');
    expect(thread.root.author.agentName).toBe('Test Agent');
    await agent.close();
  });

  it('MCP face: 401 carries WWW-Authenticate for MCP-client discovery', async () => {
    const res = await fetch(harbor.mcpUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer nonsense', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource');
  });

  it('live face: JWT via query token subscribes and receives frames', async () => {
    const spaces = await harbor.service.listSpaces({ memberId: 'ramnique' });
    const live = await liveClient(harbor, await as.mint({}));
    live.send({ kind: 'subscribe', spaceId: spaces[0]!.id });
    await live.until((f) => f.some((x) => x.kind === 'subscribed'), 'subscribed frame');
    live.close();
  });

  it('live face: unmapped identity is rejected at upgrade', async () => {
    await expect(liveClient(harbor, await as.mint({ sub: 'sub-stranger' }))).rejects.toThrow(/403/);
  });

  it('live face: bad token is rejected at upgrade', async () => {
    await expect(liveClient(harbor, 'nonsense')).rejects.toThrow(/401/);
  });
});

describe('invite-binding ceremony', () => {
  let as: FakeAs;

  beforeAll(async () => {
    as = await startFakeAs();
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => as.server.close(() => resolve()));
  });

  it('walks a newcomer from not_a_member to member: resolve → accept binds (iss,sub) → tokens work', async () => {
    const harbor = await startHarbor({
      auth: new OidcAuthDriver({ issuer: as.issuer }),
      seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
      seedSpaces: [{ name: 'Roadboard', creator: 'ramnique' }],
    });
    const spaces = await harbor.service.listSpaces({ memberId: 'ramnique' });
    const invite = await harbor.service.createInvite({ memberId: 'ramnique' }, spaces[0]!.id);
    const token = await as.mint({ sub: 'sub-harsh', email: 'harsh@rowboatlabs.com', name: 'Harsh Vardhan' });
    const rest = restClient(harbor, token);

    // Before: valid token, no member.
    expect((await rest.get('/v1/spaces')).status).toBe(403);
    // Resolve is pre-auth and shows what's being joined.
    const resolved = await fetch(`${harbor.url}/v1/invites/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: invite.token }),
    });
    expect(((await resolved.json()) as { space: { name: string } }).space.name).toBe('Roadboard');

    // The bind: member created, displayName from the IdP profile, role member.
    const accepted = await rest.post('/v1/invites/accept', { token: invite.token });
    expect(accepted.status).toBe(200);
    const memberId = accepted.body.membership.memberId as string;
    expect(memberId).not.toBe('sub-harsh'); // minted id, sub lives only in the mapping
    const member = await harbor.store.getMember(memberId);
    expect(member).toMatchObject({ displayName: 'Harsh Vardhan', role: 'member' });
    expect((await harbor.store.getMemberByIdentity(as.issuer, 'sub-harsh'))?.id).toBe(memberId);

    // After: the same token works; /v1/me answers who the identity became;
    // accepting again is idempotent; the seed creator carries the admin bit.
    expect((await rest.get('/v1/spaces')).status).toBe(200);
    expect((await rest.get('/v1/me')).body.member.id).toBe(memberId);
    const again = await rest.post('/v1/invites/accept', { token: invite.token });
    expect(again.body.membership.memberId).toBe(memberId);
    const members = (await rest.get(`/v1/spaces/${spaces[0]!.id}/members`)).body.members as Array<{
      id: string;
      role: string;
    }>;
    expect(members.find((m) => m.id === 'ramnique')?.role).toBe('admin');
    expect(members.find((m) => m.id === memberId)?.role).toBe('member');
    await harbor.close();
  });

  it('a mapped member accepting a second space reuses the member, adds a membership', async () => {
    const harbor = await startHarbor({
      auth: new OidcAuthDriver({ issuer: as.issuer }),
      seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
      seedSpaces: [
        { name: 'Roadboard', creator: 'ramnique' },
        { name: 'Design', creator: 'ramnique' },
      ],
    });
    const spaces = await harbor.service.listSpaces({ memberId: 'ramnique' });
    const token = await as.mint({ sub: 'sub-gagan', email: 'gagan@rowboatlabs.com' });
    const rest = restClient(harbor, token);

    const first = await harbor.service.createInvite({ memberId: 'ramnique' }, spaces[0]!.id);
    const one = await rest.post('/v1/invites/accept', { token: first.token });
    const second = await harbor.service.createInvite({ memberId: 'ramnique' }, spaces[1]!.id);
    const two = await rest.post('/v1/invites/accept', { token: second.token });
    expect(two.body.membership.memberId).toBe(one.body.membership.memberId);
    // No name claim → displayName seeded from the email local-part.
    const member = await harbor.store.getMember(one.body.membership.memberId);
    expect(member?.displayName).toBe('gagan');
    expect((await rest.get('/v1/spaces')).body.spaces).toHaveLength(2);
    await harbor.close();
  });

  it('domain rule: matching binds (case-insensitive), wrong or missing email is policy_refused', async () => {
    const harbor = await startHarbor({
      auth: new OidcAuthDriver({ issuer: as.issuer }),
      allowedEmailDomains: ['rowboatlabs.com'],
      seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
      seedSpaces: [{ name: 'Roadboard', creator: 'ramnique' }],
    });
    const spaces = await harbor.service.listSpaces({ memberId: 'ramnique' });
    const invite = await harbor.service.createInvite({ memberId: 'ramnique' }, spaces[0]!.id);

    const outsider = restClient(harbor, await as.mint({ sub: 'sub-x', email: 'x@gmail.com' }));
    const refused = await outsider.post('/v1/invites/accept', { token: invite.token });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('policy_refused');
    expect(refused.body.message).toContain('@rowboatlabs.com');

    const noEmail = restClient(harbor, await as.mint({ sub: 'sub-y' }));
    expect((await noEmail.post('/v1/invites/accept', { token: invite.token })).body.code).toBe('policy_refused');
    // Refusal binds nothing.
    expect(await harbor.store.getMemberByIdentity(as.issuer, 'sub-x')).toBeUndefined();

    const insider = restClient(harbor, await as.mint({ sub: 'sub-p', email: 'Prakhar@RowboatLabs.COM' }));
    expect((await insider.post('/v1/invites/accept', { token: invite.token })).status).toBe(200);
    await harbor.close();
  });
});
