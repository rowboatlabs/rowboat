import { useState, useEffect, useCallback } from 'react';

export interface OAuthProviderState {
    connected: boolean;
    error?: string | null;
}

export type OAuthState = Record<string, OAuthProviderState>;

/**
 * Maps OAuth provider keys to their provider flavor IDs.
 * OAuth repo uses keys like 'chatgpt', etc.
 * while the model system uses flavors like 'openai', etc.
 * Note: Anthropic blocked third-party OAuth in Feb 2026, so it's API-key-only.
 */
const OAUTH_KEY_TO_FLAVOR: Record<string, string> = {
    'chatgpt': 'openai',
    'antigravity': 'antigravity',
    'google': 'google',
};

const FLAVOR_TO_OAUTH_KEY: Record<string, string> = {
    'openai': 'chatgpt',
    'antigravity': 'antigravity',
    'google': 'google',
};

/**
 * Hook to track OAuth connection state for all providers.
 * Returns connection status mapped to provider flavor IDs.
 */
export function useOAuthState() {
    const [oauthState, setOAuthState] = useState<OAuthState>({});
    const [isLoading, setIsLoading] = useState(true);

    const fetchState = useCallback(async () => {
        try {
            const result = await window.ipc.invoke('oauth:getState', null);
            const mapped: OAuthState = {};

            for (const [key, value] of Object.entries(result.config)) {
                const flavor = OAUTH_KEY_TO_FLAVOR[key];
                if (flavor) {
                    mapped[flavor] = value;
                }
                // Also keep original key for direct lookup
                mapped[key] = value;
            }

            setOAuthState(mapped);
        } catch {
            // Ignore errors silently
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchState();

        // Listen for OAuth connection changes
        const cleanup = window.ipc.on('oauth:didConnect', () => {
            fetchState();
        });

        return cleanup;
    }, [fetchState]);

    /**
     * Check if a provider flavor is connected via OAuth
     */
    const isConnected = useCallback((flavor: string): boolean => {
        return oauthState[flavor]?.connected ?? false;
    }, [oauthState]);

    /**
     * Check if a provider flavor supports OAuth login (vs API key only)
     */
    const supportsOAuth = useCallback((flavor: string): boolean => {
        return flavor in FLAVOR_TO_OAUTH_KEY;
    }, []);

    /**
     * Get the OAuth connection error for a provider, if any
     */
    const getError = useCallback((flavor: string): string | null => {
        return oauthState[flavor]?.error ?? null;
    }, [oauthState]);

    /**
     * Check if a provider has any auth (OAuth connected OR likely has API key)
     * For OAuth providers, checks connection. For API-key-only providers, always returns true
     * (since we can't check if the API key is set from the renderer).
     */
    const hasAuth = useCallback((flavor: string): boolean => {
        if (flavor in FLAVOR_TO_OAUTH_KEY) {
            return isConnected(flavor);
        }
        // API-key-only providers (openrouter, ollama, etc.) - we can't tell from here
        return true;
    }, [isConnected]);

    return {
        oauthState,
        isLoading,
        isConnected,
        supportsOAuth,
        getError,
        hasAuth,
        refresh: fetchState,
    };
}
