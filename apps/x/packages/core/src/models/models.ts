import { ProviderV2 } from "@ai-sdk/provider";
import * as fs from 'fs';
import { createGateway, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LlmModelConfig, LlmProvider } from "@x/shared/dist/models.js";
import z from "zod";

import { IOAuthRepo } from "../auth/repo.js";
import container from "../di/container.js";
import { loadCodeAssist, createAntigravityFetch, ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET } from "./antigravity-gateway.js";

export const Provider = LlmProvider;
export const ModelConfig = LlmModelConfig;

export async function createProvider(config: z.infer<typeof Provider>): Promise<ProviderV2> {
    let { apiKey, baseURL } = config;
    const { headers } = config;
    let isOAuthToken = false;

    // Inject OAuth token if apiKey is missing
    if (!apiKey) {
        try {
            const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
            const providerKey = config.flavor === 'openai' ? 'chatgpt' : (config.flavor === 'anthropic' ? 'anthropic-native' : config.flavor);
            const connection = await oauthRepo.read(providerKey);
            const tokens = connection.tokens;

            if (tokens?.access_token) {
                let accessToken = tokens.access_token;

                // Refresh expired tokens before using them
                const now = Math.floor(Date.now() / 1000);
                if (tokens.expires_at && tokens.expires_at <= now && tokens.refresh_token) {
                    console.log(`[models] OAuth token expired for ${providerKey}, refreshing...`);
                    try {
                        const refreshed = await refreshGoogleOAuthToken(tokens.refresh_token);
                        accessToken = refreshed.access_token;
                        // Persist the refreshed tokens
                        const updatedTokens = {
                            ...tokens,
                            access_token: refreshed.access_token,
                            expires_at: Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600),
                            refresh_token: refreshed.refresh_token || tokens.refresh_token,
                        };
                        await oauthRepo.upsert(providerKey, { tokens: updatedTokens, error: null });
                        console.log(`[models] OAuth token refreshed for ${providerKey}`);
                    } catch (refreshErr) {
                        console.error(`[models] Token refresh failed for ${providerKey}:`, refreshErr);
                        // Fall through with the expired token — the API will return 401
                    }
                }

                console.log(`[models] Injecting OAuth token for flavor: ${config.flavor} (key: ${providerKey})`);
                apiKey = accessToken;
                isOAuthToken = true;
                if (config.flavor === 'openai') {
                    baseURL = 'https://chatgpt.com/backend-api/codex';
                } else if (config.flavor === 'anthropic') {
                    baseURL = 'https://api.anthropic.com/v1';
                }
                // Antigravity baseURL is handled in its own provider case
            } else {
                console.log(`[models] No OAuth token found for flavor: ${config.flavor} (key: ${providerKey})`);
            }
        } catch (e) {
            console.error(`[models] Failed to load OAuth token for ${config.flavor}:`, e);
        }
    }

    if (!apiKey && (config.flavor === 'openai' || config.flavor === 'anthropic' || config.flavor === 'antigravity' || config.flavor === 'google')) {
        throw new Error(`API Key is missing and no active OAuth session found for ${config.flavor}. Please connect in Settings.`);
    }

    const customFetch = async (url: string, init?: RequestInit) => {
        if (init?.body && url.includes('chatgpt.com/backend-api/codex')) {
            try {
                fs.writeFileSync('/tmp/rowboat_models_log_before.json', init.body as string);
                const body = JSON.parse(init.body as string);

                const msgList = body.messages || body.input;

                // Codex API requires 'instructions' at the top level
                if (!body.instructions && msgList) {
                    const sysIdx = msgList.findIndex((m: any) => m.role === 'system' || m.role === 'developer');
                    if (sysIdx !== -1) {
                        const systemMessage = msgList[sysIdx];
                        body.instructions = typeof systemMessage.content === 'string' ? systemMessage.content : JSON.stringify(systemMessage.content);
                        msgList.splice(sysIdx, 1);
                    } else {
                        // don't inject empty instructions string if unnecessary
                    }
                }

                // Tool Flattening: Codex with store:false doesn't persist tool IDs.
                // We convert tool_calls/tool messages and complex array contents into a flattened text format.
                if (msgList) {
                    const newMessages: any[] = [];
                    for (const msg of msgList) {
                        if (msg.type === 'item_reference') {
                            continue; // Skip server reference since store is false
                        } else if (msg.type === 'function_call_output') {
                            newMessages.push({ role: 'user', content: `Tool Result for ${msg.call_id}: ${msg.output}` });
                        } else if (msg.role === 'assistant' && msg.tool_calls) {
                            const toolDesc = msg.tool_calls.map((tc: any) => `[Calling tool ${tc.function?.name} with args ${tc.function?.arguments}]`).join('\n');
                            newMessages.push({ role: 'assistant', content: msg.content ? `${msg.content}\n${toolDesc}` : toolDesc });
                        } else if (msg.role === 'tool') {
                            newMessages.push({ role: 'user', content: `Tool Result: ${msg.content}` });
                        } else {
                            if (msg.content && Array.isArray(msg.content)) {
                                let combinedContent = "";
                                for (const part of msg.content) {
                                    if (part.type === "input_text" || part.type === "text") {
                                        combinedContent += (part.text || part.value || "") + "\n";
                                    } else if (part.type === "function_call_output") {
                                        combinedContent += `Tool Result: ${part.output}\n`;
                                    } else if (part.type === "item_reference") {
                                        continue;
                                    }
                                }
                                newMessages.push({ role: msg.role || 'user', content: combinedContent.trim() });
                            } else {
                                newMessages.push(msg);
                            }
                        }
                    }
                    if (body.input) delete body.input;
                    body.messages = newMessages;
                }

                init.body = JSON.stringify(body);
                console.log(`[models] Simplified Codex request to ${url}:`, JSON.stringify(body, null, 2));
            } catch (e) {
                console.error('[models] Failed to normalize request body:', e);
            }
        }
        return fetch(url, init);
    };

    switch (config.flavor) {
        case "openai":
            return createOpenAI({
                apiKey: apiKey!,
                baseURL,
                headers,
                fetch: customFetch as any,
            });
        case "aigateway":
            return createGateway({
                apiKey,
                baseURL,
                headers,
            });
        case "anthropic": {
            if (isOAuthToken && apiKey) {
                // OAuth tokens must be sent as Authorization: Bearer, not x-api-key
                // The @ai-sdk/anthropic SDK always sends apiKey as x-api-key header,
                // so we use a custom fetch to override the auth header
                const oauthToken = apiKey;
                const anthropicOAuthFetch = async (url: string, init?: RequestInit) => {
                    const newInit = { ...init };
                    const newHeaders = new Headers(init?.headers);
                    newHeaders.delete('x-api-key');
                    newHeaders.set('Authorization', `Bearer ${oauthToken}`);
                    newInit.headers = newHeaders;
                    return fetch(url, newInit);
                };
                return createAnthropic({
                    apiKey: 'oauth-placeholder', // SDK requires non-empty, but we override in fetch
                    baseURL,
                    headers,
                    fetch: anthropicOAuthFetch as any,
                });
            }
            return createAnthropic({
                apiKey: apiKey || 'empty',
                baseURL,
                headers,
            });
        }
        case "google":
            return createGoogleGenerativeAI({
                apiKey,
                baseURL,
                headers,
            });
        case "ollama": {
            // ollama-ai-provider-v2 expects baseURL to include /api
            let ollamaURL = baseURL;
            if (ollamaURL && !ollamaURL.replace(/\/+$/, '').endsWith('/api')) {
                ollamaURL = ollamaURL.replace(/\/+$/, '') + '/api';
            }
            return createOllama({
                baseURL: ollamaURL,
                headers,
            });
        }
        case "openai-compatible":
            return createOpenAICompatible({
                name: "openai-compatible",
                apiKey,
                baseURL: baseURL || "",
                headers,
            });
        case "openrouter":
            return createOpenRouter({
                apiKey,
                baseURL,
                headers,
            });
        case "antigravity": {
            // Antigravity uses Google's Cloud Code gateway with Gemini-format requests
            // wrapped in a custom envelope. We use the Google AI SDK provider with a
            // custom fetch that handles the envelope transformation.
            const oauthToken = apiKey!;
            const session = await loadCodeAssist(oauthToken);
            const antigravityFetch = createAntigravityFetch(oauthToken, session.project);
            return createGoogleGenerativeAI({
                // The Google provider requires an apiKey but we handle auth in our custom fetch
                apiKey: 'antigravity-oauth',
                // Set baseURL to the gateway – the custom fetch will rewrite the full URL
                baseURL: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal',
                headers,
                fetch: antigravityFetch as any,
            });
        }
        default:
            throw new Error(`Unsupported provider flavor: ${config.flavor}`);
    }
}

/**
 * Refresh a Google OAuth token using the Antigravity client credentials.
 * Works for any Google OAuth token obtained with these credentials.
 */
async function refreshGoogleOAuthToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
}> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
        }).toString(),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google token refresh failed (${res.status}): ${text}`);
    }

    return res.json();
}

export async function testModelConnection(
    providerConfig: z.infer<typeof Provider>,
    model: string,
    timeoutMs?: number,
): Promise<{ success: boolean; error?: string }> {
    const isLocal = providerConfig.flavor === "ollama" || providerConfig.flavor === "openai-compatible";
    const isAntigravity = providerConfig.flavor === "antigravity";
    const effectiveTimeout = timeoutMs ?? (isLocal ? 60000 : isAntigravity ? 30000 : 8000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);
    try {
        const provider = await createProvider(providerConfig);
        const languageModel = provider.languageModel(model);
        await generateText({
            model: languageModel,
            prompt: "ping",
            abortSignal: controller.signal,
        });
        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Connection test failed";
        return { success: false, error: message };
    } finally {
        clearTimeout(timeout);
    }
}
