// A cloud instance (Baarali) holds no sign-in of its own: its session is a
// token the control plane issued, which a Spaces server cannot verify. Where
// BAARALI_SPACES_TOKEN_URL is set, that token is traded there for a short
// Spaces token (a JWT the Spaces server checks alone), kept until a minute
// before it ends. Unset — the desktop signed in itself — nothing changes.

interface Held {
    session: string;
    token: string;
    expiresAt: number;
}

let held: Held | null = null;
let inFlight: Promise<Held> | null = null;

async function trade(url: string, session: string): Promise<Held> {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${session}` } });
    if (!res.ok) throw new Error(`Spaces token: ${url} returned ${res.status}`);
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
        throw new Error('Spaces token: malformed response');
    }
    return { session, token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
}

/** The Spaces token for this session; `forceRefresh` is the 401 path. */
export async function exchangeForSpaces(url: string, session: string, opts?: { forceRefresh?: boolean }): Promise<string> {
    const fresh = held && held.session === session && held.expiresAt - Date.now() > 60_000;
    if (fresh && !opts?.forceRefresh) return held!.token;
    if (!inFlight) {
        inFlight = trade(url, session).finally(() => {
            inFlight = null;
        });
    }
    held = await inFlight;
    return held.token;
}
