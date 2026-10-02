import { afterEach, describe, expect, it, vi } from 'vitest';
import { restClient, startTestHarbor } from './helpers.js';

// The single-org server and the deployment assemble an org through one
// factory (runtime.ts). What that factory decides — and what used to differ
// between the two roots — is pinned here.

const EXPO = 'https://exp.host/';

describe('buildOrgRuntime', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("single-org push payloads carry the store's org id, not the org's display name", async () => {
    // Intercept only Expo; every other fetch (the test's own REST calls) passes through.
    const real = globalThis.fetch;
    const sent: Array<{ to: string; data: { orgId: string } }> = [];
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!String(url).startsWith(EXPO)) return real(url, init);
      const batch = JSON.parse(String(init?.body ?? '[]')) as typeof sent;
      sent.push(...batch);
      return { json: async () => ({ data: batch.map(() => ({ status: 'ok', id: 't' })) }) } as unknown as Response;
    });
    const harbor = await startTestHarbor({
      orgName: 'Rowboat Labs (dev)',
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'gagan', displayName: 'Gagan' },
      ],
      seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
    });
    try {
      const gagan = restClient(harbor, 'dev-gagan');
      await gagan.post('/v1/push/register', { token: 'ExponentPushToken[g]', level: 'all' });
      const spaceId = (await gagan.get('/v1/spaces')).body.spaces[0].id as string;
      await restClient(harbor, 'dev-ramnique').post(`/v1/spaces/${spaceId}/messages`, { body: 'ping', actingMode: 'direct' });
      const deadline = Date.now() + 3000;
      while (sent.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: 'ExponentPushToken[g]', data: { orgId: 'org-default' } });
    } finally {
      await harbor.close();
    }
  });
});
