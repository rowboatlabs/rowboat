// Server-Sent Events reader for a workspace's event stream (2026-09-28).
// Replicas documents the envelope only — { id, ts, type, payload } plus a
// heartbeat every 15 s — so this reader is shape-agnostic: it hands every
// frame to the caller and lets the wait tool decide what "done" means.

export interface ReplicasEvent {
    id: string | null;
    ts: string | null;
    type: string;
    payload: unknown;
    /** The raw data line, for grep-style PR-link detection. */
    raw: string;
}

export type StreamOutcome = "ended" | "stopped" | "quiet" | "aborted";

export interface ReadEventStreamOptions {
    url: string;
    headers: Record<string, string>;
    signal: AbortSignal;
    /** Return "stop" to close the stream early. */
    onEvent: (event: ReplicasEvent) => "continue" | "stop";
    /** Close when no non-heartbeat event arrives for this long. */
    quietMs: number;
}

const HEARTBEAT_TYPES = new Set(["heartbeat", "ping", "keepalive", "keep-alive"]);

export function isHeartbeat(event: ReplicasEvent): boolean {
    return HEARTBEAT_TYPES.has(event.type.toLowerCase());
}

/** Parse one SSE frame (the lines between blank lines) into an event, or null for comments. */
export function parseSseFrame(frame: string): ReplicasEvent | null {
    let eventName: string | null = null;
    let id: string | null = null;
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") eventName = value;
        else if (field === "data") dataLines.push(value);
        else if (field === "id") id = value;
    }
    if (dataLines.length === 0) return eventName ? { id, ts: null, type: eventName, payload: null, raw: "" } : null;
    const raw = dataLines.join("\n");
    let parsed: unknown = raw;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // plain-text data: keep the string
    }
    const obj = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    const type = eventName ?? (obj && typeof obj.type === "string" ? obj.type : "message");
    return {
        id: id ?? (obj && typeof obj.id === "string" ? obj.id : null),
        ts: obj && typeof obj.ts === "string" ? obj.ts : null,
        type,
        payload: obj && "payload" in obj ? obj.payload : parsed,
        raw,
    };
}

export async function readEventStream(options: ReadEventStreamOptions): Promise<StreamOutcome> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (options.signal.aborted) return "aborted";
    options.signal.addEventListener("abort", onAbort, { once: true });

    let outcome: StreamOutcome = "ended";
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    const armQuiet = () => {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => {
            outcome = "quiet";
            controller.abort();
        }, options.quietMs);
    };

    try {
        const response = await fetch(options.url, {
            headers: { Accept: "text/event-stream", ...options.headers },
            signal: controller.signal,
        });
        if (!response.ok || !response.body) {
            const text = await response.text().catch(() => "");
            throw new Error(`Replicas event stream HTTP ${response.status}: ${text.slice(0, 300)}`);
        }
        armQuiet();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.search(/\r?\n\r?\n/);
            while (boundary !== -1) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
                const event = parseSseFrame(frame);
                if (event) {
                    if (!isHeartbeat(event)) armQuiet();
                    if (options.onEvent(event) === "stop") {
                        outcome = "stopped";
                        controller.abort();
                        return outcome;
                    }
                }
                boundary = buffer.search(/\r?\n\r?\n/);
            }
        }
        return outcome;
    } catch (error) {
        if (options.signal.aborted) return "aborted";
        if (controller.signal.aborted) return outcome; // quiet or stopped
        throw error;
    } finally {
        if (quietTimer) clearTimeout(quietTimer);
        options.signal.removeEventListener("abort", onAbort);
    }
}
