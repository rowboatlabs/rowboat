import { ChildProcess } from "child_process";

export interface IAbortRegistry {
    /**
     * Create and track an AbortController for a run.
     * Returns the AbortSignal to thread through all operations.
     */
    createForRun(runId: string): AbortSignal;

    /**
     * Track a child process for a run (so we can kill it on abort).
     */
    registerProcess(runId: string, process: ChildProcess): void;

    /**
     * Untrack a child process after it exits.
     */
    unregisterProcess(runId: string, process: ChildProcess): void;

    /**
     * Graceful abort:
     * 1. Fires the AbortSignal (cancels LLM streaming, etc.)
     * 2. Sends SIGTERM to all tracked process groups
     * 3. Schedules SIGKILL fallback after grace period
     */
    abort(runId: string): void;

    /**
     * Force abort:
     * 1. Fires AbortSignal if not already fired
     * 2. Sends SIGKILL to all tracked process groups immediately
     */
    forceAbort(runId: string): void;

    /**
     * Check if a run has been aborted.
     */
    isAborted(runId: string): boolean;

    /**
     * Clean up tracking state after a run completes or is fully stopped.
     */
    cleanup(runId: string): void;
}

interface RunAbortState {
    controller: AbortController;
    processes: Set<ChildProcess>;
    killTimers: Set<ReturnType<typeof setTimeout>>;
}

const SIGKILL_GRACE_MS = 200;

export class InMemoryAbortRegistry implements IAbortRegistry {
    private runs: Map<string, RunAbortState> = new Map();

    createForRun(runId: string): AbortSignal {
        // If a previous run state exists, clean it up first
        this.cleanup(runId);

        const state: RunAbortState = {
            controller: new AbortController(),
            processes: new Set(),
            killTimers: new Set(),
        };
        this.runs.set(runId, state);
        return state.controller.signal;
    }

    registerProcess(runId: string, process: ChildProcess): void {
        const state = this.runs.get(runId);
        if (!state) return;
        state.processes.add(process);

        // Auto-unregister when process exits
        const onExit = () => {
            state.processes.delete(process);
        };
        process.once("exit", onExit);
        process.once("error", onExit);
    }

    unregisterProcess(runId: string, process: ChildProcess): void {
        const state = this.runs.get(runId);
        if (!state) return;
        state.processes.delete(process);
    }

    abort(runId: string): void {
        const state = this.runs.get(runId);
        if (!state) return;

        // 1. Fire the abort signal
        if (!state.controller.signal.aborted) {
            state.controller.abort();
        }

        // 2. SIGTERM all tracked process groups
        for (const proc of state.processes) {
            this.killProcessTree(proc, "SIGTERM");

            // 3. Schedule SIGKILL fallback
            const timer = setTimeout(() => {
                if (!proc.killed) {
                    this.killProcessTree(proc, "SIGKILL");
                }
                state.killTimers.delete(timer);
            }, SIGKILL_GRACE_MS);
            state.killTimers.add(timer);
        }
    }

    forceAbort(runId: string): void {
        const state = this.runs.get(runId);
        if (!state) return;

        // 1. Fire abort signal if not already
        if (!state.controller.signal.aborted) {
            state.controller.abort();
        }

        // 2. Clear any pending graceful kill timers
        for (const timer of state.killTimers) {
            clearTimeout(timer);
        }
        state.killTimers.clear();

        // 3. SIGKILL all tracked process groups immediately
        for (const proc of state.processes) {
            this.killProcessTree(proc, "SIGKILL");
        }
    }

    isAborted(runId: string): boolean {
        const state = this.runs.get(runId);
        return state?.controller.signal.aborted ?? false;
    }

    cleanup(runId: string): void {
        const state = this.runs.get(runId);
        if (!state) return;

        // Clear any pending kill timers
        for (const timer of state.killTimers) {
            clearTimeout(timer);
        }

        this.runs.delete(runId);
    }

    /**
     * Kill a process tree using negative PID (process group kill on Unix).
     * Falls back to direct kill if group kill fails.
     */
    private killProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
        if (!proc.pid || proc.killed) return;

        try {
            // Negative PID kills the entire process group (Unix)
            process.kill(-proc.pid, signal);
        } catch {
            // Fallback: kill just the process directly
            try {
                proc.kill(signal);
            } catch {
                // Process may already be dead
            }
        }
    }
}
