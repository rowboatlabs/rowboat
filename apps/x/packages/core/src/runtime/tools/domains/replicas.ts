// Builtin tools: Replicas cloud workspaces (2026-09-28). The model-facing
// face of packages/core/src/replicas: dispatch a task into a workspace,
// steer one that already exists, wait on its event stream, read its status.
// Attached by the `replicas` skill (pinned from the Space composer's "Run on
// Replicas" strip, or loaded on request). Dispatch and send spend money and
// change remote state, so both are gated like addMcpServer.

import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";
import type { ToolContext } from "../exec-tool.js";
import { isReplicasAvailable } from "../../assembly/connections.js";
import {
    chatIdFor,
    createWorkspace,
    eventsUrl,
    getHistory,
    getWorkspace,
    listEnvironments,
    REPLICAS_CODING_AGENTS,
    ReplicasApiError,
    requestHeaders,
    sendMessage,
    type ReplicasEnvironment,
    type ReplicasWorkspace,
} from "../../../replicas/client.js";
import { getBinding, setBinding } from "../../../replicas/bindings.js";
import { findPullRequestUrls, formatWorkspaceHandle, resolveWorkspaceRef, workspaceNameFor } from "../../../replicas/handles.js";
import { isHeartbeat, readEventStream, type ReplicasEvent } from "../../../replicas/events.js";
import { summarizeHistory } from "../../../replicas/history.js";

// Shared by every tool result so a puzzling outcome never sends the copilot
// hunting through local files or Rowboat's own source (seen live 2026-09-28:
// a null lastText produced `find /Users/… -name "replicas*.ts"`).
const NO_LOCAL_DEBUG =
    "These tools talk to a cloud service; nothing about the run exists on this machine. Never run shell commands, search local files, or read Rowboat's source to understand a result — call replicas-status or replicas-wait again instead.";

const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });

/** Is the agent working — the bound chat's flag when known, else any chat's. */
function isProcessing(workspace: ReplicasWorkspace | null, chatId: string | null): boolean {
    if (!workspace) return false;
    if (chatId) {
        const chat = workspace.chats.find((c) => c.id === chatId);
        if (chat) return chat.processing;
    }
    return workspace.processing;
}

export const REPLICAS_TOOL_NAMES = [
    "replicas-environments",
    "replicas-dispatch",
    "replicas-send",
    "replicas-wait",
    "replicas-status",
] as const;

function errorEnvelope(error: unknown): { success: false; error: string } {
    if (error instanceof ReplicasApiError) return { success: false, error: error.message };
    return { success: false, error: error instanceof Error ? error.message : String(error) };
}

/** An explicit ref beats the session binding; neither = a clear error, never a guess. */
function resolveWorkspaceId(ref: string | undefined, ctx?: ToolContext): { id: string } | { error: string } {
    if (ref?.trim()) {
        const id = resolveWorkspaceRef(ref);
        return id ? { id } : { error: `"${ref}" is not a Replicas workspace id, handle line, or URL` };
    }
    const bound = ctx?.sessionId ? getBinding(ctx.sessionId) : null;
    if (bound) return { id: bound.workspaceId };
    return {
        error:
            "No Replicas workspace is bound to this conversation. Pass `workspace` (the id from a `Replicas workspace` handle line in the thread, or its URL), or dispatch a new one with replicas-dispatch.",
    };
}

function matchEnvironment(
    environments: ReplicasEnvironment[],
    input: { environmentId?: string; repository?: string },
): { environment: ReplicasEnvironment } | { error: string } {
    if (input.environmentId) {
        const byId = environments.find((env) => env.id === input.environmentId);
        return byId ? { environment: byId } : { error: `No Replicas environment with id ${input.environmentId}. Known: ${describeEnvironments(environments)}` };
    }
    if (input.repository) {
        const needle = input.repository.trim().toLowerCase();
        const scored = environments
            .map((env) => {
                const haystacks = [env.name, ...env.repositories].map((s) => s.toLowerCase());
                const exact = haystacks.some((h) => h === needle || h.endsWith(`/${needle}`));
                const partial = haystacks.some((h) => h.includes(needle));
                return { env, score: exact ? 2 : partial ? 1 : 0 };
            })
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score);
        if (scored.length === 0) {
            return { error: `No Replicas environment matches repository "${input.repository}". Known: ${describeEnvironments(environments)}. The repo may need connecting on the Replicas side first.` };
        }
        if (scored.length > 1 && scored[0]!.score === scored[1]!.score) {
            return { error: `Repository "${input.repository}" is ambiguous on Replicas: ${scored.map((s) => `${s.env.name} (${s.env.id})`).join(", ")}. Pass environmentId.` };
        }
        return { environment: scored[0]!.env };
    }
    if (environments.length === 1) return { environment: environments[0]! };
    if (environments.length === 0) return { error: "This Replicas account has no environments yet. Connect a repository on Replicas first." };
    return { error: `Which repository? Pass environmentId or repository. Known: ${describeEnvironments(environments)}` };
}

function describeEnvironments(environments: ReplicasEnvironment[]): string {
    return environments.map((env) => `${env.name} [${env.id}]${env.repositories.length ? ` (${env.repositories.join(", ")})` : ""}`).join("; ") || "none";
}

/** Text-ish fields a payload might carry — the last assistant words, for the plan-mode hand-back. */
function payloadText(payload: unknown): string | null {
    if (typeof payload === "string") return payload;
    if (typeof payload !== "object" || payload === null) return null;
    const obj = payload as Record<string, unknown>;
    for (const key of ["text", "content", "message", "delta", "summary"]) {
        const value = obj[key];
        if (typeof value === "string" && value.trim()) return value;
        if (typeof value === "object" && value !== null) {
            const nested = payloadText(value);
            if (nested) return nested;
        }
    }
    return null;
}

const DONE_TYPE_RE = /(turn|run|response|agent|assistant|task|session)[._-]?(complete|completed|done|end|ended|finish|finished|idle|stopped)\b|^(complete|completed|done|idle|finished)$/i;
const ERROR_TYPE_RE = /\b(error|failed|failure)\b/i;

export const replicasTools: z.infer<typeof BuiltinToolsSchema> = {
    "replicas-environments": {
        permission: "none",
        isAvailable: isReplicasAvailable,
        description:
            "List the Replicas environments (one per connected repository) this account can dispatch coding work into: id, name, repositories. Call this only when you need to pick a repo and none was given — the Space composer's Run-on-Replicas block already names the environment.",
        inputSchema: z.object({}),
        execute: async () => {
            try {
                const environments = await listEnvironments();
                return { success: true, environments };
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },

    "replicas-dispatch": {
        permission: "prompt",
        isAvailable: isReplicasAvailable,
        description:
            "Start a NEW Replicas cloud workspace (an isolated VM with the repo cloned) and give its coding agent a task. Returns the workspace id, its URL, and a `handle` line — in a Space thread, post that handle line verbatim so teammates can steer the same workspace. Before dispatching in a thread, check the thread for an existing handle: if one exists, use replicas-send instead of starting a second workspace. Forward the user's request nearly verbatim as `task`; add thread context only under a labeled section when the ask refers to it. The workspace bills the Replicas org per awake minute and opens a pull request on GitHub — it never touches this machine.",
        inputSchema: z.object({
            task: z.string().min(1).describe("The coding request, forwarded nearly verbatim (fix typos only). Include a labeled 'Context from the thread:' section only when the ask refers to the discussion."),
            environmentId: z.string().optional().describe("Replicas environment id. Prefer this when the Run-on-Replicas block or the user gives one."),
            repository: z.string().optional().describe("Repository name (e.g. 'rowboatlabs/rowboat' or 'rowboat') to resolve the environment when no id is known."),
            name: z.string().optional().describe("Short slug for the workspace (default: derived from the task)."),
            codingAgent: z.enum(REPLICAS_CODING_AGENTS).optional().describe("Harness to run inside the workspace. Default claude."),
            model: z.string().optional().describe("Model id for the harness, when the user named one."),
            thinking: z.string().optional().describe("Reasoning level when the user asked for one (e.g. low, medium, high)."),
            branch: z.string().optional().describe("Branch to start from, when the user named one."),
            planMode: z.boolean().optional().describe("true = ask the agent for a plan first (Manual in the composer strip). Post the plan to the thread and send 'proceed' only after a go-ahead."),
        }),
        execute: async (input: {
            task: string;
            environmentId?: string;
            repository?: string;
            name?: string;
            codingAgent?: (typeof REPLICAS_CODING_AGENTS)[number];
            model?: string;
            thinking?: string;
            branch?: string;
            planMode?: boolean;
        }, ctx?: ToolContext) => {
            try {
                const environments = await listEnvironments();
                const picked = matchEnvironment(environments, input);
                if ("error" in picked) return { success: false, error: picked.error };
                const workspace = await createWorkspace({
                    name: input.name?.trim() || workspaceNameFor(input.task),
                    environmentId: picked.environment.id,
                    message: input.task,
                    ...(input.codingAgent ? { codingAgent: input.codingAgent } : {}),
                    ...(input.model ? { model: input.model } : {}),
                    ...(input.thinking ? { thinking: input.thinking } : {}),
                    ...(input.branch ? { branch: input.branch } : {}),
                    ...(input.planMode ? { planMode: true } : {}),
                });
                const chatId = chatIdFor(workspace, input.codingAgent ?? "claude");
                if (ctx?.sessionId) {
                    setBinding(ctx.sessionId, {
                        workspaceId: workspace.id,
                        chatId,
                        environmentId: picked.environment.id,
                        url: workspace.url,
                    });
                }
                const handle = formatWorkspaceHandle({ id: workspace.id, url: workspace.url });
                return {
                    success: true,
                    workspaceId: workspace.id,
                    chatId,
                    url: workspace.url,
                    status: workspace.status,
                    environment: { id: picked.environment.id, name: picked.environment.name, repositories: picked.environment.repositories },
                    handle,
                    note: `This conversation is now bound to the workspace: replicas-send and replicas-wait target it by default. In a Space thread, post the \`handle\` line verbatim (one message) so teammates' Rowboats can steer the same workspace, then call replicas-wait. ${NO_LOCAL_DEBUG}`,
                };
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },

    "replicas-send": {
        permission: "prompt",
        isAvailable: isReplicasAvailable,
        description:
            "Send a follow-up or steering message into an EXISTING Replicas workspace. Replicas queues it behind a running turn or steers the turn; it never boots a second VM. Use this for 'also do X', corrections, 'proceed with the plan', and for any teammate's follow-up when the thread already carries a `Replicas workspace` handle line — pass that handle (or its URL / id) as `workspace`. Omit `workspace` only when this conversation already dispatched one.",
        inputSchema: z.object({
            message: z.string().min(1).describe("The follow-up, forwarded nearly verbatim."),
            workspace: z.string().optional().describe("Workspace id, the handle line from the thread, or the workspace URL. Default: the workspace this conversation dispatched."),
            planMode: z.boolean().optional().describe("Ask for a plan before changes."),
            thinking: z.string().optional().describe("Reasoning level, when the user asked for one."),
        }),
        execute: async (input: { message: string; workspace?: string; planMode?: boolean; thinking?: string }, ctx?: ToolContext) => {
            const resolved = resolveWorkspaceId(input.workspace, ctx);
            if ("error" in resolved) return { success: false, error: resolved.error };
            try {
                const bound = ctx?.sessionId ? getBinding(ctx.sessionId) : null;
                const chatId = bound?.workspaceId === resolved.id ? bound.chatId ?? undefined : undefined;
                const sent = await sendMessage(resolved.id, {
                    message: input.message,
                    ...(chatId ? { chatId } : {}),
                    ...(input.planMode ? { planMode: true } : {}),
                    ...(input.thinking ? { thinking: input.thinking } : {}),
                });
                let url: string | null = bound?.workspaceId === resolved.id ? bound.url : null;
                if (!url) {
                    url = await getWorkspace(resolved.id).then((w) => w.url).catch(() => null);
                }
                if (ctx?.sessionId) {
                    setBinding(ctx.sessionId, { workspaceId: resolved.id, chatId: sent.chatId ?? chatId ?? null, url });
                }
                return {
                    success: true,
                    workspaceId: resolved.id,
                    url,
                    messageId: sent.id,
                    status: sent.status,
                    handle: formatWorkspaceHandle({ id: resolved.id, url }),
                    note: `Queued or steering. Call replicas-wait to follow the outcome. ${NO_LOCAL_DEBUG}`,
                };
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },

    "replicas-wait": {
        permission: "none",
        isAvailable: isReplicasAvailable,
        description:
            "Wait for a Replicas workspace's agent to finish its current turn (or until maxMinutes), then return the outcome: `answer` (the agent's final message — an answer, a plan, or a question back), `prUrls` (pull requests it opened), `processing` (still working?), and the branch diff. Call this right after replicas-dispatch or replicas-send. For a question-shaped task there is no PR: `answer` IS the result — post it. If `processing` is still true, call replicas-wait again. " +
            NO_LOCAL_DEBUG,
        inputSchema: z.object({
            workspace: z.string().optional().describe("Workspace id, handle line, or URL. Default: the bound workspace."),
            maxMinutes: z.number().min(1).max(60).optional().describe("Upper bound on the wait. Default 20."),
            quietSeconds: z.number().min(30).max(900).optional().describe("Give up on the live stream after this long without an agent event. Default 150."),
        }),
        execute: async (input: { workspace?: string; maxMinutes?: number; quietSeconds?: number }, ctx?: ToolContext) => {
            const resolved = resolveWorkspaceId(input.workspace, ctx);
            if ("error" in resolved) return { success: false, error: resolved.error };
            const maxMs = Math.round((input.maxMinutes ?? 20) * 60_000);
            const quietMs = Math.round((input.quietSeconds ?? 150) * 1000);
            const startedAt = Date.now();
            const bound = ctx?.sessionId ? getBinding(ctx.sessionId) : null;
            const chatId = bound?.workspaceId === resolved.id ? bound.chatId : null;

            // Live vocabulary (2026-09-28): `chat.turn.delta` while the agent
            // streams, `chat.turn.completed` when the turn ends, and
            // `engine.status.changed` (payload.status.chatsProcessing) a few
            // times a minute. The stream has no replay, so a turn that ended
            // before we connect is invisible on it — the workspace's per-chat
            // `processing` flag and the history endpoint are the ground truth.
            let workspace: ReplicasWorkspace | null = await getWorkspace(resolved.id).catch(() => null);
            // A message sent a moment ago may not have flipped `processing` yet.
            for (let i = 0; i < 3 && workspace && !isProcessing(workspace, chatId) && !ctx?.signal.aborted; i++) {
                await sleep(2000, ctx?.signal);
                workspace = await getWorkspace(resolved.id).catch(() => workspace);
            }

            const eventCounts: Record<string, number> = {};
            const prUrls: string[] = [];
            let deltaText: string | null = null;
            let lastEventAt: string | null = null;
            let errors = 0;
            let sawTurnCompleted = false;
            let sawProcessing = false;
            let agentEvents = 0;
            let streamOutcome: "skipped" | "ended" | "stopped" | "quiet" | "aborted" | "error" = "skipped";
            let streamError: string | null = null;

            if (!workspace || isProcessing(workspace, chatId)) {
                const controller = new AbortController();
                const onOuterAbort = () => controller.abort();
                ctx?.signal.addEventListener("abort", onOuterAbort, { once: true });
                const deadline = setTimeout(() => controller.abort(), maxMs);
                const onEvent = (event: ReplicasEvent): "continue" | "stop" => {
                    eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
                    if (isHeartbeat(event)) return "continue";
                    for (const url of findPullRequestUrls(event.raw)) if (!prUrls.includes(url)) prUrls.push(url);
                    if (event.type === "engine.status.changed") {
                        const status = (event.payload as { status?: { chatsProcessing?: unknown } } | null)?.status;
                        const n = typeof status?.chatsProcessing === "number" ? status.chatsProcessing : null;
                        if (n !== null && n > 0) sawProcessing = true;
                        else if (n === 0 && sawProcessing) return "stop"; // every chat went idle
                        return "continue";
                    }
                    agentEvents += 1;
                    lastEventAt = event.ts ?? new Date().toISOString();
                    const text = payloadText(event.payload);
                    if (text) deltaText = text.slice(-2000);
                    if (ERROR_TYPE_RE.test(event.type)) errors += 1;
                    if (event.type === "chat.turn.completed" || DONE_TYPE_RE.test(event.type)) {
                        sawTurnCompleted = true;
                        return "stop";
                    }
                    return "continue";
                };
                try {
                    streamOutcome = await readEventStream({
                        url: eventsUrl(resolved.id),
                        headers: requestHeaders(),
                        signal: controller.signal,
                        onEvent,
                        quietMs,
                    });
                } catch (error) {
                    streamOutcome = "error";
                    streamError = error instanceof Error ? error.message : String(error);
                } finally {
                    clearTimeout(deadline);
                    ctx?.signal.removeEventListener("abort", onOuterAbort);
                }
            }

            // Ground truth after the stream: the transcript and the processing flag.
            const history = await getHistory(resolved.id, 80).catch(() => null);
            const summary = history ? summarizeHistory(history.events) : null;
            workspace = await getWorkspace(resolved.id).catch(() => workspace);
            const processing = isProcessing(workspace, chatId);
            for (const url of summary?.prUrls ?? []) if (!prUrls.includes(url)) prUrls.push(url);
            const answer = summary?.resultText ?? summary?.lastAssistantText ?? deltaText;

            const cancelled = !!ctx?.signal.aborted;
            const timedOut = streamOutcome === "aborted" && !cancelled;
            const outcome = cancelled
                ? "cancelled"
                : prUrls.length > 0
                  ? "pr_opened"
                  : !processing && (summary?.finished || sawTurnCompleted || answer)
                    ? "completed"
                    : streamOutcome === "error"
                      ? "error"
                      : timedOut
                        ? "timeout"
                        : processing
                          ? "still_running"
                          : "completed";
            const branches = workspace?.branches ?? [];
            const diff = branches.reduce((acc, b) => ({ added: acc.added + b.added, removed: acc.removed + b.removed }), { added: 0, removed: 0 });
            return {
                success: outcome !== "error" && outcome !== "cancelled",
                outcome,
                workspaceId: resolved.id,
                url: workspace?.url ?? null,
                processing,
                answer,
                prUrls,
                stopReason: summary?.stopReason ?? null,
                toolUses: summary?.toolUses ?? 0,
                branch: branches[0]?.branch ?? null,
                uncommittedDiff: diff,
                lastEventAt: lastEventAt ?? summary?.lastTimestamp ?? null,
                eventCounts,
                agentEvents,
                errorsSeen: errors,
                elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
                ...(streamError ? { error: streamError } : {}),
                handle: formatWorkspaceHandle({ id: resolved.id, url: workspace?.url ?? null }),
                note:
                    outcome === "pr_opened"
                        ? "Report the PR link; do not summarize the diff."
                        : outcome === "completed"
                          ? "The agent finished. `answer` is its final message — for a question that IS the result, post it; for coding work with no PR, it says what happened or what it needs."
                          : outcome === "still_running"
                            ? "Still working. Call replicas-wait again."
                            : NO_LOCAL_DEBUG,
            };
        },
    },

    "replicas-status": {
        permission: "none",
        isAvailable: isReplicasAvailable,
        description:
            "Read a Replicas workspace's current status and URL (no waiting). Default: the workspace bound to this conversation; or pass a handle line / URL / id from the thread.",
        inputSchema: z.object({
            workspace: z.string().optional().describe("Workspace id, handle line, or URL."),
        }),
        execute: async (input: { workspace?: string }, ctx?: ToolContext) => {
            const resolved = resolveWorkspaceId(input.workspace, ctx);
            if ("error" in resolved) return { success: false, error: resolved.error };
            try {
                const workspace = await getWorkspace(resolved.id);
                const bound = ctx?.sessionId ? getBinding(ctx.sessionId) : null;
                return {
                    success: true,
                    workspaceId: workspace.id,
                    name: workspace.name,
                    vmStatus: workspace.status,
                    processing: isProcessing(workspace, bound?.workspaceId === workspace.id ? bound.chatId : null),
                    chats: workspace.chats.map((c) => ({ provider: c.provider, title: c.title, processing: c.processing })),
                    repositories: workspace.repositories,
                    branches: workspace.branches,
                    url: workspace.url,
                    boundToThisConversation: bound?.workspaceId === workspace.id,
                    handle: formatWorkspaceHandle({ id: workspace.id, url: workspace.url }),
                    note: NO_LOCAL_DEBUG,
                };
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },
};
