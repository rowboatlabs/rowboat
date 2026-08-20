import { Hono } from 'hono';
import type { AuthDriver } from './auth.js';
import { consentPageHtml } from './consent.js';
import type { OrgDirectory } from './directory.js';
import { HarborError } from './errors.js';
import { PgStore } from './pg-store.js';
import type { SqlDb } from './sql.js';

// The deployment face, served on the APEX domain (spaces.rowboatlabs.com) —
// as opposed to org subdomains. Self-serve org creation, free (decided
// 2026-08-20: no billing norms for now; /internal + limit knobs are parked
// until the knob discussion lands, and a billing world later puts a check in
// front of these same calls rather than replacing them).
//
// Auth here is IDENTITY-level only (the deployment's AS): creating an org is
// the one act with no org to be a member of yet. The (iss, sub) becomes the
// org's provisioned first admin. Tokens from a shared AS realm are
// deliberately realm-generic (spike finding), so the token that created an
// org works at the org's own subdomain immediately.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'apex', 'internal', 'admin', 'mail', 'smtp', 'ftp',
  'auth', 'oauth', 'consent', 'status', 'docs', 'help', 'support', 'billing',
]);

export interface ApexDeps {
  db: SqlDb;
  directory: OrgDirectory;
  auth: AuthDriver;
  /** e.g. spaces.rowboatlabs.com — org domains are `<slug>.<apexDomain>`. */
  apexDomain: string;
  /** The deployment's AS — every created org pins this issuer. */
  issuer: string;
  /**
   * Mounts /oauth/consent here. The AS has ONE consent URL per project and
   * the page is org-agnostic (it only talks to the AS), so the apex is its
   * home — point the AS's authorization/consent URL at
   * https://<apexDomain>/oauth/consent.
   */
  consentPublishableKey?: string;
}

export function buildApexApp(deps: ApexDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    const e = err instanceof HarborError ? err : new HarborError('internal', 'unexpected error');
    if (!(err instanceof HarborError)) console.error('[harbor] apex error:', err);
    if (e.code === 'unauthorized') {
      const origin = new URL(c.req.url).origin;
      c.header('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
    }
    return c.json(e.toBody(), e.status as 400);
  });

  app.get('/v1/health', (c) => c.json({ ok: true, apex: deps.apexDomain }));

  if (deps.consentPublishableKey) {
    const publishableKey = deps.consentPublishableKey;
    app.get('/oauth/consent', (c) =>
      c.html(consentPageHtml({ issuer: deps.issuer, publishableKey, orgName: deps.apexDomain })),
    );
  }

  // Same discovery shape as an org, so the app's existing OAuth dance works
  // against the apex unchanged.
  app.get('/.well-known/oauth-protected-resource', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({ resource: origin, authorization_servers: [deps.issuer], bearer_methods_supported: ['header'] });
  });

  /** Create an org: {name, slug} → org at slug.<apexDomain>, caller = first admin. */
  app.post('/v1/orgs', async (c) => {
    const identity = await deps.auth.authenticate(c.req.header('authorization'));
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; slug?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    if (name.length < 1 || name.length > 128) throw new HarborError('invalid_request', 'name must be 1–128 characters');
    if (!SLUG_RE.test(slug)) {
      throw new HarborError('invalid_request', 'slug must be 1–40 characters: lowercase letters, digits, inner hyphens');
    }
    if (RESERVED_SLUGS.has(slug)) throw new HarborError('invalid_request', `"${slug}" is reserved`);

    const domain = `${slug}.${deps.apexDomain}`;
    let org;
    try {
      org = await deps.directory.createOrg({
        name,
        domains: [domain],
        issuer: deps.issuer,
        firstAdmin: { iss: identity.iss, sub: identity.sub, displayName: adminDisplayName(identity) },
      });
    } catch (err) {
      if (err instanceof Error && /already routes/.test(err.message)) {
        throw new HarborError('invalid_request', `"${slug}" is taken`);
      }
      throw err;
    }
    const member = await new PgStore(deps.db, org.id).getMemberByIdentity(identity.iss, identity.sub);
    return c.json({
      org: { id: org.id, name: org.name, address: domain },
      member: { id: member?.id ?? '', displayName: member?.displayName ?? '', role: 'admin' },
    });
  });

  /** The caller's orgs on this deployment — what the app lists after sign-in. */
  app.get('/v1/orgs', async (c) => {
    const identity = await deps.auth.authenticate(c.req.header('authorization'));
    const orgs = await deps.directory.listOrgs();
    const mine = [];
    for (const org of orgs) {
      const member = await new PgStore(deps.db, org.id).getMemberByIdentity(identity.iss, identity.sub);
      if (member) {
        mine.push({
          id: org.id,
          name: org.name,
          address: org.domains[0] ?? '',
          memberId: member.id,
          displayName: member.displayName,
          role: member.role,
        });
      }
    }
    return c.json({ orgs: mine });
  });

  return app;
}

function adminDisplayName(identity: { sub: string; email?: string; name?: string }): string {
  const name = identity.name?.trim();
  if (name) return name.slice(0, 128);
  const local = identity.email?.split('@')[0];
  if (local) return local.slice(0, 128);
  return identity.sub.slice(0, 24);
}
