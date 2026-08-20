import { Hono } from 'hono';
import type { AuthDriver } from './auth.js';
import { consentPageHtml } from './consent.js';
import type { OrgDirectory } from './directory.js';
import { HarborError } from './errors.js';
import type { SpaceHub } from './hub.js';
import { PgStore } from './pg-store.js';
import { HarborService } from './service.js';
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
  /** Shared event hub — the seeded space's events flow like any other. */
  hub: SpaceHub;
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
    const store = new PgStore(deps.db, org.id);
    const member = await store.getMemberByIdentity(identity.iss, identity.sub);
    // Landing area: a first space with a welcome README, so a fresh org is a
    // place rather than an empty list. Attributed to the founder — every act
    // belongs to a member, and this is theirs.
    if (member) {
      const service = new HarborService(store, deps.hub, { name: org.name, address: domain });
      const space = await service.createSpace({ memberId: member.id }, 'Main');
      await service.proposeChange({ memberId: member.id }, space.id, {
        assetPath: 'README.md',
        baseVersion: 0,
        newContent: welcomeReadme(org.name),
        reason: 'seed the landing page',
        actingMode: 'direct',
      });
    }
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

function welcomeReadme(orgName: string): string {
  return `# Welcome to ${orgName}

This is your team's shared corner. **Main** is its first space — talk and files in one place, for you, your teammates, and everyone's agents.

## What happens here

- **Talk in Messages.** The open stream is where the team thinks out loud. A message that gets replies becomes its own topic.
- **Files are the record.** Anything the team agrees on — plans, notes, decisions — lives here as files everyone (and everyone's agent) can read and propose changes to. This README is one: edit it, replace it, make it yours.
- **Ask @rowboat.** Mention @rowboat in any message and *your* agent picks it up — summarize a thread, draft a doc, fold a decision into a file.
- **Invite your team.** Share an invite link from the space menu. Each person signs in with their own account, and each person's agent acts as them — never as a bot with special powers.

## When to make more spaces

Start here in Main. When one project or team-area grows its own steady stream of talk and files, give it a space of its own — spaces are cheap, attention isn't.
`;
}

function adminDisplayName(identity: { sub: string; email?: string; name?: string }): string {
  const name = identity.name?.trim();
  if (name) return name.slice(0, 128);
  const local = identity.email?.split('@')[0];
  if (local) return local.slice(0, 128);
  return identity.sub.slice(0, 24);
}
