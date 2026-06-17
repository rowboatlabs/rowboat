import type { ApprovalPolicy, CodeRunEvent, CodingAgent, PermissionAsk, PermissionDecision, RunPromptResult } from './types.js';
import { AcpClient } from './client.js';
import { PermissionBroker } from './permission-broker.js';
import { readStoredSession, writeStoredSession, clearStoredSession } from './session-store.js';

export interface RunPromptArgs {
    runId: string;
    agent: CodingAgent;
    cwd: string;
    prompt: string;
    policy: ApprovalPolicy;
    /** Called when the policy needs the user to decide (the "ask" path). */
    ask: (ask: PermissionAsk) => Promise<PermissionDecision>;
    /** Stream sink for this prompt's run. */
    onEvent: (event: CodeRunEvent) => void;
    /** Aborts the turn on stop; the manager cancels then force-kills the adapter. */
    signal?: AbortSignal;
    /**
     * Drop the conversation replay that session/load streams on a cold resume.
     * Direct sessions persist their own history (run JSONL) and render from it,
     * so replaying through onEvent would duplicate every prior turn. When set,
     * events only flow to onEvent once the session is open, right before prompt.
     */
    suppressReplay?: boolean;
}

interface ActiveRun {
    client: AcpClient;
    sessionId: string;
    agent: CodingAgent;
    cwd: string;
    // Prompts currently streaming on this connection. Disposal is deferred while
    // this is > 0 so we never tear down a connection mid-turn.
    inflight: number;
    // Pending grace-window teardown, cleared if the run is reused before it fires.
    disposeTimer?: ReturnType<typeof setTimeout>;
}

// How long a connection stays warm after its last turn ends before we tear it down.
// A coding "turn" is one code_agent_run tool call; we keep the adapter briefly so
// back-to-back calls within one copilot turn (edit -> test -> fix) and quick user
// follow-ups reuse the warm connection instead of cold-starting. Set to 0 for strict
// per-turn teardown. Context is never lost either way: the next turn resumes the
// persisted session via session/load.
const DISPOSE_GRACE_MS = 60_000;

// On stop, how long to let the adapter cancel gracefully (ACP session/cancel) before
// we force-kill it. The kill guarantees the turn unwinds even if the adapter ignores
// cancel or is blocked — otherwise a hung prompt would lock the chat indefinitely.
const CANCEL_GRACE_MS = 2_000;

// Drives ACP coding sessions. A connection's lifetime is scoped to the agent turn
// (one code_agent_run): it is torn down a short grace window after the turn ends, so
// idle chats hold no adapter processes. Turns that land within the grace window reuse
// the warm connection; anything colder (grace elapsed, or after an app restart)
// resumes the persisted session via session/load.
export class CodeModeManager {
    private readonly runs = new Map<string, ActiveRun>();

    async runPrompt(args: RunPromptArgs): Promise<RunPromptResult> {
        const { runId, agent, cwd, prompt, policy, ask, onEvent, signal, suppressReplay } = args;

        const broker = new PermissionBroker({
            policy,
            ask,
            onResolved: (a, decision, auto) => onEvent({ type: 'permission', ask: a, decision, auto }),
        });

        const run = await this.ensureRun(runId, agent, cwd, broker, onEvent, suppressReplay ?? false);
        run.inflight++;

        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        try {
            const promptP = run.client.prompt(run.sessionId, prompt);
            // We may stop awaiting this prompt below (force-kill on stop rejects it);
            // attach a no-op catch so the orphaned rejection isn't flagged.
            promptP.catch(() => {});

            // Stop handling: on abort, ask the adapter to cancel; if it hasn't unwound
            // within the grace, force-kill it and resolve as cancelled. This guarantees
            // the turn ends even if the adapter ignores cancel or is wedged — a hung
            // prompt would otherwise lock the chat (no run-stopped, composer disabled).
            const cancelledP = new Promise<{ stopReason: string }>((resolve) => {
                if (!signal) return;
                onAbort = () => {
                    run.client.cancel(run.sessionId).catch(() => {});
                    graceTimer = setTimeout(() => {
                        this.dispose(runId);
                        resolve({ stopReason: 'cancelled' });
                    }, CANCEL_GRACE_MS);
                    graceTimer.unref?.();
                };
                if (signal.aborted) onAbort();
                else signal.addEventListener('abort', onAbort, { once: true });
            });

            const res = await Promise.race([promptP, cancelledP]);
            return { stopReason: res.stopReason, sessionId: run.sessionId };
        } catch (e) {
            // A kill-induced "connection closed" during a stop is an expected cancel.
            if (signal?.aborted) return { stopReason: 'cancelled', sessionId: run.sessionId };
            throw e;
        } finally {
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
            if (graceTimer) clearTimeout(graceTimer);
            run.inflight--;
            this.scheduleDispose(runId);
        }
    }

    dispose(runId: string): void {
        const run = this.runs.get(runId);
        if (!run) return;
        this.cancelDispose(run);
        run.client.dispose();
        this.runs.delete(runId);
    }

    // Tear down the connection a grace window after its last turn ends. Skipped while a
    // prompt is still streaming, and re-armed when each turn ends so the window measures
    // idle-since-last-activity. With grace 0 we dispose immediately (strict per-turn).
    private scheduleDispose(runId: string): void {
        const run = this.runs.get(runId);
        if (!run || run.inflight > 0) return;
        this.cancelDispose(run);
        if (DISPOSE_GRACE_MS <= 0) {
            this.dispose(runId);
            return;
        }
        run.disposeTimer = setTimeout(() => {
            const r = this.runs.get(runId);
            if (r && r.inflight === 0) this.dispose(runId);
        }, DISPOSE_GRACE_MS);
        // A pending teardown timer must not keep the process alive at quit.
        run.disposeTimer.unref?.();
    }

    private cancelDispose(run: ActiveRun): void {
        if (run.disposeTimer) {
            clearTimeout(run.disposeTimer);
            run.disposeTimer = undefined;
        }
    }

    disposeAll(): void {
        for (const runId of [...this.runs.keys()]) this.dispose(runId);
    }

    // Reuse the warm connection if it matches; otherwise (cold start, or the user
    // switched agent/cwd for this chat) build a fresh one and create-or-resume its session.
    private async ensureRun(
        runId: string,
        agent: CodingAgent,
        cwd: string,
        broker: PermissionBroker,
        onEvent: (event: CodeRunEvent) => void,
        suppressReplay: boolean,
    ): Promise<ActiveRun> {
        const existing = this.runs.get(runId);
        if (existing && existing.agent === agent && existing.cwd === cwd) {
            this.cancelDispose(existing); // reused before its grace window elapsed
            existing.client.setHandlers(broker, onEvent);
            return existing;
        }
        if (existing) this.dispose(runId); // agent/cwd changed — start over

        // With suppressReplay, the client starts with a muted event sink so a
        // session/load replay of the prior conversation goes nowhere; the real
        // sink is installed once the session is open (below).
        const client = new AcpClient({
            agent,
            cwd,
            broker,
            onEvent: suppressReplay ? () => {} : onEvent,
        });
        // Dispose the client if startup fails (e.g. the startup-timeout fires) so the
        // spawned adapter process doesn't leak.
        try {
            await client.start();
            const sessionId = await this.openSession(runId, agent, cwd, client);
            if (suppressReplay) client.setHandlers(broker, onEvent);
            const run: ActiveRun = { client, sessionId, agent, cwd, inflight: 0 };
            this.runs.set(runId, run);
            return run;
        } catch (e) {
            client.dispose();
            throw e;
        }
    }

    // Resume the persisted session for this chat when possible; else start a new one
    // and persist its id so a later restart can resume it.
    private async openSession(runId: string, agent: CodingAgent, cwd: string, client: AcpClient): Promise<string> {
        const stored = await readStoredSession(runId);
        if (stored && stored.agent === agent && stored.cwd === cwd && client.loadSupported) {
            try {
                await client.loadSession(stored.sessionId);
                return stored.sessionId;
            } catch {
                // Stored session is stale/unloadable — fall through to a fresh one.
                await clearStoredSession(runId);
            }
        }
        const sessionId = await client.newSession();
        await writeStoredSession({ runId, agent, cwd, sessionId });
        return sessionId;
    }
}
