import type { z } from "zod";
import type { UserMessage } from "@x/shared/dist/message.js";
import {
    SessionCreated,
    type SessionEvent,
    type SessionIndexEntry,
    type SessionLatestTurnStatus,
    type SessionState,
    reduceSession,
    sessionIndexEntry,
} from "@x/shared/dist/sessions.js";
import {
    type JsonValue,
    type ModelDescriptor,
    type ToolResultData,
    deriveTurnStatus,
    reduceTurn,
} from "@x/shared/dist/turns.js";
import type { IMonotonicallyIncreasingIdGenerator } from "../application/lib/id-gen.js";
import type {
    ITurnRuntime,
    Turn,
    TurnExecution,
    TurnExternalInput,
    TurnOutcome,
} from "../turns/api.js";
import type { IClock } from "../turns/clock.js";
import {
    type ISessions,
    type SendMessageConfig,
    TurnNotSettledError,
} from "./api.js";
import type { ISessionBus } from "./bus.js";
import type { ISessionRepo } from "./repo.js";
import { SessionIndex } from "./session-index.js";

export interface SessionsDependencies {
    sessionRepo: ISessionRepo;
    turnRuntime: ITurnRuntime;
    idGenerator: IMonotonicallyIncreasingIdGenerator;
    clock: IClock;
    sessionBus: ISessionBus;
}

// The session layer per session-design.md: owns conversations as ordered
// chains of turn references, enforces one active turn per session, assembles
// context as a reference to the previous turn, and maintains the in-memory
// index write-through. It never reads or writes turn-file contents beyond
// what ITurnRuntime exposes.
export class SessionsImpl implements ISessions {
    private readonly sessionRepo: ISessionRepo;
    private readonly turnRuntime: ITurnRuntime;
    private readonly idGenerator: IMonotonicallyIncreasingIdGenerator;
    private readonly clock: IClock;
    private readonly sessionBus: ISessionBus;

    private readonly index = new SessionIndex();
    // Ephemeral: executions this process started, for stopTurn's abort path.
    private readonly active = new Map<
        string,
        { sessionId: string | null; controller: AbortController; execution: TurnExecution }
    >();

    constructor({
        sessionRepo,
        turnRuntime,
        idGenerator,
        clock,
        sessionBus,
    }: SessionsDependencies) {
        this.sessionRepo = sessionRepo;
        this.turnRuntime = turnRuntime;
        this.idGenerator = idGenerator;
        this.clock = clock;
        this.sessionBus = sessionBus;
    }

    // §8.2: scan session files, read each session's latest turn for status.
    // Corrupt files yield errored entries; the scan never aborts.
    async initialize(): Promise<void> {
        for (const sessionId of await this.sessionRepo.listSessionIds()) {
            this.index.upsert(await this.scanSession(sessionId));
        }
    }

    private async scanSession(sessionId: string): Promise<SessionIndexEntry> {
        try {
            const state = reduceSession(await this.sessionRepo.read(sessionId));
            const status = await this.latestTurnStatus(state);
            return sessionIndexEntry(state, status);
        } catch (error) {
            return {
                sessionId,
                createdAt: "",
                updatedAt: "",
                turnCount: 0,
                latestTurnStatus: "none",
                error: errorMessage(error),
            };
        }
    }

    private async latestTurnStatus(
        state: SessionState,
    ): Promise<SessionLatestTurnStatus> {
        if (!state.latestTurnId) {
            return "none";
        }
        const turn = await this.turnRuntime.getTurn(state.latestTurnId);
        return deriveTurnStatus(reduceTurn(turn.events));
    }

    async createSession(input?: { title?: string }): Promise<string> {
        const sessionId = await this.idGenerator.next();
        const event = SessionCreated.parse({
            type: "session_created",
            schemaVersion: 1,
            sessionId,
            ts: this.clock.now(),
            ...(input?.title === undefined ? {} : { title: input.title }),
        });
        await this.sessionRepo.create(event);
        this.publishEntry(sessionIndexEntry(reduceSession([event]), "none"));
        return sessionId;
    }

    listSessions(): SessionIndexEntry[] {
        return this.index.list();
    }

    async getSession(sessionId: string): Promise<SessionState> {
        return reduceSession(await this.sessionRepo.read(sessionId));
    }

    async getTurn(turnId: string): Promise<Turn> {
        return this.turnRuntime.getTurn(turnId);
    }

    // §9.1. Write order per §7: turn file first, then turn_appended, then the
    // first advance — so an orphan turn (crash between the writes) is benign
    // and an executing turn is always referenced.
    async sendMessage(
        sessionId: string,
        input: z.infer<typeof UserMessage>,
        config: SendMessageConfig,
    ): Promise<{ turnId: string }> {
        return this.sessionRepo.withLock(sessionId, async () => {
            const events = await this.sessionRepo.read(sessionId);
            const state = reduceSession(events);

            if (state.latestTurnId) {
                const status = await this.latestTurnStatus(state);
                if (
                    status !== "completed" &&
                    status !== "failed" &&
                    status !== "cancelled"
                ) {
                    throw new TurnNotSettledError(
                        sessionId,
                        state.latestTurnId,
                        status,
                    );
                }
            }

            const turnId = await this.turnRuntime.createTurn({
                agent: config.agent,
                sessionId,
                context: state.latestTurnId
                    ? { previousTurnId: state.latestTurnId }
                    : [],
                input,
                config: {
                    humanAvailable: true,
                    ...(config.autoPermission === undefined
                        ? {}
                        : { autoPermission: config.autoPermission }),
                    ...(config.maxModelCalls === undefined
                        ? {}
                        : { maxModelCalls: config.maxModelCalls }),
                },
            });

            const batch: Array<z.infer<typeof SessionEvent>> = [
                {
                    type: "turn_appended",
                    sessionId,
                    ts: this.clock.now(),
                    turnId,
                    sessionSeq: state.turns.length + 1,
                    agentId: config.agent.agentId,
                    model: await this.resolvedModelOf(turnId),
                },
            ];
            if (!state.title) {
                batch.push({
                    type: "title_changed",
                    sessionId,
                    ts: this.clock.now(),
                    title: defaultTitle(input),
                });
            }
            await this.sessionRepo.append(sessionId, batch);

            this.publishEntry(
                sessionIndexEntry(reduceSession([...events, ...batch]), "idle"),
            );
            this.startTrackedAdvance(sessionId, turnId);
            return { turnId };
        });
    }

    async respondToPermission(
        turnId: string,
        toolCallId: string,
        decision: "allow" | "deny",
        metadata?: JsonValue,
    ): Promise<void> {
        await this.advanceWithInput(turnId, {
            type: "permission_decision",
            toolCallId,
            decision,
            ...(metadata === undefined ? {} : { metadata }),
        });
    }

    async respondToAskHuman(
        turnId: string,
        toolCallId: string,
        answer: string,
    ): Promise<void> {
        await this.advanceWithInput(turnId, {
            type: "async_tool_result",
            toolCallId,
            result: { output: answer, isError: false },
        });
    }

    async deliverAsyncToolResult(
        turnId: string,
        toolCallId: string,
        result: z.infer<typeof ToolResultData>,
    ): Promise<void> {
        await this.advanceWithInput(turnId, {
            type: "async_tool_result",
            toolCallId,
            result,
        });
    }

    async stopTurn(turnId: string, reason?: string): Promise<void> {
        const running = this.active.get(turnId);
        if (running) {
            running.controller.abort();
            await running.execution.outcome.catch(() => undefined);
            return;
        }
        await this.advanceWithInput(turnId, {
            type: "cancel",
            ...(reason === undefined ? {} : { reason }),
        });
    }

    // Recovery entry for idle (crash-interrupted) turns. Deliberately not run
    // at startup: recovery re-issues interrupted model calls, so resumption
    // must be an explicit action. Runs in the background.
    async resumeTurn(sessionId: string): Promise<void> {
        const state = reduceSession(await this.sessionRepo.read(sessionId));
        if (!state.latestTurnId) {
            throw new Error(`session ${sessionId} has no turns to resume`);
        }
        this.startTrackedAdvance(sessionId, state.latestTurnId);
    }

    async setTitle(sessionId: string, title: string): Promise<void> {
        await this.sessionRepo.withLock(sessionId, async () => {
            const events = await this.sessionRepo.read(sessionId);
            const batch: Array<z.infer<typeof SessionEvent>> = [
                { type: "title_changed", sessionId, ts: this.clock.now(), title },
            ];
            await this.sessionRepo.append(sessionId, batch);
            const state = reduceSession([...events, ...batch]);
            const existing = this.index.get(sessionId);
            this.publishEntry(
                sessionIndexEntry(state, existing?.latestTurnStatus ?? "none"),
            );
        });
    }

    // §9.4: removes the session file and index entry only. Referenced turn
    // files stay behind as inert orphans.
    async deleteSession(sessionId: string): Promise<void> {
        await this.sessionRepo.withLock(sessionId, async () => {
            await this.sessionRepo.delete(sessionId);
            this.index.remove(sessionId);
            this.sessionBus.publish({ kind: "index-changed", sessionId, entry: null });
        });
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private async resolvedModelOf(
        turnId: string,
    ): Promise<z.infer<typeof ModelDescriptor>> {
        const turn = await this.turnRuntime.getTurn(turnId);
        const created = turn.events[0];
        if (created.type !== "turn_created") {
            throw new Error(`turn ${turnId} has no turn_created event`);
        }
        return created.agent.resolved.model;
    }

    private async sessionIdOf(turnId: string): Promise<string | null> {
        const turn = await this.turnRuntime.getTurn(turnId);
        const created = turn.events[0];
        if (created.type !== "turn_created") {
            throw new Error(`turn ${turnId} has no turn_created event`);
        }
        return created.sessionId;
    }

    private async advanceWithInput(
        turnId: string,
        input: TurnExternalInput,
    ): Promise<void> {
        const sessionId = await this.sessionIdOf(turnId);
        const execution = this.startTrackedAdvance(sessionId, turnId, input);
        await execution.outcome;
    }

    // Every advance this layer initiates: forward its stream to the bus
    // tagged with sessionId, keep the abort controller for stopTurn, and
    // update the index entry when the outcome settles.
    private startTrackedAdvance(
        sessionId: string | null,
        turnId: string,
        input?: TurnExternalInput,
    ): TurnExecution {
        const controller = new AbortController();
        const execution = this.turnRuntime.advanceTurn(turnId, input, {
            signal: controller.signal,
        });
        this.active.set(turnId, { sessionId, controller, execution });

        void (async () => {
            try {
                for await (const event of execution.events) {
                    if (sessionId !== null) {
                        this.sessionBus.publish({
                            kind: "turn-event",
                            sessionId,
                            turnId,
                            event,
                        });
                    }
                }
            } catch {
                // Infrastructure failures surface through the outcome.
            }
        })();

        void execution.outcome
            .then((outcome) => this.onSettled(sessionId, turnId, outcome))
            .catch(() => undefined)
            .finally(() => this.active.delete(turnId));

        return execution;
    }

    private onSettled(
        sessionId: string | null,
        turnId: string,
        outcome: TurnOutcome,
    ): void {
        if (sessionId === null) {
            return;
        }
        const entry = this.index.get(sessionId);
        // The session may have been deleted, or a newer turn appended.
        if (!entry || entry.latestTurnId !== turnId) {
            return;
        }
        this.publishEntry({
            ...entry,
            latestTurnStatus: outcome.status,
            updatedAt: this.clock.now(),
        });
    }

    private publishEntry(entry: SessionIndexEntry): void {
        this.index.upsert(entry);
        this.sessionBus.publish({
            kind: "index-changed",
            sessionId: entry.sessionId,
            entry,
        });
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function defaultTitle(input: z.infer<typeof UserMessage>): string {
    const text =
        typeof input.content === "string"
            ? input.content
            : input.content
                  .map((part) => (part.type === "text" ? part.text : ""))
                  .join(" ");
    const collapsed = text.trim().replace(/\s+/g, " ");
    if (collapsed.length === 0) {
        return "New session";
    }
    return collapsed.length > 80 ? `${collapsed.slice(0, 79)}…` : collapsed;
}
