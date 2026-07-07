import type { CodeRunFeedEvent } from '@x/shared/dist/code-mode.js';

// Ephemeral side-channel for code_agent_run's live ACP stream — a direct
// tool-implementation → renderer contract that deliberately bypasses the turn
// runtime. The stream is chatty (per-chunk agent messages, tool status
// updates) and only ever renders inside one tool card, so persisting each
// event as durable turn progress bloats the turn log for no benefit. Instead:
//   - live:    the tool broadcasts here; main forwards over `codeRun:events`
//              (see apps/main ipc.ts) and the renderer buffers per toolCallId.
//   - durable: ONE code-run-events-batch is published when the run settles,
//              so reloads replay the full timeline from the turn record.
// Fire-and-forget: no subscribers ⇒ events vanish, which is the point.
export class CodeRunFeed {
    private readonly listeners = new Set<(event: CodeRunFeedEvent) => void>();

    broadcast(event: CodeRunFeedEvent): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch {
                // A broken subscriber must not stall the coding turn.
            }
        }
    }

    subscribe(listener: (event: CodeRunFeedEvent) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}
