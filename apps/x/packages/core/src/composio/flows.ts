import { openExternalUrl } from '../auth/url-opener.js';
import { composioConnectBus } from '../auth/connector-events.js';
import { openLoopback } from '../auth/loopback-server.js';
import * as composioClient from '../composio/client.js';
import { composioAccountsRepo } from '../composio/repo.js';
import { invalidateCopilotInstructionsCache } from '../runtime/assembly/copilot/instructions.js';
import { CURATED_TOOLKIT_SLUGS } from '@x/shared/dist/composio.js';
import type { LocalConnectedAccount, Toolkit } from '../composio/types.js';
import { triggerSync as triggerGmailSync } from '../knowledge/sync_gmail.js';
import { triggerSync as triggerCalendarSync } from '../knowledge/sync_calendar.js';
import { composioAuthConfigName, composioUserId } from '../config/profile.js';
import { selectManagedAuthConfig } from './auth-config.js';

/** Build the per-flow loopback callback URL from the actually-bound port. */
function composioCallbackUrl(port: number): string {
    return `http://localhost:${port}/oauth/callback`;
}

// Store active OAuth flows (keyed by toolkitSlug to prevent concurrent flows for the same toolkit)
const activeFlows = new Map<string, {
    toolkitSlug: string;
    connectedAccountId: string;
    authConfigId: string;
    server: import('../auth/loopback-server.js').LoopbackHandle;
    timeout: NodeJS.Timeout;
}>();

function emitComposioEvent(event: { toolkitSlug: string; success: boolean; error?: string }): void {
    composioConnectBus.publish(event);
}

/**
 * Check if Composio is configured with an API key
 */
export async function isConfigured(): Promise<{ configured: boolean }> {
    return { configured: await composioClient.isConfigured() };
}

/**
 * Set the Composio API key
 */
export function setApiKey(apiKey: string): { success: boolean; error?: string } {
    try {
        composioClient.setApiKey(apiKey);
        invalidateCopilotInstructionsCache();
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to set API key',
        };
    }
}

/**
 * Initiate OAuth connection for a toolkit
 */
export async function initiateConnection(toolkitSlug: string): Promise<{
    success: boolean;
    redirectUrl?: string;
    connectedAccountId?: string;
    error?: string;
}> {
    try {
        console.log(`[Composio] Initiating connection for ${toolkitSlug}...`);

        // Check if already connected
        if (composioAccountsRepo.isConnected(toolkitSlug)) {
            return { success: true };
        }

        // Get toolkit to check auth schemes
        const toolkit = await composioClient.getToolkit(toolkitSlug);

        // Check for managed OAuth2
        if (!toolkit.composio_managed_auth_schemes?.includes('OAUTH2')) {
            return {
                success: false,
                error: `Toolkit ${toolkitSlug} does not support managed OAuth2`,
            };
        }

        // Find or create this profile's managed OAuth2 auth config,
        // scanning every page: a foreign profile's config must never match.
        let authConfigId: string | null = null;
        let cursor: string | null = null;
        do {
            const page = await composioClient.listAuthConfigs(toolkitSlug, cursor, true);
            authConfigId = selectManagedAuthConfig(page.items, toolkitSlug);
            cursor = page.next_cursor;
        } while (!authConfigId && cursor);

        if (!authConfigId) {
            // No managed config exists for this toolkit at all — create one.
            // Composio allows only one per toolkit per project, so a concurrent
            // create (another profile/flow) surfaces as "already exists"; recover
            // by re-listing and reusing the winner rather than failing.
            try {
                const created = await composioClient.createAuthConfig({
                    toolkit: { slug: toolkitSlug },
                    auth_config: {
                        type: 'use_composio_managed_auth',
                        name: composioAuthConfigName(toolkitSlug),
                    },
                });
                authConfigId = created.auth_config.id;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (!/already exists/i.test(message)) throw err;
                console.log(`[Composio] Managed auth already exists for ${toolkitSlug}; reusing it`);
                let retryCursor: string | null = null;
                do {
                    const page = await composioClient.listAuthConfigs(toolkitSlug, retryCursor, true);
                    authConfigId = selectManagedAuthConfig(page.items, toolkitSlug);
                    retryCursor = page.next_cursor;
                } while (!authConfigId && retryCursor);
                if (!authConfigId) throw err;
            }
        }

        // Abort any existing flow for this toolkit before starting a new one
        const existingFlow = activeFlows.get(toolkitSlug);
        if (existingFlow) {
            console.log(`[Composio] Aborting existing flow for ${toolkitSlug}`);
            clearTimeout(existingFlow.timeout);
            existingFlow.server.close();
            activeFlows.delete(toolkitSlug);
        }

        // Bind the loopback callback server FIRST on a dynamic port, so two
        // profiles (or two concurrent flows) never fight over one fixed port.
        // The port itself identifies the flow; the connected account id is
        // filled in below before any browser tab can redirect back.
        const timeoutRef: { current: NodeJS.Timeout | null } = { current: null };
        let callbackHandled = false;
        let connectedAccountId = '';
        const server = await openLoopback(0, async () => {
            // Guard against duplicate callbacks (browser may send multiple requests)
            if (callbackHandled) return;
            callbackHandled = true;
            // A hit before the account exists (scanner, stale tab in the
            // bind-to-create window) settles nothing: leave the flow running.
            if (!connectedAccountId) {
                callbackHandled = false;
                return;
            }
            // OAuth callback received - sync the account status
            try {
                const accountStatus = await composioClient.getConnectedAccount(connectedAccountId);
                composioAccountsRepo.updateAccountStatus(toolkitSlug, accountStatus.status);

                if (accountStatus.status === 'ACTIVE') {
                    // Invalidate instructions cache so the copilot knows about the new connection
                    invalidateCopilotInstructionsCache();
                    emitComposioEvent({ toolkitSlug, success: true });
                    if (toolkitSlug === 'gmail') {
                        triggerGmailSync();
                    }
                    if (toolkitSlug === 'googlecalendar') {
                        triggerCalendarSync();
                    }
                } else {
                    emitComposioEvent({
                        toolkitSlug,
                        success: false,
                        error: `Connection status: ${accountStatus.status}`,
                    });
                }
            } catch (error) {
                console.error('[Composio] Failed to sync account status:', error);
                emitComposioEvent({
                    toolkitSlug,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            } finally {
                activeFlows.delete(toolkitSlug);
                server.close();
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
            }
        });

        // Create the connected account against the actually-bound callback
        // URL, namespaced to this profile so two profiles never share one.
        const callbackUrl = composioCallbackUrl(server.port);
        let createResponse;
        try {
            createResponse = await composioClient.createConnectedAccount({
                auth_config: { id: authConfigId },
                connection: {
                    user_id: composioUserId(),
                    callback_url: callbackUrl,
                },
            });
        } catch (error) {
            server.close();
            throw error;
        }
        connectedAccountId = createResponse.id;

        // Safely extract redirectUrl with type checking
        const connectionVal = createResponse.connectionData?.val;
        const redirectUrl = typeof connectionVal === 'object' && connectionVal !== null && 'redirectUrl' in connectionVal
            ? String((connectionVal as Record<string, unknown>).redirectUrl)
            : undefined;

        if (!redirectUrl) {
            server.close();
            return {
                success: false,
                error: 'No redirect URL received from Composio',
            };
        }

        // Save initial account state
        const account: LocalConnectedAccount = {
            id: connectedAccountId,
            authConfigId,
            status: 'INITIATED',
            toolkitSlug,
            createdAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
        };
        composioAccountsRepo.saveAccount(account);

        // Timeout for abandoned flows (5 minutes)
        const cleanupTimeout = setTimeout(() => {
            if (activeFlows.has(toolkitSlug)) {
                console.log(`[Composio] Cleaning up abandoned flow for ${toolkitSlug}`);
                activeFlows.delete(toolkitSlug);
                server.close();
                emitComposioEvent({
                    toolkitSlug,
                    success: false,
                    error: 'OAuth flow timed out',
                });
            }
        }, 5 * 60 * 1000);
        timeoutRef.current = cleanupTimeout;

        // Store flow state (keyed by toolkit to prevent concurrent flows)
        activeFlows.set(toolkitSlug, {
            toolkitSlug,
            connectedAccountId,
            authConfigId,
            server,
            timeout: cleanupTimeout,
        });

        // Open browser for OAuth
        void openExternalUrl(redirectUrl);

        return {
            success: true,
            redirectUrl,
            connectedAccountId,
        };
    } catch (error) {
        console.error('[Composio] Connection initiation failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get connection status for a toolkit
 */
export async function getConnectionStatus(toolkitSlug: string): Promise<{
    isConnected: boolean;
    status?: string;
}> {
    const account = composioAccountsRepo.getAccount(toolkitSlug);
    if (!account) {
        return { isConnected: false };
    }
    return {
        isConnected: account.status === 'ACTIVE',
        status: account.status,
    };
}

/**
 * Sync connection status with Composio API
 */
export async function syncConnection(
    toolkitSlug: string,
    connectedAccountId: string
): Promise<{ status: string }> {
    try {
        const accountStatus = await composioClient.getConnectedAccount(connectedAccountId);
        composioAccountsRepo.updateAccountStatus(toolkitSlug, accountStatus.status);
        return { status: accountStatus.status };
    } catch (error) {
        console.error('[Composio] Failed to sync connection:', error);
        return { status: 'FAILED' };
    }
}

/**
 * Disconnect a toolkit
 */
export async function disconnect(toolkitSlug: string): Promise<{ success: boolean }> {
    try {
        const account = composioAccountsRepo.getAccount(toolkitSlug);
        if (account) {
            await composioClient.deleteConnectedAccount(account.id);
        }
    } catch (error) {
        console.error('[Composio] Disconnect failed:', error);
    } finally {
        // Always clean up local state, even if the API call fails
        composioAccountsRepo.deleteAccount(toolkitSlug);
        invalidateCopilotInstructionsCache();
    }
    return { success: true };
}

/**
 * List connected toolkits
 */
export function listConnected(): { toolkits: string[] } {
    return { toolkits: composioAccountsRepo.getConnectedToolkits() };
}

/**
 * List available Composio toolkits — filtered to curated list only.
 * Return type matches the ZToolkit schema from core/composio/types.ts.
 */
export async function listToolkits() {
    // Paginate through all API pages to collect every curated toolkit
    const allItems: Toolkit[] = [];
    let cursor: string | null = null;
    const maxPages = 10; // safety limit
    for (let page = 0; page < maxPages; page++) {
        const result = await composioClient.listToolkits(cursor);
        allItems.push(...result.items);
        cursor = result.next_cursor;
        if (!cursor) break;
    }
    const filtered = allItems.filter(item => CURATED_TOOLKIT_SLUGS.has(item.slug));
    return {
        items: filtered,
        nextCursor: null as string | null,
        totalItems: filtered.length,
    };
}

/**
 * Execute a Composio tool by slug on behalf of a Mini App. The toolkit must be
 * connected (ACTIVE). Mirrors the agent's composio-execute-tool builtin.
 */
export async function executeTool(
    toolkitSlug: string,
    toolSlug: string,
    args?: Record<string, unknown>,
): Promise<{ successful: boolean; data?: unknown; error?: string }> {
    const account = composioAccountsRepo.getAccount(toolkitSlug);
    if (!account || account.status !== 'ACTIVE') {
        return { successful: false, error: `Toolkit "${toolkitSlug}" is not connected.` };
    }
    try {
        const result = await composioClient.executeAction(toolSlug, {
            connected_account_id: account.id,
            user_id: composioUserId(),
            version: 'latest',
            arguments: args ?? {},
        });
        return { successful: result.successful, data: result.data, error: result.error ?? undefined };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Composio] Mini App tool execution failed for ${toolSlug}:`, message);
        return { successful: false, error: `Failed to execute ${toolSlug}: ${message}` };
    }
}

/**
 * Search Composio tools within a toolkit so a Mini App can discover the right
 * tool slug + input schema at runtime (how generated apps will wire actions).
 */
export async function searchToolsInToolkit(
    toolkitSlug: string,
    query: string,
): Promise<{ tools: Array<{ slug: string; name: string; description?: string }>; error?: string }> {
    try {
        const { items } = await composioClient.searchTools(query, [toolkitSlug]);
        return {
            tools: items.map((t) => ({ slug: t.slug, name: t.name, description: t.description })),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { tools: [], error: message };
    }
}
