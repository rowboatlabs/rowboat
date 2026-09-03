import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ChangeSet, ProposeChangeResult, ReadAssetResult } from '@rowboat/spaces-protocol';
import { PgStore } from '../src/pg-store.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { pgliteDb } from './pglite.js';
import { agentClient, callStructured, liveClient, restClient, type LiveClient } from './helpers.js';

// Spec §11's acceptance scenario, run as code. The narrative is the QA script;
// each `it` is one beat of the Roadboard day. Beats share state on purpose —
// the day is one continuous story, and the log at the end must tell all of it.
//
// The whole day runs TWICE — against the in-memory store and against Postgres
// (in-process PGlite). This is the stub→real storage swap gate: same contract,
// same story, byte-identical assertions.

let harbor: RunningHarbor;
let spaceId: string;
let sqlDb: SqlDb | undefined;

// The five, as REST clients (humans at the app)...
let ramnique: ReturnType<typeof restClient>;
let arjun: ReturnType<typeof restClient>;
let harsh: ReturnType<typeof restClient>;
let gagan: ReturnType<typeof restClient>;
let prakhar: ReturnType<typeof restClient>;
// ...and as agents on the MCP face (each member's own Rowboat).
let ramniqueAgent: Client;
let gaganAgent: Client;
let prakharAgent: Client;
let ramniqueCron: Client;

let arjunOpenDoc: LiveClient; // beat 6: Arjun with the doc open
let arjunLastSeen = 0; // offset Arjun's app last saw before he goes home

const ROADMAP_V1 = `# Roadmap

## P1
- [ ] CSV importer crash (Harsh)

## P2
- [ ] SSO — scope SAML vs OIDC
- [ ] Webhook retries

## Standups
`;

const GAGAN_LINE = '- 08-14 gagan: importer fix shipped; next webhook retries';
const PRAKHAR_LINE = '- 08-14 prakhar: docs revamp underway';

async function startForStore(kind: 'memory' | 'postgres'): Promise<void> {
  const options: HarborOptions = {
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'arjun', displayName: 'Arjun' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'prakhar', displayName: 'Prakhar' },
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
  arjun = restClient(harbor, 'dev-arjun');
  harsh = restClient(harbor, 'dev-harsh');
  gagan = restClient(harbor, 'dev-gagan');
  prakhar = restClient(harbor, 'dev-prakhar');
  ramniqueAgent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat' });
  gaganAgent = await agentClient(harbor, 'dev-gagan', { agentName: 'Rowboat' });
  prakharAgent = await agentClient(harbor, 'dev-prakhar', { agentName: 'Rowboat' });
  ramniqueCron = await agentClient(harbor, 'dev-ramnique', { agentName: 'Rowboat', scheduled: true });
}

async function stopHarbor(): Promise<void> {
  arjunOpenDoc?.close();
  await Promise.all([ramniqueAgent, gaganAgent, prakharAgent, ramniqueCron].map((c) => c?.close()));
  await harbor.close();
  await sqlDb?.close();
  sqlDb = undefined;
  arjunLastSeen = 0;
}

describe.each([['memory'], ['postgres']] as const)('§11 — a day in the life of Roadboard (%s store)', (storeKind) => {
  beforeAll(async () => {
    await startForStore(storeKind);
  });

  afterAll(async () => {
    await stopHarbor();
  });
  it('beat 1 — creation: Ramnique makes the space, the agent seeds the roadmap, four invites land', async () => {
    const created = await ramnique.post('/v1/spaces', { name: 'Roadboard' });
    spaceId = created.body.space.id;

    // "asking their agent to draft it — already a private→shared push"
    const seeded = await callStructured<Extract<ProposeChangeResult, { outcome: 'applied' }>>(
      ramniqueAgent,
      'propose_change',
      {
        spaceId,
        path: 'roadmap.md',
        baseVersion: 0,
        newContent: ROADMAP_V1,
        reason: 'draft the roadmap from our planning notes',
      },
    );
    expect(seeded.outcome).toBe('applied');
    expect(seeded.version).toBe(1);
    expect(seeded.changeSet.attribution).toEqual({ memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' });

    const invite = await ramnique.post('/v1/invites', { spaceId });
    for (const member of [arjun, harsh, gagan, prakhar]) {
      expect((await member.post('/v1/invites/accept', { token: invite.body.token })).status).toBe(200);
    }
    const members = await arjun.get(`/v1/spaces/${spaceId}/members`);
    expect(members.body.members.map((m: any) => m.id).sort()).toEqual(['arjun', 'gagan', 'harsh', 'prakhar', 'ramnique']);
  });

  it('beat 2 — standup: everyone captures privately; nothing shared happens', async () => {
    const head = await harbor.service.headOffset(spaceId);
    // (five private notes are taken, none of them here)
    expect(await harbor.service.headOffset(spaceId)).toBe(head);
  });

  it('beat 3 — first push: Gagan\'s agent reads (history bundled), applies one change-set with reasoning', async () => {
    const read = await callStructured<ReadAssetResult>(gaganAgent, 'read_asset', { spaceId, path: 'roadmap.md' });
    expect(read.version).toBe(1);
    expect(read.recentHistory.length).toBeGreaterThan(0); // read-before-write is mechanical fact

    const push = await callStructured<Extract<ProposeChangeResult, { outcome: 'applied' }>>(
      gaganAgent,
      'propose_change',
      {
        spaceId,
        path: 'roadmap.md',
        baseVersion: read.version,
        newContent: `${read.content}${GAGAN_LINE}\n`,
        reason: 'standup 10:35 — push action items',
      },
    );
    expect(push.outcome).toBe('applied');
    expect(push.version).toBe(2);

    // The feed shows the activity row: the change is a durable event on the log.
    const events = await harbor.service.eventsAfter(spaceId, 0);
    const changes = events.filter((e) => e.event.type === 'change');
    expect(changes.at(-1)!.event).toMatchObject({
      type: 'change',
      changeSet: { resultVersion: 2, attribution: { memberId: 'gagan', actingMode: 'agent' } },
    });
  });

  it('beat 4 — second push, unaware: stale same-point append conflicts, nothing written; the agent applies only the delta', async () => {
    // Prakhar's agent still holds the standup-time read (v1) and appends at the
    // same insertion point — line order would be arbitrary, so this must
    // conflict (golden fixture 04), not silently interleave.
    const stale = await callStructured<ProposeChangeResult>(prakharAgent, 'propose_change', {
      spaceId,
      path: 'roadmap.md',
      baseVersion: 1,
      newContent: `${ROADMAP_V1}${PRAKHAR_LINE}\n`,
      reason: 'standup 10:41 — push action items',
    });
    expect(stale.outcome).toBe('conflict');
    if (stale.outcome !== 'conflict') return;
    expect(stale.currentVersion).toBe(2); // nothing was written
    expect(stale.currentContent).toContain(GAGAN_LINE);
    expect(stale.recentHistory[0]!.reason).toBe('standup 10:35 — push action items');

    // "sees the items already present, applies only the missing delta"
    const retry = await callStructured<Extract<ProposeChangeResult, { outcome: 'applied' }>>(
      prakharAgent,
      'propose_change',
      {
        spaceId,
        path: 'roadmap.md',
        baseVersion: stale.currentVersion,
        newContent: `${stale.currentContent}${PRAKHAR_LINE}\n`,
        reason: 'standup 10:41 — gagan already pushed the shared items; adding only mine',
      },
    );
    expect(retry.outcome).toBe('applied');
    expect(retry.version).toBe(3);
  });

  it('beat 5 — the seam: an email summary lands as an attributed change-set; stale but distant edits auto-merge', async () => {
    // Ramnique's agent last read at v2; meanwhile v3 landed (Prakhar's standup
    // line, end of file). The SSO note edits the P2 section — distant regions,
    // the everyday case, must auto-merge (golden fixture 01/03).
    const v2 = await ramnique.get(`/v1/spaces/${spaceId}/asset?path=roadmap.md&version=2`);
    const proposed = (v2.body.content as string).replace(
      '- [ ] SSO — scope SAML vs OIDC',
      '- [ ] SSO — scope SAML vs OIDC\n  - Customer X requesting SSO (via Ramnique, from email)',
    );
    const push = await callStructured<Extract<ProposeChangeResult, { outcome: 'merged' }>>(
      ramniqueAgent,
      'propose_change',
      {
        spaceId,
        path: 'roadmap.md',
        baseVersion: 2,
        newContent: proposed,
        reason: 'Customer X requesting SSO (via Ramnique, from email)',
      },
    );
    expect(push.outcome).toBe('merged');
    expect(push.version).toBe(4);
    // No write silently lost, in either direction:
    expect(push.mergedContent).toContain(PRAKHAR_LINE);
    expect(push.mergedContent).toContain('Customer X requesting SSO');
  });

  it('beat 6 — direct manipulation: Harsh ticks the checkbox; Arjun, doc open, sees it live', async () => {
    arjunOpenDoc = await liveClient(harbor, 'dev-arjun');
    const head = await harbor.service.headOffset(spaceId);
    arjunOpenDoc.send({ kind: 'subscribe', spaceId, afterOffset: head });
    await arjunOpenDoc.until((fs) => fs.some((f) => f.kind === 'subscribed'), 'arjun subscribed');

    const read = await harsh.get(`/v1/spaces/${spaceId}/asset?path=roadmap.md`);
    const ticked = (read.body.content as string).replace('- [ ] CSV importer crash (Harsh)', '- [x] CSV importer crash (Harsh)');
    const apply = await harsh.post(`/v1/spaces/${spaceId}/changes`, {
      assetPath: 'roadmap.md',
      baseVersion: read.body.version,
      newContent: ticked,
      actingMode: 'direct', // tiny change-set, no reason required on this face
    });
    expect(apply.body.outcome).toBe('applied');
    expect(apply.body.version).toBe(5);

    await arjunOpenDoc.until((fs) => fs.some((f) => f.kind === 'event'), 'arjun sees the tick');
    const seen = arjunOpenDoc.events()[0]!;
    expect(seen.event).toMatchObject({
      type: 'change',
      changeSet: { attribution: { memberId: 'harsh', actingMode: 'direct' }, resultVersion: 5 },
    });
    arjunLastSeen = seen.offset;
    arjunOpenDoc.close();
  });

  it('beat 7 — chat grammar: a thread starts flat in the stream, agents stay silent, @rowboat runs only for its own person', async () => {
    const headBefore = await harbor.service.headOffset(spaceId);

    const started = await arjun.post(`/v1/spaces/${spaceId}/messages`, {
      body: 'should SSO jump the migration work?',
      actingMode: 'direct',
    });
    const rootId = started.body.message.id;
    expect(started.body.message.threadRoot).toBeUndefined();

    const replied = await ramnique.post(`/v1/spaces/${spaceId}/messages`, {
      threadRoot: rootId,
      body: 'Yes — Customer X moved it for me. @rowboat move SSO to P1.',
      actingMode: 'direct',
    });
    expect(replied.body.message.threadRoot).toBe(rootId);

    // Agents were silent so far: everything since the topic started is direct.
    const midEvents = await harbor.service.eventsAfter(spaceId, headBefore);
    for (const e of midEvents) {
      if (e.event.type === 'message') expect(e.event.message.author.actingMode).toBe('direct');
      expect(e.event.type).not.toBe('change');
    }

    // @rowboat resolves to RAMNIQUE's own agent, runs on their machine, lands attributed.
    const read = await callStructured<ReadAssetResult>(ramniqueAgent, 'read_asset', { spaceId, path: 'roadmap.md' });
    const moved = read.content
      .replace('\n- [ ] SSO — scope SAML vs OIDC\n  - Customer X requesting SSO (via Ramnique, from email)', '')
      .replace(
        '## P1\n',
        '## P1\n- [ ] SSO — scope SAML vs OIDC\n  - Customer X requesting SSO (via Ramnique, from email)\n',
      );
    const change = await callStructured<Extract<ProposeChangeResult, { outcome: 'applied' }>>(
      ramniqueAgent,
      'propose_change',
      { spaceId, path: 'roadmap.md', baseVersion: read.version, newContent: moved, reason: 'move SSO to P1 (asked in Roadboard thread)' },
    );
    expect(change.outcome).toBe('applied');
    expect(change.version).toBe(6);

    const turnSummary = await callStructured<{ messageId: string; threadRoot?: string }>(ramniqueAgent, 'post_message', {
      spaceId,
      threadRoot: rootId,
      body: 'Moved SSO to P1 in roadmap.md.',
    });
    expect(turnSummary.threadRoot).toBe(rootId);

    const thread = await arjun.get(`/v1/spaces/${spaceId}/threads/${rootId}`);
    expect(thread.body.root.author).toEqual({ memberId: 'arjun', actingMode: 'direct' });
    expect(thread.body.messages.map((m: any) => m.author)).toEqual([
      { memberId: 'ramnique', actingMode: 'direct' },
      { memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' },
    ]);
  });

  it('beat 8 — housekeeping: the DRI\'s local cron tidies, attributed "(via Rowboat, scheduled)"', async () => {
    const read = await callStructured<ReadAssetResult>(ramniqueCron, 'read_asset', { spaceId, path: 'roadmap.md' });
    const tidied = read.content.replace('## Standups\n', '## Standups — week of Aug 11\n');
    const tidy = await callStructured<Extract<ProposeChangeResult, { outcome: 'applied' }>>(
      ramniqueCron,
      'propose_change',
      { spaceId, path: 'roadmap.md', baseVersion: read.version, newContent: tidied, reason: 'nightly tidy: date the standup section' },
    );
    expect(tidy.outcome).toBe('applied');
    expect(tidy.version).toBe(7);
    expect(tidy.changeSet.attribution).toEqual({ memberId: 'ramnique', actingMode: 'scheduled', agentName: 'Rowboat' });
  });

  it('beat 9 — catch-up: resume-from-offset replays exactly what Arjun missed; history answers "why"', async () => {
    const catchUp = await liveClient(harbor, 'dev-arjun');
    catchUp.send({ kind: 'subscribe', spaceId, afterOffset: arjunLastSeen });
    const head = await harbor.service.headOffset(spaceId);
    await catchUp.until((fs) => fs.filter((f) => f.kind === 'event').length >= head - arjunLastSeen, 'overnight replay');

    const replay = catchUp.events();
    // Contiguous, gapless, exactly the missed tail.
    expect(replay.map((e) => e.offset)).toEqual(
      Array.from({ length: head - arjunLastSeen }, (_, i) => arjunLastSeen + 1 + i),
    );
    // The unread badge's story: three messages (a root + two replies), two changes.
    const kinds = replay.map((e) => e.event.type);
    expect(kinds.filter((k) => k === 'message').length).toBe(3);
    expect(kinds.filter((k) => k === 'change').length).toBe(2);
    catchUp.close();

    // The doc's history answers any "why" — with the full attribution spectrum.
    const history = await arjun.get(`/v1/spaces/${spaceId}/history?path=roadmap.md`);
    const changeSets = history.body.changeSets as ChangeSet[];
    expect(changeSets).toHaveLength(7);
    expect(changeSets.map((cs) => cs.resultVersion)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    const reasons = changeSets.map((cs) => cs.reason);
    expect(reasons).toContain('Customer X requesting SSO (via Ramnique, from email)');
    expect(reasons).toContain('move SSO to P1 (asked in Roadboard thread)');
    expect(reasons).toContain('nightly tidy: date the standup section');
    expect(new Set(changeSets.map((cs) => cs.attribution.actingMode))).toEqual(new Set(['direct', 'agent', 'scheduled']));

    // And the day's diff reads like the day.
    const diff = await arjun.get(`/v1/spaces/${spaceId}/diff?path=roadmap.md&from=1&to=7`);
    expect(diff.body.unified).toContain('+- [x] CSV importer crash (Harsh)');
    expect(diff.body.unified).toContain('+- [ ] SSO — scope SAML vs OIDC');
    expect(diff.body.unified).toContain(`+${GAGAN_LINE}`);
    expect(diff.body.unified).toContain(`+${PRAKHAR_LINE}`);
  });
});
