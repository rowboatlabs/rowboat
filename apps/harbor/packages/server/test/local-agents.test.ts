import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { liveClient, restClient, startTestHarbor, type LiveClient } from './helpers.js';

// Local agents (spec §4 Agent members and §8 Where agents run, 2026-10-28):
// the desktop app runs its owner's own Claude Code or Codex as an agent on
// its key. Always personal, and online only while the app holds a live
// connection on that key.

let harbor: RunningHarbor;
let local: Member;
let localKey: string;
const as = (token: string) => restClient(harbor, token);
const GRACE_MS = 150;

beforeAll(async () => {
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
    agentPresenceGraceMs: GRACE_MS,
  });
  // Asked for as a channel agent: a local agent is personal anyway.
  const added = await as('dev-gagan').post('/v1/agents', { displayName: "Gagan's Claude Code", kind: 'claude-code', connection: 'local', personal: false });
  expect(added.status).toBe(200);
  local = added.body.agent;
  localKey = added.body.key.secret;
});

afterAll(async () => {
  await harbor.close();
});

async function roster(token: string) {
  const r = await as(token).get('/v1/members');
  expect(r.status).toBe(200);
  return routes.listOrgMembers.response.parse(r.body);
}

const presence = (frames: LiveClient['frames'], online: boolean) =>
  frames.some((f) => f.kind === 'agent_presence' && f.agentId === local.id && f.online === online);

describe('adding one', () => {
  it('is Claude Code or Codex through local, and always personal', async () => {
    expect(local).toMatchObject({ kind: 'agent', agentKind: 'claude-code', agentConnection: 'local', ownerId: 'gagan', personal: true });
    const codex = await as('dev-gagan').post('/v1/agents', { displayName: 'Codex', kind: 'codex', connection: 'local' });
    expect(codex.body.agent).toMatchObject({ agentConnection: 'local', personal: true });
    const cursor = await as('dev-gagan').post('/v1/agents', { displayName: 'Cursor', kind: 'cursor', connection: 'local' });
    expect(cursor.status).toBe(400);
  });

  it('never switches to a channel agent', async () => {
    const r = await as('dev-gagan').put(`/v1/agents/${local.id}/personal`, { personal: false });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/runs on its owner’s computer/);
    expect((await harbor.store.getMember(local.id))?.personal).toBe(true);
    // Asking for what it already is stays a no-op.
    expect((await as('dev-gagan').put(`/v1/agents/${local.id}/personal`, { personal: true })).status).toBe(200);
  });
});

describe('presence', () => {
  it('is offline until its app connects, online while it is, and offline after the grace once it leaves', async () => {
    expect((await roster('dev-harsh')).online).toEqual([]);
    const harsh = await liveClient(harbor, 'dev-harsh');

    const app = await liveClient(harbor, localKey);
    await harsh.until((frames) => presence(frames, true), 'online');
    expect((await roster('dev-harsh')).online).toEqual([local.id]);

    app.close();
    // Within the grace it still counts as online, and nothing is announced.
    expect((await roster('dev-harsh')).online).toEqual([local.id]);
    await harsh.until((frames) => presence(frames, false), 'offline');
    expect((await roster('dev-harsh')).online).toEqual([]);
    harsh.close();
  });

  it('does not flicker when the app reconnects within the grace', async () => {
    const harsh = await liveClient(harbor, 'dev-harsh');
    const first = await liveClient(harbor, localKey);
    await harsh.until((frames) => presence(frames, true), 'online');
    first.close();
    const second = await liveClient(harbor, localKey);
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 3));
    expect(presence(harsh.frames, false)).toBe(false);
    expect(harsh.frames.filter((f) => f.kind === 'agent_presence')).toHaveLength(1);
    expect((await roster('dev-harsh')).online).toEqual([local.id]);
    second.close();
    await harsh.until((frames) => presence(frames, false), 'offline');
    harsh.close();
  });

  it('says nothing about people', async () => {
    const harsh = await liveClient(harbor, 'dev-harsh');
    const gagan = await liveClient(harbor, 'dev-gagan');
    gagan.close();
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 3));
    expect(harsh.frames.filter((f) => f.kind === 'agent_presence')).toEqual([]);
    expect((await roster('dev-harsh')).online).toEqual([]);
    harsh.close();
  });
});
