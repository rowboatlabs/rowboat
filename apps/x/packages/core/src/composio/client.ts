import { z } from "zod";
import fs from "fs";
import path from "path";
import { WorkDir } from "../config/config.js";
import {
    ZAuthConfig,
    ZConnectedAccount,
    ZCreateAuthConfigRequest,
    ZCreateAuthConfigResponse,
    ZCreateConnectedAccountRequest,
    ZCreateConnectedAccountResponse,
    ZDeleteOperationResponse,
    ZErrorResponse,
    ZExecuteActionRequest,
    ZExecuteActionResponse,
    ZListResponse,
    ZTool,
    ZToolkit,
} from "./types.js";
import { isSignedIn } from "../account/account.js";
import { getAccessToken } from "../auth/tokens.js";
import { API_URL } from "../config/env.js";

const COMPOSIO_BASE_URL = 'https://backend.composio.dev/api/v3';
const CONFIG_FILE = path.join(WorkDir, 'config', 'composio.json');

async function getBaseUrl(): Promise<string> {
    if (await isSignedIn()) {
        return `${API_URL}/v1/composio`;
    }
    return COMPOSIO_BASE_URL;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
    if (await isSignedIn()) {
        const token = await getAccessToken();
        return { 'Authorization': `Bearer ${token}` };
    }
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Composio API key not configured');
    }
    return { 'x-api-key': apiKey };
}

/**
 * Configuration schema for Composio
 */
const ZComposioConfig = z.object({
    apiKey: z.string().optional(),
});

type ComposioConfig = z.infer<typeof ZComposioConfig>;

/**
 * Load Composio configuration
 */
function loadConfig(): ComposioConfig {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            return ZComposioConfig.parse(JSON.parse(data));
        }
    } catch (error) {
        console.error('[Composio] Failed to load config:', error);
    }
    return {};
}

/**
 * Save Composio configuration
 */
export function saveConfig(config: ComposioConfig): void {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get the Composio API key
 */
export function getApiKey(): string | null {
    const config = loadConfig();
    return config.apiKey || process.env.COMPOSIO_API_KEY || null;
}

/**
 * Set the Composio API key
 */
export function setApiKey(apiKey: string): void {
    const config = loadConfig();
    config.apiKey = apiKey;
    saveConfig(config);
}

/**
 * Check if Composio is configured
 */
export async function isConfigured(): Promise<boolean> {
    if (await isSignedIn()) return true;
    return !!getApiKey();
}

/**
 * Make an API call to Composio
 */
export async function composioApiCall<T extends z.ZodTypeAny>(
    schema: T,
    path: string,
    params: Record<string, string> = {},
    options: RequestInit = {},
): Promise<z.infer<T>> {
    const authHeaders = await getAuthHeaders();
    const baseURL = await getBaseUrl();
    const url = new URL(path, baseURL);

    console.log(`[Composio] ${options.method || 'GET'} ${url}`);
    const startTime = Date.now();

    try {
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

        const response = await fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                ...authHeaders,
                ...(options.method === 'POST' ? { "Content-Type": "application/json" } : {}),
            },
        });

        const duration = Date.now() - startTime;
        console.log(`[Composio] Response in ${duration}ms`);

        const contentType = response.headers.get('content-type') || '';
        const rawText = await response.text();

        if (!response.ok || !contentType.includes('application/json')) {
            console.error(`[Composio] Error response:`, {
                status: response.status,
                statusText: response.statusText,
                contentType,
                preview: rawText.slice(0, 200),
            });
        }

        if (!response.ok) {
            throw new Error(`Composio API error: ${response.status} ${response.statusText}`);
        }

        if (!contentType.includes('application/json')) {
            throw new Error('Expected JSON response');
        }

        let data: unknown;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Unknown error';
            throw new Error(`Failed to parse response: ${message}`);
        }

        if (typeof data === 'object' && data !== null && 'error' in data) {
            const parsedError = ZErrorResponse.parse(data);
            throw new Error(`Composio error (${parsedError.error.error_code}): ${parsedError.error.message}`);
        }

        return schema.parse(data);
    } catch (error) {
        console.error(`[Composio] Error:`, error);
        throw error;
    }
}

/**
 * List available toolkits
 */
export async function listToolkits(cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
    const params: Record<string, string> = {
        sort_by: "usage",
    };
    if (cursor) {
        params.cursor = cursor;
    }
    return composioApiCall(ZListResponse(ZToolkit), "/toolkits", params);
}

/**
 * Get a specific toolkit
 */
export async function getToolkit(toolkitSlug: string): Promise<z.infer<typeof ZToolkit>> {
    return composioApiCall(ZToolkit, `/toolkits/${toolkitSlug}`);
}

/**
 * List auth configs for a toolkit
 */
export async function listAuthConfigs(
    toolkitSlug: string,
    cursor: string | null = null,
    managedOnly: boolean = false
): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZAuthConfig>>>> {
    const params: Record<string, string> = {
        toolkit_slug: toolkitSlug,
    };
    if (cursor) {
        params.cursor = cursor;
    }
    if (managedOnly) {
        params.is_composio_managed = "true";
    }
    return composioApiCall(ZListResponse(ZAuthConfig), "/auth_configs", params);
}

/**
 * Create an auth config
 */
export async function createAuthConfig(
    request: z.infer<typeof ZCreateAuthConfigRequest>
): Promise<z.infer<typeof ZCreateAuthConfigResponse>> {
    return composioApiCall(ZCreateAuthConfigResponse, "/auth_configs", {}, {
        method: 'POST',
        body: JSON.stringify(request),
    });
}

/**
 * Delete an auth config
 */
export async function deleteAuthConfig(authConfigId: string): Promise<z.infer<typeof ZDeleteOperationResponse>> {
    return composioApiCall(ZDeleteOperationResponse, `/auth_configs/${authConfigId}`, {}, {
        method: 'DELETE',
    });
}

/**
 * Create a connected account
 */
export async function createConnectedAccount(
    request: z.infer<typeof ZCreateConnectedAccountRequest>
): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    return composioApiCall(ZCreateConnectedAccountResponse, "/connected_accounts", {}, {
        method: 'POST',
        body: JSON.stringify(request),
    });
}

/**
 * Get a connected account
 */
export async function getConnectedAccount(connectedAccountId: string): Promise<z.infer<typeof ZConnectedAccount>> {
    return composioApiCall(ZConnectedAccount, `/connected_accounts/${connectedAccountId}`);
}

/**
 * Delete a connected account
 */
export async function deleteConnectedAccount(connectedAccountId: string): Promise<z.infer<typeof ZDeleteOperationResponse>> {
    return composioApiCall(ZDeleteOperationResponse, `/connected_accounts/${connectedAccountId}`, {}, {
        method: 'DELETE',
    });
}

/**
 * List available tools for a toolkit
 */
export async function listToolkitTools(
    toolkitSlug: string,
    searchQuery: string | null = null,
): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
    const params: Record<string, string> = {
        toolkit_slug: toolkitSlug,
        limit: '200',
    };
    if (searchQuery) {
        params.search = searchQuery;
    }
    return composioApiCall(ZListResponse(ZTool), "/tools", params);
}

/**
 * Execute a tool action
 */
export async function executeAction(
    actionSlug: string,
    request: z.infer<typeof ZExecuteActionRequest>
): Promise<z.infer<typeof ZExecuteActionResponse>> {
    return composioApiCall(ZExecuteActionResponse, `/tools/execute/${actionSlug}`, {}, {
        method: 'POST',
        body: JSON.stringify(request),
    });
}
