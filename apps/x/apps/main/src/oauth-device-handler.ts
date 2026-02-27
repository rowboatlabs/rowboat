import { shell } from 'electron';
import { ChatGPTAuth } from './oauth/chatgpt.js';
import { AnthropicAuth } from './oauth/anthropic.js';
import { AntigravityAuth } from './oauth/antigravity.js';
import container from '@x/core/dist/di/container.js';
import type { IOAuthRepo } from '@x/core/dist/auth/repo.js';
import { emitOAuthEvent } from './ipc.js';
import { createAuthServer } from './auth-server.js';

const REDIRECT_URI = 'http://localhost:8080/oauth/callback';

function getOAuthRepo(): IOAuthRepo {
    return container.resolve<IOAuthRepo>('oauthRepo');
}

/**
 * Normalizes vendor-specific token responses to our OAuthTokens schema.
 */
function normalizeOAuthTokens(tokens: any): any {
    const expiresIn = tokens.expires_in || 3600;
    return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        token_type: 'Bearer',
        scopes: tokens.scopes || tokens.scope?.split(' ') || []
    };
}

export async function handleChatGPTDeviceAuth(): Promise<{ success: boolean; deviceCode?: string; verificationUri?: string; error?: string }> {
    try {
        const { deviceData, url } = await ChatGPTAuth.initiateDeviceAuth();

        // The user needs to input the device code `deviceData.user_code`.
        // We launch the browser pointing directly to the device activation page with the query mapped 
        // so it ideally auto-fills, otherwise they must paste it.
        shell.openExternal(`${url}?user_code=${deviceData.user_code}`);

        // Begin polling the auth.openai.com endpoint asynchronously so we can
        // return the device code to the UI immediately
        ChatGPTAuth.pollForTokens(deviceData).then(async (tokens) => {
            const oauthRepo = getOAuthRepo();
            const normalized = normalizeOAuthTokens(tokens);
            await oauthRepo.upsert('chatgpt', { tokens: normalized, error: null });

            emitOAuthEvent({ provider: 'chatgpt', success: true });
        }).catch((error) => {
            console.error('ChatGPT device auth polling failed:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            emitOAuthEvent({ provider: 'chatgpt', success: false, error: errorMessage });
        });

        return {
            success: true,
            deviceCode: deviceData.user_code,
            verificationUri: url
        };
    } catch (error) {
        console.error('ChatGPT device auth failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        emitOAuthEvent({ provider: 'chatgpt', success: false, error: errorMessage });
        return { success: false, error: errorMessage };
    }
}

export async function handleAnthropicBrowserAuth(): Promise<{ success: boolean; error?: string }> {
    // This client ID is registered with redirect_uri http://localhost:8765/callback
    const ANTHROPIC_PORT = 8765;
    const ANTHROPIC_REDIRECT_URI = `http://localhost:${ANTHROPIC_PORT}/callback`;
    try {
        const pkce = AnthropicAuth.generatePKCE();
        const authUrl = AnthropicAuth.getAuthorizeUrl(pkce, ANTHROPIC_REDIRECT_URI);

        console.log(`[OAuth] Starting Anthropic browser auth on port ${ANTHROPIC_PORT}...`);
        console.log(`[OAuth] Anthropic redirect URI: ${ANTHROPIC_REDIRECT_URI}`);

        // Create a dedicated callback server for Anthropic using /callback path
        // (auth-server.ts uses /oauth/callback which doesn't match Anthropic's registered URI)
        return new Promise((resolve) => {
            const { createServer } = require('http');
            const { URL } = require('url');

            const server = createServer((req: any, res: any) => {
                if (!req.url) {
                    res.writeHead(400);
                    res.end('Bad Request');
                    return;
                }

                const url = new URL(req.url, `http://localhost:${ANTHROPIC_PORT}`);

                if (url.pathname === '/callback') {
                    const code = url.searchParams.get('code');
                    const state = url.searchParams.get('state');
                    const error = url.searchParams.get('error');

                    if (error) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:50px"><h1 style="color:#d32f2f">Authorization Failed</h1><p>${error}</p><p>You can close this window.</p><script>setTimeout(()=>window.close(),3000)</script></body></html>`);
                        server.close();
                        emitOAuthEvent({ provider: 'anthropic-native', success: false, error });
                        resolve({ success: false, error });
                        return;
                    }

                    // Process the callback
                    (async () => {
                        try {
                            if (!code) {
                                throw new Error('No authorization code received from Anthropic');
                            }
                            if (state && state !== pkce.verifier) {
                                console.warn(`[OAuth] Anthropic state mismatch`);
                                throw new Error('Invalid state parameter - possible CSRF attack');
                            }

                            console.log('[OAuth] Anthropic: exchanging code for tokens...');
                            const tokens = await AnthropicAuth.exchangeCodeForTokens(code, pkce.verifier, ANTHROPIC_REDIRECT_URI);

                            const oauthRepo = getOAuthRepo();
                            const normalized = normalizeOAuthTokens(tokens);
                            await oauthRepo.upsert('anthropic-native', { tokens: normalized, error: null });

                            console.log('[OAuth] Anthropic: successfully connected!');
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:50px"><h1 style="color:#2e7d32">Authorization Successful</h1><p>You can close this window.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>`);
                            server.close();
                            emitOAuthEvent({ provider: 'anthropic-native', success: true });
                            resolve({ success: true });
                        } catch (err) {
                            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                            console.error('[OAuth] Anthropic token exchange failed:', errorMessage);
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:50px"><h1 style="color:#d32f2f">Authorization Failed</h1><p>${errorMessage}</p><p>You can close this window.</p><script>setTimeout(()=>window.close(),3000)</script></body></html>`);
                            server.close();
                            emitOAuthEvent({ provider: 'anthropic-native', success: false, error: errorMessage });
                            resolve({ success: false, error: errorMessage });
                        }
                    })();
                } else {
                    res.writeHead(404);
                    res.end('Not Found');
                }
            });

            server.listen(ANTHROPIC_PORT, 'localhost', () => {
                console.log(`[OAuth] Anthropic auth server listening on port ${ANTHROPIC_PORT}`);
                shell.openExternal(authUrl);
            });

            server.on('error', (err: any) => {
                const msg = err.code === 'EADDRINUSE'
                    ? `Port ${ANTHROPIC_PORT} is already in use`
                    : (err.message || 'Failed to start auth server');
                console.error('[OAuth] Anthropic: failed to start auth server:', msg);
                resolve({ success: false, error: msg });
            });

            // Timeout after 3 minutes
            setTimeout(() => {
                server.close();
                resolve({ success: false, error: 'OAuth timeout - did not receive callback within 3 minutes' });
            }, 180000);
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[OAuth] Anthropic: unexpected error:', msg);
        return { success: false, error: msg };
    }
}

export async function handleAntigravityBrowserAuth(): Promise<{ success: boolean; error?: string }> {
    const ANTIGRAVITY_PORT = 51121;
    const ANTIGRAVITY_REDIRECT_URI = `http://localhost:${ANTIGRAVITY_PORT}/oauth/callback`;
    try {
        const pkce = AntigravityAuth.generatePKCE();
        const authUrl = AntigravityAuth.getAuthorizeUrl(pkce, ANTIGRAVITY_REDIRECT_URI);

        console.log(`[OAuth] Starting Antigravity browser auth on port ${ANTIGRAVITY_PORT}...`);

        // Provide a simple local server to catch the callback
        return new Promise((resolve) => {
            createAuthServer(ANTIGRAVITY_PORT, async (code, state) => {
                try {
                    if (!code) {
                        throw new Error('No authorization code received from Antigravity');
                    }

                    // Extract the verifier back from the callback state string
                    const decodedState = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
                    if (decodedState.verifier !== pkce.verifier) {
                        console.warn('[OAuth] Antigravity state mismatch');
                        throw new Error('Invalid state parameter - possible CSRF attack');
                    }

                    console.log('[OAuth] Antigravity: exchanging code for tokens...');
                    const tokens = await AntigravityAuth.exchangeCodeForTokens(code, pkce.verifier, ANTIGRAVITY_REDIRECT_URI);

                    const oauthRepo = getOAuthRepo();
                    const normalized = normalizeOAuthTokens(tokens);
                    await oauthRepo.upsert('antigravity', { tokens: normalized, error: null });

                    console.log('[OAuth] Antigravity: successfully connected!');
                    emitOAuthEvent({ provider: 'antigravity', success: true });
                    resolve({ success: true });
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error('[OAuth] Antigravity token exchange failed:', errorMessage);
                    emitOAuthEvent({ provider: 'antigravity', success: false, error: errorMessage });
                    resolve({ success: false, error: errorMessage });
                }
            }).then(({ server }) => {
                shell.openExternal(authUrl);
                // Timeout server after 3 minutes
                setTimeout(() => {
                    server.close();
                    resolve({ success: false, error: 'OAuth timeout - did not receive callback within 3 minutes' });
                }, 180000);
            }).catch((err) => {
                const msg = err instanceof Error ? err.message : 'Failed to start auth server';
                console.error('[OAuth] Antigravity: failed to start auth server:', msg);
                resolve({ success: false, error: msg });
            });
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[OAuth] Antigravity: unexpected error:', msg);
        return { success: false, error: msg };
    }
}
