// Rowboat's production repair (2026-11-24). Run after 067 with Harbor
// stopped and the November 9 snapshot restored as schema nov9. All mapping,
// validation and writes share one transaction, including the completion marker.
import { ulid } from 'ulid';
import pg from 'pg';
import { mapMentionTokens, parseMentions } from '@rowboat/spaces-protocol';
import { searchTextFor } from '../src/search.js';

const flat = 'org-default';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const report: Record<string, number> = {};
const count = (rule: string, n = 1) => {
  report[rule] = (report[rule] ?? 0) + n;
};
const query = async <T extends pg.QueryResultRow>(sql: string, args: unknown[] = []) =>
  (await db.query<T>(sql, args)).rows;
const update = async (label: string, sql: string, args: unknown[] = []) =>
  count(label, (await db.query(sql, args)).rowCount ?? 0);

interface Person {
  id: string;
  name: string;
  kind: string;
  owner: string | null;
  old_org: string | null;
  canonical: string;
}
interface Room {
  id: string;
  kind: string;
  old_org: string | null;
  people: string[];
}
function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(value);
}

async function split() {
  await db.query("select pg_advisory_xact_lock(hashtext('harbor-org-split'))");
  if ((await query("select id from schema_migrations where id='split-orgs-20261124'")).length) return;
  if (!(await query("select id from schema_migrations where id='067-orgs-return'")).length)
    throw Error('Run 067 before the split.');
  const [deployment] = await query<{ apex: string | null; issuer: string | null }>(
    `select
    (select domain from org_domains where org_id=o.id limit 1) apex, issuer from orgs o where id=$1`,
    [flat],
  );
  if (!deployment?.apex || !deployment.issuer) throw Error('067 must have the deployment apex and issuer.');
  const { apex, issuer } = deployment;
  // Refuse a live deployment that has already begun accepting multi-org writes.
  if ((await query('select id from orgs where id<>$1 limit 1', [flat])).length)
    throw Error('Expected only the migrated default org.');
  const people =
    await query<Person>(`select m.id, m.display_name name, m.kind, m.owner_id owner, n.org_id old_org,
      coalesce((select mi.member_id from nov9.member_identities ni join member_identities mi using (iss,sub)
        where ni.member_id=m.id limit 1),m.id) canonical
    from members m left join nov9.members n on n.id=m.id order by m.id`);
  const byId = new Map(people.map((p) => [p.id, p]));
  const home = new Map<string, string>();
  const known = new Map<string, Set<string>>();
  for (const p of people) {
    if (p.old_org) {
      if (p.canonical === p.id) home.set(p.id, p.old_org);
      addTo(known, p.canonical, p.old_org);
    }
  }
  await db.query('update spaces set is_default=false where is_default');
  // Discard only 067's empty synthetic landing space. A real flat general
  // has its original creation time and must be assigned like any other space.
  await db.query(
    `delete from spaces s using orgs o where o.id=$1 and s.org_id=o.id and s.name='general'
    and s.created_at=o.created_at and not exists(select from nov9.spaces n where n.id=s.id)
    and not exists(select from memberships m where m.space_id=s.id) and not exists(select from events e where e.space_id=s.id)`,
    [flat],
  );
  const rooms = await query<Room>(`select s.id, coalesce(n.kind,s.kind) kind, n.org_id old_org,
    array(select ms.member_id from memberships ms where ms.space_id=s.id order by ms.joined_at,ms.member_id) people
    from spaces s left join nov9.spaces n using(id) order by s.created_at,s.id`);
  const roomOrg = new Map<string, string>();
  const shared = rooms.filter((s) => s.kind === 'shared');
  const orgsOf = (id: string) => known.get(byId.get(id)?.canonical ?? id) ?? new Set<string>();
  const humanIds = (r: Room) => r.people.filter((id) => byId.get(id)?.kind === 'human');
  const founders = new Set<string>();
  const solo = async (p: Person) => {
    founders.add(p.id);
    const org = 'org-' + ulid().toLowerCase();
    const first = p.name.trim().split(/\s+/)[0] || 'My';
    const name = first === 'My' ? 'My space' : first + "'s space";
    const prefix =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 35)
        .replace(/-+$/, '') || 'server';
    await db.query('insert into orgs(id,name,created_at,issuer) values($1,$2,$3,$4)', [
      org,
      name,
      new Date().toISOString(),
      issuer,
    ]);
    for (;;) {
      const domain = prefix + '-' + ulid().toLowerCase().slice(-4) + '.' + apex;
      const saved = await query(
        'insert into org_domains(domain,org_id) values($1,$2) on conflict do nothing returning domain',
        [domain, org],
      );
      if (saved.length) break;
    }
    home.set(p.id, org);
    addTo(known, p.id, org);
    count('solo orgs created');
    return org;
  };
  await update('snapshot orgs restored', 'insert into orgs select * from nov9.orgs');
  await db.query('insert into org_domains select * from nov9.org_domains');
  await db.query('insert into org_settings select org_id,invite_policy,set_by,set_at from nov9.org_settings');
  await db.query('insert into org_logos select * from nov9.org_logos');
  const imageCols = 'org_id,hash,size,mime,width,height,uploaded_by,uploaded_at';
  await db.query(`insert into org_images (${imageCols}) select ${imageCols} from nov9.org_images`);
  for (const r of rooms)
    if (r.old_org) {
      roomOrg.set(r.id, r.old_org);
      count(r.kind + ' spaces from snapshot');
    }
  const joinedOrgs = (p: Person) =>
    new Set(
      shared
        .filter((r) => r.people.includes(p.id))
        .map((r) => roomOrg.get(r.id))
        .filter((id): id is string => !!id),
    );
  // A known founder anchors a new space. Only orgs the founder belonged to
  // are candidates; equal scores prefer the winner's original home.
  function assignShared(r: Room) {
    const humans = humanIds(r);
    const founder = humans[0];
    if (!founder) return false;
    const own = home.get(founder);
    if (!own) return false;
    const options = [...orgsOf(founder)];
    const score = (o: string) => r.people.filter((id) => orgsOf(id).has(o)).length;
    options.sort(
      (a, b) => score(b) - score(a) || Number(b === own) - Number(a === own) || a.localeCompare(b),
    );
    roomOrg.set(r.id, options[0] ?? own);
    count('shared spaces by founder');
    return true;
  }
  const newPeople = people.filter((p) => p.kind === 'human' && !p.old_org);
  while (newPeople.some((p) => !home.has(p.id))) {
    for (const r of shared) if (!roomOrg.has(r.id)) assignShared(r);
    const pending = newPeople.filter((p) => !home.has(p.id));
    let progress = false;
    for (const p of pending) {
      const places = joinedOrgs(p);
      if (places.size === 1) {
        const [org] = places;
        home.set(p.id, org!);
        addTo(known, p.id, org!);
        progress = true;
      } else if (places.size > 1) {
        await solo(p);
        progress = true;
      }
    }
    // An entirely new component needs its first founder before its spaces can locate anyone else.
    if (!progress) {
      const founder = shared
        .filter((r) => !roomOrg.has(r.id))
        .map((r) => humanIds(r)[0])
        .find((id) => pending.some((p) => p.id === id));
      await solo(pending.find((p) => p.id === founder) ?? pending[0]!);
    }
  }
  for (const r of shared)
    if (!roomOrg.has(r.id) && !assignShared(r)) throw Error('Unmapped shared space ' + r.id);
  for (const p of newPeople) {
    if (joinedOrgs(p).size > 1 && !founders.has(p.id)) await solo(p);
  }
  for (const r of shared)
    for (const id of humanIds(r)) addTo(known, byId.get(id)!.canonical, roomOrg.get(r.id)!);
  for (const p of people.filter((p) => p.kind === 'agent')) {
    const places = new Set(
      rooms
        .filter((r) => r.people.includes(p.id))
        .map((r) => roomOrg.get(r.id))
        .filter((v): v is string => !!v),
    );
    const org = p.old_org ?? (places.size === 1 ? [...places][0] : home.get(p.owner ?? ''));
    if (!org) throw Error('Unmapped agent ' + p.id);
    home.set(p.id, org);
    addTo(known, p.id, org);
  }
  for (const r of rooms.filter((r) => r.kind === 'direct' && !roomOrg.has(r.id))) {
    const ids = [...r.people].sort();
    const older = ids[0];
    if (!older) throw Error('Unmapped DM with no participants: ' + r.id);
    const candidates = [...orgsOf(older)].filter((o) => ids.every((id) => orgsOf(id).has(o)));
    const together = (o: string) =>
      shared.filter((s) => roomOrg.get(s.id) === o && ids.every((id) => s.people.includes(id))).length;
    const fallback = home.get(older);
    candidates.sort(
      (a, b) =>
        together(b) - together(a) || Number(b === fallback) - Number(a === fallback) || a.localeCompare(b),
    );
    const org = candidates[0] ?? fallback;
    if (!org) throw Error('Unmapped DM ' + r.id);
    roomOrg.set(r.id, org);
    count(candidates.length ? 'DMs by common org' : 'DMs by older participant');
  }
  await db.query('create temp table room_org(id text primary key, org_id text not null) on commit drop');
  for (const [id, org] of roomOrg) await db.query('insert into room_org values ($1,$2)', [id, org]);
  // Composite references are checked after both sides move. Restore their
  // original immediate mode before the transaction commits.
  const fks = await query<{
    tbl: string;
    name: string;
  }>(`select conrelid::regclass::text tbl,conname name from pg_constraint
    where confrelid='public.members'::regclass and contype='f'`);
  for (const { tbl, name } of fks)
    await db.query(`alter table ${tbl} alter constraint "${name}" deferrable initially deferred`);
  await db.query('set constraints all deferred');
  const local = new Map<string, string>();
  const slot = (id: string, org: string) => JSON.stringify([id, org]);
  for (const p of people) {
    const org = p.old_org ?? home.get(p.id);
    if (!org) throw Error('Unmapped member ' + p.id);
    local.set(slot(p.canonical, org), p.id);
    await db.query("update members set org_id=$2, role='member' where id=$1", [p.id, org]);
  }
  await db.query(`update members m set role=n.role, personal=case when n.kind='agent' then n.personal or m.personal else false end,
    removed_at=case when n.kind='agent' then coalesce(m.removed_at,n.removed_at) else n.removed_at end
    from nov9.members n where n.id=m.id`);
  await db.query(`update members set role='admin' where id=any($1::text[])`, [[...founders]]);
  await db.query(`update member_identities mi set org_id=m.org_id from members m where m.id=mi.member_id`);
  await db.query(`insert into member_identities (org_id,iss,sub,member_id) select ni.org_id,ni.iss,ni.sub,ni.member_id
    from nov9.member_identities ni join members m on m.id=ni.member_id and m.org_id=ni.org_id on conflict do nothing`);
  const joined = new Set(
    rooms.flatMap((r) => r.people.map((id) => slot(byId.get(id)!.canonical, roomOrg.get(r.id)!))),
  );
  // Attribution and mentions alone cannot authorize access to a private organization.
  for (const person of people) {
    if (person.canonical !== person.id)
      await db.query(
        `update members m set deactivated_at=w.deactivated_at, avatar_url=null
      from members w where w.id=$1 and m.id=$2 and w.deactivated_at is not null`,
        [person.canonical, person.id],
      );
  }
  const memberAt = async (id: string, org: string) => {
    const p = byId.get(id);
    if (!p) throw Error('Unmapped member reference ' + id + ' in ' + org);
    const key = slot(p.canonical, org);
    const existing = local.get(key);
    if (existing) return existing;
    if (p.kind !== 'human') throw Error('Agent in a foreign org: ' + id + ' in ' + org);
    const newId = ulid();
    await db.query(
      `insert into members (org_id,id,display_name,title,avatar_url,kind,availability,deactivated_at,removed_at)
      select $2,$3,display_name,title,avatar_url,kind,availability,deactivated_at,coalesce(removed_at,$4) from members where id=$1`,
      [p.canonical, org, newId, joined.has(key) ? null : new Date().toISOString()],
    );
    if (joined.has(key))
      await db.query(
        `insert into member_identities (org_id,iss,sub,member_id)
      select $2,iss,sub,$3 from member_identities where member_id=$1`,
        [p.canonical, org, newId],
      );
    local.set(key, newId);
    count('new org-local people');
    return newId;
  };
  for (const r of rooms) for (const id of r.people) await memberAt(id, roomOrg.get(r.id)!);
  for (const p of people)
    if (p.owner) {
      const org = home.get(p.id)!;
      await db.query('update members set owner_id=$2 where id=$1', [p.id, await memberAt(p.owner, org)]);
    }
  await db.query('update spaces s set org_id=r.org_id from room_org r where r.id=s.id');
  await db.query(`update spaces s set visibility=n.visibility,kind=n.kind,
    direct_key=case when n.kind='direct' then n.direct_key else null end,
    name=case when n.kind='direct' then n.name else s.name end from nov9.spaces n where s.id=n.id`);
  const refs = new Set([
    'memberId',
    'memberIds',
    'by',
    'setBy',
    'createdBy',
    'requestedBy',
    'decidedBy',
    'ownerId',
    'readers',
    'mentions',
    'replyAuthors',
    'participants',
    'author',
    'authorId',
    'agentId',
    'actorId',
    'member_id',
    'uploaded_by',
    'set_by',
    'created_by',
    'llm_set_by',
    'mentions_list',
  ]);
  const rewriteTokens = async (body: string, org: string) => {
    const replacements = new Map<string, string>();
    for (const id of parseMentions(body).members) {
      if (byId.has(id)) replacements.set(id, await memberAt(id, org));
    }
    return mapMentionTokens(body, (ref, raw) => {
      if (ref.kind !== 'member') return raw;
      const next = replacements.get(ref.id);
      if (!next || next === ref.id) return raw;
      return raw.slice(0, -(ref.id.length + 1)) + next + ')';
    });
  };
  async function remap(value: unknown, field: string, org: string): Promise<unknown> {
    if (typeof value === 'string') {
      if (field === 'entityId' && value.startsWith('member:') && byId.has(value.slice(7)))
        return 'member:' + (await memberAt(value.slice(7), org));
      if (refs.has(field) && byId.has(value)) return memberAt(value, org);
      if (['body', 'content', 'extracted'].includes(field) && value.includes('#member:')) {
        const next = await rewriteTokens(value, org);
        if (value !== next) count('texts with mentions rewritten');
        return next;
      }
    }
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value) result.push(await remap(item, field, org));
      return result;
    }
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value)) result[key] = await remap(v, key, org);
      return result;
    }
    return value;
  }
  // Scope comes from the space, never the author's home. Generated search
  // and author columns are maintained by Postgres. The access rows that 062
  // changed are repaired regardless of their original creation time.
  const columns: Record<string, string[]> = {
    memberships: ['member_id'],
    space_read_marks: ['member_id'],
    thread_read_marks: ['member_id'],
    space_blobs: ['uploaded_by'],
    messages: ['author', 'body', 'mentions', 'reply_authors', 'approval', 'poll', 'secrets'],
    topics: ['created_by'],
    events: ['event'],
    reactions: ['member_id', 'attribution'],
    poll_votes: ['member_id', 'attribution'],
    change_sets: ['attribution'],
    asset_versions: ['content'],
    asset_search: ['extracted'],
    graph_threads: ['judgment'],
    invocations: ['data'],
    approvals: ['data'],
  };
  for (const [table, cols] of Object.entries(columns)) {
    const types = await query<{ column_name: string; data_type: string }>(
      `select column_name,data_type from information_schema.columns
      where table_schema='public' and table_name=$1`,
      [table],
    );
    const json = new Set(types.filter((c) => c.data_type === 'jsonb').map((c) => c.column_name));
    const keys = await query<{ col: string }>(
      `select a.attname col from pg_index i
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
      where i.indrelid=to_regclass($1) and i.indisprimary order by a.attnum`,
      ['nov9.' + table],
    );
    const canCompare =
      keys.length &&
      !['memberships', 'space_read_marks', 'thread_read_marks'].includes(table) &&
      keys.every((k) => types.some((c) => c.column_name === k.col));
    const snapshot = canCompare
      ? 'left join nov9.' + table + ' n on ' + keys.map((k) => 'n.' + k.col + '=t.' + k.col).join(' and ')
      : '';
    const rows = await query(
      `select t.ctid::text loc,r.org_id,${table === 'messages' ? 't.summary,' : ''}${canCompare ? 'to_jsonb(n)' : 'null'} original,${cols.map((c) => 't.' + c).join(',')} from ${table} t join room_org r on r.id=t.space_id ${snapshot}`,
    );
    for (const row of rows) {
      const sets: string[] = [],
        values: unknown[] = [];
      for (const c of cols) {
        if (row.original && JSON.stringify(row.original[c]) === JSON.stringify(row[c])) continue;
        const field = c === 'reply_authors' ? 'replyAuthors' : c;
        const v = await remap(row[c], field, row.org_id);
        if (JSON.stringify(v) === JSON.stringify(row[c])) continue;
        values.push(json.has(c) ? JSON.stringify(v) : v);
        sets.push(`${c}=$${values.length}${json.has(c) ? '::jsonb' : ''}`);
        if (table === 'messages' && c === 'body' && typeof v === 'string') {
          values.push(searchTextFor(row.summary ? row.summary + '\n' + v : v));
          sets.push('search_text=$' + values.length);
        }
      }
      if (sets.length)
        await update(
          table + ' rows remapped',
          `update ${table} set ${sets.join(',')} where ctid=$${values.length + 1}::tid`,
          [...values, row.loc],
        );
    }
  }
  // Existing DMs keep their immutable snapshot pair. Migration 063 removed Ro
  // from memberships, so deriving those pairs from today's roster loses a participant.
  await db.query(`update spaces s set direct_key=(select to_json(array_agg(m.member_id order by m.member_id))::text from memberships m where m.space_id=s.id)
    where s.kind='direct' and not exists (select from nov9.spaces n where n.id=s.id)`);
  for (const table of [
    'agent_keys',
    'agent_capabilities',
    'agent_connection_credentials',
    'agent_connection_threads',
    'agent_connector_keys',
    'agent_hooks',
    'agent_option_defaults',
    'agent_hosting',
    'approvals',
    'invocations',
  ]) {
    await db.query(`update ${table} t set org_id=m.org_id from members m where t.agent_id=m.id`);
  }
  await db.query(
    `update agent_hosting t set org_id=m.org_id from members m where t.agent_id is null and t.created_by=m.id`,
  );
  await db.query(`update invites i set org_id=coalesce((select s.org_id from invite_spaces x join spaces s on x.space_id=s.id where x.token=i.token order by x.position limit 1),
      (select m.org_id from members m where m.id=i.created_by))`);
  for (const [table, fields] of Object.entries({
    invites: ['created_by'],
    agent_keys: ['created_by'],
    agent_hosting: ['created_by', 'llm_set_by', 'requested_by'],
    agent_connection_credentials: ['set_by'],
    agent_hooks: ['set_by'],
    agent_option_defaults: ['set_by'],
  })) {
    for (const row of await query(`select ctid::text loc,org_id,${fields.join(',')} from ${table}`)) {
      const values: unknown[] = [];
      const sets: string[] = [];
      for (const field of fields)
        if (row[field] && byId.has(row[field])) {
          const next = await memberAt(row[field], row.org_id);
          if (next !== row[field]) {
            values.push(next);
            sets.push(`${field}=$${values.length}`);
          }
        }
      if (sets.length)
        await update(
          table + ' rows remapped',
          `update ${table} set ${sets.join(',')} where ctid=$${values.length + 1}::tid`,
          [...values, row.loc],
        );
    }
  }
  await db.query('create temp table local_person(original text,org_id text,member_id text) on commit drop');
  for (const [key, id] of local) {
    const [original, org] = JSON.parse(key) as [string, string];
    await db.query('insert into local_person values($1,$2,$3)', [original, org, id]);
  }
  for (const [table, fields] of Object.entries({
    push_tokens: 'token,updated_at',
    push_prefs: 'level',
    activity_seen: 'seen_at',
  })) {
    await db.query(
      `insert into ${table} (org_id,member_id,${fields}) select l.org_id,l.member_id,${fields
        .split(',')
        .map((f) => 'p.' + f)
        .join(
          ',',
        )} from ${table} p join local_person l on l.original=p.member_id join members m on m.org_id=l.org_id and m.id=l.member_id where p.org_id=$1 and m.removed_at is null and m.deactivated_at is null`,
      [flat],
    );
    await db.query(`delete from ${table} where org_id=$1`, [flat]);
  }
  // Images uploaded since the snapshot follow their uploader and every org
  // whose member currently uses that hash. Bytes remain in the flat store.
  await db.query(
    `insert into org_images (${imageCols}) select distinct m.org_id,i.hash,i.size,i.mime,i.width,i.height,i.uploaded_by,i.uploaded_at
    from org_images i join members m on m.id=i.uploaded_by or m.avatar_url like '%/v1/images/'||i.hash where i.org_id=$1 on conflict do nothing`,
    [flat],
  );
  if (
    (
      await query(
        `select hash from org_images f where f.org_id=$1 and not exists
    (select from org_images i where i.hash=f.hash and i.org_id<>$1) limit 1`,
        [flat],
      )
    ).length
  )
    throw Error('Unmapped image');
  await db.query('delete from org_images where org_id=$1', [flat]);
  for (const { id } of await query<{ id: string }>('select id from orgs where id<>$1 order by id', [flat])) {
    const [candidate] = await query<{ id: string }>(
      `select s.id from spaces s left join nov9.spaces n on n.id=s.id
      where s.org_id=$1 and s.kind='shared' and not s.archived and ((s.name='general' and s.visibility='open') or n.is_default)
      order by (s.name='general' and s.visibility='open') desc,s.created_at,s.id limit 1`,
      [id],
    );
    if (candidate)
      await db.query("update spaces set name='general',visibility='open',is_default=true where id=$1", [
        candidate.id,
      ]);
    else {
      const g = ulid(),
        now = new Date().toISOString();
      await db.query(
        "insert into spaces (id,org_id,name,kind,visibility,is_default,created_at) values ($1,$2,'general','shared','open',true,$3)",
        [g, id, now],
      );
      await db.query(
        `insert into memberships(space_id,member_id,joined_at) select $1,id,$3 from members where org_id=$2 and role='admin'
        and removed_at is null and deactivated_at is null`,
        [g, id, now],
      );
      count('general spaces created');
    }
  }
  await db.query('set constraints all immediate');
  for (const { tbl, name } of fks)
    await db.query(`alter table ${tbl} alter constraint "${name}" not deferrable`);
  const tables = await query<{
    table_name: string;
  }>(`select table_name from information_schema.columns where table_schema='public' and column_name='org_id'
    and table_name <> 'org_domains'`);
  for (const { table_name } of tables) {
    if ((await query(`select 1 from "${table_name}" where org_id=$1 limit 1`, [flat])).length)
      throw Error('Unmapped rows in ' + table_name);
  }
  if (
    (
      await query(`select ms.space_id from memberships ms join spaces s on s.id=ms.space_id left join members m on m.id=ms.member_id and m.org_id=s.org_id
    where m.id is null limit 1`)
    ).length
  )
    throw Error('Memberships outside their space org');
  await db.query(
    `insert into schema_migrations(id,applied_at)
    select left(m.id,-length($1)) || o.id,m.applied_at from schema_migrations m cross join orgs o
    where m.id like 'backfill:%:' || $1 and o.id<>$1 on conflict do nothing`,
    [flat],
  );
  await db.query("delete from schema_migrations where id like 'backfill:%:' || $1", [flat]);
  await db.query('delete from org_domains where org_id=$1', [flat]);
  await db.query('delete from orgs where id=$1', [flat]);
  const badDefaults =
    await query(`select o.id from orgs o left join spaces s on s.org_id=o.id and s.is_default
    group by o.id having count(s.id) <> 1`);
  if (badDefaults.length) throw Error('Orgs without exactly one default: ' + JSON.stringify(badDefaults));
  await db.query("insert into schema_migrations values ('split-orgs-20261124',$1)", [
    new Date().toISOString(),
  ]);
  const totals = await query(
    "select org_id,count(*)::int people from members where kind='human' group by org_id order by org_id",
  );
  return { counts: report, peoplePerOrg: totals, unmapped: 0 };
}

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
await db.connect();
try {
  await db.query('begin isolation level serializable');
  const result = await split();
  await db.query('commit');
  console.log(JSON.stringify(result ?? { alreadyComplete: true }));
} catch (error) {
  await db.query('rollback');
  throw error;
} finally {
  await db.end();
}
