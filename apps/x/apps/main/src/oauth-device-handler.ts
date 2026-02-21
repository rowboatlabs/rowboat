import { shell } from 'electron';
import { ChatGPTAuth } from './oauth/chatgpt.js';
import { AnthropicAuth } from './oauth/anthropic.js';
import container from '@x/core/dist/di/container.js';
import type { IOAuthRepo } from '@x/core/dist/auth/repo.js';
import { emitOAuthEvent } from './ipc.js';
import { createAuthServer } from './auth-server.js';
import fs from 'fs/promises';

const REDIRECT_URI = 'http://localhost:8080/oauth/callback';

function getOAuthRepo(): IOAuthRepo {
    return container.resolve<IOAuthRepo>('oauthRepo');
}

export async function handleChatGPTDeviceAuth(): Promise<{ success: boolean; error?: string }> {
    try {
        const { deviceData, url } = await ChatGPTAuth.initiateDeviceAuth();

        // The user needs to input the device code `deviceData.user_code`.
        // We launch the browser pointing directly to the device activation page with the query mapped 
        // so it ideally auto-fills, otherwise they must paste it.
        shell.openExternal(`${url}?user_code=${deviceData.user_code}`);

        // Begin polling the auth.openai.com endpoint
        const tokens = await ChatGPTAuth.pollForTokens(deviceData);

        const oauthRepo = getOAuthRepo();
        await oauthRepo.upsert('chatgpt', { tokens: tokens as any });
        await oauthRepo.upsert('chatgpt', { error: null });

        emitOAuthEvent({ provider: 'chatgpt', success: true });
        return { success: true };
    } catch (error) {
        console.error('ChatGPT device auth failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        emitOAuthEvent({ provider: 'chatgpt', success: false, error: errorMessage });
        return { success: false, error: errorMessage };
    }
}

export async function handleAnthropicBrowserAuth(): Promise<{ success: boolean; error?: string }> {
    try {
        const pkce = AnthropicAuth.generatePKCE();
        const authUrl = AnthropicAuth.getAuthorizeUrl(pkce, REDIRECT_URI);

        // Provide a simple local server to catch the callback
        return new Promise((resolve) => {
            createAuthServer(8080, async (code, state) => {
                try {
                    if (state !== pkce.verifier) {
                        throw new Error('Invalid state verifier match - CSRF warning');
                    }

                    const tokens = await AnthropicAuth.exchangeCodeForTokens(code, pkce.verifier, REDIRECT_URI);

                    const oauthRepo = getOAuthRepo();
                    await oauthRepo.upsert('anthropic-native', { tokens: tokens as any });
                    await oauthRepo.upsert('anthropic-native', { error: null });

                    emitOAuthEvent({ provider: 'anthropic-native', success: true });
                    resolve({ success: true });
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    emitOAuthEvent({ provider: 'anthropic-native', success: false, error: errorMessage });
                    resolve({ success: false, error: errorMessage });
                }
            }).then(({ server }) => {
                shell.openExternal(authUrl);
                // Timeout server after 3 minutes
                setTimeout(() => {
                    server.close();
                    resolve({ success: false, error: 'OAuth timeout' });
                }, 180000);
            });
        });
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}
