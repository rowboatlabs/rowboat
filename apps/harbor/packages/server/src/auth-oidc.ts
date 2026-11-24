import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Member } from '@rowboat/spaces-protocol';
import type { AuthDriver, AuthIdentity } from './auth.js';
import { HarborError } from './errors.js';
import type { Store } from './store.js';

// The real auth driver (spec §4, spike-verified 2026-08-18): Harbor is only
// ever a RESOURCE server. This driver pins one issuer per org, discovers its
// JWKS via RFC 8414 metadata, verifies bearers offline, and maps
// (iss, sub) → member with NO auto-create — a valid token with no mapping is
// `not_a_member`, the state the invite ceremony converts. The AS behind the
// issuer is pluggable (Supabase Auth flagship, Keycloak, corporate IdP);
// nothing here is Supabase-specific.

export interface OidcOptions {
  /** The pinned issuer URL, e.g. https://<project>.supabase.co/auth/v1 */
  issuer: string;
  /**
   * Optional `aud` check. Deliberately off by default: shared AS realms mint
   * realm-generic audiences (Supabase: "authenticated" — RFC 8707 ignored),
   * so membership is the authorization boundary, not the audience.
   */
  audience?: string;
  /** Accepted signature algorithms. Supabase mints ES256. */
  algorithms?: string[];
}

interface AsMetadata {
  issuer: string;
  jwks_uri: string;
}

export class OidcAuthDriver implements AuthDriver {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private discovering?: Promise<ReturnType<typeof createRemoteJWKSet>>;

  constructor(private readonly options: OidcOptions) {}

  metadata(): { authorizationServers: string[] } {
    return { authorizationServers: [this.options.issuer] };
  }

  async authenticate(authorization: string | undefined, queryToken?: string | null): Promise<AuthIdentity> {
    const raw = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : (queryToken ?? undefined);
    if (!raw) throw new HarborError('unauthorized', 'missing bearer token');

    const jwks = await this.getJwks();
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(raw, jwks, {
        issuer: this.options.issuer,
        algorithms: this.options.algorithms ?? ['ES256', 'RS256'],
        ...(this.options.audience ? { audience: this.options.audience } : {}),
      });
      payload = verified.payload;
    } catch {
      throw new HarborError('unauthorized', 'invalid or expired token');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new HarborError('unauthorized', 'token has no subject');
    }
    // GoTrue puts the social profile's name in user_metadata; plain `name` is
    // the generic OIDC location.
    const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
    const name = [payload.name, meta.full_name, meta.name].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
    return {
      iss: this.options.issuer,
      sub: payload.sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(name ? { name } : {}),
    };
  }

  async resolveMember(store: Store, identity: AuthIdentity): Promise<Member> {
    const member = await store.getMemberByIdentity(identity.iss, identity.sub);
    if (!member) {
      throw new HarborError('not_a_member', 'authenticated identity is not a member of this org');
    }
    return member;
  }

  /**
   * Lazy one-time discovery; jose's remote JWK set handles kid-keyed caching
   * and refetch-on-unknown-kid (rate-limited by its default cooldown), so key
   * rotation at the AS needs nothing from us. Discovery failures are
   * `internal`, not `unauthorized` — the token was never judged.
   */
  private getJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (this.jwks) return Promise.resolve(this.jwks);
    this.discovering ??= this.discover()
      .then((jwks) => {
        this.jwks = jwks;
        return jwks;
      })
      .finally(() => {
        this.discovering = undefined;
      });
    return this.discovering;
  }

  private async discover(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    const issuer = this.options.issuer.replace(/\/$/, '');
    const { origin, pathname } = new URL(issuer);
    // Suffix placements first (what Supabase and OIDC providers actually
    // serve), then the strict RFC 8414 path-inserted form.
    const candidates = [
      `${issuer}/.well-known/oauth-authorization-server`,
      `${issuer}/.well-known/openid-configuration`,
      `${origin}/.well-known/oauth-authorization-server${pathname === '/' ? '' : pathname}`,
    ];
    for (const url of candidates) {
      let meta: AsMetadata;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        meta = (await res.json()) as AsMetadata;
      } catch {
        continue;
      }
      if (typeof meta.jwks_uri !== 'string') continue;
      // RFC 8414 §3.3: the metadata's issuer MUST match the one we asked about.
      if (meta.issuer !== this.options.issuer && meta.issuer !== issuer) {
        throw new HarborError('internal', `authorization server metadata issuer mismatch (got ${meta.issuer})`);
      }
      return createRemoteJWKSet(new URL(meta.jwks_uri));
    }
    throw new HarborError('internal', `authorization server discovery failed for ${this.options.issuer}`);
  }
}
