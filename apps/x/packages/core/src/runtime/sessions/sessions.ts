import type { z } from "zod";
import type { UserMessage } from "@x/shared/dist/message.js";
import {
    type QueuedSessionMessage,
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
    type TurnState,
    deriveTurnStatus,
    inlineAgentId,
    isInlineAgentRequest,
    reduceTurn,
} from "@x/shared/dist/turns.js";
import type { IMonotonicallyIncreasingIdGenerator } from "../../application/lib/id-gen.js";
import { chatActivity } from "../../application/lib/chat-activity.js";
import {
    type ITurnRuntime,
    type Turn,
    type TurnExecution,
    type TurnExternalInput,
    TurnInputError,
    type TurnOutcome,
} from "../turns/api.js";
// traits.js, not registry.js: the registry's builders transitively reach
// di/container, which imports this module — a cycle. The traits leaf exists
// exactly so upstream layers can gate on traits.
import { carriesSkillsForward } from "../assembly/traits.js";
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
    // Optional: authoritative per-session composition pins (e.g. a Code
    // section session's coding agent + working directory), merged into every
    // turn's composition SERVER-side so prompt assembly never depends on
    // which client surface sent the message. Injected by DI; the session
    // layer knows nothing about what the pins mean.
    sessionCompositionPins?: (sessionId: string) => Promise<Record<string, JsonValue> | null>;
}

interface ActiveAdvance {
    sessionId: string | null;
    controller: AbortController;
    execution: TurnExecution;
}

// One pending-queue entry (QueuedSessionMessage plus the SendMessageConfig it
// arrived with — used only if the entry is promoted to a new turn; a steered
// entry joins the live turn, whose configuration wins).
interface PendingSessionEntry {
    queueId: string;
    message: z.infer<typeof UserMessage>;
    config: SendMessageConfig;
    ts: string;
}

function publicQueueEntry(entry: PendingSessionEntry): QueuedSessionMessage {
    return { queueId: entry.queueId, message: entry.message, ts: entry.ts };
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
    private readonly sessionCompositionPins?: (
        sessionId: string,
    ) => Promise<Record<string, JsonValue> | null>;

    private readonly index = new SessionIndex();
    // Ephemeral: executions this process started, for stopTurn's abort path.
    // A turn can legally have more than one live advance at once — a running
    // invocation plus external-input invocations queued on the turn lock —
    // so entries accumulate per turn and each advance removes only its own.
    private readonly active = new Map<string, Set<ActiveAdvance>>();
    // Ephemeral pending queue per session (session-design.md §12.1,
    // deliberately NOT durable): messages accepted while the latest turn was
    // running, waiting to steer it (input_added at the next boundary) or to
    // be promoted into a new turn at settle. A crash drops the queue along
    // with the in-flight turn it was steering — coherent loss.
    private readonly pending = new Map<string, PendingSessionEntry[]>();

    constructor({
        sessionRepo,
        turnRuntime,
        idGenerator,
        clock,
        sessionBus,
        sessionCompositionPins,
    }: SessionsDependencies) {
        this.sessionRepo = sessionRepo;
        this.turnRuntime = turnRuntime;
        this.idGenerator = idGenerator;
        this.clock = clock;
        this.sessionBus = sessionBus;
        this.sessionCompositionPins = sessionCompositionPins;
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
            const latestTurnState = await this.latestTurnState(state);
            if (latestTurnState) {
                const status = deriveTurnStatus(latestTurnState);
                if (
                    status !== "completed" &&
                    status !== "failed" &&
                    status !== "cancelled"
                ) {
                    throw new TurnNotSettledError(
                        sessionId,
                        state.latestTurnId as string,
                        status,
                    );
                }
            }
            return this.startTurnLocked(
                sessionId,
                events,
                state,
                latestTurnState,
                input,
                config,
            );
        });
    }

    // Deliver-ASAP (see api.ts): start a turn when settled, queue otherwise.
    // The enqueue and the settled-check share one lock hold, and promotion
    // (promoteQueued) always re-checks under the same lock, so a turn that
    // settles concurrently with the enqueue cannot strand the message — the
    // promotion queued behind this lock will see both the terminal turn and
    // the pending entry (opencode's pendingWake problem, solved by ordering).
    async sendOrQueueMessage(
        sessionId: string,
        input: z.infer<typeof UserMessage>,
        config: SendMessageConfig,
    ): Promise<{ queued: false; turnId: string } | { queued: true; queueId: string }> {
        return this.sessionRepo.withLock(sessionId, async () => {
            const events = await this.sessionRepo.read(sessionId);
            const state = reduceSession(events);
            let latestTurnState = await this.latestTurnState(state);
            let status = latestTurnState
                ? deriveTurnStatus(latestTurnState)
                : "none";
            // An "idle" turn with no live advance in this process is a turn
            // NOTHING is running: the process driving it died (or its advance
            // rejected as infrastructure) before a terminal event was written.
            // It will never settle, so deliver-ASAP must not park messages
            // behind it forever — cancel it (the §22 fast-path: no live
            // dependencies, never re-issues a model call) and deliver this
            // message as a fresh turn. A suspended turn is different: it is
            // parked on a permission or async tool and legitimately waits
            // with no advance, so it still queues.
            if (
                status === "idle" &&
                state.latestTurnId &&
                !this.active.has(state.latestTurnId)
            ) {
                await this.abortOrCancel(
                    state.latestTurnId,
                    "interrupted: the app quit or crashed while this turn was running",
                );
                latestTurnState = await this.latestTurnState(state);
                status = latestTurnState
                    ? deriveTurnStatus(latestTurnState)
                    : "none";
            }
            const settled =
                status === "none" ||
                status === "completed" ||
                status === "failed" ||
                status === "cancelled";
            // A settled session with an empty queue starts immediately. With
            // entries still pending (promotion hasn't run yet), the new
            // message queues behind them to keep arrival order.
            if (settled && (this.pending.get(sessionId) ?? []).length === 0) {
                const { turnId } = await this.startTurnLocked(
                    sessionId,
                    events,
                    state,
                    latestTurnState,
                    input,
                    config,
                );
                return { queued: false as const, turnId };
            }
            const entry: PendingSessionEntry = {
                queueId: await this.idGenerator.next(),
                message: input,
                config,
                ts: this.clock.now(),
            };
            const queue = this.pending.get(sessionId) ?? [];
            queue.push(entry);
            this.pending.set(sessionId, queue);
            this.publishQueue(sessionId);
            return { queued: true as const, queueId: entry.queueId };
        });
    }

    listQueued(sessionId: string): QueuedSessionMessage[] {
        return (this.pending.get(sessionId) ?? []).map(publicQueueEntry);
    }

    editQueued(
        sessionId: string,
        queueId: string,
        message: z.infer<typeof UserMessage>,
    ): void {
        const entry = (this.pending.get(sessionId) ?? []).find(
            (e) => e.queueId === queueId,
        );
        if (!entry) {
            throw new Error(`no queued message ${queueId} in session ${sessionId}`);
        }
        entry.message = message;
        this.publishQueue(sessionId);
    }

    removeQueued(
        sessionId: string,
        queueId: string,
    ): QueuedSessionMessage | undefined {
        const queue = this.pending.get(sessionId) ?? [];
        const at = queue.findIndex((e) => e.queueId === queueId);
        if (at < 0) {
            return undefined;
        }
        const [removed] = queue.splice(at, 1);
        this.publishQueue(sessionId);
        return publicQueueEntry(removed);
    }

    private async latestTurnState(
        state: SessionState,
    ): Promise<TurnState | undefined> {
        if (!state.latestTurnId) {
            return undefined;
        }
        const turn = await this.turnRuntime.getTurn(state.latestTurnId);
        return reduceTurn(turn.events);
    }

    // The create-and-start core shared by sendMessage, sendOrQueueMessage,
    // and queue promotion. Caller holds the session lock.
    private async startTurnLocked(
        sessionId: string,
        events: Array<z.infer<typeof SessionEvent>>,
        state: SessionState,
        latestTurnState: TurnState | undefined,
        input: z.infer<typeof UserMessage>,
        config: SendMessageConfig,
    ): Promise<{ turnId: string }> {
        let agentRequest = latestTurnState
            ? withActiveSkills(config.agent, deriveActiveSkills(latestTurnState))
            : config.agent;

        // Server-side session pins: whatever surface sent this message
        // (composer, voice, quick-ask, a background runner — and queued
        // messages promoted after settle), the session's pinned composition
        // is the same — the client's copy is at most a cosmetic hint, and
        // the pins win on conflict.
        if (this.sessionCompositionPins && !isInlineAgentRequest(agentRequest)) {
            const pins = await this.sessionCompositionPins(sessionId).catch(() => null);
            if (pins && Object.keys(pins).length > 0) {
                const provided = agentRequest.overrides?.composition;
                const base: { [key: string]: JsonValue } =
                    provided !== undefined &&
                    provided !== null &&
                    typeof provided === "object" &&
                    !Array.isArray(provided)
                        ? (provided as { [key: string]: JsonValue })
                        : {};
                agentRequest = {
                    ...agentRequest,
                    overrides: {
                        ...agentRequest.overrides,
                        composition: { ...base, ...pins },
                    },
                };
            }
        }

        const turnId = await this.turnRuntime.createTurn({
            agent: agentRequest,
            sessionId,
            context: state.latestTurnId
                ? { previousTurnId: state.latestTurnId }
                : [],
            input,
            analytics: {
                useCase: config.useCase ?? "copilot_chat",
                ...(config.subUseCase
                    ? { subUseCase: config.subUseCase }
                    : {}),
            },
            config: {
                humanAvailable: config.humanAvailable ?? true,
                ...(config.autoPermission === undefined
                    ? {}
                    : { autoPermission: config.autoPermission }),
                ...(config.maxModelCalls === undefined
                    ? {}
                    : { maxModelCalls: config.maxModelCalls }),
                ...(config.reasoningEffort === undefined
                    ? {}
                    : { reasoningEffort: config.reasoningEffort }),
            },
        });

        const batch: Array<z.infer<typeof SessionEvent>> = [
            {
                type: "turn_appended",
                sessionId,
                ts: this.clock.now(),
                turnId,
                sessionSeq: state.turns.length + 1,
                agentId: isInlineAgentRequest(config.agent)
                    ? inlineAgentId(config.agent.inline.name)
                    : config.agent.agentId,
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
        if (!state.title) {
            this.generateTitleInBackground(
                sessionId,
                defaultTitle(input),
                messageText(input),
            );
        }
        this.startTrackedAdvance(sessionId, turnId);
        return { turnId };
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

    async stopTurn(
        turnId: string,
        reason?: string,
    ): Promise<{ dequeued: QueuedSessionMessage[] }> {
        // Drain the session's pending queue BEFORE aborting: a stop must not
        // be followed by promotion auto-starting the next queued message.
        // The drained text goes back to the caller (composer restore). A
        // message the loop already steered in is durable and stays — it was
        // delivered, then the user stopped.
        const dequeued: QueuedSessionMessage[] = [];
        try {
            const sessionId = await this.sessionIdOf(turnId);
            if (sessionId !== null) {
                const queue = this.pending.get(sessionId) ?? [];
                dequeued.push(...queue.splice(0).map(publicQueueEntry));
                if (dequeued.length > 0) {
                    this.publishQueue(sessionId);
                }
            }
        } catch {
            // Unreadable turn: nothing to drain; the abort below still runs.
        }
        await this.abortOrCancel(turnId, reason);
        return { dequeued };
    }

    private async abortOrCancel(turnId: string, reason?: string): Promise<void> {
        const running = this.active.get(turnId);
        if (running && running.size > 0) {
            // Abort every live advance for this turn: the running invocation
            // cancels, and queued ones observe their aborted signal once the
            // turn lock frees. Await them all so stop returns settled.
            const advances = [...running];
            for (const advance of advances) {
                advance.controller.abort();
            }
            await Promise.all(
                advances.map((a) => a.execution.outcome.catch(() => undefined)),
            );
            return;
        }
        try {
            await this.advanceWithInput(turnId, {
                type: "cancel",
                ...(reason === undefined ? {} : { reason }),
            });
        } catch (error) {
            // A cancel input that loses the race with a concurrent settle is
            // a successful stop: the turn is already terminal.
            if (error instanceof TurnInputError) {
                const turn = await this.turnRuntime.getTurn(turnId);
                if (reduceTurn(turn.events).terminal) {
                    return;
                }
            }
            throw error;
        }
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

    // Fire-and-forget: replace the truncated-first-message placeholder with a
    // short model-generated title. The placeholder stays if the call fails or
    // the title changed in the meantime (e.g. a manual rename won the race).
    private generateTitleInBackground(
        sessionId: string,
        placeholder: string,
        firstMessage: string,
    ): void {
        void (async () => {
            try {
                // Dynamic import: generate_title reaches models/defaults →
                // di/container, which imports this module (see traits.js note
                // above) — a static import would close the cycle.
                const { generateChatTitle } = await import(
                    "../../knowledge/generate_title.js"
                );
                const title = await generateChatTitle(firstMessage);
                if (!title || title === placeholder) return;
                await this.sessionRepo.withLock(sessionId, async () => {
                    const events = await this.sessionRepo.read(sessionId);
                    const state = reduceSession(events);
                    if (state.title !== placeholder) return;
                    const batch: Array<z.infer<typeof SessionEvent>> = [
                        { type: "title_changed", sessionId, ts: this.clock.now(), title },
                    ];
                    await this.sessionRepo.append(sessionId, batch);
                    const existing = this.index.get(sessionId);
                    this.publishEntry(
                        sessionIndexEntry(
                            reduceSession([...events, ...batch]),
                            existing?.latestTurnStatus ?? "none",
                        ),
                    );
                });
            } catch {
                // Placeholder title stays.
            }
        })();
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

    // §9.4: removes the session file, the index entry, and every turn file
    // the session references (following sub-agent child-turn links). Live
    // advances are aborted first so nothing appends to a deleted file.
    // Session-file-first ordering: a crash mid-cleanup leaves unreferenced
    // turn files behind — the same inert orphans the pre-cleanup design
    // produced, invisible and harmless.
    async deleteSession(sessionId: string): Promise<void> {
        // Pending messages die with the session (they are ephemeral by
        // design); dropping them first keeps promotion from racing deletion.
        this.pending.delete(sessionId);
        // Abort every live advance this process is driving for the session
        // and wait for them to settle (mirrors stopTurn's abort path).
        const advances = [...this.active.values()]
            .flatMap((set) => [...set])
            .filter((advance) => advance.sessionId === sessionId);
        for (const advance of advances) {
            advance.controller.abort();
        }
        await Promise.all(
            advances.map((a) => a.execution.outcome.catch(() => undefined)),
        );

        await this.sessionRepo.withLock(sessionId, async () => {
            // Collect the reference chain before the session file disappears —
            // turns are only discoverable through it. A corrupt session file
            // still gets deleted; its turns stay orphaned as before.
            let turnIds: string[] = [];
            try {
                const state = reduceSession(await this.sessionRepo.read(sessionId));
                turnIds = state.turns.map((ref) => ref.turnId);
            } catch {
                // Unreadable session — nothing to traverse.
            }
            await this.sessionRepo.delete(sessionId);
            this.index.remove(sessionId);
            this.sessionBus.publish({ kind: "index-changed", sessionId, entry: null });
            await this.deleteTurnFiles(turnIds);
        });
    }

    // Best-effort removal of a session's turn files, following spawn-agent
    // child links breadth-first so sub-agent transcripts go too. Individual
    // failures are swallowed: a leftover file is an inert orphan, not a fault.
    private async deleteTurnFiles(rootTurnIds: string[]): Promise<void> {
        const seen = new Set<string>();
        const queue = [...rootTurnIds];
        while (queue.length > 0) {
            const turnId = queue.shift()!;
            if (seen.has(turnId)) {
                continue;
            }
            seen.add(turnId);
            try {
                const turn = await this.turnRuntime.getTurn(turnId);
                queue.push(...childTurnIdsOf(reduceTurn(turn.events)));
            } catch {
                // Missing or corrupt turn — still attempt the delete below.
            }
            try {
                await this.turnRuntime.deleteTurn(turnId);
            } catch {
                // Leftovers are inert orphans.
            }
        }
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

    // Every advance this layer initiates: keep the abort controller for
    // stopTurn and update the index entry when the outcome settles. Live
    // event delivery is not this layer's job — the runtime publishes every
    // event to the turn event bus; the execution stream is drained so an
    // unconsumed HotStream never buffers events until settle.
    private startTrackedAdvance(
        sessionId: string | null,
        turnId: string,
        input?: TurnExternalInput,
    ): TurnExecution {
        const controller = new AbortController();
        // A session turn is a user-facing chat: mark it active so background
        // agents can defer (see agents/headless-app.ts runWhenPossible).
        if (sessionId !== null) {
            chatActivity.enter();
        }
        const execution = this.turnRuntime.advanceTurn(turnId, input, {
            signal: controller.signal,
            // Steering: every session advance offers the pending queue to the
            // loop, which drains it at each model-call boundary into durable
            // input_added events. Suspended turns get this for free — the
            // advance a permission answer starts polls the same source.
            ...(sessionId === null
                ? {}
                : { takeInputs: () => this.drainQueuedForSteer(sessionId) }),
        });
        if (sessionId !== null) {
            void execution.outcome.catch(() => undefined).finally(() => chatActivity.exit());
        }
        const advance: ActiveAdvance = { sessionId, controller, execution };
        const live = this.active.get(turnId) ?? new Set<ActiveAdvance>();
        live.add(advance);
        this.active.set(turnId, live);

        void (async () => {
            try {
                for await (const event of execution.events) {
                    void event;
                }
            } catch {
                // Infrastructure failures surface through the outcome.
            }
        })();

        void execution.outcome
            .then((outcome) => this.onSettled(sessionId, turnId, outcome))
            .catch(() => undefined)
            .finally(() => {
                // Remove only this advance's entry; a sibling advance for the
                // same turn may still be live and must stay stoppable.
                const set = this.active.get(turnId);
                if (!set) {
                    return;
                }
                set.delete(advance);
                if (set.size === 0) {
                    this.active.delete(turnId);
                }
            });

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
        // Messages the settled turn never got to steer promote into a new
        // turn. Suspended is not terminal: those messages steer the resuming
        // advance instead.
        if (outcome.status !== "suspended") {
            void this.promoteQueued(sessionId);
        }
    }

    // Promote the pending head into a new turn once the session is settled.
    // Runs under the session lock and re-checks everything there, so it is
    // safe against every interleaving with sendOrQueueMessage (which enqueues
    // under the same lock). The remaining entries stay queued: they steer the
    // just-started turn at its first model-call boundary, which is the
    // earliest the model can see them.
    private async promoteQueued(sessionId: string): Promise<void> {
        try {
            await this.sessionRepo.withLock(sessionId, async () => {
                const queue = this.pending.get(sessionId) ?? [];
                if (queue.length === 0) {
                    return;
                }
                const events = await this.sessionRepo.read(sessionId);
                const state = reduceSession(events);
                const latestTurnState = await this.latestTurnState(state);
                if (latestTurnState) {
                    const status = deriveTurnStatus(latestTurnState);
                    if (
                        status !== "completed" &&
                        status !== "failed" &&
                        status !== "cancelled"
                    ) {
                        return; // a newer turn is live; steering owns the queue
                    }
                }
                const head = queue[0];
                await this.startTurnLocked(
                    sessionId,
                    events,
                    state,
                    latestTurnState,
                    head.message,
                    head.config,
                );
                // Dequeue only after the turn exists: a createTurn failure
                // (agent resolution, repo fault) leaves the entry pending and
                // editable instead of silently dropping the user's text.
                queue.shift();
                this.publishQueue(sessionId);
            });
        } catch (error) {
            // The entry stays queued and visible; the user can edit, remove,
            // or retry by sending again. Promotion has no requester to
            // surface the error to.
            console.error(
                `[sessions] queued-message promotion failed for ${sessionId}:`,
                error,
            );
        }
    }

    // The loop-facing drain (TakeAddedInputs): hand every pending message to
    // the live turn. Synchronous mutation — no interleaving with the
    // lock-holding paths' own synchronous queue access is possible.
    private drainQueuedForSteer(
        sessionId: string,
    ): Array<z.infer<typeof UserMessage>> {
        const queue = this.pending.get(sessionId);
        if (!queue || queue.length === 0) {
            return [];
        }
        const messages = queue.splice(0).map((entry) => entry.message);
        this.publishQueue(sessionId);
        return messages;
    }

    private publishQueue(sessionId: string): void {
        this.sessionBus.publish({
            kind: "queue-changed",
            sessionId,
            queue: this.listQueued(sessionId),
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

// ---- Skill-scoped tool carry-forward --------------------------------------
// Skills loaded in earlier turns stay active for the whole session: the next
// turn's activeSkills = the previous turn's requested activeSkills plus any
// skills its durable tools_extended events recorded, in first-load order.
// Stable ordering keeps agent snapshots byte-identical across turns, which is
// what lets snapshot inheritance keep working.

function parseActiveSkills(composition: JsonValue | undefined): string[] {
    if (
        composition === undefined ||
        composition === null ||
        typeof composition !== "object" ||
        Array.isArray(composition)
    ) {
        return [];
    }
    const value = (composition as Record<string, JsonValue>).activeSkills;
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
}

function deriveActiveSkills(turnState: TurnState): string[] {
    const requested = turnState.definition.agent.requested;
    const skills = isInlineAgentRequest(requested)
        ? []
        : parseActiveSkills(requested.overrides?.composition);
    for (const extension of turnState.toolExtensions) {
        if (!skills.includes(extension.event.source)) {
            skills.push(extension.event.source);
        }
    }
    return skills;
}

function withActiveSkills(
    agent: SendMessageConfig["agent"],
    activeSkills: string[],
): SendMessageConfig["agent"] {
    // Mirrors the resolver's carriesSkillsForward gate (real-agent-resolver):
    // the resolver would ignore activeSkills for a non-trait agent anyway,
    // but injecting them here would still persist an ever-growing list into
    // every turn's requested composition.
    if (
        isInlineAgentRequest(agent) ||
        activeSkills.length === 0 ||
        !carriesSkillsForward(agent.agentId)
    ) {
        return agent;
    }
    const composition = agent.overrides?.composition;
    const base =
        composition !== undefined &&
        composition !== null &&
        typeof composition === "object" &&
        !Array.isArray(composition)
            ? composition
            : {};
    // Carried-forward skills first (stable order), then any caller-supplied
    // extras not already present.
    const provided = parseActiveSkills(composition);
    const merged = [
        ...activeSkills,
        ...provided.filter((id) => !activeSkills.includes(id)),
    ];
    return {
        ...agent,
        overrides: {
            ...agent.overrides,
            composition: { ...base, activeSkills: merged },
        },
    };
}

function messageText(input: z.infer<typeof UserMessage>): string {
    const text =
        typeof input.content === "string"
            ? input.content
            : input.content
                  .map((part) => (part.type === "text" ? part.text : ""))
                  .join(" ");
    return text.trim().replace(/\s+/g, " ");
}

function defaultTitle(input: z.infer<typeof UserMessage>): string {
    const collapsed = messageText(input);
    if (collapsed.length === 0) {
        return "New session";
    }
    return collapsed.length > 80 ? `${collapsed.slice(0, 79)}…` : collapsed;
}

// spawn-agent records one durable 'subagent' tool_progress entry per child
// turn (see spawn-agent.ts) — the same parent→child link the UI uses to
// fetch child transcripts. Extracting it here lets session deletion (and the
// retention sweep) follow the chain and treat sub-agent turn files correctly.
export function childTurnIdsOf(state: TurnState): string[] {
    const ids: string[] = [];
    for (const toolCall of state.toolCalls) {
        for (const progress of toolCall.progress) {
            const entry = progress.progress;
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                continue;
            }
            const { kind, childTurnId } = entry as {
                kind?: unknown;
                childTurnId?: unknown;
            };
            if (kind === "subagent" && typeof childTurnId === "string") {
                ids.push(childTurnId);
            }
        }
    }
    return ids;
}
