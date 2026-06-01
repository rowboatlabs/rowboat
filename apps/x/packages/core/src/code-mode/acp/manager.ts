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
}

interface ActiveRun {
    client: AcpClient;
    sessionId: string;
    agent: CodingAgent;
    cwd: string;
}

// Drives ACP coding sessions, one live connection per chat run. Reuses a warm
// connection for follow-up prompts in the same chat; resumes a persisted session
// (via session/load) on the first prompt after an app restart.
export class CodeModeManager {
    private readonly runs = new Map<string, ActiveRun>();

    async runPrompt(args: RunPromptArgs): Promise<RunPromptResult> {
        const { runId, agent, cwd, prompt, policy, ask, onEvent } = args;

        const broker = new PermissionBroker({
            policy,
            ask,
            onResolved: (a, decision, auto) => onEvent({ type: 'permission', ask: a, decision, auto }),
        });

        const run = await this.ensureRun(runId, agent, cwd, broker, onEvent);
        const res = await run.client.prompt(run.sessionId, prompt);
        return { stopReason: res.stopReason, sessionId: run.sessionId };
    }

    async cancel(runId: string): Promise<void> {
        const run = this.runs.get(runId);
        if (run) await run.client.cancel(run.sessionId);
    }

    dispose(runId: string): void {
        const run = this.runs.get(runId);
        if (!run) return;
        run.client.dispose();
        this.runs.delete(runId);
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
    ): Promise<ActiveRun> {
        const existing = this.runs.get(runId);
        if (existing && existing.agent === agent && existing.cwd === cwd) {
            existing.client.setHandlers(broker, onEvent);
            return existing;
        }
        if (existing) this.dispose(runId); // agent/cwd changed — start over

        const client = new AcpClient({ agent, cwd, broker, onEvent });
        await client.start();

        const sessionId = await this.openSession(runId, agent, cwd, client);
        const run: ActiveRun = { client, sessionId, agent, cwd };
        this.runs.set(runId, run);
        return run;
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
