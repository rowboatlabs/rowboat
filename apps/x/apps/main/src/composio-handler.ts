import { shell, BrowserWindow } from 'electron';
import { createAuthServer } from './auth-server.js';
import * as composioClient from '@x/core/dist/composio/client.js';
import { composioAccountsRepo } from '@x/core/dist/composio/repo.js';
import { invalidateCopilotInstructionsCache } from '@x/core/dist/application/assistant/instructions.js';
import { CURATED_TOOLKIT_SLUGS } from '@x/shared/dist/composio.js';
import type { LocalConnectedAccount, Toolkit } from '@x/core/dist/composio/types.js';
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
        const { server } = await createAuthServer(8081, async (_callbackUrl) => {
            // Guard against duplicate callbacks (browser may send multiple requests)
            if (callbackHandled) return;
            callbackHandled = true;
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
