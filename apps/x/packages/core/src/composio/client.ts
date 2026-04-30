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
    ZSearchResultTool,
    ZToolkit,
    type NormalizedToolResult,
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
    use_composio_for_google: z.boolean().optional(),
    use_composio_for_google_calendar: z.boolean().optional(),
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
function saveConfig(config: ComposioConfig): void {
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
 * Check if Composio should be used for Google services (Gmail, etc.)
 */
export async function useComposioForGoogle(): Promise<boolean> {
    if (await isSignedIn()) return true;
    const config = loadConfig();
    return config.use_composio_for_google === true;
}

/**
 * Check if Composio should be used for Google Calendar
 */
export async function useComposioForGoogleCalendar(): Promise<boolean> {
    if (await isSignedIn()) return true;
    const config = loadConfig();
    return config.use_composio_for_google_calendar === true;
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
    const url = new URL(`${baseURL}${path}`);

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
            // Try to extract a human-readable message from the JSON body
            let detail = '';
            try {
                const body = JSON.parse(rawText);
                if (typeof body?.error === 'string') detail = body.error;
                else if (typeof body?.message === 'string') detail = body.message;
            } catch { /* body isn't JSON or has no message field */ }
            const suffix = detail ? `: ${detail}` : '';
            throw new Error(`Composio API error: ${response.status} ${response.statusText}${suffix}`);
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

        if (typeof data === 'object' && data !== null && 'error' in data && data.error !== null && typeof data.error === 'object') {
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
 * Search for tools across all toolkits (or optionally filtered by specific toolkit slugs).
 * Returns tools with full input_parameters so the agent knows what params to pass.
 *
 * Uses a limit of 50 (not 15) to avoid the curated-filter-after-limit problem where
 * in-scope results at position 16+ would be discarded if earlier results are out-of-scope.
 */
export async function searchTools(
    searchQuery: string,
    toolkitSlugs?: string[],
): Promise<{ items: NormalizedToolResult[] }> {
    const params: Record<string, string> = {
        query: searchQuery,
        limit: '50',
    };
    if (toolkitSlugs && toolkitSlugs.length === 1) {
        params.toolkit_slug = toolkitSlugs[0];
    }

    const result = await composioApiCall(ZListResponse(ZSearchResultTool), "/tools", params);

    const items: NormalizedToolResult[] = result.items.map((item) => ({
        slug: item.slug,
        name: item.name,
        description: item.description,
        toolkitSlug: item.toolkit.slug,
        inputParameters: {
            type: 'object' as const,
            properties: item.input_parameters?.properties ?? {},
            required: item.input_parameters?.required,
        },
    }));

    return { items };
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
