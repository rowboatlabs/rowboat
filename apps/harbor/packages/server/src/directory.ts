import { monotonicFactory } from 'ulid';
import type { Member } from '@rowboat/spaces-protocol';
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

interface OrgRow {
  id: string;
  name: string;
  created_at: string;
  issuer: string | null;
  allowed_email_domains: string[] | null;
}

const ulid = monotonicFactory();

export class OrgDirectory {
  constructor(private readonly db: SqlDb) {}

  async createOrg(input: CreateOrgInput): Promise<OrgConfig> {
    const id = `org-${ulid().toLowerCase()}`;
    const createdAt = new Date().toISOString();
    for (const domain of input.domains) {
      const taken = await this.db.query<{ org_id: string }>('select org_id from org_domains where domain = $1', [
        normalizeDomain(domain),
      ]);
      if (taken.length > 0) throw new Error(`domain ${domain} already routes to an org`);
    }
    await this.db.query('insert into orgs (id, name, created_at, issuer, allowed_email_domains) values ($1, $2, $3, $4, $5)', [
      id,
      input.name,
      createdAt,
      input.issuer ?? null,
      input.allowedEmailDomains ? JSON.stringify(input.allowedEmailDomains) : null,
    ]);
    for (const domain of input.domains) {
      await this.db.query('insert into org_domains (domain, org_id) values ($1, $2)', [normalizeDomain(domain), id]);
    }
    if (input.firstAdmin) {
      const store = new PgStore(this.db, id);
      const member: Member = { id: ulid(), displayName: input.firstAdmin.displayName, role: 'admin' };
      await store.putMember(member);
      await store.putIdentity(input.firstAdmin.iss, input.firstAdmin.sub, member.id);
    }
    return {
      id,
      name: input.name,
      createdAt,
      ...(input.issuer ? { issuer: input.issuer } : {}),
      ...(input.allowedEmailDomains ? { allowedEmailDomains: input.allowedEmailDomains } : {}),
      domains: input.domains.map(normalizeDomain),
    };
  }

  async getByDomain(domain: string): Promise<OrgConfig | undefined> {
    const rows = await this.db.query<OrgRow & { domain: string }>(
      `select o.*, d.domain from org_domains d join orgs o on o.id = d.org_id where d.domain = $1`,
      [normalizeDomain(domain)],
    );
    const r = rows[0];
    return r ? this.hydrate(r) : undefined;
  }

  async getById(id: string): Promise<OrgConfig | undefined> {
    const rows = await this.db.query<OrgRow>('select * from orgs where id = $1', [id]);
    const r = rows[0];
    return r ? this.hydrate(r) : undefined;
  }

  async listOrgs(): Promise<OrgConfig[]> {
    const rows = await this.db.query<OrgRow>('select * from orgs order by created_at, id');
    return Promise.all(rows.map((r) => this.hydrate(r)));
  }

  private async hydrate(r: OrgRow): Promise<OrgConfig> {
    const domains = await this.db.query<{ domain: string }>('select domain from org_domains where org_id = $1 order by domain', [
      r.id,
    ]);
    return {
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      ...(r.issuer !== null ? { issuer: r.issuer } : {}),
      ...(r.allowed_email_domains !== null && r.allowed_email_domains.length > 0
        ? { allowedEmailDomains: r.allowed_email_domains }
        : {}),
      domains: domains.map((d) => d.domain),
    };
  }
}

/** Host values arrive with ports and mixed case; domains are stored bare and lowercase. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/:\d+$/, '');
}
