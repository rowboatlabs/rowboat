import { shell, BrowserWindow } from 'electron';
import { createAuthServer } from './auth-server.js';
import * as composioClient from '@x/core/dist/composio/client.js';
import { composioAccountsRepo } from '@x/core/dist/composio/repo.js';
import type { LocalConnectedAccount } from '@x/core/dist/composio/types.js';

const REDIRECT_URI = 'http://localhost:8081/oauth/callback';

// Store active OAuth flows
const activeFlows = new Map<string, {
    toolkitSlug: string;
    connectedAccountId: string;
    authConfigId: string;
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
export function isConfigured(): { configured: boolean } {
    return { configured: composioClient.isConfigured() };
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
        if (!toolkit.composio_managed_auth_schemes.includes('OAUTH2')) {
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

        // Store flow state
        const flowKey = `${toolkitSlug}-${Date.now()}`;
        activeFlows.set(flowKey, {
            toolkitSlug,
            connectedAccountId,
            authConfigId,
        });

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
        let cleanupTimeout: NodeJS.Timeout;
        const { server } = await createAuthServer(8081, async (_code, _state) => {
            // OAuth callback received - sync the account status
            try {
                const accountStatus = await composioClient.getConnectedAccount(connectedAccountId);
                composioAccountsRepo.updateAccountStatus(toolkitSlug, accountStatus.status);

                if (accountStatus.status === 'ACTIVE') {
                    emitComposioEvent({ toolkitSlug, success: true });
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
                activeFlows.delete(flowKey);
                server.close();
                clearTimeout(cleanupTimeout);
            }
        });

        // Timeout for abandoned flows (5 minutes)
        cleanupTimeout = setTimeout(() => {
            if (activeFlows.has(flowKey)) {
                console.log(`[Composio] Cleaning up abandoned flow for ${toolkitSlug}`);
                activeFlows.delete(flowKey);
                server.close();
                emitComposioEvent({
                    toolkitSlug,
                    success: false,
                    error: 'OAuth flow timed out',
                });
            }
        }, 5 * 60 * 1000);

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
        return { success: true };
    } catch (error) {
        console.error('[Composio] Disconnect failed:', error);
        // Still delete local record even if API call fails
        composioAccountsRepo.deleteAccount(toolkitSlug);
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
 * Execute a Composio action
 */
export async function executeAction(
    actionSlug: string,
    toolkitSlug: string,
    input: Record<string, unknown>
): Promise<{ success: boolean; data: unknown; error?: string }> {
    try {
        const account = composioAccountsRepo.getAccount(toolkitSlug);
        if (!account || account.status !== 'ACTIVE') {
            return {
                success: false,
                data: null,
                error: `Toolkit ${toolkitSlug} is not connected`,
            };
        }

        const result = await composioClient.executeAction(actionSlug, account.id, input);
        return result;
    } catch (error) {
        console.error('[Composio] Action execution failed:', error);
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
