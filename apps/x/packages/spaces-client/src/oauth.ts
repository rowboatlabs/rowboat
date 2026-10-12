// The public-client half of Harbor's OAuth (CONTRACT.md decision 4), for an
// app that talks to Harbor directly: RFC 9728 discovery from a Harbor origin,
// RFC 8414 metadata, dynamic client registration, PKCE (S256), and the token
// exchange and refresh. The browser uses it (2026-10-09, the Spaces web-app
// plan); the phone's lib/spaces/oauth.ts is the same journey with its own
// redirect and keychain. Storage and the redirect itself belong to the app.
//
// Tokens are realm-generic (Supabase Auth, the flagship): one sign-in works
// at the apex and at every org on the deployment.

export interface SpacesTokens {
  access: string;
  refresh: string;
  /** epoch ms */
  expiresAt: number;
}

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

/** The issuer a Harbor origin names in its resource metadata; null under dev auth (404). */
export async function discoverIssuer(harborUrl: string): Promise<string | null> {
  const res = await fetch(`${harborUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`resource metadata request failed (${res.status})`);
  const meta = (await res.json()) as { authorization_servers?: string[] };
  return meta.authorization_servers?.[0] ?? null;
}

export async function authServerMetadata(issuer: string): Promise<AuthServerMetadata> {
  const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`);
  if (!res.ok) throw new Error(`authorization server metadata failed (${res.status})`);
  return (await res.json()) as AuthServerMetadata;
}

/** Register a public client (no secret) for one redirect URI; returns its client_id. */
export async function registerPublicClient(
  meta: AuthServerMetadata,
  client: { name: string; redirectUri: string },
): Promise<string> {
  if (!meta.registration_endpoint) throw new Error('the authorization server does not support client registration');
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: client.name,
      redirect_uris: [client.redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (!res.ok) throw new Error(`client registration failed (${res.status}): ${await res.text().catch(() => '')}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An unguessable URL-safe string: the PKCE verifier, the state. */
export function randomToken(bytes = 32): string {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(
  meta: AuthServerMetadata,
  input: { clientId: string; redirectUri: string; scope: string; state: string; challenge: string },
): string {
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scope);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCode(
  meta: AuthServerMetadata,
  input: { code: string; clientId: string; redirectUri: string; verifier: string },
): Promise<SpacesTokens> {
  const tokens = await tokenRequest(meta.token_endpoint, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.verifier,
  });
  if (!tokens.refresh) throw new Error('the authorization server returned no refresh token');
  return tokens;
}

export async function refreshTokens(meta: AuthServerMetadata, input: { clientId: string; refreshToken: string }): Promise<SpacesTokens> {
  const tokens = await tokenRequest(meta.token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });
  // A server may rotate the refresh token or omit it; keep the old one if omitted.
  return { ...tokens, refresh: tokens.refresh || input.refreshToken };
}

/** A refresh the authorization server refused: the session is over, not the network. */
export class SessionEndedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionEndedError';
  }
}

async function tokenRequest(endpoint: string, params: Record<string, string>): Promise<SpacesTokens> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const message = `token request failed (${res.status}): ${json.error_description ?? json.error ?? 'no access token'}`;
    // 400/401 with an OAuth error is the server saying no (a used, revoked or
    // expired refresh token); anything else may pass on a retry.
    if ((res.status === 400 || res.status === 401) && json.error) throw new SessionEndedError(message);
    throw new Error(message);
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token ?? '',
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}
