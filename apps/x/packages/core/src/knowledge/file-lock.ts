const locks = new Map<string, Promise<void>>();

export async function withFileLock<T>(absPath: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(absPath) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const myTail = prev.then(() => gate);
    locks.set(absPath, myTail);
    try {
        await prev;
        return await fn();
    } finally {
        release();
        if (locks.get(absPath) === myTail) {
            locks.delete(absPath);
        }
    }
}
