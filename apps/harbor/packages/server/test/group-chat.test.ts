import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, callStructured, liveClient, restClient, startTestHarbor } from './helpers.js';

// Group chats (spec §4, 2026-10-07): an org with one shared space and no DMs
// is a group chat for every member — DMs are off, notes to self included —
// and a second space, private or not, makes it a workspace for everyone.

let harbor: RunningHarbor;
let ramnique: ReturnType<typeof restClient>;
let harsh: ReturnType<typeof restClient>;
let ramAgent: Client;

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Family',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
    seedSpaces: [{ name: 'Family', creator: 'ramnique' }],
  });
  ramnique = restClient(harbor, 'dev-ramnique');
  harsh = restClient(harbor, 'dev-harsh');
  ramAgent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
});

afterAll(async () => {
  await ramAgent.close();
  await harbor.close();
});

describe('a group chat', () => {
  it('says so on both faces, the same for every member', async () => {
    expect((await ramnique.get('/v1/spaces')).body.groupChat).toBe(true);
    expect((await harsh.get('/v1/spaces?includeDirect=1')).body.groupChat).toBe(true);
    expect((await callStructured<{ groupChat: boolean }>(ramAgent, 'list_spaces', {})).groupChat).toBe(true);
  });

  it('refuses DMs — with someone, with yourself, and from an agent — and creates nothing', async () => {
    const dm = await ramnique.post('/v1/direct', { memberId: 'harsh' });
    expect(dm.status).toBe(403);
    expect(dm.body.message).toContain('add a channel');
    expect((await ramnique.post('/v1/direct', { memberId: 'ramnique' })).status).toBe(403);
    const viaTool = await ramAgent.callTool({ name: 'open_direct', arguments: { memberId: 'harsh' } });
    expect(viaTool.isError).toBe(true);
    expect((await harsh.get('/v1/spaces?includeDirect=1')).body.spaces.map((s: { kind: string }) => s.kind)).toEqual(['shared']);
  });

  it('becomes a workspace for everyone when anyone adds a channel, even a private one they alone are in', async () => {
    const harshLive = await liveClient(harbor, 'dev-harsh');
    const created = await ramnique.post('/v1/spaces', { name: 'Trips' });
    expect(created.status).toBe(200);
    // Harsh is not in Trips, and still hears that the org changed.
    await harshLive.until((fs) => fs.some((f) => f.kind === 'org_changed'), 'org_changed');
    harshLive.close();
    const listing = (await harsh.get('/v1/spaces')).body;
    expect(listing.spaces.map((s: { name: string }) => s.name)).toEqual(['Family']);
    expect(listing.groupChat).toBe(false);
    // DMs are on: notes to self too.
    expect((await harsh.post('/v1/direct', { memberId: 'ramnique' })).status).toBe(200);
    expect((await harsh.post('/v1/direct', { memberId: 'harsh' })).status).toBe(200);
  });

  it('tells no one again once it is a workspace', async () => {
    const harshLive = await liveClient(harbor, 'dev-harsh');
    await ramnique.post('/v1/spaces', { name: 'Recipes' });
    await new Promise((r) => setTimeout(r, 50));
    expect(harshLive.frames.some((f) => f.kind === 'org_changed')).toBe(false);
    harshLive.close();
  });
});
