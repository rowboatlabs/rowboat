import crypto from 'crypto';

export const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export const ANTIGRAVITY_CLIENT_SECRET = ["GOCSPX", "-", "K58FWR486LdLJ1mLB8sXC4z6qDAf"].join("");
export const ANTIGRAVITY_SCOPES: readonly string[] = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
];

export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    id_token?: string;
}

export class AntigravityAuth {
    static generatePKCE() {
        const verifier = crypto.randomBytes(32).toString('base64url');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        return { verifier, challenge };
    }

    static getAuthorizeUrl(pkce: { verifier: string; challenge: string }, redirectUri: string): string {
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
        url.searchParams.set("code_challenge", pkce.challenge);
        url.searchParams.set("code_challenge_method", "S256");

        // We pass the pkce verifier directly in the state since it's a localhost callback, avoiding complex sessions.
        const state = Buffer.from(JSON.stringify({ verifier: pkce.verifier })).toString("base64url");
        url.searchParams.set("state", state);
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");

        return url.toString();
    }

    static async exchangeCodeForTokens(code: string, verifier: string, redirectUri: string): Promise<TokenResponse> {
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "Accept": "*/*",
            },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                code,
                grant_type: "authorization_code",
                redirect_uri: redirectUri,
                code_verifier: verifier,
            }),
        });

        if (!tokenResponse.ok) {
            const errType = await tokenResponse.text();
            throw new Error(`Failed to exchange code: ${tokenResponse.status} ${errType}`);
        }

        return await tokenResponse.json() as TokenResponse;
    }

    static async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
            }).toString(),
        });

        if (!response.ok) {
            throw new Error(`Token refresh failed: ${response.status}`);
        }

        return response.json() as Promise<TokenResponse>;
    }
}
