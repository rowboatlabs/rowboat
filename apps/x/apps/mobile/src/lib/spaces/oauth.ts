import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

// The phone side of the OAuth journey (mirror of core/spaces/oauth.ts):
// discovery via RFC 9728 metadata → DCR → PKCE in an auth session with a
// deep-link redirect (rowboat://oauth-callback — verified accepted by
// Supabase DCR, 2026-09-03) → token exchange. Tokens are realm-generic:
// the one sign-in works at the apex and every org on the deployment.

export const REDIRECT_URI = 'rowboat://oauth-callback';
const SCOPES = 'openid email profile';
/** DCR registrations cached per issuer — registering once per install is plenty. */
const CLIENT_KEY = 'rowboat.spaces.oauth.client.v1';

export interface SpacesTokens {
  access: string;
  refresh: string;
  /** epoch ms */
  expiresAt: number;
}

interface AsMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

/** The resource's RFC 9728 metadata names its AS; absence means dev auth. */
export async function discoverIssuer(baseUrl: string): Promise<string | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`).catch(() => null);
  if (!res || res.status === 404) return null;
  if (!res.ok) throw new Error(`metadata request failed (${res.status})`);
  const meta = (await res.json()) as { authorization_servers?: string[] };
  return meta.authorization_servers?.[0] ?? null;
}

async function fetchAsMetadata(issuer: string): Promise<AsMetadata> {
  const base = issuer.replace(/\/$/, '');
  const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
  if (!res.ok) throw new Error(`authorization server metadata failed (${res.status})`);
  return (await res.json()) as AsMetadata;
}

/** Register (or recall) this install's public client at the issuer. */
async function clientIdFor(meta: AsMetadata): Promise<string> {
  const raw = await SecureStore.getItemAsync(CLIENT_KEY).catch(() => null);
  const cache: Record<string, string> = raw ? JSON.parse(raw) : {};
  const cached = cache[meta.issuer];
  if (cached) return cached;

  if (!meta.registration_endpoint) throw new Error('authorization server does not support client registration');
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Rowboat Mobile',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (!res.ok) throw new Error(`client registration failed (${res.status}): ${await res.text().catch(() => '')}`);
  const registration = (await res.json()) as { client_id: string };
  cache[meta.issuer] = registration.client_id;
  await SecureStore.setItemAsync(CLIENT_KEY, JSON.stringify(cache));
  return registration.client_id;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The full browser dance: opens an auth session, resolves with tokens once
 * the person signs in and consents. Throws on cancel/denial.
 */
export async function danceForTokens(issuer: string): Promise<{ issuer: string; clientId: string; tokens: SpacesTokens }> {
  const meta = await fetchAsMetadata(issuer);
  const clientId = await clientIdFor(meta);

  const verifier = base64url(Crypto.getRandomBytes(32));
  const challenge = base64url(
    new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(verifier))),
  );
  const state = base64url(Crypto.getRandomBytes(16));

  const authorize = new URL(meta.authorization_endpoint);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', REDIRECT_URI);
  authorize.searchParams.set('scope', SCOPES);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  const result = await WebBrowser.openAuthSessionAsync(authorize.toString(), REDIRECT_URI);
  if (result.type !== 'success') throw new Error(result.type === 'cancel' || result.type === 'dismiss' ? 'sign-in cancelled' : 'sign-in failed');
  const callback = new URL(result.url);
  const error = callback.searchParams.get('error');
  if (error) throw new Error(`sign-in denied: ${callback.searchParams.get('error_description') ?? error}`);
  if (callback.searchParams.get('state') !== state) throw new Error('sign-in failed: state mismatch');
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('sign-in failed: no authorization code in callback');

  const tokens = await tokenRequest(meta.token_endpoint, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (!tokens.refresh) throw new Error('the authorization server returned no refresh token');
  return { issuer: meta.issuer, clientId, tokens };
}

export async function refreshTokens(issuer: string, clientId: string, refreshToken: string): Promise<SpacesTokens> {
  const meta = await fetchAsMetadata(issuer);
  const tokens = await tokenRequest(meta.token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  // Servers may rotate or omit the refresh token; keep the old one if omitted.
  return { ...tokens, refresh: tokens.refresh || refreshToken };
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
    throw new Error(`token request failed (${res.status}): ${json.error_description ?? json.error ?? 'no access token'}`);
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token ?? '',
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}
