/**
 * Connection bridge for Composio toolkit OAuth.
 *
 * Builtin tools run in the core package which cannot import Electron-specific
 * code from the main process. This module provides a callback registry so the
 * main process can register its `initiateConnection` function at startup, and
 * builtin tools can call it at runtime.
 */

type ConnectionInitiator = (toolkitSlug: string) => Promise<{
    success: boolean;
    redirectUrl?: string;
    connectedAccountId?: string;
    error?: string;
}>;

let connectionInitiator: ConnectionInitiator | null = null;

/**
 * Register the connection initiator callback.
 * Called once by the main process at startup.
 */
export function setConnectionInitiator(fn: ConnectionInitiator): void {
    connectionInitiator = fn;
}

/**
 * Get the registered connection initiator.
 * Returns null if not yet registered (app not fully initialized).
 */
export function getConnectionInitiator(): ConnectionInitiator | null {
    return connectionInitiator;
}
