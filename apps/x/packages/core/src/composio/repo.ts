import fs from "fs";
import path from "path";
import { z } from "zod";
import { WorkDir } from "../config/config.js";
import { ZLocalConnectedAccount, LocalConnectedAccount, ConnectedAccountStatus } from "./types.js";

const ACCOUNTS_FILE = path.join(WorkDir, 'data', 'composio', 'connected_accounts.json');

/**
 * Schema for the connected accounts storage file
 */
const ZConnectedAccountsStorage = z.object({
    accounts: z.record(z.string(), ZLocalConnectedAccount), // keyed by toolkit slug
});

type ConnectedAccountsStorage = z.infer<typeof ZConnectedAccountsStorage>;

/**
 * Interface for Composio accounts repository
 */
export interface IComposioAccountsRepo {
    getAccount(toolkitSlug: string): LocalConnectedAccount | null;
    getAllAccounts(): Record<string, LocalConnectedAccount>;
    saveAccount(account: LocalConnectedAccount): void;
    updateAccountStatus(toolkitSlug: string, status: ConnectedAccountStatus): boolean;
    deleteAccount(toolkitSlug: string): void;
    isConnected(toolkitSlug: string): boolean;
    getConnectedToolkits(): string[];
}

/**
 * Ensure the storage directory exists
 */
function ensureStorageDir(): void {
    const dir = path.dirname(ACCOUNTS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Load connected accounts from storage
 */
function loadAccounts(): ConnectedAccountsStorage {
    try {
        if (fs.existsSync(ACCOUNTS_FILE)) {
            const data = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
            return ZConnectedAccountsStorage.parse(JSON.parse(data));
        }
    } catch (error) {
        console.error('[ComposioRepo] Failed to load accounts:', error);
    }
    return { accounts: {} };
}

/**
 * Save connected accounts to storage
 */
function saveAccounts(storage: ConnectedAccountsStorage): void {
    ensureStorageDir();
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(storage, null, 2));
}

/**
 * Composio Connected Accounts Repository
 * Stores connected account information locally
 */
export class ComposioAccountsRepo implements IComposioAccountsRepo {
    /**
     * Get a connected account by toolkit slug
     */
    getAccount(toolkitSlug: string): LocalConnectedAccount | null {
        const storage = loadAccounts();
        return storage.accounts[toolkitSlug] || null;
    }

    /**
     * Get all connected accounts
     */
    getAllAccounts(): Record<string, LocalConnectedAccount> {
        const storage = loadAccounts();
        return storage.accounts;
    }

    /**
     * Save a connected account
     */
    saveAccount(account: LocalConnectedAccount): void {
        const storage = loadAccounts();
        storage.accounts[account.toolkitSlug] = account;
        saveAccounts(storage);
    }

    /**
     * Update account status
     * @returns true if account was found and updated, false if account doesn't exist
     */
    updateAccountStatus(toolkitSlug: string, status: ConnectedAccountStatus): boolean {
        const storage = loadAccounts();
        const account = storage.accounts[toolkitSlug];
        if (!account) {
            console.warn(`[ComposioRepo] Cannot update status: account '${toolkitSlug}' not found`);
            return false;
        }
        account.status = status;
        account.lastUpdatedAt = new Date().toISOString();
        saveAccounts(storage);
        return true;
    }

    /**
     * Delete a connected account
     */
    deleteAccount(toolkitSlug: string): void {
        const storage = loadAccounts();
        delete storage.accounts[toolkitSlug];
        saveAccounts(storage);
    }

    /**
     * Check if a toolkit is connected
     */
    isConnected(toolkitSlug: string): boolean {
        const account = this.getAccount(toolkitSlug);
        return account?.status === 'ACTIVE';
    }

    /**
     * Get list of connected toolkit slugs
     */
    getConnectedToolkits(): string[] {
        const storage = loadAccounts();
        return Object.entries(storage.accounts)
            .filter(([, account]) => account.status === 'ACTIVE')
            .map(([slug]) => slug);
    }
}

// Export singleton instance
export const composioAccountsRepo = new ComposioAccountsRepo();
