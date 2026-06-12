import crypto from "node:crypto";
import { z } from "zod";
import { Message, MessageList } from "@x/shared/dist/message.js";
import type { AgentLoop, TurnHandle } from "../agent-loop/agent-loop.js";
import { KeyedMutex } from "../agent-loop/mutex.js";
import type { TurnStore } from "../agent-loop/turn-store.js";
import {
    AgentLoopTurn,
    deriveToolCallState,
    deriveTurnStatus,
    unresolvedToolCalls,
} from "../agent-loop/types.js";
import type { SessionStore } from "./session-store.js";
import { CreateSessionInput, SendMessageOptions, Session } from "./types.js";

// A thin layer above the agent loop: a session is an ordered chain of
// self-contained turns. sendMessage builds the next turn's input from the
// previous turn's full transcript (copy-forward history) — the loop itself
// never learns that sessions exist.
export interface Sessions {
    createSession(input?: z.infer<typeof CreateSessionInput>): Promise<z.infer<typeof Session>>;
    getSession(sessionId: string): Promise<z.infer<typeof Session>>;
    listSessions(filter?: { agentId?: string }): Promise<z.infer<typeof Session>[]>;
    sendMessage(
        sessionId: string,
        messages: z.infer<typeof MessageList>,
        options?: z.infer<typeof SendMessageOptions>,
    ): Promise<TurnHandle>;
    getHistory(sessionId: string): Promise<z.infer<typeof MessageList>>;
    listTurns(sessionId: string): Promise<z.infer<typeof AgentLoopTurn>[]>;
}

function nowIso(): string {
    return new Date().toISOString();
}

export class SessionsImpl implements Sessions {
    private sessionStore: SessionStore;
    private turnStore: TurnStore;
    private agentLoop: AgentLoop;
    private mutex = new KeyedMutex();

    constructor(deps: {
        sessionStore: SessionStore;
        turnStore: TurnStore;
        agentLoop: AgentLoop;
    }) {
        this.sessionStore = deps.sessionStore;
        this.turnStore = deps.turnStore;
        this.agentLoop = deps.agentLoop;
    }

    async createSession(
        input: z.infer<typeof CreateSessionInput> = {},
    ): Promise<z.infer<typeof Session>> {
        const parsed = CreateSessionInput.parse(input);
        const now = nowIso();
        const session: z.infer<typeof Session> = {
            id: crypto.randomUUID(),
            agentId: parsed.agentId ?? null,
            title: parsed.title ?? null,
            createdAt: now,
            updatedAt: now,
        };
        await this.sessionStore.create(session);
        return session;
    }

    async getSession(sessionId: string): Promise<z.infer<typeof Session>> {
        return this.mustGetSession(sessionId);
    }

    async listSessions(filter?: { agentId?: string }): Promise<z.infer<typeof Session>[]> {
        return this.sessionStore.list(filter);
    }

    async sendMessage(
        sessionId: string,
        messages: z.infer<typeof MessageList>,
        options: z.infer<typeof SendMessageOptions> = {},
    ): Promise<TurnHandle> {
        // Validate the NEW messages alone — combined with history they would
        // pass the loop's min(1) even when empty.
        const newMessages = MessageList.min(1).parse(messages);
        const parsedOptions = SendMessageOptions.parse(options);
        return this.mutex.run(sessionId, async () => {
            const session = await this.mustGetSession(sessionId);
            const latest = await this.turnStore.latestForSession(sessionId);
            if (latest) {
                // A session only ever chains on TERMINAL turns. Anything else
                // (running, waiting on a permission/tool result, or idle after
                // a crash) must be resolved first: wait for it, respond to
                // it, resume it, or stopTurn it — a stop is itself terminal.
                // Terminal turns are immutable, so the snapshot we copy
                // forward below can never go stale or be re-activated.
                const status = deriveTurnStatus(latest);
                if (status !== "completed" && status !== "error") {
                    throw new Error(
                        `Session's latest turn is not finished: ${latest.id} (status: ${status})`,
                    );
                }
            }
            // Bump recency BEFORE creating the turn: if this write fails, no
            // orphan turn is left running with its handle lost to the caller.
            session.updatedAt = nowIso();
            await this.sessionStore.update(session);
            return this.agentLoop.createTurn({
                agentId: session.agentId,
                provider: parsedOptions.provider ?? null,
                model: parsedOptions.model ?? null,
                ...(parsedOptions.permissionMode !== undefined
                    ? { permissionMode: parsedOptions.permissionMode }
                    : {}),
                sessionId,
                sessionSeq: (latest?.sessionSeq ?? 0) + 1,
                messages: [...(latest ? historyFrom(latest) : []), ...newMessages],
            });
        });
    }

    // The transcript as the next turn will see it: a stopped turn's dangling
    // tool calls appear closed out, matching what sendMessage actually sends.
    async getHistory(sessionId: string): Promise<z.infer<typeof MessageList>> {
        await this.mustGetSession(sessionId);
        const latest = await this.turnStore.latestForSession(sessionId);
        return latest ? historyFrom(latest) : [];
    }

    async listTurns(sessionId: string): Promise<z.infer<typeof AgentLoopTurn>[]> {
        await this.mustGetSession(sessionId);
        return this.turnStore.listBySession(sessionId);
    }

    private async mustGetSession(sessionId: string): Promise<z.infer<typeof Session>> {
        const session = await this.sessionStore.get(sessionId);
        if (!session) throw new Error(`Session not found: ${sessionId}`);
        return session;
    }
}

// Copy-forward history: the next turn's input is the previous turn's full
// transcript. A stopped turn can carry unresolved tool calls; they are closed
// out with synthetic ToolMessages so the new turn never re-executes — or
// hangs on — stale calls. This is the sessions-layer analogue of the
// reducer's interrupted-call handling.
function historyFrom(
    turn: z.infer<typeof AgentLoopTurn>,
): z.infer<typeof Message>[] {
    const messages = [...turn.messages];
    for (const call of unresolvedToolCalls(turn)) {
        const interrupted = deriveToolCallState(turn, call.toolCallId) === "interrupted";
        messages.push({
            role: "tool",
            content: interrupted
                ? "Tool execution was interrupted before completing. It may or may not have taken effect; do not assume it ran."
                : "Tool was not executed: the turn was stopped before this call ran.",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
        });
    }
    return messages;
}
