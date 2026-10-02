import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Member } from '@rowboat/spaces-protocol';
import { blobHash } from '../src/blobs.js';
import { MAX_PROFILE_IMAGE_BYTES } from '../src/core/images.js';
import { canSetOrgLogo } from '../src/policy.js';
import type { RunningHarbor } from '../src/server.js';
import { startTestHarbor } from './helpers.js';

// Profile images over the render face (2026-10-02): a member's avatar, the
// org's logo, and the one route that serves both to the whole org.

// A real 1×1 PNG (sniffable magic bytes), and a second one that differs.
const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PNG_B = Buffer.concat([PNG_A, Buffer.from([0])]);
const HTML = new TextEncoder().encode('<script>alert(1)</script>');

let harbor: RunningHarbor;

function api(token: string) {
  const auth = { authorization: `Bearer ${token}` };
  const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });
  return {
    get: async (path: string) => json(await fetch(`${harbor.url}${path}`, { headers: auth })),
    del: async (path: string) => json(await fetch(`${harbor.url}${path}`, { method: 'DELETE', headers: auth })),
    putImage: async (path: string, bytes: Uint8Array, type = 'image/png') =>
      json(await fetch(`${harbor.url}${path}`, { method: 'PUT', headers: { ...auth, 'content-type': type }, body: bytes as unknown as BodyInit })),
    raw: async (url: string) => fetch(url, { headers: auth }),
  };
}

let admin: ReturnType<typeof api>;
let gagan: ReturnType<typeof api>;

describe('profile images over the render face', () => {
  beforeAll(async () => {
    harbor = await startTestHarbor({
      orgName: 'Image Test Org',
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'gagan', displayName: 'Gagan' },
      ],
      // The seed space's creator is the org's admin.
      seedSpaces: [{ name: 'general', creator: 'ramnique' }],
    });
    admin = api('dev-ramnique');
    gagan = api('dev-gagan');
  });

  afterAll(async () => {
    await harbor.close();
  });

  it('sets your avatar and shows it on me and the roster', async () => {
    const set = await gagan.putImage('/v1/me/avatar', PNG_A);
    expect(set.status).toBe(200);
    const member = set.body.member as Member;
    expect(member.avatarUrl).toBe(`${harbor.url}/v1/images/${blobHash(PNG_A)}`);

    expect((await gagan.get('/v1/me')).body.member.avatarUrl).toBe(member.avatarUrl);
    const roster = (await admin.get('/v1/members')).body.members as Member[];
    expect(roster.find((m) => m.id === 'gagan')?.avatarUrl).toBe(member.avatarUrl);
  });

  it('serves the image to any member of the org, as an image', async () => {
    const res = await admin.raw(`${harbor.url}/v1/images/${blobHash(PNG_A)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(PNG_A));
  });

  it('refuses a hash the org never registered, and an unauthenticated read', async () => {
    expect((await admin.get(`/v1/images/${blobHash(PNG_B)}`)).status).toBe(404);
    expect((await fetch(`${harbor.url}/v1/images/${blobHash(PNG_A)}`)).status).toBe(401);
  });

  it('accepts images only, whatever the content-type claims, and bounds the size', async () => {
    const html = await gagan.putImage('/v1/me/avatar', HTML, 'image/png');
    expect(html.status).toBe(400);
    expect(html.body.code).toBe('invalid_request');

    const big = new Uint8Array(MAX_PROFILE_IMAGE_BYTES + 1);
    big.set(PNG_A);
    const tooBig = await gagan.putImage('/v1/me/avatar', big);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.code).toBe('payload_too_large');

    // Neither refusal touched the avatar.
    expect((await gagan.get('/v1/me')).body.member.avatarUrl).toContain(blobHash(PNG_A));
  });

  it('clears your avatar, idempotently', async () => {
    const cleared = await gagan.del('/v1/me/avatar');
    expect(cleared.status).toBe(200);
    expect(cleared.body.member.avatarUrl).toBeUndefined();
    expect((await gagan.del('/v1/me/avatar')).body.member.avatarUrl).toBeUndefined();
    expect((await gagan.get('/v1/me')).body.member.avatarUrl).toBeUndefined();
  });

  it('lets an admin set the org logo, and every member read it', async () => {
    expect((await gagan.get('/v1/org/logo')).body).toEqual({});

    const refused = await gagan.putImage('/v1/org/logo', PNG_B);
    expect(refused.status).toBe(403);
    expect((await gagan.get('/v1/org/logo')).body).toEqual({});

    const set = await admin.putImage('/v1/org/logo', PNG_B);
    expect(set.status).toBe(200);
    const logoUrl = `${harbor.url}/v1/images/${blobHash(PNG_B)}`;
    expect(set.body).toEqual({ logoUrl });
    expect((await gagan.get('/v1/org/logo')).body).toEqual({ logoUrl });
    expect((await gagan.raw(logoUrl)).status).toBe(200);
  });

  it('lets only an admin clear the logo, idempotently', async () => {
    expect((await gagan.del('/v1/org/logo')).status).toBe(403);
    expect((await admin.del('/v1/org/logo')).body).toEqual({});
    expect((await admin.del('/v1/org/logo')).body).toEqual({});
    expect((await gagan.get('/v1/org/logo')).body).toEqual({});
  });

  it('policy: the logo is an admin’s', () => {
    const member = (role: Member['role']): Member => ({ id: 'm', displayName: 'M', role, kind: 'human' });
    expect(canSetOrgLogo(member('admin'))).toBeNull();
    expect(canSetOrgLogo(member('member'))?.code).toBe('forbidden');
  });
});
