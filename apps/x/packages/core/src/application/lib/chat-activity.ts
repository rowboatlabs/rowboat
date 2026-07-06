// Tracks whether any user-facing chat turn is currently being processed.
// Both chat runtimes mark their turns here (sessions/sessions.ts for the
// turns runtime, agents/runtime.ts trigger() for legacy runs). Background
// agent invocations consult it via startWhenPossible/runWhenPossible in
// agents/headless-app.ts when the user enabled "Defer background tasks
// while a chat is running" — useful on local models, where a background run
// competes with the chat for the same hardware.
export class ChatActivity {
    private active = 0;
    private waiters: Array<() => void> = [];

    enter(): void {
        this.active++;
    }

    exit(): void {
        this.active = Math.max(0, this.active - 1);
        if (this.active === 0) {
            const waiters = this.waiters.splice(0);
            for (const waiter of waiters) {
                waiter();
            }
        }
    }

    get activeCount(): number {
        return this.active;
    }

    /** Resolves immediately when no chat turn is running. */
    waitUntilIdle(): Promise<void> {
        if (this.active === 0) {
            return Promise.resolve();
        }
        return new Promise((resolve) => this.waiters.push(resolve));
    }
}

export const chatActivity = new ChatActivity();
