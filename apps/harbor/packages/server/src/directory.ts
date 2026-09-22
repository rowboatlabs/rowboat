import { monotonicFactory } from 'ulid';
import type { Member } from '@rowboat/spaces-protocol';
import { HarborError } from './errors.js';
import { PgStore } from './pg-store.js';
import type { SqlDb } from './sql.js';

// The deployment's org directory (spec §4 "Deployment and tenancy"): which
// orgs this deployment serves and which domains reach them. Control-plane
// data, outside the member protocol — /internal (phase 2) is its API face;
// this module is the logic both /internal and tests call.

export interface OrgConfig {
  id: string;
  name: string;
  createdAt: string;
  /** Pinned AS issuer. Absent = dev auth (never for public deployments). */
  issuer?: string;
  /** Org policy v1: bind-time email-domain rule. */
  allowedEmailDomains?: string[];
  domains: string[];
}

export interface CreateOrgInput {
  name: string;
  /** Domains that resolve to this org (Host/X-Forwarded-Host values, no scheme). */
  domains: string[];
  issuer?: string;
  allowedEmailDomains?: string[];
  /**
   * The provisioned first admin (spec §4 roles: named at provisioning). The
   * control plane knows the signup identity's (iss, sub), so the founder is
   * bound directly — no invite bootstrap problem.
   */
  firstAdmin?: { iss: string; sub: string; displayName: string };
}

/** An org as the apex lists it for one identity: the org, and the caller's member on it. */
export interface OrgMembershipRow {
  id: string;
  name: string;
  /** The org's first domain by name; '' when it has none. */
  address: string;
  memberId: string;
  displayName: string;
  role: Member['role'];
}

interface OrgRow {
  id: string;
  name: string;
  created_at: string;
  issuer: string | null;
  allowed_email_domains: string[] | null;
  /** Every domain routing to the org, sorted — folded in by the query, never fetched per row. */
  domains: string[];
}

const ulid = monotonicFactory();

/** The org rows with their domains folded in: one statement whatever the count (2026-09-22). */
const ORG_SELECT = `select o.id, o.name, o.created_at, o.issuer, o.allowed_email_domains,
       coalesce(array_agg(d.domain order by d.domain) filter (where d.domain is not null), '{}') as domains
  from orgs o
  left join org_domains d on d.org_id = o.id`;

export class OrgDirectory {
  constructor(private readonly db: SqlDb) {}

  /**
   * Provision an org: the row, its first admin's member and identity rows,
   * and its domains, in ONE transaction (2026-09-22) — all or nothing, so a
   * failure can leave neither an unreachable org behind nor an org whose
   * founder is not a member. The org_domains primary key is the uniqueness
   * check; a collision is refused as `invalid_request` ("already routes"),
   * which the apex rewords as a taken slug.
   */
  async createOrg(input: CreateOrgInput): Promise<OrgConfig> {
    const id = `org-${ulid().toLowerCase()}`;
    const createdAt = new Date().toISOString();
    const domains = input.domains.map(normalizeDomain);
    const store = new PgStore(this.db, id);
    try {
      await store.transaction(async (tx) => {
        await tx.query('insert into orgs (id, name, created_at, issuer, allowed_email_domains) values ($1, $2, $3, $4, $5)', [
          id,
          input.name,
          createdAt,
          input.issuer ?? null,
          input.allowedEmailDomains ? JSON.stringify(input.allowedEmailDomains) : null,
        ]);
        if (input.firstAdmin) {
          const member: Member = { id: ulid(), displayName: input.firstAdmin.displayName, role: 'admin' };
          await store.putMember(member);
          await store.putIdentity(input.firstAdmin.iss, input.firstAdmin.sub, member.id);
        }
        // Domains last: a collision here rolls back everything above.
        for (const domain of domains) await tx.query('insert into org_domains (domain, org_id) values ($1, $2)', [domain, id]);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'org_domains')) {
        throw new HarborError('invalid_request', `domain ${domains.join(', ')} already routes to an org`);
      }
      throw err;
    }
    return {
      id,
      name: input.name,
      createdAt,
      ...(input.issuer ? { issuer: input.issuer } : {}),
      ...(input.allowedEmailDomains ? { allowedEmailDomains: input.allowedEmailDomains } : {}),
      domains,
    };
  }

  async getByDomain(domain: string): Promise<OrgConfig | undefined> {
    const rows = await this.db.query<OrgRow>(
      `${ORG_SELECT}
       where o.id = (select org_id from org_domains where domain = $1)
       group by o.id`,
      [normalizeDomain(domain)],
    );
    return rows[0] ? toConfig(rows[0]) : undefined;
  }

  async getById(id: string): Promise<OrgConfig | undefined> {
    const rows = await this.db.query<OrgRow>(`${ORG_SELECT} where o.id = $1 group by o.id`, [id]);
    return rows[0] ? toConfig(rows[0]) : undefined;
  }

  /** Every org on the deployment — operator-side. A caller's own orgs are listOrgsForIdentity. */
  async listOrgs(): Promise<OrgConfig[]> {
    const rows = await this.db.query<OrgRow>(`${ORG_SELECT} group by o.id order by o.created_at, o.id`);
    return rows.map(toConfig);
  }

  /**
   * The orgs an identity is a member of, with its member on each — one
   * statement over the identity table (2026-09-22), whatever the number of
   * orgs on the deployment. What the app lists after sign-in (apex.ts).
   */
  async listOrgsForIdentity(iss: string, sub: string): Promise<OrgMembershipRow[]> {
    const rows = await this.db.query<{
      id: string;
      name: string;
      address: string | null;
      member_id: string;
      display_name: string;
      role: Member['role'];
    }>(
      `select o.id, o.name, mi.member_id, m.display_name, m.role,
              (select d.domain from org_domains d where d.org_id = o.id order by d.domain limit 1) as address
         from member_identities mi
         join members m on m.org_id = mi.org_id and m.id = mi.member_id
         join orgs o on o.id = mi.org_id
        where mi.iss = $1 and mi.sub = $2
        order by o.created_at, o.id`,
      [iss, sub],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address ?? '',
      memberId: r.member_id,
      displayName: r.display_name,
      role: r.role,
    }));
  }
}

function toConfig(r: OrgRow): OrgConfig {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    ...(r.issuer !== null ? { issuer: r.issuer } : {}),
    ...(r.allowed_email_domains !== null && r.allowed_email_domains.length > 0
      ? { allowedEmailDomains: r.allowed_email_domains }
      : {}),
    domains: r.domains,
  };
}

/** Postgres SQLSTATE 23505 on the named table — node-postgres exposes `code`; PGlite's message carries the constraint. */
function isUniqueViolation(err: unknown, table: string): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  const unique = code === '23505' || /duplicate key value violates unique constraint/.test(err.message);
  return unique && err.message.includes(table);
}

/** Host values arrive with ports and mixed case; domains are stored bare and lowercase. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/:\d+$/, '');
}
