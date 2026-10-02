import { API_URL } from "./env.js";

/**
 * Per-process cache of the unauthenticated `GET /v1/config` response from
 * the api. The api returns `{ appUrl, supabaseUrl, websocketApiUrl }` —
 * we use this to discover the webapp host (where the rowboat-mode OAuth
 * flow runs) without hardcoding it on the desktop side.
 *
 * Cached as a Promise so concurrent first-callers all await the same fetch
 * (no thundering herd). On failure the cache is cleared so the next call
 * can retry. A success is kept for CACHE_MS only: a long-lived process (a
 * cloud instance that sleeps and wakes with its memory intact) would
 * otherwise never see the api's config change, e.g. Spaces turned on.
 */

const CACHE_MS = 10 * 60 * 1000;

interface RemoteConfig {
    appUrl: string;
    supabaseUrl: string;
    websocketApiUrl: string;
    /** Rowboat Spaces managed apex (org creation) — null until a fleet exists for this environment. */
    spacesApexUrl: string | null;
    /** Whether the api proxies Composio (`/v1/composio`); absent means it does. */
    composio: boolean;
}

let _cached: Promise<RemoteConfig> | null = null;
let _fetchedAt = 0;

async function fetchRemoteConfig(): Promise<RemoteConfig> {
    const res = await fetch(`${API_URL}/v1/config`);
    if (!res.ok) {
        throw new Error(`/v1/config returned ${res.status}`);
    }
    const body = (await res.json()) as Partial<RemoteConfig>;
    if (!body.appUrl) {
        throw new Error("/v1/config response missing appUrl");
    }
    return {
        appUrl: body.appUrl,
        supabaseUrl: body.supabaseUrl ?? "",
        websocketApiUrl: body.websocketApiUrl ?? "",
        spacesApexUrl: body.spacesApexUrl ?? null,
        composio: body.composio !== false,
    };
}

export async function getRemoteConfig(): Promise<RemoteConfig> {
    if (!_cached || Date.now() - _fetchedAt > CACHE_MS) {
        _fetchedAt = Date.now();
        _cached = fetchRemoteConfig().catch((err) => {
            _cached = null; // allow retry
            throw err;
        });
    }
    return _cached;
}

export async function getWebappUrl(): Promise<string> {
    const config = await getRemoteConfig();
    return config.appUrl;
}
