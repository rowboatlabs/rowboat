import { shell, BrowserWindow } from 'electron';
import { createAuthServer } from './auth-server.js';
import * as composioClient from '@x/core/dist/composio/client.js';
import { composioAccountsRepo } from '@x/core/dist/composio/repo.js';
import { composioEnabledToolsRepo } from '@x/core/dist/composio/enabled-tools-repo.js';
import type { EnabledTool } from '@x/core/dist/composio/enabled-tools-repo.js';
import type { LocalConnectedAccount, ZExecuteActionResponse } from '@x/core/dist/composio/types.js';
import { refreshComposioTools } from '@x/core/dist/application/lib/builtin-tools.js';
import { z } from 'zod';
import { triggerSync as triggerGmailSync } from '@x/core/dist/knowledge/sync_gmail.js';
import { triggerSync as triggerCalendarSync } from '@x/core/dist/knowledge/sync_calendar.js';

const REDIRECT_URI = 'http://localhost:8081/oauth/callback';

// Store active OAuth flows (keyed by toolkitSlug to prevent concurrent flows for the same toolkit)
const activeFlows = new Map<string, {
    toolkitSlug: string;
    connectedAccountId: string;
    authConfigId: string;
    server: import('http').Server;
    timeout: NodeJS.Timeout;
}>();

/**
 * Emit Composio connection event to all renderer windows
 */
export function emitComposioEvent(event: { toolkitSlug: string; success: boolean; error?: string }): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
        if (!win.isDestroyed() && win.webContents) {
            win.webContents.send('composio:didConnect', event);
        }
    }
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

        // Find or create managed OAuth2 auth config
        const authConfigs = await composioClient.listAuthConfigs(toolkitSlug, null, true);
        let authConfigId: string;

        const managedOauth2 = authConfigs.items.find(
            cfg => cfg.auth_scheme === 'OAUTH2' && cfg.is_composio_managed
        );

        if (managedOauth2) {
            authConfigId = managedOauth2.id;
        } else {
            // Create new managed auth config
            const created = await composioClient.createAuthConfig({
                toolkit: { slug: toolkitSlug },
                auth_config: {
                    type: 'use_composio_managed_auth',
                    name: `rowboat-${toolkitSlug}`,
                },
            });
            authConfigId = created.auth_config.id;
        }

        // Create connected account with callback URL
        const callbackUrl = REDIRECT_URI;
        const response = await composioClient.createConnectedAccount({
            auth_config: { id: authConfigId },
            connection: {
                user_id: 'rowboat-user',
                callback_url: callbackUrl,
            },
        });

        const connectedAccountId = response.id;

        // Safely extract redirectUrl with type checking
        const connectionVal = response.connectionData?.val;
        const redirectUrl = typeof connectionVal === 'object' && connectionVal !== null && 'redirectUrl' in connectionVal
            ? String((connectionVal as Record<string, unknown>).redirectUrl)
            : undefined;

        if (!redirectUrl) {
            return {
                success: false,
                error: 'No redirect URL received from Composio',
            };
        }

        // Abort any existing flow for this toolkit before starting a new one
        const existingFlow = activeFlows.get(toolkitSlug);
        if (existingFlow) {
            console.log(`[Composio] Aborting existing flow for ${toolkitSlug}`);
            clearTimeout(existingFlow.timeout);
            existingFlow.server.close();
            activeFlows.delete(toolkitSlug);
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

        // Set up callback server
        const timeoutRef: { current: NodeJS.Timeout | null } = { current: null };
        let callbackHandled = false;
        const { server } = await createAuthServer(8081, async () => {
            // Guard against duplicate callbacks (browser may send multiple requests)
            if (callbackHandled) return;
            callbackHandled = true;
            // OAuth callback received - sync the account status
            try {
                const accountStatus = await composioClient.getConnectedAccount(connectedAccountId);
                composioAccountsRepo.updateAccountStatus(toolkitSlug, accountStatus.status);

                if (accountStatus.status === 'ACTIVE') {
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
        shell.openExternal(redirectUrl);

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
            // Delete from Composio
            await composioClient.deleteConnectedAccount(account.id);
            // Delete local record
            composioAccountsRepo.deleteAccount(toolkitSlug);
        }
        // Clean up enabled tools for this toolkit
        composioEnabledToolsRepo.disableAllForToolkit(toolkitSlug);
        refreshComposioTools();
        return { success: true };
    } catch (error) {
        console.error('[Composio] Disconnect failed:', error);
        // Still delete local record even if API call fails
        composioAccountsRepo.deleteAccount(toolkitSlug);
        composioEnabledToolsRepo.disableAllForToolkit(toolkitSlug);
        refreshComposioTools();
        return { success: true };
    }
}

/**
 * List connected toolkits
 */
export function listConnected(): { toolkits: string[] } {
    return { toolkits: composioAccountsRepo.getConnectedToolkits() };
}

/**
 * Check if Composio should be used for Google services (Gmail, etc.)
 */
export async function useComposioForGoogle(): Promise<{ enabled: boolean }> {
    return { enabled: await composioClient.useComposioForGoogle() };
}

/**
 * Check if Composio should be used for Google Calendar
 */
export async function useComposioForGoogleCalendar(): Promise<{ enabled: boolean }> {
    return { enabled: await composioClient.useComposioForGoogleCalendar() };
}

/**
 * Execute a Composio action
 */
export async function executeAction(
    actionSlug: string,
    toolkitSlug: string,
    input: Record<string, unknown>
): Promise<z.infer<typeof ZExecuteActionResponse>> {
    try {
        const account = composioAccountsRepo.getAccount(toolkitSlug);
        if (!account || account.status !== 'ACTIVE') {
            return {
                data: null,
                successful: false,
                error: `Toolkit ${toolkitSlug} is not connected`,
            };
        }

        const result = await composioClient.executeAction(actionSlug, {
            connected_account_id: account.id,
            user_id: 'rowboat-user',
            version: 'latest',
            arguments: input,
        });
        return result;
    } catch (error) {
        console.error('[Composio] Action execution failed:', error);
        return {
            successful: false,
            data: null,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * List available Composio toolkits
 */
export async function listToolkits(cursor?: string): Promise<{
    items: Array<{
        slug: string;
        name: string;
        meta: { description: string; logo: string; tools_count: number; triggers_count: number };
        no_auth?: boolean;
        auth_schemes?: string[];
        composio_managed_auth_schemes?: string[];
    }>;
    nextCursor: string | null;
    totalItems: number;
}> {
    const result = await composioClient.listToolkits(cursor || null);
    return {
        items: result.items,
        nextCursor: result.next_cursor,
        totalItems: result.total_items,
    };
}

/**
 * List tools for a toolkit with full details
 */
export async function listToolkitToolsDetailed(toolkitSlug: string, search?: string): Promise<{
    items: Array<{
        slug: string;
        name: string;
        description: string;
        toolkitSlug: string;
        inputParameters?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
    }>;
}> {
    return composioClient.listToolkitToolsDetailed(toolkitSlug, search || null);
}

/**
 * Get all enabled tools
 */
export function getEnabledTools(): {
    tools: Record<string, { slug: string; name: string; description: string; toolkitSlug: string }>;
} {
    const all = composioEnabledToolsRepo.getAll();
    const tools: Record<string, { slug: string; name: string; description: string; toolkitSlug: string }> = {};
    for (const [slug, tool] of Object.entries(all)) {
        tools[slug] = {
            slug: tool.slug,
            name: tool.name,
            description: tool.description,
            toolkitSlug: tool.toolkitSlug,
        };
    }
    return { tools };
}

/**
 * Enable specific tools from a toolkit
 */
export function enableTools(tools: Array<{
    slug: string;
    name: string;
    description: string;
    toolkitSlug: string;
    inputParameters?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
}>): { success: boolean } {
    const enabledTools: EnabledTool[] = tools.map(t => ({
        slug: t.slug,
        name: t.name,
        description: t.description,
        toolkitSlug: t.toolkitSlug,
        inputParameters: {
            type: 'object' as const,
            properties: t.inputParameters?.properties ?? {},
            required: t.inputParameters?.required,
        },
    }));
    composioEnabledToolsRepo.enableBatch(enabledTools);
    refreshComposioTools();
    return { success: true };
}

/**
 * Disable specific tools
 */
export function disableTools(toolSlugs: string[]): { success: boolean } {
    composioEnabledToolsRepo.disableBatch(toolSlugs);
    refreshComposioTools();
    return { success: true };
}
