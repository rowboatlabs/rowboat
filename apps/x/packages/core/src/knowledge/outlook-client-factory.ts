import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';
import { getProviderConfig } from '../auth/providers.js';
import * as oauthClient from '../auth/oauth-client.js';
import type { Configuration } from '../auth/oauth-client.js';
import { OAuthTokens } from '../auth/types.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export class GraphError extends Error {
    constructor(message: string, public readonly status: number) {
        super(message);
        this.name = 'GraphError';
    }
}

/**
 * Token + fetch plumbing for the Microsoft Graph connection. Much simpler than
 * GoogleClientFactory: there is no SDK client object and no rowboat mode — the
 * embedded public client id refreshes locally via openid-client against the
 * static /common endpoints, and every API call goes through `graphFetch`.
 */
export class OutlookClientFactory {
    private static readonly PROVIDER_NAME = 'microsoft';
    private static config: Configuration | null = null;
    private static inFlightToken: Promise<string | null> | null = null;

    private static async getConfig(): Promise<Configuration> {
        if (this.config) return this.config;
        const providerConfig = await getProviderConfig(this.PROVIDER_NAME);
        if (providerConfig.discovery.mode !== 'static' || providerConfig.client.mode !== 'static' || !providerConfig.client.clientId) {
            throw new Error('Microsoft provider must use static endpoints + static client id');
        }
        this.config = oauthClient.createStaticConfiguration(
            providerConfig.discovery.authorizationEndpoint,
            providerConfig.discovery.tokenEndpoint,
            providerConfig.client.clientId,
        );
        return this.config;
    }

    /**
     * Current access token, refreshing proactively when expired. Concurrent
     * callers share one refresh (same dedup pattern as GoogleClientFactory).
     */
    static async getAccessToken(): Promise<string | null> {
        if (this.inFlightToken) return this.inFlightToken;
        this.inFlightToken = this.getAccessTokenInner().finally(() => {
            this.inFlightToken = null;
        });
        return this.inFlightToken;
    }

    private static async getAccessTokenInner(): Promise<string | null> {
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const { tokens } = await oauthRepo.read(this.PROVIDER_NAME);
        if (!tokens) return null;

        if (!oauthClient.isTokenExpired(tokens)) {
            return tokens.access_token;
        }

        if (!tokens.refresh_token) {
            console.log('[OAuth] Microsoft token expired and no refresh token available.');
            await oauthRepo.upsert(this.PROVIDER_NAME, { error: 'Missing refresh token. Please reconnect.' });
            return null;
        }

        try {
            const secsSinceExpiry = Math.floor(Date.now() / 1000) - tokens.expires_at;
            console.log(`[OAuth] Microsoft token expired ${secsSinceExpiry}s ago, refreshing...`);
            const config = await this.getConfig();
            const refreshed: OAuthTokens = await oauthClient.refreshTokens(config, tokens.refresh_token, tokens.scopes);
            await oauthRepo.upsert(this.PROVIDER_NAME, { tokens: refreshed, error: null });
            const ttl = refreshed.expires_at - Math.floor(Date.now() / 1000);
            console.log(`[OAuth] Microsoft token refreshed successfully (ttl=${ttl}s)`);
            return refreshed.access_token;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to refresh Microsoft token';
            await oauthRepo.upsert(this.PROVIDER_NAME, { error: message });
            console.error('[OAuth] Failed to refresh Microsoft token:', error);
            return null;
        }
    }

    /**
     * Call the Graph API. `pathOrUrl` is either a path relative to /v1.0
     * (e.g. `/me/messages?$top=100`) or an absolute URL (delta/next links).
     *
     * Always sends `Prefer: IdType="ImmutableId"` so message ids survive folder
     * moves (archive!); pass additional Prefer values via init.headers and they
     * are merged. 429s honor Retry-After once; a 401 marks the connection as
     * needing reconnect (proactive refresh means a 401 is a revoked grant, not
     * simple expiry). Returns the parsed JSON body, or null for empty replies
     * (202 send, 204 delete).
     */
    static async graphFetch<T = unknown>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
        const token = await this.getAccessToken();
        if (!token) throw new GraphError('Outlook is not connected.', 401);

        const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;

        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token}`);
        const extraPrefer = headers.get('Prefer');
        headers.set('Prefer', extraPrefer ? `IdType="ImmutableId", ${extraPrefer}` : 'IdType="ImmutableId"');
        if (init.body && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        let res = await fetch(url, { ...init, headers });

        if (res.status === 429) {
            const retryAfter = Number(res.headers.get('Retry-After'));
            const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2000;
            console.warn(`[Outlook] Graph 429 — retrying after ${waitMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            res = await fetch(url, { ...init, headers });
        }

        if (res.status === 401) {
            const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
            await oauthRepo.upsert(this.PROVIDER_NAME, { error: 'Reconnect Microsoft' });
            this.clearCache();
            throw new GraphError('Microsoft authorization was revoked. Please reconnect.', 401);
        }

        if (!res.ok) {
            let detail = '';
            try {
                const body = await res.json() as { error?: { code?: string; message?: string } };
                detail = body?.error?.message || body?.error?.code || '';
            } catch { /* non-JSON error body */ }
            throw new GraphError(`Graph request failed (${res.status})${detail ? `: ${detail}` : ''}`, res.status);
        }

        if (res.status === 204) return null as T;
        const contentType = res.headers.get('Content-Type') || '';
        if (!contentType.includes('json')) return null as T;
        return await res.json() as T;
    }

    /**
     * Connection/scope check. Microsoft echoes fully-qualified Graph scopes
     * (`https://graph.microsoft.com/Mail.ReadWrite`) but tenants can return
     * short forms, so scopes are matched by suffix; `offline_access` is granted
     * but never echoed and must not be required here.
     */
    static async getCredentialStatus(requiredScopes: string | string[]): Promise<{
        connected: boolean;
        hasRequiredScopes: boolean;
        missingScopes: string[];
    }> {
        const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
        const { tokens } = await oauthRepo.read(this.PROVIDER_NAME);
        const scopesArray = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
        if (!tokens) {
            return { connected: false, hasRequiredScopes: false, missingScopes: scopesArray };
        }
        const granted = tokens.scopes ?? [];
        if (granted.length === 0) {
            return { connected: true, hasRequiredScopes: false, missingScopes: scopesArray };
        }
        const missingScopes = scopesArray.filter((required) => {
            const shortName = required.split('/').pop() || required;
            return !granted.some((g) => g === required || g.endsWith(`/${shortName}`) || g === shortName);
        });
        return { connected: true, hasRequiredScopes: missingScopes.length === 0, missingScopes };
    }

    static async hasValidCredentials(requiredScopes: string | string[]): Promise<boolean> {
        const status = await this.getCredentialStatus(requiredScopes);
        return status.hasRequiredScopes;
    }

    static clearCache(): void {
        this.config = null;
    }
}
