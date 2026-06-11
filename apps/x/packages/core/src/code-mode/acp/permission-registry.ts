import type { PermissionDecision } from './types.js';

interface Pending {
    runId: string;
    resolve: (decision: PermissionDecision) => void;
}

// Holds in-flight mid-run permission asks. The agent (via the broker) calls
// request() which BLOCKS the coding turn until the user answers; the renderer's
// answer arrives over IPC and calls resolve(). This is separate from the LLM
// tool-loop's pre-call permission gate, which can't model a mid-execution wait.
export class CodePermissionRegistry {
    private readonly pending = new Map<string, Pending>();
    private counter = 0;

    // Register a pending ask, hand the generated requestId to `emit` (so the caller
    // can publish the UI event), and resolve once the user answers.
    request(runId: string, emit: (requestId: string) => void): Promise<PermissionDecision> {
        const requestId = `cpr-${runId}-${++this.counter}`;
        return new Promise<PermissionDecision>((resolve) => {
            this.pending.set(requestId, { runId, resolve });
            emit(requestId);
        });
    }

    // Called from the IPC handler when the user answers a card.
    resolve(requestId: string, decision: PermissionDecision): void {
        const entry = this.pending.get(requestId);
        if (!entry) return;
        this.pending.delete(requestId);
        entry.resolve(decision);
    }

    // On run stop/cancel: reject anything still waiting so the turn can unwind.
    cancelRun(runId: string): void {
        for (const [id, entry] of [...this.pending]) {
            if (entry.runId === runId) {
                this.pending.delete(id);
                entry.resolve('reject');
            }
        }
    }
}
