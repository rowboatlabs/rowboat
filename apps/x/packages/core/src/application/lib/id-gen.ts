export interface IMonotonicallyIncreasingIdGenerator {
    next(): Promise<string>;
}

export class IdGen implements IMonotonicallyIncreasingIdGenerator {
    private lastMs = 0;
    private seq = 0;
    private readonly pid: string;
    private readonly hostTag: string;

    constructor() {
        this.pid = String(process.pid).padStart(7, "0");
        this.hostTag = "";
    }

    /**
     * Returns an ISO8601-based, lexicographically sortable id string.
     * Example: 2025-11-11T04-36-29Z-0001234-h1-000
     */
    async next(): Promise<string> {
        const now = Date.now();
        const ms = now >= this.lastMs ? now : this.lastMs; // monotonic clamp
        this.seq = ms === this.lastMs ? this.seq + 1 : 0;
        this.lastMs = ms;

        // Build ISO string (UTC) and remove milliseconds for cleaner filenames
        const iso = new Date(ms).toISOString() // e.g. 2025-11-11T04:36:29.123Z
            .replace(/\.\d{3}Z$/, "Z")           // drop .123 part
            .replace(/:/g, "-");                 // safe for files: 2025-11-11T04-36-29Z

        const seqStr = String(this.seq).padStart(3, "0");
        return `${iso}-${this.pid}${this.hostTag}-${seqStr}`;
    }
}