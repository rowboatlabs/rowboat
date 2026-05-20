import { EventEmitter } from "node:events";
import { classifyExecutable, type MeetingAppKind } from "./meeting-apps.js";
import type { MicProbe, MicUser } from "./types.js";

const DEFAULT_TICK_MS = 3_000;

export interface MeetingActiveEvent {
    executable: string;
    pid?: number;
    kind: MeetingAppKind;
    // Stable key for dedup — exe path (plus pid on mac so a Zoom relaunch counts as a new session).
    sessionKey: string;
    startedAt: Date;
}

export interface MeetingClearedEvent {
    sessionKey: string;
    endedAt: Date;
}

/**
 * Polls a platform-specific MicProbe and emits when a whitelisted meeting app
 * starts / stops holding the mic. One emit per distinct session — a session
 * lasts as long as the same exe (+pid on macOS) keeps appearing in probe
 * results across ticks.
 *
 * Pure logic; UI/notification wiring lives in the service layer. Probe is
 * injected so this is testable without a real OS.
 */
export class MeetingDetector extends EventEmitter {
    private readonly probe: MicProbe;
    private readonly tickMs: number;
    private active = new Map<string, MeetingActiveEvent>();
    private timer: NodeJS.Timeout | null = null;
    private running = false;

    constructor(probe: MicProbe, tickMs: number = DEFAULT_TICK_MS) {
        super();
        this.probe = probe;
        this.tickMs = tickMs;
    }

    start(): void {
        if (this.timer) return;
        const loop = async () => {
            if (!this.running) return;
            try {
                await this.tick();
            } catch (err) {
                console.error("[MeetingDetect] tick failed:", err);
            }
            if (this.running) this.timer = setTimeout(loop, this.tickMs);
        };
        this.running = true;
        // Run first tick immediately; subsequent ticks scheduled by the loop.
        this.timer = setTimeout(loop, 0);
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /** Exposed for tests — drive a single probe-and-diff cycle. */
    async tick(): Promise<void> {
        const users = await this.probe.probe();
        const seenKeys = new Set<string>();
        const now = new Date();

        for (const user of users) {
            const kind = classifyExecutable(user.executable);
            if (kind === "unknown") continue;

            const key = sessionKey(user);
            seenKeys.add(key);

            if (!this.active.has(key)) {
                const event: MeetingActiveEvent = {
                    executable: user.executable,
                    pid: user.pid,
                    kind,
                    sessionKey: key,
                    startedAt: now,
                };
                this.active.set(key, event);
                this.emit("meeting-active", event);
            }
        }

        for (const [key, event] of this.active) {
            if (seenKeys.has(key)) continue;
            this.active.delete(key);
            const cleared: MeetingClearedEvent = { sessionKey: key, endedAt: now };
            this.emit("meeting-cleared", cleared);
        }
    }
}

function sessionKey(user: MicUser): string {
    // On macOS we include pid so an app relaunch counts as a new session.
    // On Windows there's no pid; the exe path alone is sufficient because
    // Windows can't tell us *which instance* of an exe is holding the mic.
    return user.pid !== undefined ? `${user.executable}#${user.pid}` : user.executable;
}
