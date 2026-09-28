import { z } from "zod";
import fs from "fs";
import path from "path";
import { WorkDir } from "../config/config.js";

// Replicas (replicas.dev): hosted cloud workspaces that run Claude Code,
// Codex and friends against a GitHub/GitLab repo and hand back a PR. Added
// 2026-09-28 so a Space thread can hand coding work to a workspace and the
// whole room can steer it. Credential model mirrors composio/client.ts: one
// PERSONAL API key per member in config/replicas.json (never an org key —
// an org key attributes every PR to the Replicas bot). Repos, environments,
// model credentials and billing all live on the Replicas side.
//
// Wire shapes: docs.replicas.dev documents endpoint names and the create
// body, not full response schemas, so every parser here is tolerant (pick
// the id/name/status/url keys that exist, keep the raw object). Tighten
// after the first live run against a real workspace.

export const REPLICAS_DEFAULT_BASE_URL = "https://api.replicas.dev";
export const REPLICAS_API_VERSION = "2026-05-17";
const CONFIG_FILE = path.join(WorkDir, "config", "replicas.json");

const ZReplicasConfig = z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
});
type ReplicasConfig = z.infer<typeof ZReplicasConfig>;

function loadConfig(): ReplicasConfig {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return ZReplicasConfig.parse(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")));
        }
    } catch (error) {
        console.error("[Replicas] Failed to load config:", error);
    }
    return {};
}

function saveConfig(config: ReplicasConfig): void {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getApiKey(): string | null {
    return loadConfig().apiKey || process.env.REPLICAS_API_KEY || null;
}

export function getBaseUrl(): string {
    return (loadConfig().baseUrl || process.env.REPLICAS_BASE_URL || REPLICAS_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function setApiKey(apiKey: string): void {
    const config = loadConfig();
    config.apiKey = apiKey;
    saveConfig(config);
}

export function clearApiKey(): void {
    const config = loadConfig();
    delete config.apiKey;
    saveConfig(config);
}

export async function isConfigured(): Promise<boolean> {
    return !!getApiKey();
}

function authHeaders(): Record<string, string> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("Replicas API key not configured (Settings → Code Mode → Replicas)");
    return {
        Authorization: `Bearer ${apiKey}`,
        "X-Replicas-Api-Version": REPLICAS_API_VERSION,
    };
}

/** Headers for a raw request (the SSE reader in events.ts uses these). */
export function requestHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { ...authHeaders(), ...extra };
}

export class ReplicasApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly body: string,
    ) {
        super(message);
        this.name = "ReplicasApiError";
    }
}

/**
 * One JSON round trip. Non-2xx throws ReplicasApiError with the status and a
 * body snippet — the tools turn that into their error envelope.
 */
export async function replicasApiCall<T extends z.ZodTypeAny>(
    schema: T,
    apiPath: string,
    options: RequestInit = {},
): Promise<z.infer<T>> {
    const url = `${getBaseUrl()}${apiPath}`;
    const method = options.method || "GET";
    const startedAt = Date.now();
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(options.headers as Record<string, string> | undefined),
            ...authHeaders(),
        },
    });
    const text = await response.text();
    console.log(`[Replicas] ${method} ${apiPath} → ${response.status} (${Date.now() - startedAt}ms)`);
    if (!response.ok) {
        const snippet = text.slice(0, 400);
        const hint = response.status === 401 || response.status === 403 ? "API key rejected" : `HTTP ${response.status}`;
        throw new ReplicasApiError(`Replicas ${hint} on ${method} ${apiPath}: ${snippet}`, response.status, text);
    }
    if (!text.trim()) return schema.parse(null);
    return schema.parse(JSON.parse(text));
}

// --- tolerant readers ---------------------------------------------------------

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(obj: Rec, keys: string[]): string | null {
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === "string" && value.trim()) return value;
    }
    return null;
}

/** A list response: a bare array, or an object wrapping one under a known key. */
export function unwrapList(raw: unknown, keys: string[] = ["data", "items", "results"]): Rec[] {
    if (Array.isArray(raw)) return raw.filter(isRecord);
    if (!isRecord(raw)) return [];
    for (const key of keys) {
        const value = raw[key];
        if (Array.isArray(value)) return value.filter(isRecord);
    }
    return [];
}

function repositoryLabel(value: unknown): string | null {
    if (typeof value === "string") return value.trim() || null;
    if (!isRecord(value)) return null;
    return pickString(value, ["full_name", "fullName", "name", "slug", "url", "html_url", "id"]);
}

/** Repo names an environment is bound to, from whichever shape the API used. */
export function environmentRepositories(env: Rec): string[] {
    const found: string[] = [];
    const push = (label: string | null) => {
        if (label && !found.includes(label)) found.push(label);
    };
    for (const key of ["repositories", "repos", "repository", "repository_set", "repositorySet"]) {
        const value = env[key];
        if (Array.isArray(value)) value.forEach((item) => push(repositoryLabel(item)));
        else if (isRecord(value) && Array.isArray(value.repositories)) value.repositories.forEach((item) => push(repositoryLabel(item)));
        else if (value !== undefined) push(repositoryLabel(value));
    }
    return found;
}

export interface ReplicasEnvironment {
    id: string;
    name: string;
    repositories: string[];
}

export function normalizeEnvironment(raw: Rec): ReplicasEnvironment | null {
    const id = pickString(raw, ["id", "environment_id", "environmentId"]);
    if (!id) return null;
    const repositories = environmentRepositories(raw);
    return {
        id,
        name: pickString(raw, ["name", "title", "slug"]) ?? repositories[0] ?? id,
        repositories,
    };
}

export interface ReplicasChatSummary {
    id: string;
    /** The harness: claude, codex, cursor, opencode, pi, muse, relay. */
    provider: string | null;
    title: string | null;
    /** true while that chat's agent is running a turn. */
    processing: boolean;
}

export interface ReplicasBranchStatus {
    repository: string;
    branch: string | null;
    added: number;
    removed: number;
}

export interface ReplicasWorkspace {
    id: string;
    name: string | null;
    /** VM status (`active` while awake) — NOT whether the agent is working; see `processing`. */
    status: string | null;
    url: string | null;
    /** The chat the initial message landed in, when the API says. */
    chatId: string | null;
    /** Live 2026-09-28: one pre-created chat per harness; `processing` is the real "agent is working" flag. */
    chats: ReplicasChatSummary[];
    /** Any chat's agent is mid-turn. */
    processing: boolean;
    repositories: string[];
    /** `repository_statuses`: branch and uncommitted diff per repo. */
    branches: ReplicasBranchStatus[];
    raw: Rec;
}

export function normalizeWorkspace(raw: unknown): ReplicasWorkspace | null {
    // The live API wraps the resource: { replica: {...} } (create and get alike).
    const obj = isRecord(raw)
        ? (["replica", "workspace", "data"].map((k) => raw[k]).find(isRecord) as Rec | undefined) ?? raw
        : null;
    if (!obj) return null;
    const id = pickString(obj, ["id", "replica_id", "replicaId", "workspace_id", "workspaceId"]);
    if (!id) return null;
    const chat = obj.chat;
    const chats: ReplicasChatSummary[] = (Array.isArray(obj.chats) ? obj.chats : [])
        .filter(isRecord)
        .map((c) => {
            const chatId = pickString(c, ["id", "chat_id", "chatId"]);
            return chatId
                ? { id: chatId, provider: pickString(c, ["provider", "coding_agent", "agent"]), title: pickString(c, ["title", "name"]), processing: c.processing === true }
                : null;
        })
        .filter((c): c is ReplicasChatSummary => c !== null);
    const branches: ReplicasBranchStatus[] = (Array.isArray(obj.repository_statuses) ? obj.repository_statuses : [])
        .filter(isRecord)
        .map((s) => {
            const diff = isRecord(s.git_diff) ? s.git_diff : {};
            return {
                repository: pickString(s, ["repository", "name"]) ?? "",
                branch: pickString(s, ["branch"]),
                added: typeof diff.added === "number" ? diff.added : 0,
                removed: typeof diff.removed === "number" ? diff.removed : 0,
            };
        });
    return {
        id,
        name: pickString(obj, ["name", "title"]),
        status: pickString(obj, ["status", "state"]),
        url: pickString(obj, ["url", "app_url", "appUrl", "web_url", "html_url"]),
        chatId: pickString(obj, ["chat_id", "chatId"]) ?? (isRecord(chat) ? pickString(chat, ["id"]) : null),
        chats,
        processing: chats.some((c) => c.processing),
        repositories: environmentRepositories(obj),
        branches,
        raw: obj,
    };
}

/** The chat a harness runs in (the initial message lands in the coding_agent's chat). */
export function chatIdFor(workspace: ReplicasWorkspace, provider: string | null | undefined): string | null {
    if (workspace.chatId) return workspace.chatId;
    if (provider) {
        const match = workspace.chats.find((c) => c.provider === provider);
        if (match) return match.id;
    }
    return workspace.chats[0]?.id ?? null;
}

// --- endpoints ------------------------------------------------------------------

export async function listEnvironments(): Promise<ReplicasEnvironment[]> {
    const raw = await replicasApiCall(z.unknown(), "/v1/environments");
    return unwrapList(raw, ["environments", "data", "items", "results"])
        .map(normalizeEnvironment)
        .filter((env): env is ReplicasEnvironment => env !== null);
}

export const REPLICAS_CODING_AGENTS = ["claude", "codex", "cursor", "opencode", "pi", "muse"] as const;
export type ReplicasCodingAgent = (typeof REPLICAS_CODING_AGENTS)[number];

export interface CreateWorkspaceArgs {
    name: string;
    environmentId: string;
    message: string;
    codingAgent?: ReplicasCodingAgent;
    model?: string;
    thinking?: string;
    branch?: string;
    planMode?: boolean;
}

export async function createWorkspace(args: CreateWorkspaceArgs): Promise<ReplicasWorkspace> {
    const body: Rec = {
        name: args.name,
        environment_id: args.environmentId,
        message: args.message,
        coding_agent: args.codingAgent ?? "claude",
        ...(args.model ? { model: args.model } : {}),
        ...(args.thinking ? { thinking: args.thinking } : {}),
        ...(args.branch ? { branch: args.branch } : {}),
        ...(args.planMode ? { plan_mode: true } : {}),
    };
    const raw = await replicasApiCall(z.unknown(), "/v1/replica", { method: "POST", body: JSON.stringify(body) });
    const workspace = normalizeWorkspace(raw);
    if (!workspace) throw new Error(`Replicas returned no workspace id: ${JSON.stringify(raw).slice(0, 300)}`);
    return workspace;
}

export async function getWorkspace(id: string): Promise<ReplicasWorkspace> {
    const raw = await replicasApiCall(z.unknown(), `/v1/replica/${encodeURIComponent(id)}`);
    const workspace = normalizeWorkspace(raw);
    if (!workspace) throw new Error(`Replicas workspace ${id}: unrecognized response ${JSON.stringify(raw).slice(0, 300)}`);
    return workspace;
}

export interface SendMessageArgs {
    message: string;
    chatId?: string;
    planMode?: boolean;
    thinking?: string;
}

export interface SentMessage {
    id: string | null;
    chatId: string | null;
    status: string | null;
    raw: unknown;
}

/** A follow-up into a workspace: queued behind a running turn, or steering it (Replicas' call). */
export async function sendMessage(workspaceId: string, args: SendMessageArgs): Promise<SentMessage> {
    const body: Rec = {
        message: args.message,
        ...(args.chatId ? { chat_id: args.chatId } : {}),
        ...(args.planMode ? { plan_mode: true } : {}),
        ...(args.thinking ? { thinking: args.thinking } : {}),
    };
    const raw = await replicasApiCall(z.unknown(), `/v1/replica/${encodeURIComponent(workspaceId)}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
    });
    const obj = isRecord(raw) ? raw : {};
    return {
        id: pickString(obj, ["id", "message_id", "messageId"]),
        chatId: pickString(obj, ["chat_id", "chatId"]),
        status: pickString(obj, ["status", "state"]),
        raw,
    };
}

export interface ReplicasChat {
    id: string;
    name: string | null;
    raw: Rec;
}

export async function listChats(workspaceId: string): Promise<ReplicasChat[]> {
    const raw = await replicasApiCall(z.unknown(), `/v1/replica/${encodeURIComponent(workspaceId)}/chats`);
    return unwrapList(raw, ["chats", "data", "items", "results"])
        .map((chat) => {
            const id = pickString(chat, ["id", "chat_id", "chatId"]);
            return id ? { id, name: pickString(chat, ["name", "title"]), raw: chat } : null;
        })
        .filter((chat): chat is ReplicasChat => chat !== null);
}

export interface WorkspaceHistory {
    codingAgent: string | null;
    goal: string | null;
    events: import("./history.js").HistoryEvent[];
    total: number | null;
    hasMore: boolean;
}

/**
 * The harness transcript, read from the end (`limit` newest events). Live
 * 2026-09-28: { thread_id, events[{timestamp,type,payload}], beforeCursor,
 * historyVersion, goal, senders, total, has_more, coding_agent }.
 */
export async function getHistory(workspaceId: string, limit = 80): Promise<WorkspaceHistory> {
    const raw = await replicasApiCall(z.unknown(), `/v1/replica/${encodeURIComponent(workspaceId)}/history?limit=${limit}`);
    const obj = isRecord(raw) ? raw : {};
    const events = (Array.isArray(obj.events) ? obj.events : [])
        .filter(isRecord)
        .map((e) => ({
            timestamp: typeof e.timestamp === "string" ? e.timestamp : "",
            type: typeof e.type === "string" ? e.type : "unknown",
            payload: e.payload,
        }));
    return {
        codingAgent: pickString(obj, ["coding_agent", "codingAgent"]),
        goal: pickString(obj, ["goal"]),
        events,
        total: typeof obj.total === "number" ? obj.total : null,
        hasMore: obj.has_more === true,
    };
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
    await replicasApiCall(z.unknown(), `/v1/replica/${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
}

/** The SSE URL the wait tool follows (events.ts reads it with requestHeaders()). */
export function eventsUrl(workspaceId: string): string {
    return `${getBaseUrl()}/v1/replica/${encodeURIComponent(workspaceId)}/events`;
}

// --- UI-facing, never-throwing wrappers (both IPC hosts call these verbatim) ----

export interface ReplicasStatus {
    configured: boolean;
    baseUrl: string;
}

export function getStatus(): ReplicasStatus {
    return { configured: !!getApiKey(), baseUrl: getBaseUrl() };
}

/**
 * Save a key only after it lists environments — a typo should fail at the
 * settings screen, not on a teammate's first dispatch.
 */
export async function setApiKeyVerified(apiKey: string): Promise<{ success: boolean; error?: string; environmentCount?: number }> {
    const trimmed = apiKey.trim();
    if (!trimmed) return { success: false, error: "API key is empty" };
    const previous = loadConfig().apiKey;
    setApiKey(trimmed);
    try {
        const environments = await listEnvironments();
        return { success: true, environmentCount: environments.length };
    } catch (error) {
        if (previous) setApiKey(previous);
        else clearApiKey();
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export async function listEnvironmentsForUi(): Promise<{ environments: ReplicasEnvironment[]; error?: string }> {
    if (!getApiKey()) return { environments: [] };
    try {
        return { environments: await listEnvironments() };
    } catch (error) {
        return { environments: [], error: error instanceof Error ? error.message : String(error) };
    }
}
