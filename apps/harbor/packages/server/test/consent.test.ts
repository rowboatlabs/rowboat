import { describe, expect, it } from 'vitest';
import { OidcAuthDriver } from '../src/auth-oidc.js';
import { startHarbor } from '../src/server.js';

// The consent page is config-gated glue (consent.ts): mounted only when an
// oidc driver names an AS AND a publishable key is provided. The page's
// browser-side behavior (claim step, approve/deny) runs against the AS
// directly and is exercised in the live click-through, not here.

const ISSUER = 'https://as.example/auth/v1';

describe('login/consent page', () => {
  it('is NOT mounted under the dev driver', async () => {
    const harbor = await startHarbor({ consent: { publishableKey: 'pk' } });
    const res = await fetch(`${harbor.url}/oauth/consent`);
    expect(res.status).toBe(404);
    await harbor.close();
  });

  it('is NOT mounted without a publishable key', async () => {
    const harbor = await startHarbor({ auth: new OidcAuthDriver({ issuer: ISSUER }) });
    const res = await fetch(`${harbor.url}/oauth/consent`);
    expect(res.status).toBe(404);
    await harbor.close();
  });

  it('serves the page: AS config embedded, providers DERIVED from /settings', async () => {
    const harbor = await startHarbor({
      auth: new OidcAuthDriver({ issuer: ISSUER }),
      consent: { publishableKey: 'pk-test-123' },
      orgName: 'Rowboat <Labs>',
    });
    const res = await fetch(`${harbor.url}/oauth/consent?authorization_id=auth-1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain(ISSUER);
    expect(html).toContain('pk-test-123');
    // Buttons come from the AS's /settings at load time — never hardcoded.
    expect(html).toContain("'/settings'");
    expect(html).toContain('"nonSocial":["email","phone","anonymous_users"]');
    // Ids whose display name isn't just capitalization.
    expect(html).toContain('"azure":"Microsoft"');
    expect(html).toContain('"github":"GitHub"');
    // Harbor never renders a credential form — social sign-in only.
    expect(html).not.toContain('type="password"');
    // Org name is escaped.
    expect(html).toContain('Rowboat &#60;Labs&#62;');
    expect(html).not.toContain('Rowboat <Labs>');
    await harbor.close();
  });
});
