import { API_URL } from "../config/env.js";
import { getAccessToken } from "./tokens.js";
import { OAuthTokens } from "./types.js";

/**
 * Client for the rowboat-mode Google OAuth endpoints on the api:
 *   POST /v1/google-oauth/claim   — one-shot retrieval of tokens parked by
 *                                   the webapp callback under a `state` ticket
 *   POST /v1/google-oauth/refresh — exchange a refresh_token for fresh tokens
 *                                   (the secret-requiring step that can't
 *                                   happen on the desktop)
 *
 * Both are called with the user's Rowboat Supabase bearer (via getAccessToken).
 *
 * The api response shape uses `scope: string` (space-delimited); we convert
 * to the desktop's `scopes: string[]`. On refresh, api may omit `scope` and
 * `refresh_token` — caller-provided existingScopes / refreshToken are
 * preserved in those cases (Google rarely rotates refresh tokens).
 */

/** Thrown when the api signals the user must reconnect (Google `invalid_grant`). */
export class ReconnectRequiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReconnectRequiredError";
    }
}

/**
 * Thrown when the api signals a transient failure (rate limit, in-flight dedup,
 * upstream 5xx) — caller should leave stored tokens untouched and retry on its
 * next tick rather than flagging the user for reconnect.
 *
 * In particular: the backend returns 429 with `Refresh in progress, retry shortly`
 * when two desktop clients race the same refresh; the proactive in-flight dedup
 * in GoogleClientFactory should make that unreachable, but this is the safety
 * net if it ever isn't.
 */
export class TransientRefreshError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "TransientRefreshError";
        this.status = status;
    }
}

interface ApiTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_at: number;
    scope?: string;
    token_type?: string;
}

function toOAuthTokens(
    body: ApiTokenResponse,
    fallbackRefreshToken: string | null = null,
    fallbackScopes?: string[],
): OAuthTokens {
    const refresh_token = body.refresh_token ?? fallbackRefreshToken;
    const scopes = body.scope
        ? body.scope.split(" ").filter((s) => s.length > 0)
        : fallbackScopes;
    return {
        access_token: body.access_token,
        refresh_token,
        expires_at: body.expires_at,
        token_type: "Bearer",
        scopes,
    };
}

async function postWithBearer(path: string, body: unknown): Promise<Response> {
    const bearer = await getAccessToken();
    return fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
    });
}

interface ErrorBody {
    error?: string;
    reconnectRequired?: boolean;
}

async function readError(res: Response): Promise<ErrorBody> {
    try {
        return (await res.json()) as ErrorBody;
    } catch {
        return {};
    }
}

/** Claim the tokens parked under `state` after the webapp finished its callback. */
export async function claimTokensViaBackend(state: string): Promise<OAuthTokens> {
    const res = await postWithBearer("/v1/google-oauth/claim", { session: state });
    if (!res.ok) {
        const err = await readError(res);
        throw new Error(`claim failed: ${res.status} ${err.error ?? ""}`.trim());
    }
    const body = (await res.json()) as ApiTokenResponse;
    return toOAuthTokens(body);
}

/**
 * Claim what the user selected in the managed OAuth-redirect Picker, parked
 * under `session` by the webapp picker callback. Returns the picked file ids
 * plus a fresh drive.file access token — the picker runs a standalone
 * drive.file authorization (the main connection doesn't carry drive.file), so
 * the desktop downloads the picked files with this token, not the main one.
 */
export async function claimPickedFilesViaBackend(
    session: string,
): Promise<{ fileIds: string[]; accessToken: string }> {
    const res = await postWithBearer("/v1/google-oauth/claim-picked", { session });
    if (!res.ok) {
        const err = await readError(res);
        throw new Error(`claim picked files failed: ${res.status} ${err.error ?? ""}`.trim());
    }
    const body = (await res.json()) as { fileIds?: unknown; tokens?: { access_token?: unknown } };
    const fileIds = Array.isArray(body.fileIds)
        ? body.fileIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
    const accessToken = typeof body.tokens?.access_token === "string" ? body.tokens.access_token : "";
    return { fileIds, accessToken };
}

/**
 * Refresh an access token via the api. Preserves caller's `refreshToken` and
 * `existingScopes` when Google omits them on the refresh response.
 */
export async function refreshTokensViaBackend(
    refreshToken: string,
    existingScopes?: string[],
): Promise<OAuthTokens> {
    const res = await postWithBearer("/v1/google-oauth/refresh", { refreshToken });
    if (res.status === 409) {
        const err = await readError(res);
        if (err.reconnectRequired) {
            throw new ReconnectRequiredError(err.error ?? "Reconnect required");
        }
        throw new Error(`refresh failed: 409 ${err.error ?? ""}`.trim());
    }
    // 429 = backend dedup said another refresh is in flight; 5xx = upstream
    // hiccup. Either way the local tokens are still valid for the next attempt
    // — surface as TransientRefreshError so the factory doesn't write a stuck
    // error into oauth.json.
    if (res.status === 429 || res.status >= 500) {
        const err = await readError(res);
        throw new TransientRefreshError(
            `refresh failed: ${res.status} ${err.error ?? ""}`.trim(),
            res.status,
        );
    }
    if (!res.ok) {
        const err = await readError(res);
        throw new Error(`refresh failed: ${res.status} ${err.error ?? ""}`.trim());
    }
    const body = (await res.json()) as ApiTokenResponse;
    return toOAuthTokens(body, refreshToken, existingScopes);
}
