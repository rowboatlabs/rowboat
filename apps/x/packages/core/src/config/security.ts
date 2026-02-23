import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { WorkDir } from "./config.js";

export const SECURITY_CONFIG_PATH = path.join(WorkDir, "config", "security.json");

const DEFAULT_ALLOW_LIST = [
    "cat",
    "date",
    "echo",
    "grep",
    "jq",
    "ls",
    "pwd",
    "yq",
    "whoami"
]

let cachedAllowList: string[] | null = null;
let cachedMtimeMs: number | null = null;

export async function addToSecurityConfig(commands: string[]): Promise<void> {
    ensureSecurityConfigSync();
    const current = readAllowList();
    const merged = new Set(current);
    for (const cmd of commands) {
        const normalized = cmd.trim().toLowerCase();
        if (normalized) merged.add(normalized);
    }
    await fsPromises.writeFile(
        SECURITY_CONFIG_PATH,
        JSON.stringify(Array.from(merged).sort(), null, 2) + "\n",
        "utf8",
    );
    // Reset cache so next read picks up the new file
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

function parseSecurityPayload(payload: unknown): string[] {
    if (Array.isArray(payload)) {
        return normalizeList(payload);
    }

    if (payload && typeof payload === "object") {
        const maybeObject = payload as Record<string, unknown>;
        if (Array.isArray(maybeObject.allowedCommands)) {
            return normalizeList(maybeObject.allowedCommands);
        }

        const dynamicList = Object.entries(maybeObject)
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key);

        return normalizeList(dynamicList);
    }

    return [];
}

function readAllowList(): string[] {
    ensureSecurityConfigSync();

    try {
        const configContent = fs.readFileSync(SECURITY_CONFIG_PATH, "utf8");
        const parsed = JSON.parse(configContent);
        return parseSecurityPayload(parsed);
    } catch (error) {
        console.warn(`Failed to read security config at ${SECURITY_CONFIG_PATH}: ${error instanceof Error ? error.message : error}`);
        return DEFAULT_ALLOW_LIST;
    }
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
        cachedMtimeMs = null;
        return readAllowList();
    }
}

export function resetSecurityAllowListCache() {
    cachedAllowList = null;
    cachedMtimeMs = null;
}
