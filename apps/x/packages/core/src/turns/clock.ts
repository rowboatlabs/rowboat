// Deterministic timestamp seam. No IClock existed in the codebase before the
// turn runtime; production uses SystemClock, tests inject fixed clocks.
export interface IClock {
    now(): string; // ISO-8601 timestamp
}

export class SystemClock implements IClock {
    now(): string {
        return new Date().toISOString();
    }
}
