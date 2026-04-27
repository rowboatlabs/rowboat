import { WorkDir } from "../config/config.js";
import fs from "fs";
import path from "path";

const CONFIG_FILE = path.join(WorkDir, "config", "supermemory.json");
const API_BASE = "https://api.supermemory.ai";
const DEFAULT_CONTAINER_TAG = "rowboat-user";

interface SupermemoryConfig {
    apiKey?: string;
    containerTag?: string;
}

function loadConfig(): SupermemoryConfig {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        }
    } catch (error) {
        console.error("[Supermemory] Failed to load config:", error);
    }
    return {};
}

function saveConfig(config: SupermemoryConfig): void {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getApiKey(): string | null {
    const config = loadConfig();
    return config.apiKey || process.env.SUPERMEMORY_API_KEY || null;
}

export function setApiKey(apiKey: string): void {
    const config = loadConfig();
    config.apiKey = apiKey;
    saveConfig(config);
}

export function getContainerTag(): string {
    const config = loadConfig();
    return config.containerTag || DEFAULT_CONTAINER_TAG;
}

export async function isConfigured(): Promise<boolean> {
    return !!getApiKey();
}

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("Supermemory API key not configured");
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("Content-Type", "application/json");
    return fetch(`${API_BASE}${path}`, { ...options, headers });
}

export async function addDocument(content: string, containerTag?: string): Promise<{ id: string; status: string }> {
    const response = await authedFetch("/v3/documents", {
        method: "POST",
        body: JSON.stringify({
            content,
            containerTag: containerTag || getContainerTag(),
            taskType: "memory",
        }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supermemory add failed: ${response.status} ${text}`);
    }
    return response.json();
}

export interface ProfileResult {
    profile: { static: string[]; dynamic: string[] };
    searchResults: { results: Array<{ memory: string; score?: number }> };
}

export async function getProfile(query: string, containerTag?: string): Promise<ProfileResult> {
    const tag = containerTag || getContainerTag();
    const response = await authedFetch(
        `/v3/memory/profile?containerTag=${encodeURIComponent(tag)}&q=${encodeURIComponent(query)}`
    );
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supermemory profile failed: ${response.status} ${text}`);
    }
    return response.json();
}

export async function testConnection(): Promise<boolean> {
    try {
        const apiKey = getApiKey();
        if (!apiKey) return false;
        const response = await fetch(`${API_BASE}/v3/memory/profile?containerTag=test&q=test`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        });
        return response.status === 200 || response.status === 404;
    } catch {
        return false;
    }
}
