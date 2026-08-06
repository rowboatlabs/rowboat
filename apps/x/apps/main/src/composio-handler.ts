import { shell, BrowserWindow } from 'electron';
import { closeAuthServer, createAuthServer } from './auth-server.js';
import * as composioClient from '@x/core/dist/composio/client.js';
import { composioAccountsRepo } from '@x/core/dist/composio/repo.js';
import { invalidateCopilotInstructionsCache } from '@x/core/dist/runtime/assembly/copilot/instructions.js';
import { CURATED_TOOLKIT_SLUGS } from '@x/shared/dist/composio.js';
import type { LocalConnectedAccount, Toolkit } from '@x/core/dist/composio/types.js';
import { triggerSync as triggerGmailSync } from '@x/core/dist/knowledge/sync_gmail.js';
import { triggerSync as triggerCalendarSync } from '@x/core/dist/knowledge/sync_calendar.js';

const REDIRECT_URI = 'http://localhost:8081/oauth/callback';

interface ActiveComposioFlow {
    toolkitSlug: string;
    connectedAccountId: string;
    authConfigId: string;
    server: import('http').Server;
    timeout: NodeJS.Timeout;
    pollInterval: NodeJS.Timeout | null;
    settled: boolean;
}

const TERMINAL_CONNECTION_STATUSES = new Set<LocalConnectedAccount['status']>([
    'ACTIVE',
    'FAILED',
    'EXPIRED',
    'INACTIVE',
]);

// Composio registers one fixed callback URI, so only one managed OAuth flow
// can own port 8081 at a time — even when the toolkits differ.
let activeFlow: ActiveComposioFlow | null = null;

async function cancelActiveFlow(reason: string): Promise<void> {
    const flow = activeFlow;
    if (!flow) return;

    activeFlow = null;
    flow.settled = true;
    clearTimeout(flow.timeout);
    if (flow.pollInterval) clearInterval(flow.pollInterval);
    console.log(`[Composio] Aborting ${flow.toolkitSlug} flow: ${reason}`);
    await closeAuthServer(flow.server);
}

function activateToolkit(toolkitSlug: string): void {
    invalidateCopilotInstructionsCache();
    if (toolkitSlug === 'gmail') triggerGmailSync();
    if (toolkitSlug === 'googlecalendar') triggerCalendarSync();
}

async function refreshStoredAccountStatus(
    account: LocalConnectedAccount,
): Promise<LocalConnectedAccount['status']> {
    try {
        const remote = await composioClient.getConnectedAccount(account.id);
        composioAccountsRepo.updateAccountStatus(account.toolkitSlug, remote.status);
        if (remote.status === 'ACTIVE' && account.status !== 'ACTIVE') {
            activateToolkit(account.toolkitSlug);
        }
        return remote.status;
    } catch (error) {
        console.warn(`[Composio] Failed to refresh ${account.toolkitSlug} status:`, error);
        return account.status;
    }
}

async function settleFlow(
    flow: ActiveComposioFlow,
    status: LocalConnectedAccount['status'],
): Promise<void> {
    if (flow.settled) return;
    flow.settled = true;
    if (activeFlow === flow) activeFlow = null;
    clearTimeout(flow.timeout);
    if (flow.pollInterval) clearInterval(flow.pollInterval);

    const previousStatus = composioAccountsRepo.getAccount(flow.toolkitSlug)?.status;
    composioAccountsRepo.updateAccountStatus(flow.toolkitSlug, status);

    if (status === 'ACTIVE') {
        if (previousStatus !== 'ACTIVE') activateToolkit(flow.toolkitSlug);
        emitComposioEvent({ toolkitSlug: flow.toolkitSlug, success: true });
    } else {
        emitComposioEvent({
            toolkitSlug: flow.toolkitSlug,
            success: false,
            error: `Connection status: ${status}`,
        });
    }

    await closeAuthServer(flow.server);
}

/**
 * Connect Links do not consistently redirect every provider back to the
 * localhost callback after consent. Reconcile against Composio while the
 * browser flow is active so providers such as Google Meet and Canva still
 * settle promptly, while the callback remains the fast path when delivered.
 */
async function reconcileActiveFlow(flow: ActiveComposioFlow): Promise<void> {
    if (flow.settled) return;
    try {
        const accountStatus = await composioClient.getConnectedAccount(flow.connectedAccountId);
        if (flow.settled) return;

        if (TERMINAL_CONNECTION_STATUSES.has(accountStatus.status)) {
            await settleFlow(flow, accountStatus.status);
        } else {
            composioAccountsRepo.updateAccountStatus(flow.toolkitSlug, accountStatus.status);
        }
    } catch (error) {
        // Browser OAuth may outlive a transient API/network failure. Keep the
        // flow alive and let the next poll or the callback settle it.
        console.warn(`[Composio] Status reconciliation failed for ${flow.toolkitSlug}:`, error);
    }
}

// Serialize setup as well as active ownership. Without this queue, two rapid
// Connect clicks can both pass the preflight before either has bound 8081.
let connectionSetupQueue: Promise<void> = Promise.resolve();

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
export function initiateConnection(toolkitSlug: string): Promise<{
    success: boolean;
    redirectUrl?: string;
    connectedAccountId?: string;
    error?: string;
}> {
    const result = connectionSetupQueue.then(() => initiateConnectionExclusive(toolkitSlug));
    connectionSetupQueue = result.then(() => undefined, () => undefined);
    return result;
}

async function initiateConnectionExclusive(toolkitSlug: string): Promise<{
    success: boolean;
    redirectUrl?: string;
    connectedAccountId?: string;
    error?: string;
}> {
    try {
        console.log(`[Composio] Initiating connection for ${toolkitSlug}...`);

        // Recover a grant completed by Composio even when that provider never
        // returned to localhost (or the app restarted before reconciliation).
        const existingAccount = composioAccountsRepo.getAccount(toolkitSlug);
        if (existingAccount) {
            const existingStatus = existingAccount.status === 'ACTIVE'
                ? 'ACTIVE'
                : await refreshStoredAccountStatus(existingAccount);
            if (existingStatus === 'ACTIVE') {
                emitComposioEvent({ toolkitSlug, success: true });
                return {
                    success: true,
                    connectedAccountId: existingAccount.id,
                };
            }
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

        // A second connector (or a retry) supersedes the abandoned browser
        // flow. Await socket release before creating and opening the next link.
        await cancelActiveFlow('new_flow_started');

        // Create a Connect Link for the managed OAuth account. Composio retired
        // managed OAuth creation through POST /connected_accounts in July 2026.
        const callbackUrl = REDIRECT_URI;
        const response = await composioClient.createConnectedAccountLink({
            auth_config_id: authConfigId,
            user_id: 'rowboat-user',
            callback_url: callbackUrl,
        });

        const connectedAccountId = response.connected_account_id;
        const redirectUrl = response.redirect_url;

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
        let flow: ActiveComposioFlow | null = null;
        let callbackHandled = false;
        const { server } = await createAuthServer(8081, async () => {
            // Guard against duplicate callbacks (browser may send multiple requests)
            if (callbackHandled) return;
            callbackHandled = true;
            if (flow) await reconcileActiveFlow(flow);
            // Consent has returned; if Composio is still propagating the
            // status, the background poll can finish without another callback.
            if (flow && !flow.settled) await closeAuthServer(server);
        });

        // Timeout for abandoned flows (5 minutes)
        const cleanupTimeout = setTimeout(() => {
            if (flow && activeFlow === flow && !flow.settled) {
                console.log(`[Composio] Cleaning up abandoned flow for ${toolkitSlug}`);
                flow.settled = true;
                activeFlow = null;
                if (flow.pollInterval) clearInterval(flow.pollInterval);
                void closeAuthServer(server).catch(error => {
                    console.error('[Composio] Failed to close timed-out callback server:', error);
                });
                emitComposioEvent({
                    toolkitSlug,
                    success: false,
                    error: 'OAuth flow timed out',
                });
            }
        }, 5 * 60 * 1000);

        // Store the single fixed-port owner.
        flow = {
            toolkitSlug,
            connectedAccountId,
            authConfigId,
            server,
            timeout: cleanupTimeout,
            pollInterval: null,
            settled: false,
        };
        activeFlow = flow;

        // Callback delivery varies by provider. Polling centralizes reliable
        // completion for every renderer surface (Settings, onboarding, chat).
        flow.pollInterval = setInterval(() => {
            if (flow) void reconcileActiveFlow(flow);
        }, 1_000);

        // Open browser for OAuth
        await shell.openExternal(redirectUrl);

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

    if (account.status !== 'ACTIVE') {
        const flow = activeFlow?.toolkitSlug === toolkitSlug ? activeFlow : null;
        if (flow) {
            await reconcileActiveFlow(flow);
        } else {
            // Recover successful authorizations after an app restart or a
            // missed callback from a previous build.
            await refreshStoredAccountStatus(account);
        }
    }

    const refreshed = composioAccountsRepo.getAccount(toolkitSlug);
    return {
        isConnected: refreshed?.status === 'ACTIVE',
        status: refreshed?.status,
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
export async function listConnected(): Promise<{ toolkits: string[] }> {
    // Reconcile unfinished records on every Connections load. This doubles as
    // a migration for grants completed by older callback-only builds.
    const pendingAccounts = Object.values(composioAccountsRepo.getAllAccounts())
        .filter(account => account.status !== 'ACTIVE');
    await Promise.all(pendingAccounts.map(refreshStoredAccountStatus));
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
            user_id: 'rowboat-user',
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
