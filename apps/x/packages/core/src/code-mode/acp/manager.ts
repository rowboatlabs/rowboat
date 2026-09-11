import { OPEN_CODE_ACCESS_ERROR } from './opencode-model-access.js';
import * as os from 'os';
import type { ApprovalPolicy, CodeRunEvent, CodingAgent, PermissionAsk, PermissionDecision, RunPromptResult } from './types.js';
import { AcpClient, type CodeAgentModelOptions } from './client.js';
import { PermissionBroker } from './permission-broker.js';

import { ENGINE_MANIFEST } from './engine-manifest.js';
import { OPENCODE_ROOT } from './opencode-environment.js';
import { readStoredSession, writeStoredSession, clearStoredSession } from './session-store.js';

export interface RunPromptArgs {
    runId: string;
    agent: CodingAgent;
    cwd: string;
    prompt: string;
    policy: ApprovalPolicy;
    /** Coding-agent model alias/id (e.g. "opus"); applied to the ACP session
     *  before the prompt. Omitted / "default" leaves the engine default. */
    model?: string;
    /** Reasoning-effort level (e.g. "high"); applied alongside the model. */
    effort?: string;
    mode?: string;
    /** Called when the policy needs the user to decide (the "ask" path). */
    ask: (ask: PermissionAsk) => Promise<PermissionDecision>;
    /** Stream sink for this prompt's run. */
    onEvent: (event: CodeRunEvent) => void;
    /** Aborts the turn on stop; the manager cancels then force-kills the adapter. */
    signal?: AbortSignal;
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
    private readonly busy = new Set<string>();
    private readonly starting = new Map<string, AcpClient>();
    isRunning(runId: string): boolean { return this.busy.has(runId); }
    // Per-agent model/effort choices, discovered once from the engine and reused
    // (the list only changes when the provider ships new models, and the app can
    // be restarted to pick those up). Avoids cold-starting an adapter per picker.
    private readonly modelOptionsCache = new Map<CodingAgent, CodeAgentModelOptions>();

    // Discover a coding agent's available models + effort levels straight from
    // the engine (what its `/model` picker would show). Spawns a short-lived
    // adapter, opens a throwaway session to read its advertised options, and
    // tears it down. Cached per agent for the lifetime of the process.
    async listModelOptions(agent: CodingAgent, cwd?: string, model?: string, effort?: string, mode?: string, strict = true): Promise<CodeAgentModelOptions> {
        if (agent === 'opencode' && !cwd) throw new Error('Select a project before discovering OpenCode models.');

        // OpenCode discovery is deliberately uncached: project config, credentials
        // and model variants must all be read by a fresh process.
        const cached = agent === 'opencode' ? undefined : this.modelOptionsCache.get(agent);
        if (cached) return cached;
        const broker = new PermissionBroker({ policy: 'yolo', ask: async () => 'reject' });
        const client = new AcpClient({ agent, cwd: cwd ?? os.homedir(), broker, onEvent: () => {} });
        try {
            await client.start();
            const access = agent === 'opencode' ? await client.getOpenCodeModelAccess() : undefined;
            let selectionError: string | undefined;
            if (access && model && model !== 'default' && !access.models.has(model)) {
                if (strict) throw new Error(OPEN_CODE_ACCESS_ERROR);
                selectionError = OPEN_CODE_ACCESS_ERROR;
                model = undefined;
            }
            if (access && !access.models.size) {
                const message = 'No models are available through your current OpenCode connection. Refresh models or reconnect your account.';
                if (strict) throw new Error(message);
                return { models: [], efforts: [], openCodeProviders: access.groups, selectionError: message };
            }
            const discoveryModel = access && (!model || model === 'default') ? access.models.keys().next().value : model;
            const options = await client.describeModelOptions(discoveryModel, effort, mode, strict);
            if (access) {
                options.openCodeProviders = access.groups;
                options.models = options.models.filter(m => access.models.has(m.value)).map(m => ({ ...m,
                    label: m.label + ' (' + ({ free: 'Free', zen: 'Zen', go: 'Go' }[access.models.get(m.value)!]) + ')',
                }));
                if (selectionError) { options.selectionError = selectionError; options.currentModel = undefined; options.currentEffort = undefined; }
            }
            if (agent !== 'opencode') this.modelOptionsCache.set(agent, options);
            return options;
        } finally {
            client.dispose();
        }
    }

    async runPrompt(args: RunPromptArgs): Promise<RunPromptResult> {
        if (this.busy.has(args.runId)) throw new Error('This coding session already has a running operation.');
        args.signal?.throwIfAborted();
        this.busy.add(args.runId);
        try { return await this.runPromptExclusive(args); }
        finally { this.busy.delete(args.runId); }
    }

    private async runPromptExclusive(args: RunPromptArgs): Promise<RunPromptResult> {
        const { runId, agent, cwd, prompt, policy, model, effort, ask, onEvent, signal } = args;

        const broker = new PermissionBroker({
            policy,
            ask,
            signal,
            allowPersistent: agent !== 'opencode',
            onResolved: (a, decision, auto) => onEvent({ type: 'permission', ask: a, decision, auto }),
        });

        const run = await this.ensureRun(runId, agent, cwd, broker, onEvent, signal);
        // Re-apply the session's model + effort each turn (idempotent): a warm
        // connection keeps the last selection, but a cold session/load resets it,
        // and the user may have changed it from the header since the last turn.
        const abortPreparation = () => this.dispose(runId);
        signal?.addEventListener('abort', abortPreparation, { once: true });
        try {
            signal?.throwIfAborted();
            if (args.mode) await run.client.setMode(run.sessionId, args.mode);
            await this.applyModelAndEffort(run, model, effort);
            await run.client.preparePermissions(run.sessionId);
            signal?.throwIfAborted();
        } catch (error) { this.dispose(runId); throw error; }
        finally { signal?.removeEventListener('abort', abortPreparation); }
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
            broker.cancel();
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
            if (graceTimer) clearTimeout(graceTimer);
            run.inflight--;
            this.scheduleDispose(runId);
        }
    }

    // Best-effort: a model the engine doesn't know, or an effort level a model
    // doesn't support, must not abort the turn — we log and proceed with the
    // engine default rather than surfacing a hard error to the user.
    private async applyModelAndEffort(run: ActiveRun, model?: string, effort?: string): Promise<void> {
        if (run.agent === 'opencode') {
            const access = await run.client.getOpenCodeModelAccess();
            const explicit = model && model !== 'default' ? model : undefined;
            if (explicit && !access.models.has(explicit)) throw new Error(OPEN_CODE_ACCESS_ERROR);
            const current = run.client.configuration.currentModel;
            const selected = explicit ?? (current && access.models.has(current) ? current : access.models.keys().next().value);
            if (!selected) throw new Error('No OpenCode models are available. Refresh models or reconnect your account.');
            await run.client.setModel(run.sessionId, selected);
            if (effort) await run.client.setEffort(run.sessionId, effort);
            return;
        }
        if (model && model !== 'default') {
            try {
                await run.client.setModel(run.sessionId, model);
            } catch (e) {
                console.warn(`[code-mode] could not set model "${model}": ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        if (effort && effort !== 'default') {
            try {
                await run.client.setEffort(run.sessionId, effort);
            } catch (e) {
                console.warn(`[code-mode] could not set effort "${effort}": ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }

    dispose(runId: string): void {
        this.starting.get(runId)?.dispose();
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
        if (DISPOSE_GRACE_MS <= 0 || run.agent === 'opencode') {
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
        for (const client of this.starting.values()) client.dispose();
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
        signal?: AbortSignal,
    ): Promise<ActiveRun> {
        const existing = this.runs.get(runId);
        if (existing && existing.agent === agent && existing.cwd === cwd) {
            this.cancelDispose(existing); // reused before its grace window elapsed
            existing.client.setHandlers(broker, onEvent);
            return existing;
        }
        if (existing) this.dispose(runId); // agent/cwd changed — start over

        // The client starts with a muted event sink so a session/load replay of
        // the prior conversation goes nowhere — the chat's durable record is the
        // only source of history. The real sink is installed once the session is
        // open (below), right before the prompt.
        const client = new AcpClient({
            agent,
            cwd,
            broker,
            onEvent: () => {},
        });
        // Dispose the client if startup fails (e.g. the startup-timeout fires) so the
        // spawned adapter process doesn't leak.
        const abort = () => client.dispose();
        this.starting.set(runId, client);
        signal?.addEventListener('abort', abort, { once: true });
        try {
            signal?.throwIfAborted();
            await client.start();
            const sessionId = await this.openSession(runId, agent, cwd, client);
            signal?.throwIfAborted();
            client.setHandlers(broker, onEvent);
            const run: ActiveRun = { client, sessionId, agent, cwd, inflight: 0 };
            this.runs.set(runId, run);
            return run;
        } catch (e) {
            client.dispose();
            throw e;
        } finally {
            this.starting.delete(runId);
            signal?.removeEventListener('abort', abort);
        }
    }

    // Resume the persisted session for this chat when possible; else start a new one
    // and persist its id so a later restart can resume it.
    private async openSession(runId: string, agent: CodingAgent, cwd: string, client: AcpClient): Promise<string> {
        const stored = await readStoredSession(runId);
        if (stored?.agent === 'opencode' && stored.stateNamespace && stored.stateNamespace !== OPENCODE_ROOT) throw new Error('The saved OpenCode session belongs to a different state directory. Restore its state or create a new Code session.');
        if (stored && stored.agent === agent && stored.cwd === cwd && client.loadSupported) {
            try {
                await client.loadSession(stored.sessionId);
                return stored.sessionId;
            } catch {
                if (agent === 'opencode') throw new Error('The saved OpenCode session could not be loaded. Its history was preserved. Restore the managed OpenCode state or create a new Code session.');
                // Stored session is stale/unloadable — fall through to a fresh one.
                await clearStoredSession(runId);
            }
        }
        if (stored && agent === 'opencode' && stored.agent === agent) throw new Error('The saved OpenCode session cannot resume in this working directory or engine. Create a new Code session.');
        const sessionId = await client.newSession();
        await writeStoredSession({ runId, agent, cwd, sessionId,
            ...(agent === 'opencode' ? { engineVersion: ENGINE_MANIFEST.opencode.version, stateNamespace: OPENCODE_ROOT, capabilities: client.capabilities } : {}),
        });
        return sessionId;
    }
}
