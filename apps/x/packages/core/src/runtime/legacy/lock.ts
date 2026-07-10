export interface IRunsLock {
    lock(runId: string): Promise<boolean>;
    release(runId: string): Promise<void>;
}

export class InMemoryRunsLock implements IRunsLock {
    private locks: Record<string, boolean> = {};

    async lock(runId: string): Promise<boolean> {
        if (this.locks[runId]) {
            return false;
        }
        this.locks[runId] = true;
        return true;
    }

    async release(runId: string): Promise<void> {
        delete this.locks[runId];
    }
}
