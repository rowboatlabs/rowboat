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
    if (!res.ok) {
        const err = await readError(res);
        throw new Error(`refresh failed: ${res.status} ${err.error ?? ""}`.trim());
    }
    const body = (await res.json()) as ApiTokenResponse;
    return toOAuthTokens(body, refreshToken, existingScopes);
}
