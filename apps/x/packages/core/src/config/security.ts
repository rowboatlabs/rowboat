import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { WorkDir } from "./config.js";

export const SECURITY_CONFIG_PATH = path.join(WorkDir, "config", "security.json");

const DEFAULT_ALLOW_LIST = [
    "agent-slack",
    "awk",
    "basename",
    "cat",
    "cut",
    "date",
    "df",
    "diff",
    "dirname",
    "du",
    "echo",
    "env",
    "file",
    "find",
    "grep",
    "head",
    "hostname",
    "jq",
    "ls",
    "printenv",
    "printf",
    "pwd",
    "readlink",
    "realpath",
    "sort",
    "stat",
    "tail",
    "tree",
    "uname",
    "uniq",
    "wc",
    "which",
    "whoami",
    "yq"
]

export type FileAccessOperation = "read" | "list" | "search" | "write" | "delete";

export type FileAccessGrant = {
    operation: FileAccessOperation;
    pathPrefix: string;
};

let cachedAllowList: string[] | null = null;
let cachedFileAccessAllowList: FileAccessGrant[] | null = null;
let cachedMtimeMs: number | null = null;

export async function addToSecurityConfig(commands: string[]): Promise<void> {
    ensureSecurityConfigSync();
    const current = readSecurityConfig();
    const merged = new Set(current.allowedCommands);
    for (const cmd of commands) {
        const normalized = cmd.trim().toLowerCase();
        if (normalized) merged.add(normalized);
    }
    await fsPromises.writeFile(
        SECURITY_CONFIG_PATH,
        JSON.stringify({
            allowedCommands: Array.from(merged).sort(),
            allowedFileAccess: current.allowedFileAccess,
        }, null, 2) + "\n",
        "utf8",
    );
    // Reset cache so next read picks up the new file
    resetSecurityAllowListCache();
}

export async function addFileAccessGrant(grant: FileAccessGrant): Promise<void> {
    ensureSecurityConfigSync();
    const current = readSecurityConfig();
    const normalizedGrant = normalizeFileAccessGrant(grant);
    const exists = current.allowedFileAccess.some(existing =>
        existing.operation === normalizedGrant.operation
        && existing.pathPrefix === normalizedGrant.pathPrefix
    );
    const allowedFileAccess = exists
        ? current.allowedFileAccess
        : [...current.allowedFileAccess, normalizedGrant].sort((a, b) =>
            `${a.operation}:${a.pathPrefix}`.localeCompare(`${b.operation}:${b.pathPrefix}`)
        );
    await fsPromises.writeFile(
        SECURITY_CONFIG_PATH,
        JSON.stringify({
            allowedCommands: current.allowedCommands,
            allowedFileAccess,
        }, null, 2) + "\n",
        "utf8",
    );
    resetSecurityAllowListCache();
}

/**
 * Async function to ensure security config file exists.
 * Called explicitly at app startup via initConfigs().
 */
export async function ensureSecurityConfig(): Promise<void> {
    try {
        await fsPromises.access(SECURITY_CONFIG_PATH);
    } catch {
        await fsPromises.writeFile(
            SECURITY_CONFIG_PATH,
            JSON.stringify(DEFAULT_ALLOW_LIST, null, 2) + "\n",
            "utf8",
        );
    }
}

/**
 * Sync version for internal use by getSecurityAllowList() and readAllowList().
 */
function ensureSecurityConfigSync() {
    if (!fs.existsSync(SECURITY_CONFIG_PATH)) {
        fs.writeFileSync(
            SECURITY_CONFIG_PATH,
            JSON.stringify(DEFAULT_ALLOW_LIST, null, 2) + "\n",
            "utf8",
        );
    }
}

function normalizeList(commands: unknown[]): string[] {
    const seen = new Set<string>();
    for (const entry of commands) {
        if (typeof entry !== "string") continue;
        const normalized = entry.trim().toLowerCase();
        if (!normalized) continue;
        seen.add(normalized);
    }

    return Array.from(seen);
}

function normalizeFileAccessGrant(grant: FileAccessGrant): FileAccessGrant {
    return {
        operation: grant.operation,
        pathPrefix: path.resolve(grant.pathPrefix),
    };
}

function normalizeFileAccessList(grants: unknown[]): FileAccessGrant[] {
    const seen = new Set<string>();
    const normalized: FileAccessGrant[] = [];
    for (const entry of grants) {
        if (!entry || typeof entry !== "object") continue;
        const maybeGrant = entry as Record<string, unknown>;
        const operation = maybeGrant.operation;
        const pathPrefix = maybeGrant.pathPrefix;
        if (
            operation !== "read"
            && operation !== "list"
            && operation !== "search"
            && operation !== "write"
            && operation !== "delete"
        ) {
            continue;
        }
        if (typeof pathPrefix !== "string" || !pathPrefix.trim()) continue;
        const grant = normalizeFileAccessGrant({ operation, pathPrefix });
        const key = `${grant.operation}:${grant.pathPrefix}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(grant);
    }
    return normalized;
}

function parseSecurityPayload(payload: unknown): { allowedCommands: string[]; allowedFileAccess: FileAccessGrant[] } {
    if (Array.isArray(payload)) {
        return { allowedCommands: normalizeList(payload), allowedFileAccess: [] };
    }

    if (payload && typeof payload === "object") {
        const maybeObject = payload as Record<string, unknown>;
        const allowedFileAccess = Array.isArray(maybeObject.allowedFileAccess)
            ? normalizeFileAccessList(maybeObject.allowedFileAccess)
            : [];

        if (Array.isArray(maybeObject.allowedCommands) || Array.isArray(maybeObject.allowedFileAccess)) {
            return {
                allowedCommands: Array.isArray(maybeObject.allowedCommands)
                    ? normalizeList(maybeObject.allowedCommands)
                    : [],
                allowedFileAccess,
            };
        }

        const dynamicList = Object.entries(maybeObject)
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key);

        return {
            allowedCommands: normalizeList(dynamicList),
            allowedFileAccess,
        };
    }

    return { allowedCommands: [], allowedFileAccess: [] };
}

function readSecurityConfig(): { allowedCommands: string[]; allowedFileAccess: FileAccessGrant[] } {
    ensureSecurityConfigSync();

    try {
        const configContent = fs.readFileSync(SECURITY_CONFIG_PATH, "utf8");
        const parsed = JSON.parse(configContent);
        return parseSecurityPayload(parsed);
    } catch (error) {
        console.warn(`Failed to read security config at ${SECURITY_CONFIG_PATH}: ${error instanceof Error ? error.message : error}`);
        return { allowedCommands: DEFAULT_ALLOW_LIST, allowedFileAccess: [] };
    }
}

function readAllowList(): string[] {
    return readSecurityConfig().allowedCommands;
}

export function getSecurityAllowList(): string[] {
    ensureSecurityConfigSync();
    try {
        const stats = fs.statSync(SECURITY_CONFIG_PATH);
        if (cachedAllowList && cachedMtimeMs === stats.mtimeMs) {
            return cachedAllowList;
        }
        cachedAllowList = readAllowList();
        cachedMtimeMs = stats.mtimeMs;
        return cachedAllowList;
    } catch {
        cachedAllowList = null;
        cachedFileAccessAllowList = null;
        cachedMtimeMs = null;
        return readAllowList();
    }
}

export function getFileAccessAllowList(): FileAccessGrant[] {
    ensureSecurityConfigSync();
    try {
        const stats = fs.statSync(SECURITY_CONFIG_PATH);
        if (cachedFileAccessAllowList && cachedMtimeMs === stats.mtimeMs) {
            return cachedFileAccessAllowList;
        }
        cachedFileAccessAllowList = readSecurityConfig().allowedFileAccess;
        cachedMtimeMs = stats.mtimeMs;
        return cachedFileAccessAllowList;
    } catch {
        cachedAllowList = null;
        cachedFileAccessAllowList = null;
        cachedMtimeMs = null;
        return readSecurityConfig().allowedFileAccess;
    }
}

export function resetSecurityAllowListCache() {
    cachedAllowList = null;
    cachedFileAccessAllowList = null;
    cachedMtimeMs = null;
}
