import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpTools, type Member, type Message, type Space } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { agentClient, restClient } from './helpers.js';
import { pgliteDb } from './pglite.js';

// Agent-face parity (2026-09-09): every member operation the render face has
// is projected as an MCP tool, and an agent's act IS the member's act,
// attributed by mode. Through a real MCP client, on both stores. Every
// structured output is checked against the tool's own output schema so the
// projection cannot drift from the protocol contract.

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;
let spaceId: string;
let dmWithGagan: string;
let ramnique: ReturnType<typeof restClient>;
let gagan: ReturnType<typeof restClient>;
let ramAgent: Client;
let harshAgent: Client;

/** callStructured + the tool's own output schema as the oracle. */
async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const def = mcpTools.find((t) => t.name === name);
  if (!def) throw new Error(`no such tool ${name}`);
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`tool ${name} errored: ${JSON.stringify(result.content)}`);
  const parsed = def.output.safeParse(result.structuredContent);
  if (!parsed.success) throw new Error(`tool ${name} output failed its schema: ${parsed.error.message}`);
  return result.structuredContent as T;
}

/** The ApiError body of a refused call. */
async function refused(client: Client, name: string, args: Record<string, unknown>): Promise<{ code: string; message: string }> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { code: string; message: string };
}

async function startForStore(kind: 'memory' | 'postgres'): Promise<void> {
  const options: HarborOptions = {
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'harsh' }, // lowercase on purpose: the roster sort is case-insensitive
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'loner', displayName: 'Loner' }, // shares no space with anyone
    ],
  };
  if (kind === 'postgres') {
    sqlDb = await pgliteDb();
    const store = new PgStore(sqlDb);
    await store.init();
    options.store = store;
  }
  harbor = await startHarbor(options);
  ramnique = restClient(harbor, 'dev-ramnique');
  gagan = restClient(harbor, 'dev-gagan');
  const harsh = restClient(harbor, 'dev-harsh');
  // Membership graph: Parity = {ramnique, harsh}; DM = {ramnique, gagan}; loner alone.
  const created = await ramnique.post('/v1/spaces', { name: 'Parity' });
  spaceId = created.body.space.id;
  const inv = await ramnique.post('/v1/invites', { spaceId });
  await harsh.post('/v1/invites/accept', { token: inv.body.token });
  dmWithGagan = (await ramnique.post('/v1/direct', { memberId: 'gagan' })).body.space.id;
  ramAgent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
  harshAgent = await agentClient(harbor, 'dev-harsh', { agentName: 'Claude' });
}

describe.each([['memory'], ['postgres']] as const)('agent face parity (%s store)', (storeKind) => {
  beforeAll(async () => {
    await startForStore(storeKind);
  });

  afterAll(async () => {
    await ramAgent.close();
    await harshAgent.close();
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it("whoami is the token's member — the same row /v1/me serves", async () => {
    const { member } = await call<{ member: Member }>(ramAgent, 'whoami');
    expect(member).toMatchObject({ id: 'ramnique', displayName: 'Ramnique', role: 'member' });
    expect(member).toEqual((await ramnique.get('/v1/me')).body.member);
    const other = await call<{ member: Member }>(harshAgent, 'whoami');
    expect(other.member.id).toBe('harsh');
  });

  it('list_members without spaceId is the union of shared rosters, DMs included, and nothing more', async () => {
    const mine = await call<{ members: Member[] }>(ramAgent, 'list_members');
    // Sorted by display name, case-insensitively; the caller is present.
    expect(mine.members.map((m) => m.id)).toEqual(['gagan', 'harsh', 'ramnique']);
    expect(mine.members.map((m) => m.id)).not.toContain('loner');
    // Discovery is bounded by shared membership: harsh shares no space with gagan.
    const harshs = await call<{ members: Member[] }>(harshAgent, 'list_members');
    expect(harshs.members.map((m) => m.id)).toEqual(['harsh', 'ramnique']);
    // A member of nothing still sees themself.
    const lonerAgent = await agentClient(harbor, 'dev-loner');
    try {
      const alone = await call<{ members: Member[] }>(lonerAgent, 'list_members');
      expect(alone.members.map((m) => m.id)).toEqual(['loner']);
    } finally {
      await lonerAgent.close();
    }
    // Same answer as the render face.
    expect((await ramnique.get('/v1/members')).body.members).toEqual(mine.members);
  });

  it('list_members with spaceId matches REST listMembers, and refuses non-members', async () => {
    const listed = await call<{ members: Member[] }>(ramAgent, 'list_members', { spaceId });
    expect(listed.members).toEqual((await ramnique.get(`/v1/spaces/${spaceId}/members`)).body.members);
    expect(listed.members.map((m) => m.id).sort()).toEqual(['harsh', 'ramnique']);
    const gaganAgent = await agentClient(harbor, 'dev-gagan');
    try {
      expect((await refused(gaganAgent, 'list_members', { spaceId })).code).toBe('forbidden');
    } finally {
      await gaganAgent.close();
    }
  });

  it('open_direct is get-or-create from either side; your own id opens the self-DM', async () => {
    const first = await call<{ space: Space; created: boolean }>(ramAgent, 'open_direct', { memberId: 'harsh' });
    expect(first.created).toBe(true);
    expect(first.space).toMatchObject({ kind: 'direct', participants: ['harsh', 'ramnique'] });
    const again = await call<{ space: Space; created: boolean }>(ramAgent, 'open_direct', { memberId: 'harsh' });
    expect(again).toMatchObject({ created: false, space: { id: first.space.id } });
    const fromHarsh = await call<{ space: Space; created: boolean }>(harshAgent, 'open_direct', { memberId: 'ramnique' });
    expect(fromHarsh).toMatchObject({ created: false, space: { id: first.space.id } });

    const notes = await call<{ space: Space; created: boolean }>(ramAgent, 'open_direct', { memberId: 'ramnique' });
    expect(notes.created).toBe(true);
    expect(notes.space).toMatchObject({ kind: 'direct', participants: ['ramnique'] });
    const notesAgain = await call<{ space: Space; created: boolean }>(ramAgent, 'open_direct', { memberId: 'ramnique' });
    expect(notesAgain).toMatchObject({ created: false, space: { id: notes.space.id } });
    // list_spaces flags it for the agent.
    const spaces = await call<{ spaces: Array<{ id: string; self?: boolean }> }>(ramAgent, 'list_spaces', { includeDirect: true });
    expect(spaces.spaces.find((s) => s.id === notes.space.id)?.self).toBe(true);

    expect((await refused(ramAgent, 'open_direct', { memberId: 'nobody' })).code).toBe('not_found');
  });

  it('create_space, rename_space (attributed), leave_space — DMs refuse rename and leave', async () => {
    const made = await call<{ space: Space }>(harshAgent, 'create_space', { name: 'Agent-made' });
    expect(made.space).toMatchObject({ name: 'Agent-made', kind: 'shared' });
    const id = made.space.id;
    // harsh is its first (and only) member.
    expect((await call<{ members: Member[] }>(harshAgent, 'list_members', { spaceId: id })).members.map((m) => m.id)).toEqual(['harsh']);

    const renamed = await call<{ space: Space }>(harshAgent, 'rename_space', { spaceId: id, name: 'Agent-made (v2)' });
    expect(renamed.space).toMatchObject({ id, name: 'Agent-made (v2)' });
    const events = await harbor.service.eventsAfter(id, 0);
    const rename = events.find((e) => e.event.type === 'space_renamed')!;
    expect((rename.event as any).by).toEqual({ memberId: 'harsh', actingMode: 'agent', agentName: 'Claude' });
    // Identical name: no-op, no second event.
    await call<{ space: Space }>(harshAgent, 'rename_space', { spaceId: id, name: 'Agent-made (v2)' });
    expect((await harbor.service.eventsAfter(id, 0)).filter((e) => e.event.type === 'space_renamed')).toHaveLength(1);

    // Non-members cannot rename.
    expect((await refused(ramAgent, 'rename_space', { spaceId: id, name: 'Nope' })).code).toBe('forbidden');

    const left = await call<{ left: true }>(harshAgent, 'leave_space', { spaceId: id });
    expect(left).toEqual({ left: true });
    const listed = await call<{ spaces: Array<{ id: string }> }>(harshAgent, 'list_spaces');
    expect(listed.spaces.map((s) => s.id)).not.toContain(id);
    expect((await refused(harshAgent, 'read_stream', { spaceId: id })).code).toBe('forbidden');

    // A DM has a fixed membership and no name of its own.
    expect((await refused(ramAgent, 'rename_space', { spaceId: dmWithGagan, name: 'Us' })).code).toBe('invalid_request');
    expect((await refused(ramAgent, 'leave_space', { spaceId: dmWithGagan })).code).toBe('invalid_request');
  });

  it('create_invite returns a shareable link that admits a new member; DMs refuse', async () => {
    const invite = await call<{ token: string; link: string; expiresAt?: string }>(ramAgent, 'create_invite', {
      spaceId,
      expiresInHours: 2,
    });
    expect(invite.link).toContain(`/join/${invite.token}`);
    expect(invite.expiresAt).toBeTruthy();
    expect(Date.parse(invite.expiresAt!) - Date.now()).toBeLessThanOrEqual(2 * 3_600_000);
    // Same thing the render face mints — gagan joins with it.
    const accepted = await gagan.post('/v1/invites/accept', { token: invite.token });
    expect(accepted.status).toBe(200);
    const roster = await call<{ members: Member[] }>(ramAgent, 'list_members', { spaceId });
    expect(roster.members.map((m) => m.id).sort()).toEqual(['gagan', 'harsh', 'ramnique']);

    expect((await refused(ramAgent, 'create_invite', { spaceId: dmWithGagan })).code).toBe('invalid_request');
  });

  it("edit_message and delete_message are author-only: your person's messages, nothing else", async () => {
    const posted = await call<{ messageId: string }>(ramAgent, 'post_message', { spaceId, body: 'the quick fix' });
    const messageId = posted.messageId;

    // Another member's agent may not edit it.
    expect((await refused(harshAgent, 'edit_message', { spaceId, messageId, body: 'hijacked' })).code).toBe('forbidden');

    const edited = await call<{ message: Message }>(ramAgent, 'edit_message', { spaceId, messageId, body: 'the quicker fix' });
    expect(edited.message).toMatchObject({ id: messageId, body: 'the quicker fix' });
    expect(edited.message.editedAt).toBeTruthy();
    const events = await harbor.service.eventsAfter(spaceId, 0);
    const edit = events.find((e) => e.event.type === 'message_edited')!;
    expect((edit.event as any).edit.by).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });

    expect((await refused(harshAgent, 'delete_message', { spaceId, messageId })).code).toBe('forbidden');
    const deleted = await call<{ message: Message }>(ramAgent, 'delete_message', { spaceId, messageId });
    expect(deleted.message).toMatchObject({ id: messageId, body: '' });
    expect(deleted.message.deletedAt).toBeTruthy();
    // Idempotent, and the tombstone refuses edits.
    await call<{ message: Message }>(ramAgent, 'delete_message', { spaceId, messageId });
    expect((await refused(ramAgent, 'edit_message', { spaceId, messageId, body: 'zombie' })).code).toBe('invalid_request');
  });

  it('react adds and removes an emoji as your person, folded on the returned message', async () => {
    const posted = await call<{ messageId: string }>(harshAgent, 'post_message', { spaceId, body: 'shipped SSO' });
    const messageId = posted.messageId;
    const added = await call<{ message: Message }>(ramAgent, 'react', { spaceId, messageId, emoji: '🎉', action: 'add' });
    expect(added.message.reactions).toEqual([{ emoji: '🎉', memberIds: ['ramnique'] }]);
    const events = await harbor.service.eventsAfter(spaceId, 0);
    const reaction = events.filter((e) => e.event.type === 'reaction').at(-1)!;
    expect((reaction.event as any).reaction.by).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });
    // Re-adding is a no-op; the render face sees the same fold.
    await call<{ message: Message }>(ramAgent, 'react', { spaceId, messageId, emoji: '🎉', action: 'add' });
    expect((await harbor.service.eventsAfter(spaceId, 0)).filter((e) => e.event.type === 'reaction')).toHaveLength(events.filter((e) => e.event.type === 'reaction').length);
    const removed = await call<{ message: Message }>(ramAgent, 'react', { spaceId, messageId, emoji: '🎉', action: 'remove' });
    expect(removed.message.reactions).toEqual([]);
    // A tombstone takes no new reactions.
    await call<{ message: Message }>(harshAgent, 'delete_message', { spaceId, messageId });
    expect((await refused(ramAgent, 'react', { spaceId, messageId, emoji: '👍', action: 'add' })).code).toBe('invalid_request');
  });

  it("post_message with a poll; vote_poll as an agent is the member's vote; end_poll by the author's agent", async () => {
    const posted = await call<{ messageId: string }>(ramAgent, 'post_message', {
      spaceId,
      body: '📊 **Where do we take standup?**\n1. Keep it async\n2. Daily call',
      poll: { question: 'Where do we take standup?', answers: [{ text: 'Keep it async' }, { text: 'Daily call', emoji: '📞' }] },
    });
    const messageId = posted.messageId;
    const thread = await call<{ root: Message }>(ramAgent, 'read_thread', { spaceId, rootMessageId: messageId });
    expect(thread.root.poll?.answers).toEqual([
      { id: 1, text: 'Keep it async' },
      { id: 2, text: 'Daily call', emoji: '📞' },
    ]);
    expect(thread.root.author).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });

    const voted = await call<{ message: Message }>(harshAgent, 'vote_poll', { spaceId, messageId, answerId: 1, action: 'add' });
    expect(voted.message.poll?.votes).toEqual([{ answerId: 1, memberIds: ['harsh'] }]);
    expect((await harbor.store.listPollVotesByMessage(spaceId, messageId)).map((v) => v.by)).toEqual([
      { memberId: 'harsh', actingMode: 'agent', agentName: 'Claude' },
    ]);
    // Single-select: voting elsewhere moves it.
    const moved = await call<{ message: Message }>(harshAgent, 'vote_poll', { spaceId, messageId, answerId: 2, action: 'add' });
    expect(moved.message.poll?.votes).toEqual([{ answerId: 2, memberIds: ['harsh'] }]);
    expect((await refused(harshAgent, 'vote_poll', { spaceId, messageId, answerId: 9, action: 'add' })).code).toBe('invalid_request');

    // Author-only close: harsh's agent is not the author; ramnique's is.
    expect((await refused(harshAgent, 'end_poll', { spaceId, messageId })).code).toBe('forbidden');
    const ended = await call<{ message: Message }>(ramAgent, 'end_poll', { spaceId, messageId });
    expect(ended.message.poll?.endedAt).toBeTruthy();
    expect(ended.message.poll?.votes).toEqual([{ answerId: 2, memberIds: ['harsh'] }]);
    const events = await harbor.service.eventsAfter(spaceId, 0);
    const end = events.find((e) => e.event.type === 'poll_ended')!;
    expect((end.event as any).end.by).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });
    // Sealed: no more votes; ending again is a no-op.
    expect((await refused(harshAgent, 'vote_poll', { spaceId, messageId, answerId: 2, action: 'remove' })).code).toBe('invalid_request');
    const again = await call<{ message: Message }>(ramAgent, 'end_poll', { spaceId, messageId });
    expect(again.message.poll?.endedAt).toBe(ended.message.poll?.endedAt);
    // Poll messages cannot be edited.
    expect((await refused(ramAgent, 'edit_message', { spaceId, messageId, body: 'x' })).code).toBe('invalid_request');
  });

  it('read_asset {version}, diff, asset_history, and restore_asset after delete_asset', async () => {
    const v1 = await call<{ outcome: string }>(ramAgent, 'propose_change', {
      spaceId, path: 'notes/sso.md', baseVersion: 0, newContent: '# SSO\n- scope\n', reason: 'start',
    });
    expect(v1.outcome).toBe('applied');
    const v2 = await call<{ outcome: string }>(ramAgent, 'propose_change', {
      spaceId, path: 'notes/sso.md', baseVersion: 1, newContent: '# SSO\n- scope\n- SAML vs OIDC\n', reason: 'expand',
    });
    expect(v2.outcome).toBe('applied');

    // Time travel.
    const current = await call<{ content: string; version: number }>(ramAgent, 'read_asset', { spaceId, path: 'notes/sso.md' });
    expect(current).toMatchObject({ version: 2, content: '# SSO\n- scope\n- SAML vs OIDC\n' });
    const older = await call<{ content: string; version: number; recentHistory: unknown[] }>(ramAgent, 'read_asset', {
      spaceId, path: 'notes/sso.md', version: 1,
    });
    expect(older).toMatchObject({ version: 1, content: '# SSO\n- scope\n' });
    expect(older.recentHistory).toHaveLength(1);
    expect((await refused(ramAgent, 'read_asset', { spaceId, path: 'notes/sso.md', version: 9 })).code).toBe('not_found');

    const { unified } = await call<{ unified: string }>(ramAgent, 'diff', { spaceId, path: 'notes/sso.md', from: 1, to: 2 });
    expect(unified).toContain('+- SAML vs OIDC');
    expect(unified).not.toContain('-- scope');

    const deleted = await call<{ outcome: string }>(harshAgent, 'delete_asset', {
      spaceId, path: 'notes/sso.md', baseVersion: 2, reason: 'superseded',
    });
    expect(deleted.outcome).toBe('deleted');
    expect((await refused(ramAgent, 'read_asset', { spaceId, path: 'notes/sso.md' })).code).toBe('not_found');

    const restored = await call<{ outcome: string; version: number; changeSet: { op?: string; attribution: unknown; reason?: string } }>(
      ramAgent, 'restore_asset', { spaceId, path: 'notes/sso.md', reason: 'deleted by mistake' },
    );
    expect(restored.outcome).toBe('restored');
    expect(restored.version).toBe(2);
    expect(restored.changeSet).toMatchObject({
      op: 'restore',
      reason: 'deleted by mistake',
      attribution: { memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' },
    });
    const back = await call<{ content: string; version: number }>(ramAgent, 'read_asset', { spaceId, path: 'notes/sso.md' });
    expect(back).toMatchObject({ version: 2, content: '# SSO\n- scope\n- SAML vs OIDC\n' });
    // Nothing left in Trash at that path — the live file occupies it.
    expect((await refused(ramAgent, 'restore_asset', { spaceId, path: 'notes/sso.md', reason: 'again' })).code).toBe('not_found');

    // History: per file (newest first, across the delete/restore) and whole space.
    const file = await call<{ changeSets: Array<{ op?: string; reason?: string }> }>(ramAgent, 'asset_history', { spaceId, path: 'notes/sso.md' });
    expect(file.changeSets.map((c) => c.op ?? 'edit')).toEqual(['restore', 'delete', 'edit', 'edit']);
    expect(file.changeSets.map((c) => c.reason)).toEqual(['deleted by mistake', 'superseded', 'expand', 'start']);
    const space = await call<{ changeSets: unknown[] }>(ramAgent, 'asset_history', { spaceId });
    expect(space.changeSets.length).toBeGreaterThanOrEqual(file.changeSets.length);
    const page = await call<{ changeSets: unknown[] }>(ramAgent, 'asset_history', { spaceId, path: 'notes/sso.md', limit: 2 });
    expect(page.changeSets).toHaveLength(2);
    expect(await harbor.service.assetHistory({ memberId: 'ramnique' }, spaceId, { path: 'notes/sso.md' })).toEqual(file.changeSets);
    // An unknown path has no lineage: empty, not an error.
    expect((await call<{ changeSets: unknown[] }>(ramAgent, 'asset_history', { spaceId, path: 'never/was.md' })).changeSets).toEqual([]);
  });
});
