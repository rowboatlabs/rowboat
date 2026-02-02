import { z } from "zod";
import fs from "fs";
import path from "path";
import { Composio } from "@composio/core";
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
    ZExecuteActionResponse,
    ZListResponse,
    ZToolkit,
} from "./types.js";

const BASE_URL = 'https://backend.composio.dev/api/v3';
const CONFIG_FILE = path.join(WorkDir, 'config', 'composio.json');

// Composio SDK client (lazily initialized)
let composioClient: Composio | null = null;

function getComposioClient(): Composio {
    if (composioClient) {
        return composioClient;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Composio API key not configured');
    }

    composioClient = new Composio({ apiKey });
    return composioClient;
}

function resetComposioClient(): void {
    composioClient = null;
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
    resetComposioClient();
}

/**
 * Check if Composio is configured
 */
export function isConfigured(): boolean {
    return !!getApiKey();
}

/**
 * Make an API call to Composio
 */
export async function composioApiCall<T extends z.ZodTypeAny>(
    schema: T,
    url: string,
    options: RequestInit = {},
): Promise<z.infer<T>> {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Composio API key not configured');
    }

    console.log(`[Composio] ${options.method || 'GET'} ${url}`);
    const startTime = Date.now();

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                "x-api-key": apiKey,
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
    const url = new URL(`${BASE_URL}/toolkits`);
    url.searchParams.set("sort_by", "usage");
    if (cursor) {
        url.searchParams.set("cursor", cursor);
    }
    return composioApiCall(ZListResponse(ZToolkit), url.toString());
}

/**
 * Get a specific toolkit
 */
export async function getToolkit(toolkitSlug: string): Promise<z.infer<typeof ZToolkit>> {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Composio API key not configured');
    }

    const url = `${BASE_URL}/toolkits/${toolkitSlug}`;
    console.log(`[Composio] GET ${url}`);

    const response = await fetch(url, {
        headers: { "x-api-key": apiKey },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch toolkit: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    const no_auth = data.composio_managed_auth_schemes?.includes('NO_AUTH') ||
                    data.auth_config_details?.some((config: { mode: string }) => config.mode === 'NO_AUTH') ||
                    false;

    return ZToolkit.parse({
        ...data,
        no_auth,
        meta: data.meta || { description: '', logo: '', tools_count: 0, triggers_count: 0 },
        auth_schemes: data.auth_schemes || [],
        composio_managed_auth_schemes: data.composio_managed_auth_schemes || [],
    });
}

/**
 * List auth configs for a toolkit
 */
export async function listAuthConfigs(
    toolkitSlug: string,
    cursor: string | null = null,
    managedOnly: boolean = false
): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZAuthConfig>>>> {
    const url = new URL(`${BASE_URL}/auth_configs`);
    url.searchParams.set("toolkit_slug", toolkitSlug);
    if (cursor) {
        url.searchParams.set("cursor", cursor);
    }
    if (managedOnly) {
        url.searchParams.set("is_composio_managed", "true");
    }
    return composioApiCall(ZListResponse(ZAuthConfig), url.toString());
}

/**
 * Create an auth config
 */
export async function createAuthConfig(
    request: z.infer<typeof ZCreateAuthConfigRequest>
): Promise<z.infer<typeof ZCreateAuthConfigResponse>> {
    const url = new URL(`${BASE_URL}/auth_configs`);
    return composioApiCall(ZCreateAuthConfigResponse, url.toString(), {
        method: 'POST',
        body: JSON.stringify(request),
    });
}

/**
 * Delete an auth config
 */
export async function deleteAuthConfig(authConfigId: string): Promise<z.infer<typeof ZDeleteOperationResponse>> {
    const url = new URL(`${BASE_URL}/auth_configs/${authConfigId}`);
    return composioApiCall(ZDeleteOperationResponse, url.toString(), {
        method: 'DELETE',
    });
}

/**
 * Create a connected account
 */
export async function createConnectedAccount(
    request: z.infer<typeof ZCreateConnectedAccountRequest>
): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    const url = new URL(`${BASE_URL}/connected_accounts`);
    return composioApiCall(ZCreateConnectedAccountResponse, url.toString(), {
        method: 'POST',
        body: JSON.stringify(request),
    });
}

/**
 * Get a connected account
 */
export async function getConnectedAccount(connectedAccountId: string): Promise<z.infer<typeof ZConnectedAccount>> {
    const url = new URL(`${BASE_URL}/connected_accounts/${connectedAccountId}`);
    return composioApiCall(ZConnectedAccount, url.toString());
}

/**
 * Delete a connected account
 */
export async function deleteConnectedAccount(connectedAccountId: string): Promise<z.infer<typeof ZDeleteOperationResponse>> {
    const url = new URL(`${BASE_URL}/connected_accounts/${connectedAccountId}`);
    return composioApiCall(ZDeleteOperationResponse, url.toString(), {
        method: 'DELETE',
    });
}

/**
 * List available tools for a toolkit
 */
export async function listToolkitTools(
    toolkitSlug: string,
    searchQuery: string | null = null,
): Promise<{ items: Array<{ slug: string; name: string; description: string }> }> {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Composio API key not configured');
    }

    const url = new URL(`${BASE_URL}/tools`);
    url.searchParams.set('toolkit_slug', toolkitSlug);
    url.searchParams.set('limit', '200');
    if (searchQuery) {
        url.searchParams.set('search', searchQuery);
    }

    console.log(`[Composio] Listing tools for toolkit: ${toolkitSlug}`);

    const response = await fetch(url.toString(), {
        headers: { "x-api-key": apiKey },
    });

    if (!response.ok) {
        throw new Error(`Failed to list tools: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { items?: Array<Record<string, unknown>> };

    return {
        items: (data.items || []).map((item) => ({
            slug: String(item.slug ?? ''),
            name: String(item.name ?? ''),
            description: String(item.description ?? ''),
        })),
    };
}

/**
 * Execute a tool action using Composio SDK
 */
export async function executeAction(
    actionSlug: string,
    connectedAccountId: string,
    input: Record<string, unknown>
): Promise<z.infer<typeof ZExecuteActionResponse>> {
    console.log(`[Composio] Executing action: ${actionSlug} (account: ${connectedAccountId})`);

    try {
        const client = getComposioClient();
        const result = await client.tools.execute(actionSlug, {
            userId: connectedAccountId,
            arguments: input,
            connectedAccountId,
            dangerouslySkipVersionCheck: true,
        });

        console.log(`[Composio] Action completed successfully`);
        return { success: true, data: result.data };
    } catch (error) {
        console.error(`[Composio] Action execution failed:`, error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { success: false, data: null, error: message };
    }
}
