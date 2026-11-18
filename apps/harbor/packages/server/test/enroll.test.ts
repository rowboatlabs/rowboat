import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes } from '@rowboat/spaces-protocol';
import { OidcAuthDriver } from '../src/auth-oidc.js';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startFakeAs, startTestHarbor, type FakeAs } from './helpers.js';

// Becoming a member on first contact (spec §4 Joining, 2026-11-09): the cold
// start with no invite link. POST /v1/me binds a signed-in stranger the way
// an invite's acceptance does, without a space; everything else still answers
// not_a_member until then.

let as: FakeAs;
let harbor: RunningHarbor;

beforeAll(async () => {
  as = await startFakeAs();
  harbor = await startTestHarbor({
    auth: new OidcAuthDriver({ issuer: as.issuer }),
    seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
  });
  await harbor.store.putIdentity(as.issuer, 'sub-ramnique', 'ramnique');
});

afterAll(async () => {
  await harbor.close();
  await new Promise<void>((resolve) => as.server.close(() => resolve()));
});

describe('POST /v1/me', () => {
  it('makes a signed-in stranger a member, seeded from the claims; again is the same row', async () => {
    const token = await as.mint({ sub: 'sub-new', name: 'Priya Natarajan', email: 'priya@example.com' });
    const stranger = restClient(harbor, token);
    expect((await stranger.get('/v1/me')).status).toBe(403);
    expect((await stranger.get('/v1/spaces')).body.code).toBe('not_a_member');

    const first = await stranger.post('/v1/me', {});
    expect(first.status).toBe(200);
    const body = routes.enroll.response.parse(first.body);
    expect(body.created).toBe(true);
    expect(body.member).toMatchObject({ displayName: 'Priya Natarajan', kind: 'human' });
    expect(body.member.id).not.toBe('sub-new'); // a minted id, never the subject

    const again = routes.enroll.response.parse((await stranger.post('/v1/me', {})).body);
    expect(again).toEqual({ member: body.member, created: false });
    expect((await stranger.get('/v1/me')).body.member.id).toBe(body.member.id);
    expect((await stranger.get('/v1/spaces')).body.spaces).toEqual([]);
  });

  it('gives a member their row back, and refuses a deactivated account', async () => {
    const me = restClient(harbor, await as.mint({ sub: 'sub-ramnique' }));
    expect((await me.post('/v1/me', {})).body).toMatchObject({ member: { id: 'ramnique' }, created: false });

    const leaver = restClient(harbor, await as.mint({ sub: 'sub-leaver', name: 'Leaver' }));
    await leaver.post('/v1/me', {});
    expect((await leaver.delete('/v1/me')).status).toBe(200);
    expect((await leaver.post('/v1/me', {})).status).toBe(403);
  });
});
