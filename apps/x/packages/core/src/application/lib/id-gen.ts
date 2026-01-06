export interface IMonotonicallyIncreasingIdGenerator {
    next(): Promise<string>;
}

export class IdGen implements IMonotonicallyIncreasingIdGenerator {
    private lastSecond = 0; // Track by second since ISO string drops milliseconds
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
        const nowSecond = Math.floor(now / 1000);

        // Ensure monotonicity and handle sequence
        if (nowSecond > this.lastSecond) {
            // New second - reset sequence
            this.lastSecond = nowSecond;
            this.seq = 0;
        } else if (nowSecond === this.lastSecond) {
            // Same second - increment sequence
            this.seq++;
        } else {
            // Clock went backwards (shouldn't happen, but handle it)
            this.lastSecond = nowSecond;
            this.seq = 0;
        }

        // Use the second timestamp (multiply by 1000 to get ms)
        const ms = this.lastSecond * 1000;

        // Build ISO string (UTC) and remove milliseconds for cleaner filenames
        const iso = new Date(ms).toISOString() // e.g. 2025-11-11T04:36:29.000Z
            .replace(/\.\d{3}Z$/, "Z")           // drop .000 part
            .replace(/:/g, "-");                 // safe for files: 2025-11-11T04-36-29Z

        const seqStr = String(this.seq).padStart(3, "0");
        return `${iso}-${this.pid}${this.hostTag}-${seqStr}`;
    }
}