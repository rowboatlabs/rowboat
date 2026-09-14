import container from '../di/container.js';
import { IOAuthRepo, isAppSignIn, rowboatSession } from './repo.js';
import { IClientRegistrationRepo } from './client-repo.js';
import { getProviderConfig } from './providers.js';
import * as oauthClient from './oauth-client.js';
import { OAuthTokens } from './types.js';

// The Rowboat session, and its two uses (2026-09-14). The `rowboat` provider
// entry holds ONE set of tokens from the deployment's login desk (Supabase
// Auth). Those tokens are both the app's account (gateway models, billing,
// connectors) and the identity every managed Spaces org trusts — the same
// issuer, the same subject. Two getters keep the uses apart:
//
//   getAccessToken()         the APP's view — refuses a spaces-only session,
//                            so no app feature ever rides a session the
//                            person opened just to join a space.
//   getSessionAccessToken()  the IDENTITY — any healthy session, flag or not.
//                            Spaces calls this; nothing else should.
//
// Refresh is shared and single-flight: rotating refresh tokens mean two
// parallel refreshes would kill each other's result.

let refreshInFlight: Promise<OAuthTokens> | null = null;

async function performRefresh(tokens: OAuthTokens): Promise<OAuthTokens> {
    console.log("Refreshing rowboat access token");
    if (!tokens.refresh_token) {
        throw new Error('Rowboat token expired and no refresh token available. Please sign in again.');
    }

    const providerConfig = await getProviderConfig('rowboat');
    if (providerConfig.discovery.mode !== 'issuer') {
        throw new Error('Rowboat provider requires issuer discovery mode');
    }

    const clientRepo = container.resolve<IClientRegistrationRepo>('clientRegistrationRepo');
    const registration = await clientRepo.getClientRegistration('rowboat');
    if (!registration) {
        throw new Error('Rowboat client not registered. Please sign in again.');
    }

    const config = await oauthClient.discoverConfiguration(
        providerConfig.discovery.issuer,
        registration.client_id,
    );

    const refreshed = await oauthClient.refreshTokens(
        config,
        tokens.refresh_token,
        tokens.scopes,
    );

    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    await oauthRepo.upsert('rowboat', { tokens: refreshed });

    return refreshed;
}

async function sessionToken(tokens: OAuthTokens, opts?: { forceRefresh?: boolean }): Promise<string> {
    if (!opts?.forceRefresh && !oauthClient.isTokenExpired(tokens)) {
        return tokens.access_token;
    }

    if (!refreshInFlight) {
        refreshInFlight = performRefresh(tokens).finally(() => {
            refreshInFlight = null;
        });
    }
    const refreshed = await refreshInFlight;
    return refreshed.access_token;
}

/** The app's account token. Throws when signed out — including a spaces-only session. */
export async function getAccessToken(): Promise<string> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const connection = await oauthRepo.read('rowboat');
    const session = rowboatSession(connection);
    if (!session || !isAppSignIn(connection)) {
        throw new Error('Not signed into Rowboat');
    }
    return sessionToken(session.tokens);
}

/**
 * The identity token for Spaces: any session, spaces-only or not. `forceRefresh`
 * is the 401 path — the token we just used was rejected, get a new one.
 */
export async function getSessionAccessToken(opts?: { forceRefresh?: boolean }): Promise<string> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const session = rowboatSession(await oauthRepo.read('rowboat'));
    if (!session) {
        throw new Error('Sign in with your Rowboat account to use Spaces');
    }
    return sessionToken(session.tokens, opts);
}

export interface SessionState {
    /** The session is the app's sign-in (auth/repo.ts isAppSignIn), not spaces-only. */
    appSignedIn: boolean;
    /** Set when the last refresh failed: the session needs a re-login. */
    error?: string;
}

/** Does a Rowboat session exist at all, and in which use? Null = signed out everywhere. */
export async function readSession(): Promise<SessionState | null> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const connection = await oauthRepo.read('rowboat');
    const session = rowboatSession(connection);
    if (!session) return null;
    return { appSignedIn: isAppSignIn(connection), ...(session.error ? { error: session.error } : {}) };
}
