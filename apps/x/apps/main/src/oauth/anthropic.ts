import crypto from 'crypto';

export const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const ANTHROPIC_AUTH_URL = 'https://claude.ai/oauth/authorize';
export const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';

export interface AnthropicTokenResponse {
    refresh_token: string;
    access_token: string;
    expires_in: number;
}

export interface PkceCodes {
    verifier: string;
    challenge: string;
}

export class AnthropicAuth {
    /**
     * Generates PKCE challenge and verifier.
     */
    static generatePKCE(): PkceCodes {
        const verifier = this.generateRandomString(43);
        const hash = crypto.createHash('sha256').update(verifier).digest();
        const challenge = this.base64UrlEncode(hash);
        return { verifier, challenge };
    }

    private static generateRandomString(length: number): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        return Array.from(crypto.getRandomValues(new Uint8Array(length)))
            .map((b) => chars[b % chars.length])
            .join('');
    }

    private static base64UrlEncode(buffer: Buffer): string {
        return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    /**
     * Generates the authorization URL for the user to visit (requires a callback server).
     */
    static getAuthorizeUrl(pkce: PkceCodes, redirectUri: string): string {
        const url = new URL(ANTHROPIC_AUTH_URL);
        url.searchParams.set('code', 'true');
        url.searchParams.set('client_id', ANTHROPIC_CLIENT_ID);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('scope', 'org:create_api_key user:profile user:inference');
        url.searchParams.set('code_challenge', pkce.challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', pkce.verifier);
        return url.toString();
    }

    /**
     * Exchanges the authorization code received in the callback for tokens.
     */
    static async exchangeCodeForTokens(
        code: string,
        verifier: string,
        redirectUri: string
    ): Promise<AnthropicTokenResponse> {
        const response = await fetch(ANTHROPIC_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                code: code,
                state: verifier, // Note: OpenCode uses the verifier as the state validation in the exchange body format
                grant_type: 'authorization_code',
                client_id: ANTHROPIC_CLIENT_ID,
                redirect_uri: redirectUri,
                code_verifier: verifier,
            }),
        });

        if (!response.ok) {
            throw new Error(`Token exchange failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Refreshes an expired access token using the refresh token.
     */
    static async refreshAccessToken(refreshToken: string): Promise<AnthropicTokenResponse> {
        const response = await fetch(ANTHROPIC_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: ANTHROPIC_CLIENT_ID,
            }),
        });

        if (!response.ok) {
            throw new Error(`Token refresh failed: ${response.status}`);
        }

        return response.json();
    }
}
