import { describe, expect, it, vi } from 'vitest';
import { SpacesClient } from './client.js';
const space = { id: '01J00000000000000000000001', orgId: 'org', name: 'Open', kind: 'shared', visibility: 'open', createdAt: '2026-09-28T00:00:00Z' };
describe('open-space request compatibility', () => {
  it('treats only a missing browse endpoint as unsupported', async () => {
    for (const status of [404, 401, 403, 500]) {
      const client = new SpacesClient({ baseUrl: 'https://test.example', token: 'test', fetchImpl: vi.fn().mockResolvedValue(Response.json({ code: 'not_found' }, { status })) });
      if (status === 404) await expect(client.browseSpaces()).resolves.toEqual({ supported: false, spaces: [] });
      else await expect(client.browseSpaces()).rejects.toMatchObject({ status });
    }
  });
  it('joins the named space and parses confirmed membership', async () => {
    const membership = { spaceId: space.id, memberId: 'me', joinedAt: '2026-09-28T00:00:00Z' };
    const fetchImpl = vi.fn().mockImplementation(async () => Response.json({ space, membership }));
    const client = new SpacesClient({ baseUrl: 'https://test.example', token: 'test', fetchImpl });
    await expect(client.joinSpace(space.id)).resolves.toMatchObject({ space: { id: space.id }, membership });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://test.example/v1/spaces/${space.id}/join`);
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
  });
  it('sends visibility explicitly, preserves private defaults, and validates browse results', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => Response.json({ space }));
    const client = new SpacesClient({ baseUrl: 'https://test.example', token: 'test', fetchImpl });
    await client.createSpace('Open', 'open');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ name: 'Open', visibility: 'open' });
    await client.createSpace('Private');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ name: 'Private' });
    fetchImpl.mockResolvedValueOnce(Response.json({ spaces: [{ space, joined: false }] }));
    await expect(client.browseSpaces()).resolves.toMatchObject({ supported: true, spaces: [{ joined: false }] });
    expect(fetchImpl.mock.calls[2][0]).toBe('https://test.example/v1/spaces/browse');
  });
});
