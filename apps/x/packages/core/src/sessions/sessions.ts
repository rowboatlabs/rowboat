import crypto from "node:crypto";
import { z } from "zod";
import { MessageList } from "@x/shared/dist/message.js";
import type { AgentLoop, TurnHandle } from "../agent-loop/agent-loop.js";
import { KeyedMutex } from "../agent-loop/mutex.js";
import type { TurnStore } from "../agent-loop/turn-store.js";
import {
    AgentLoopTurn,
    ComposeContext,
    closedTranscript,
    deriveTurnStatus,
} from "../agent-loop/types.js";
import {
    NoopUserMessageContextComposer,
    type UserMessageContextComposer,
} from "./user-message-context-composer.js";
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
    // Permanently remove a session and all of its turns.
    deleteSession(sessionId: string): Promise<void>;
}

function nowIso(): string {
    return new Date().toISOString();
}

// Distill the compose chips from send options into the turn's composeContext —
// null when none are set, so a plain message stores nothing.
function composeContextFromOptions(
    options: z.infer<typeof SendMessageOptions>,
): z.infer<typeof ComposeContext> | null {
    const compose: z.infer<typeof ComposeContext> = {};
    if (options.voiceInput !== undefined) compose.voiceInput = options.voiceInput;
    if (options.voiceOutput !== undefined) compose.voiceOutput = options.voiceOutput;
    if (options.searchEnabled !== undefined) compose.searchEnabled = options.searchEnabled;
    if (options.codeMode !== undefined) compose.codeMode = options.codeMode;
    if (options.codeCwd !== undefined) compose.codeCwd = options.codeCwd;
    if (options.codePolicy !== undefined) compose.codePolicy = options.codePolicy;
    return Object.keys(compose).length > 0 ? compose : null;
}

export class SessionsImpl implements Sessions {
    private sessionStore: SessionStore;
    private turnStore: TurnStore;
    private agentLoop: AgentLoop;
    private userMessageContext: UserMessageContextComposer;
    private mutex = new KeyedMutex();

    constructor(deps: {
        sessionStore: SessionStore;
        turnStore: TurnStore;
        agentLoop: AgentLoop;
        userMessageContext?: UserMessageContextComposer;
    }) {
        this.sessionStore = deps.sessionStore;
        this.turnStore = deps.turnStore;
        this.agentLoop = deps.agentLoop;
        this.userMessageContext = deps.userMessageContext ?? new NoopUserMessageContextComposer();
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

    async deleteSession(sessionId: string): Promise<void> {
        // Serialize against in-flight sends for this session, then drop its
        // turns before the session row so a crash mid-delete never strands a
        // session pointing at half-removed turns.
        await this.mutex.run(sessionId, async () => {
            await this.turnStore.deleteBySession(sessionId);
            await this.sessionStore.delete(sessionId);
        });
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
            // Attach per-message context (fresh datetime + middle pane) to the
            // new user messages only — history already carries its own. Delegated
            // to the injected composer (no-op by default; copilot-aware in the
            // real runtime), keeping this layer agent-agnostic.
            const withContext = this.userMessageContext.attach(newMessages, {
                agentId: session.agentId,
                middlePaneContext: parsedOptions.middlePaneContext ?? null,
            });
            const composeContext = composeContextFromOptions(parsedOptions);
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
                // Sessions are the chat surface — default attribution to chat.
                useCase: parsedOptions.useCase ?? "copilot_chat",
                subUseCase: parsedOptions.subUseCase ?? null,
                composeContext,
                sessionId,
                sessionSeq: (latest?.sessionSeq ?? 0) + 1,
                messages: [...(latest ? closedTranscript(latest) : []), ...withContext],
            });
        });
    }

    // The transcript as the next turn will see it: a stopped turn's dangling
    // tool calls appear closed out, matching what sendMessage actually sends.
    async getHistory(sessionId: string): Promise<z.infer<typeof MessageList>> {
        await this.mustGetSession(sessionId);
        const latest = await this.turnStore.latestForSession(sessionId);
        return latest ? closedTranscript(latest) : [];
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
