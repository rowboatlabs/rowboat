import { API_URL } from "./env.js";

/**
 * Per-process cache of the unauthenticated `GET /v1/config` response from
 * the api. The api returns `{ appUrl, supabaseUrl, websocketApiUrl }` —
 * we use this to discover the webapp host (where the rowboat-mode OAuth
 * flow runs) without hardcoding it on the desktop side.
 *
 * Cached as a Promise so concurrent first-callers all await the same fetch
 * (no thundering herd). On failure the cache is cleared so the next call
 * can retry.
 */

interface RemoteConfig {
    appUrl: string;
    supabaseUrl: string;
    websocketApiUrl: string;
}

let _cached: Promise<RemoteConfig> | null = null;

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
    };
}

export async function getRemoteConfig(): Promise<RemoteConfig> {
    if (!_cached) {
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
