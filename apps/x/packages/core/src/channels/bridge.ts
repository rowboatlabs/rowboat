import type { SessionIndexEntry } from "@x/shared/dist/sessions.js";
import { reduceTurn, type TurnStreamEvent } from "@x/shared/dist/turns.js";
import { assistantText, lastAssistantText } from "../agents/headless.js";
import { TurnInputError } from "../turns/api.js";
import { ASK_HUMAN_TOOL } from "../turns/bridges/real-agent-resolver.js";
import { TurnNotSettledError, type ISessions } from "../sessions/api.js";
import type { EmitterSessionBus } from "../sessions/bus.js";

// Transport-agnostic command layer: inbound texts from a messaging channel
// are parsed into commands (list / resume / new / stop / status) or forwarded
// into a regular chat session; the turn's final assistant text is sent back
// through the transport's reply callback. Turns run with autoPermission and
// show up live in the desktop UI like any other session.

const AGENT_ID = "copilot";
const TURN_TIMEOUT_MS = 30 * 60 * 1000;
const LIST_LIMIT = 10;
// Telegram caps messages at 4096 chars; WhatsApp is far higher. Long replies
// are chunked, then truncated — the desktop app has the full text.
const REPLY_CHUNK_SIZE = 3500;
const MAX_REPLY_CHUNKS = 3;

const ASK_HUMAN_TOOL_ID = `builtin:${ASK_HUMAN_TOOL}`;

const HELP_TEXT = [
    "🤖 Rowboat commands:",
    "• list — recent chats",
    "• resume N — continue chat N from the list",
    "• new [message] — start a fresh chat",
    "• status — current chat and what it's doing",
    "• stop — cancel the running task",
    "",
    "Anything else is sent to the current chat.",
].join("\n");

export type ReplyFn = (text: string) => Promise<void>;

interface SenderState {
    activeSessionId: string | null;
    // sessionIds as last shown by `list` (1-based indexing for `resume N`).
    lastList: string[];
    pendingAsk: { turnId: string; toolCallId: string } | null;
    busy: boolean;
}

type Settled =
    | { kind: "completed"; text: string | null }
    | { kind: "failed"; error: string }
    | { kind: "cancelled" }
    | { kind: "ask_human"; toolCallId: string; query: string; options?: string[] }
    | { kind: "suspended" }
    | { kind: "timeout" };

function settleOf(event: TurnStreamEvent): Settled | null {
    switch (event.type) {
        case "turn_completed":
            return { kind: "completed", text: assistantText(event.output) };
        case "turn_failed":
            return { kind: "failed", error: event.error };
        case "turn_cancelled":
            return { kind: "cancelled" };
        case "turn_suspended": {
            const ask = event.pendingAsyncTools.find(
                (t) => t.toolId === ASK_HUMAN_TOOL_ID || t.toolName === ASK_HUMAN_TOOL,
            );
            if (ask) {
                const input = ask.input as { question?: unknown; options?: unknown } | null;
                const query =
                    typeof input?.question === "string" && input.question
                        ? input.question
                        : "The agent needs your input.";
                const options = Array.isArray(input?.options)
                    ? input.options.filter((o): o is string => typeof o === "string")
                    : undefined;
                return { kind: "ask_human", toolCallId: ask.toolCallId, query, options };
            }
            // Other async tools settle on their own and the turn resumes;
            // keep waiting. Pending permissions need the desktop.
            if (event.pendingAsyncTools.length === 0 && event.pendingPermissions.length > 0) {
                return { kind: "suspended" };
            }
            return null;
        }
        default:
            return null;
    }
}

function relativeTime(iso: string): string {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return "";
    const diffSec = Math.round((Date.now() - then) / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.round(diffHr / 24)}d ago`;
}

function chunkReply(text: string): string[] {
    if (text.length <= REPLY_CHUNK_SIZE) return [text];
    const parts: string[] = [];
    let rest = text;
    while (rest.length > 0 && parts.length < MAX_REPLY_CHUNKS) {
        parts.push(rest.slice(0, REPLY_CHUNK_SIZE));
        rest = rest.slice(REPLY_CHUNK_SIZE);
    }
    if (rest.length > 0) {
        parts[parts.length - 1] += "\n… (truncated — open Rowboat for the full reply)";
    }
    return parts;
}

interface TurnWatcher {
    waitFor(turnId: string, timeoutMs: number): Promise<Settled>;
    dispose(): void;
}

export class ChannelBridge {
    private senders = new Map<string, SenderState>();

    constructor(
        private readonly deps: {
            sessions: ISessions;
            sessionBus: EmitterSessionBus;
        },
    ) {}

    async handleInbound(senderKey: string, text: string, reply: ReplyFn): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed) return;
        const state = this.senderState(senderKey);
        const lower = trimmed.toLowerCase();

        try {
            if (lower === "help" || lower === "?") {
                await reply(HELP_TEXT);
                return;
            }
            if (lower === "list" || lower === "chats") {
                await reply(this.renderList(state));
                return;
            }
            const resume = /^(?:resume|open)\s+(\d+)$/.exec(lower);
            if (resume) {
                await reply(this.resumeSession(state, Number(resume[1])));
                return;
            }
            if (lower === "status") {
                await reply(this.renderStatus(state));
                return;
            }
            if (lower === "stop") {
                await reply(await this.stopActive(state));
                return;
            }
            if (lower === "new") {
                state.activeSessionId = null;
                state.pendingAsk = null;
                await reply("🆕 Fresh chat — send your first message.");
                return;
            }
            const newWithText = /^new\s+([\s\S]+)$/i.exec(trimmed);
            if (newWithText) {
                state.activeSessionId = null;
                state.pendingAsk = null;
                await this.runMessage(state, newWithText[1].trim(), reply);
                return;
            }
            await this.runMessage(state, trimmed, reply);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await reply(`❌ ${message}`).catch(() => undefined);
        }
    }

    private senderState(senderKey: string): SenderState {
        let state = this.senders.get(senderKey);
        if (!state) {
            state = { activeSessionId: null, lastList: [], pendingAsk: null, busy: false };
            this.senders.set(senderKey, state);
        }
        return state;
    }

    private sessionEntry(sessionId: string): SessionIndexEntry | undefined {
        return this.deps.sessions.listSessions().find((e) => e.sessionId === sessionId);
    }

    private recentSessions(): SessionIndexEntry[] {
        return this.deps.sessions
            .listSessions()
            .filter((e) => !e.error)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, LIST_LIMIT);
    }

    private renderList(state: SenderState): string {
        const entries = this.recentSessions();
        if (entries.length === 0) {
            return "No chats yet — just send a message to start one.";
        }
        state.lastList = entries.map((e) => e.sessionId);
        const lines = entries.map((e, i) => {
            const marker =
                e.latestTurnStatus === "suspended" ? " ⚠️" :
                e.latestTurnStatus === "idle" ? " ⏳" : "";
            const active = e.sessionId === state.activeSessionId ? " ← current" : "";
            return `${i + 1}. ${e.title ?? "Untitled"}${marker} (${relativeTime(e.updatedAt)})${active}`;
        });
        return [
            "Recent chats:",
            ...lines,
            "",
            `Reply "resume N" to continue one.`,
        ].join("\n");
    }

    private resumeSession(state: SenderState, index: number): string {
        if (state.lastList.length === 0) {
            state.lastList = this.recentSessions().map((e) => e.sessionId);
        }
        const sessionId = state.lastList[index - 1];
        if (!sessionId) {
            return `No chat #${index} — send "list" to see recent chats.`;
        }
        state.activeSessionId = sessionId;
        state.pendingAsk = null;
        const entry = this.sessionEntry(sessionId);
        return `▶️ Resumed "${entry?.title ?? "Untitled"}" — send a message to continue.`;
    }

    private renderStatus(state: SenderState): string {
        if (!state.activeSessionId) {
            return "No current chat — your next message starts a new one.";
        }
        const entry = this.sessionEntry(state.activeSessionId);
        if (!entry) return "Current chat no longer exists — send a message to start fresh.";
        const status = state.busy
            ? "working"
            : entry.latestTurnStatus === "suspended"
              ? "waiting on input"
              : entry.latestTurnStatus;
        return `Current chat: "${entry.title ?? "Untitled"}" — ${status}.`;
    }

    private async stopActive(state: SenderState): Promise<string> {
        state.pendingAsk = null;
        if (!state.activeSessionId) return "Nothing to stop.";
        const entry = this.sessionEntry(state.activeSessionId);
        if (!entry?.latestTurnId) return "Nothing to stop.";
        if (
            entry.latestTurnStatus === "completed" ||
            entry.latestTurnStatus === "failed" ||
            entry.latestTurnStatus === "cancelled"
        ) {
            return "Nothing running in the current chat.";
        }
        await this.deps.sessions.stopTurn(entry.latestTurnId, "stopped from mobile channel");
        return "🛑 Stop requested.";
    }

    private async runMessage(state: SenderState, text: string, reply: ReplyFn): Promise<void> {
        if (state.busy) {
            await reply('⏳ Still working on the previous message — send "stop" to cancel it.');
            return;
        }
        state.busy = true;
        try {
            await reply("⏳ Working on it…");
            if (state.pendingAsk) {
                const ask = state.pendingAsk;
                state.pendingAsk = null;
                const answered = await this.answerAsk(state, ask, text, reply);
                if (answered) return;
                // The ask was already resolved elsewhere (e.g. answered in the
                // desktop UI) or the turn is terminal — treat the text as a
                // normal message instead of discarding it.
            }
            await this.sendToSession(state, text, reply);
        } catch (error) {
            if (error instanceof TurnNotSettledError) {
                await reply(
                    '⏳ That chat is still working on something — send "stop" to cancel it, or "new" to start a fresh chat.',
                );
                return;
            }
            throw error;
        } finally {
            state.busy = false;
        }
    }

    private async sendToSession(state: SenderState, text: string, reply: ReplyFn): Promise<void> {
        // Subscribe before advancing so no settle event can slip past.
        const watcher = this.watchBus();
        try {
            if (!state.activeSessionId) {
                state.activeSessionId = await this.deps.sessions.createSession();
            }
            const sent = await this.deps.sessions.sendMessage(
                state.activeSessionId,
                { role: "user", content: text },
                { agent: { agentId: AGENT_ID }, autoPermission: true },
            );
            const settled = await watcher.waitFor(sent.turnId, TURN_TIMEOUT_MS);
            await this.deliverSettled(state, sent.turnId, settled, reply);
        } finally {
            watcher.dispose();
        }
    }

    // Returns false when the ask was stale (already answered on the desktop /
    // turn terminal) — the caller then routes the text as a normal message.
    private async answerAsk(
        state: SenderState,
        ask: { turnId: string; toolCallId: string },
        text: string,
        reply: ReplyFn,
    ): Promise<boolean> {
        const watcher = this.watchBus();
        try {
            const settledPromise = watcher.waitFor(ask.turnId, TURN_TIMEOUT_MS);
            // respondToAskHuman resolves only when the whole advance settles,
            // so it must not be awaited ahead of the watcher (that would
            // bypass TURN_TIMEOUT_MS). Race instead: its rejection (stale
            // ask) must beat the 30-minute timeout; its success defers to the
            // settle event.
            const settled = await Promise.race([
                settledPromise,
                this.deps.sessions
                    .respondToAskHuman(ask.turnId, ask.toolCallId, text)
                    .then(() => settledPromise),
            ]);
            await this.deliverSettled(state, ask.turnId, settled, reply);
            return true;
        } catch (error) {
            if (error instanceof TurnInputError) return false;
            throw error;
        } finally {
            watcher.dispose();
        }
    }

    private async deliverSettled(
        state: SenderState,
        turnId: string,
        settled: Settled,
        reply: ReplyFn,
    ): Promise<void> {
        switch (settled.kind) {
            case "completed": {
                let text = settled.text;
                if (!text) {
                    // Rare: final message had no text parts; recover the last
                    // assistant text from the persisted turn.
                    try {
                        const turn = await this.deps.sessions.getTurn(turnId);
                        text = lastAssistantText(reduceTurn(turn.events));
                    } catch {
                        text = null;
                    }
                }
                for (const chunk of chunkReply(text ?? "✅ Done (no text reply).")) {
                    await reply(chunk);
                }
                return;
            }
            case "failed":
                await reply(`❌ Task failed: ${settled.error}`);
                return;
            case "cancelled":
                await reply("🛑 Stopped.");
                return;
            case "ask_human": {
                state.pendingAsk = { turnId, toolCallId: settled.toolCallId };
                const lines = [`❓ ${settled.query}`];
                if (settled.options?.length) {
                    lines.push(...settled.options.map((o, i) => `${i + 1}. ${o}`));
                }
                lines.push("", "Reply with your answer.");
                await reply(lines.join("\n"));
                return;
            }
            case "suspended":
                await reply(
                    "⚠️ The agent is waiting for a permission approval — open Rowboat on your desktop to continue.",
                );
                return;
            case "timeout":
                await reply(
                    "⏱️ Still running after 30 minutes — check the desktop app for progress.",
                );
                return;
        }
    }

    // Buffers settle-relevant events (≈1 per turn) from the moment of
    // subscription so a settle firing between advance-start and waitFor() is
    // never lost — without retaining the per-token delta stream of every
    // concurrent session. One watcher per in-flight message.
    private watchBus(): TurnWatcher {
        const buffered: Array<{ turnId: string; settled: Settled }> = [];
        let waiter: { turnId: string; resolve: (settled: Settled) => void } | null = null;
        let cancelTimer: (() => void) | null = null;
        const unsubscribe = this.deps.sessionBus.subscribe((event) => {
            if (event.kind !== "turn-event") return;
            const settled = settleOf(event.event);
            if (!settled) return;
            if (waiter) {
                if (event.turnId === waiter.turnId) waiter.resolve(settled);
                return;
            }
            buffered.push({ turnId: event.turnId, settled });
        });
        return {
            waitFor: (turnId: string, timeoutMs: number): Promise<Settled> =>
                new Promise<Settled>((resolve) => {
                    const hit = buffered.find((b) => b.turnId === turnId);
                    if (hit) {
                        resolve(hit.settled);
                        return;
                    }
                    buffered.length = 0;
                    const timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
                    cancelTimer = () => clearTimeout(timer);
                    waiter = {
                        turnId,
                        resolve: (settled) => {
                            clearTimeout(timer);
                            resolve(settled);
                        },
                    };
                }),
            dispose: () => {
                unsubscribe();
                cancelTimer?.();
            },
        };
    }
}
