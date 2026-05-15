import path from "node:path";
import fs from "node:fs/promises";
import { WorkDir } from "@x/core/dist/config/config.js";

const STATE_FILE = path.join(WorkDir, "meeting_detect_state.json");
// Don't re-popup for the same exe within this window if the user dismissed.
const DISMISS_COOLDOWN_MS = 30 * 60 * 1000;
// Drop session-key entries older than 24h.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface SuppressionState {
    // Mic sessions we've already shown a popup for — keyed by detector sessionKey.
    notifiedSessions: Record<string, { notifiedAt: string }>;
    // User explicitly dismissed for this exe at this time.
    recentlyDismissed: Record<string, { dismissedAt: string }>;
    // Permanent "never offer for this app" list — exe substring matches.
    mutedApps: string[];
}

function empty(): SuppressionState {
    return { notifiedSessions: {}, recentlyDismissed: {}, mutedApps: [] };
}

export interface SuppressionStore {
    load(): Promise<SuppressionState>;
    save(state: SuppressionState): Promise<void>;
}

class FileSuppressionStore implements SuppressionStore {
    private readonly file: string;
    constructor(file: string) { this.file = file; }

    async load(): Promise<SuppressionState> {
        try {
            const raw = await fs.readFile(this.file, "utf-8");
            const parsed = JSON.parse(raw);
            return normalize(parsed);
        } catch {
            return empty();
        }
    }

    async save(state: SuppressionState): Promise<void> {
        const tmp = `${this.file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
        await fs.rename(tmp, this.file);
    }
}

function normalize(raw: unknown): SuppressionState {
    if (!raw || typeof raw !== "object") return empty();
    const obj = raw as Partial<SuppressionState>;
    return {
        notifiedSessions: obj.notifiedSessions && typeof obj.notifiedSessions === "object" ? obj.notifiedSessions : {},
        recentlyDismissed: obj.recentlyDismissed && typeof obj.recentlyDismissed === "object" ? obj.recentlyDismissed : {},
        mutedApps: Array.isArray(obj.mutedApps) ? obj.mutedApps.filter((x) => typeof x === "string") : [],
    };
}

export class Suppression {
    private readonly store: SuppressionStore;
    private state: SuppressionState = empty();
    private loaded = false;

    constructor(store?: SuppressionStore) {
        this.store = store ?? new FileSuppressionStore(STATE_FILE);
    }

    async init(): Promise<void> {
        this.state = gc(await this.store.load());
        this.loaded = true;
    }

    /** Should we fire a popup for this (sessionKey, executable)? */
    shouldNotify(sessionKey: string, executable: string, now: Date = new Date()): boolean {
        if (!this.loaded) return true; // fail open — better to occasionally re-popup than to silently miss.
        if (this.isMuted(executable)) return false;
        if (this.state.notifiedSessions[sessionKey]) return false;

        const dismissKey = dismissKeyFor(executable);
        const recent = this.state.recentlyDismissed[dismissKey];
        if (recent) {
            const dismissedAt = Date.parse(recent.dismissedAt);
            if (Number.isFinite(dismissedAt) && now.getTime() - dismissedAt < DISMISS_COOLDOWN_MS) {
                return false;
            }
        }
        return true;
    }

    async markNotified(sessionKey: string, now: Date = new Date()): Promise<void> {
        this.state.notifiedSessions[sessionKey] = { notifiedAt: now.toISOString() };
        await this.persist();
    }

    /**
     * Clear the notified mark for a session. Called when the detector observes
     * the mic being released — without this, on Windows (no pid in sessionKey)
     * the same browser would never re-fire because every new Meet call reuses
     * the same exe-keyed session.
     */
    async clearSession(sessionKey: string): Promise<void> {
        if (!this.state.notifiedSessions[sessionKey]) return;
        delete this.state.notifiedSessions[sessionKey];
        await this.persist();
    }

    async markDismissed(executable: string, now: Date = new Date()): Promise<void> {
        this.state.recentlyDismissed[dismissKeyFor(executable)] = { dismissedAt: now.toISOString() };
        await this.persist();
    }

    async muteApp(executable: string): Promise<void> {
        const key = dismissKeyFor(executable);
        if (!this.state.mutedApps.includes(key)) {
            this.state.mutedApps.push(key);
            await this.persist();
        }
    }

    isMuted(executable: string): boolean {
        const needle = dismissKeyFor(executable);
        return this.state.mutedApps.some((m) => needle.includes(m) || m.includes(needle));
    }

    private async persist(): Promise<void> {
        this.state = gc(this.state);
        try {
            await this.store.save(this.state);
        } catch (err) {
            console.error("[MeetingDetect] failed to persist suppression state:", err);
        }
    }
}

function dismissKeyFor(executable: string): string {
    // Reduce a path/exe to a stable key — strip directory, lowercase.
    const base = executable.replace(/^.*[/\\]/, "").toLowerCase();
    return base || executable.toLowerCase();
}

function gc(state: SuppressionState): SuppressionState {
    const now = Date.now();
    const sessions: SuppressionState["notifiedSessions"] = {};
    for (const [k, v] of Object.entries(state.notifiedSessions)) {
        const ts = Date.parse(v.notifiedAt);
        if (Number.isFinite(ts) && now - ts < SESSION_TTL_MS) sessions[k] = v;
    }
    const dismissed: SuppressionState["recentlyDismissed"] = {};
    for (const [k, v] of Object.entries(state.recentlyDismissed)) {
        const ts = Date.parse(v.dismissedAt);
        if (Number.isFinite(ts) && now - ts < DISMISS_COOLDOWN_MS) dismissed[k] = v;
    }
    return { notifiedSessions: sessions, recentlyDismissed: dismissed, mutedApps: state.mutedApps };
}

/** In-memory store for tests. */
export class InMemorySuppressionStore implements SuppressionStore {
    private state: SuppressionState = empty();
    async load(): Promise<SuppressionState> { return JSON.parse(JSON.stringify(this.state)); }
    async save(s: SuppressionState): Promise<void> { this.state = JSON.parse(JSON.stringify(s)); }
    snapshot(): SuppressionState { return JSON.parse(JSON.stringify(this.state)); }
}
