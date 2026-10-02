import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blobHash, MemoryBlobStore } from '../src/blobs.js';
import { startHarborDeployment, type RunningDeployment } from '../src/deployment.js';
import { ORG_TABLES, SPACE_TABLES } from '../src/directory.js';
import { PgStore } from '../src/pg-store.js';
import { pgliteDb } from '../src/sql-pglite.js';
import type { SqlDb } from '../src/sql.js';
import { startFakeAs, type FakeAs } from './helpers.js';

// Deleting an org from the apex (Baarali, 2026-10-02): its admins only, with
// its name typed back, and nothing of it left in any table — nor of it in the
// deployment's memory, nor its files' bytes.

const APEX = 'spaces.test';

let db: SqlDb;
let as: FakeAs;
let dep: RunningDeployment;
const stores = new Map<string, MemoryBlobStore>();

function client(host: string, token: string) {
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${dep.url}${path}`, {
      method,
      headers: {
        'x-forwarded-host': host,
        authorization: `Bearer ${token}`,
        ...(body instanceof Uint8Array ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: body instanceof Uint8Array ? (body as unknown as BodyInit) : JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body ?? {}),
    del: (path: string, body?: unknown) => call('DELETE', path, body ?? {}),
    putBlob: (path: string, bytes: Uint8Array) =>
      call('PUT', path, bytes, { 'x-blob-sha256': blobHash(bytes), 'content-type': 'text/csv' }),
  };
}

/** Rows an org still has, table by table, over every table that names an org or a space. */
async function leftovers(orgId: string, spaceIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of await keyedTables()) {
    const rows = await db.query<{ n: number }>(
      t.column === 'org_id'
        ? `select count(*)::int as n from ${t.table} where org_id = $1`
        : `select count(*)::int as n from ${t.table} where space_id = any($1)`,
      [t.column === 'org_id' ? orgId : spaceIds],
    );
    if (rows[0]!.n > 0) counts[t.table] = rows[0]!.n;
  }
  const ledger = await db.query<{ n: number }>("select count(*)::int as n from schema_migrations where id like '%:' || $1", [orgId]);
  if (ledger[0]!.n > 0) counts.schema_migrations = ledger[0]!.n;
  const org = await db.query<{ n: number }>('select count(*)::int as n from orgs where id = $1', [orgId]);
  if (org[0]!.n > 0) counts.orgs = org[0]!.n;
  return counts;
}

async function keyedTables(): Promise<{ table: string; column: 'org_id' | 'space_id' }[]> {
  const rows = await db.query<{ table_name: string; column_name: 'org_id' | 'space_id' }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_name in ('org_id', 'space_id')
      order by table_name`,
  );
  return rows.map((r) => ({ table: r.table_name, column: r.column_name }));
}

async function createOrg(token: string, name: string, slug: string) {
  const r = await client(APEX, token).post('/v1/orgs', { name, slug });
  expect(r.status).toBe(200);
  return r.body.org as { id: string; name: string; address: string };
}

beforeAll(async () => {
  db = await pgliteDb();
  as = await startFakeAs();
  dep = await startHarborDeployment({
    db,
    apexDomain: APEX,
    issuer: as.issuer,
    blobs: (orgId) => {
      let store = stores.get(orgId);
      if (!store) stores.set(orgId, (store = new MemoryBlobStore()));
      return store;
    },
  });
});

afterAll(async () => {
  await dep.close();
  await new Promise<void>((resolve) => as.server.close(() => resolve()));
  await db.close();
});

describe('deleting an org', () => {
  it('names every org- and space-keyed table, so a new one cannot be forgotten', async () => {
    const named = new Set<string>([...ORG_TABLES, ...SPACE_TABLES]);
    const missing = (await keyedTables()).map((t) => t.table).filter((t) => !named.has(t));
    expect(missing).toEqual([]);
  });

  it('removes everything of the org, and nothing of another', async () => {
    const founder = await as.mint({ sub: 'sub-founder', name: 'Awa' });
    const org = await createOrg(founder, 'Ma PME', 'ma-pme');
    const kept = await createOrg(founder, 'Autre', 'autre');
    const awa = client(org.address, founder);

    // Give the org a little of everything: a space, messages, a thread, a
    // reaction, a read mark, an invite, a file, a push token, a second member.
    const space = (await awa.post('/v1/spaces', { name: 'ventes' })).body.space.id as string;
    const root = (await awa.post(`/v1/spaces/${space}/messages`, { body: 'Bonjour', actingMode: 'direct' })).body.message;
    await awa.post(`/v1/spaces/${space}/messages`, { body: 'Réponse', threadRoot: root.id, actingMode: 'direct' });
    await awa.post(`/v1/spaces/${space}/messages/${root.id}/reactions`, { emoji: '👍', action: 'add', actingMode: 'direct' });
    await awa.post(`/v1/spaces/${space}/read`, { offset: root.offset });
    expect((await awa.post('/v1/invites', { spaceId: space })).status).toBe(200);
    const bytes = new TextEncoder().encode('produit,prix\nbeurre de karité,2500\n');
    expect((await awa.putBlob(`/v1/spaces/${space}/blobs`, bytes)).status).toBe(200);
    expect((await awa.post('/v1/push/register', { token: 'ExponentPushToken[test]', level: 'all' })).status).toBe(200);
    await new PgStore(db, org.id).putMember({ id: 'member-moussa', displayName: 'Moussa', role: 'member', kind: 'human' });

    const spaceIds = (await db.query<{ id: string }>('select id from spaces where org_id = $1', [org.id])).map((r) => r.id);
    expect(Object.keys(await leftovers(org.id, spaceIds)).sort()).toEqual(
      expect.arrayContaining(['events', 'invites', 'members', 'messages', 'push_prefs', 'push_tokens', 'reactions', 'space_blobs', 'spaces']),
    );
    const keptBefore = await leftovers(kept.id, []);

    const r = await client(APEX, founder).del(`/v1/orgs/${org.id}`, { confirmName: 'Ma PME' });
    expect(r.status).toBe(200);
    expect(r.body.deleted).toEqual({ id: org.id, name: 'Ma PME' });

    expect(await leftovers(org.id, spaceIds)).toEqual({});
    expect(await leftovers(kept.id, [])).toEqual(keptBefore);
    // The deployment forgot it: its domain routes nowhere, the apex no longer lists it.
    expect((await awa.get('/v1/health')).status).toBe(404);
    const listed = (await client(APEX, founder).get('/v1/orgs')).body.orgs.map((o: any) => o.id);
    expect(listed).toEqual([kept.id]);
    // And its files' bytes are gone.
    expect(await stores.get(org.id)!.has(blobHash(bytes))).toBe(false);
  });

  it('asks for the org name typed back', async () => {
    const founder = await as.mint({ sub: 'sub-careful' });
    const org = await createOrg(founder, 'Atelier', 'atelier');
    const apex = client(APEX, founder);
    expect((await apex.del(`/v1/orgs/${org.id}`)).status).toBe(400);
    expect((await apex.del(`/v1/orgs/${org.id}`, { confirmName: 'atelier' })).status).toBe(400);
    expect((await client(org.address, founder).get('/v1/health')).status).toBe(200);
  });

  it('is for admins only, and an org the caller is not in stays unknown to them', async () => {
    const founder = await as.mint({ sub: 'sub-owner' });
    const org = await createOrg(founder, 'Boutique', 'boutique');
    const store = new PgStore(db, org.id);
    await store.putMember({ id: 'member-plain', displayName: 'Fatou', role: 'member', kind: 'human' });
    await store.putIdentity(as.issuer, 'sub-plain', 'member-plain');

    const member = client(APEX, await as.mint({ sub: 'sub-plain' }));
    const plain = await member.del(`/v1/orgs/${org.id}`, { confirmName: 'Boutique' });
    expect(plain.status).toBe(403);
    expect(plain.body.code).toBe('forbidden');

    const stranger = client(APEX, await as.mint({ sub: 'sub-stranger' }));
    const unknown = await stranger.del(`/v1/orgs/${org.id}`, { confirmName: 'Boutique' });
    expect(unknown.status).toBe(404);

    expect((await client(org.address, founder).get('/v1/health')).status).toBe(200);
  });
});
