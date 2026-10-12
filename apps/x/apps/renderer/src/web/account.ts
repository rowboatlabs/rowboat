import {
    authServerMetadata,
    authorizeUrl,
    discoverIssuer,
    exchangeCode,
    pkceChallenge,
    randomToken,
    refreshTokens,
    registerPublicClient,
    SessionEndedError,
    type SpacesTokens,
} from '@x/spaces-client'
import { APEX_URL, DEV_HARBOR } from './config'

// The browser's Rowboat session (2026-10-09, the Spaces web app): the phone's
// journey, as a full-page redirect. The apex names the authorization server;
// the browser registers itself once per issuer (as every desktop install and
// phone does); PKCE carries the round trip; the tokens live in localStorage.
// Tokens are realm-generic, so the one session serves the apex and every org.
//
// Refresh tokens rotate on use, so two tabs refreshing together would burn
// each other's: a refresh runs under a Web Lock and re-reads storage inside
// it, so the second tab picks up the first one's tokens.

const SESSION_KEY = 'rowboat.spaces.web.session.v1'
const CLIENTS_KEY = 'rowboat.spaces.web.clients.v1'
const PENDING_KEY = 'rowboat.spaces.web.pending.v1'
const SCOPES = 'openid email profile'
const REFRESH_EARLY_MS = 60_000

export const CALLBACK_PATH = '/auth/callback'

interface StoredSession {
    issuer: string
    clientId: string
    tokens: SpacesTokens
}

interface PendingSignIn {
    issuer: string
    clientId: string
    verifier: string
    state: string
    returnTo: string
}

const redirectUri = () => `${window.location.origin}${CALLBACK_PATH}`

function readJson<T>(storage: Storage, key: string): T | null {
    try {
        const raw = storage.getItem(key)
        return raw ? (JSON.parse(raw) as T) : null
    } catch {
        return null
    }
}

function readSession(): StoredSession | null {
    return readJson<StoredSession>(localStorage, SESSION_KEY)
}

function writeSession(session: StoredSession | null): void {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
}

const sessionListeners = new Set<() => void>()

/** Fires when the session starts or ends, in this tab or another. */
export function onSessionChange(listener: () => void): () => void {
    sessionListeners.add(listener)
    return () => sessionListeners.delete(listener)
}

window.addEventListener('storage', (event) => {
    if (event.key === SESSION_KEY && (event.oldValue === null) !== (event.newValue === null)) {
        for (const listener of sessionListeners) listener()
    }
})

/** A local dev Harbor needs no session: its tokens are dev tokens. */
export function hasSession(): boolean {
    return !!DEV_HARBOR || readSession() !== null
}

async function clientIdFor(issuer: string): Promise<string> {
    const clients = readJson<Record<string, string>>(localStorage, CLIENTS_KEY) ?? {}
    const key = `${issuer} ${redirectUri()}`
    if (clients[key]) return clients[key]
    const clientId = await registerPublicClient(await authServerMetadata(issuer), { name: 'Rowboat Web', redirectUri: redirectUri() })
    localStorage.setItem(CLIENTS_KEY, JSON.stringify({ ...clients, [key]: clientId }))
    return clientId
}

/** Leave for the authorization server; the callback lands back on `returnTo`. Never resolves. */
export async function beginSignIn(returnTo: string): Promise<never> {
    const issuer = await discoverIssuer(APEX_URL)
    if (!issuer) throw new Error('This Spaces server names no sign-in provider.')
    const meta = await authServerMetadata(issuer)
    const clientId = await clientIdFor(meta.issuer)
    const pending: PendingSignIn = { issuer: meta.issuer, clientId, verifier: randomToken(32), state: randomToken(16), returnTo }
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    window.location.assign(authorizeUrl(meta, {
        clientId,
        redirectUri: redirectUri(),
        scope: SCOPES,
        state: pending.state,
        challenge: await pkceChallenge(pending.verifier),
    }))
    return new Promise<never>(() => {})
}

/** On the callback path: finish the exchange and say where to land. */
export async function completeSignIn(url: URL): Promise<string> {
    const pending = readJson<PendingSignIn>(sessionStorage, PENDING_KEY)
    sessionStorage.removeItem(PENDING_KEY)
    const error = url.searchParams.get('error')
    if (error) throw new Error(`Sign-in was not completed: ${url.searchParams.get('error_description') ?? error}`)
    if (!pending || url.searchParams.get('state') !== pending.state) throw new Error('This sign-in was not started here. Try signing in again.')
    const code = url.searchParams.get('code')
    if (!code) throw new Error('Sign-in failed: the provider sent no authorization code.')
    const meta = await authServerMetadata(pending.issuer)
    const tokens = await exchangeCode(meta, { code, clientId: pending.clientId, redirectUri: redirectUri(), verifier: pending.verifier })
    writeSession({ issuer: meta.issuer, clientId: pending.clientId, tokens })
    return pending.returnTo.startsWith('/') && !pending.returnTo.startsWith('//') ? pending.returnTo : '/'
}

export function signOut(): void {
    writeSession(null)
    for (const listener of sessionListeners) listener()
}

/** A bearer for Harbor; refreshed when near expiry, or when the last one was refused. */
export async function getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string> {
    const seen = readSession()
    if (!seen) throw new Error('Not signed in.')
    if (!opts?.forceRefresh && seen.tokens.expiresAt - Date.now() > REFRESH_EARLY_MS) return seen.tokens.access
    const refresh = async (): Promise<string> => {
        const latest = readSession()
        if (!latest) throw new Error('Not signed in.')
        // Another tab refreshed while this one waited for the lock.
        if (latest.tokens.access !== seen.tokens.access && latest.tokens.expiresAt - Date.now() > REFRESH_EARLY_MS) return latest.tokens.access
        try {
            const meta = await authServerMetadata(latest.issuer)
            const tokens = await refreshTokens(meta, { clientId: latest.clientId, refreshToken: latest.tokens.refresh })
            writeSession({ ...latest, tokens })
            return tokens.access
        } catch (err) {
            if (err instanceof SessionEndedError) signOut()
            throw err
        }
    }
    return navigator.locks ? navigator.locks.request('rowboat-spaces-refresh', refresh) : refresh()
}
