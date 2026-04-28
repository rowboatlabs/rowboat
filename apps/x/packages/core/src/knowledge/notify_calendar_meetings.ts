import path from "node:path";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { WorkDir } from "../config/config.js";
import container from "../di/container.js";
import type { INotificationService } from "../application/notification/service.js";

const TICK_INTERVAL_MS = 30_000;
// Notify when an event is between 30s in the past (started just now) and
// 90s in the future (about to start). The window is wider than 60s so we
// don't miss an event if the tick lands slightly off the start time.
const NOTIFY_LEAD_MS = 90_000;
const NOTIFY_GRACE_MS = 30_000;
// Drop state entries older than 24h so the file doesn't grow forever.
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

const CALENDAR_SYNC_DIR = path.join(WorkDir, "calendar_sync");
const STATE_FILE = path.join(WorkDir, "calendar_notifications_state.json");

interface NotificationState {
    notifiedEventIds: Record<string, { notifiedAt: string; startTime: string }>;
}

interface CalendarEvent {
    id?: string;
    summary?: string;
    status?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: Array<{ email?: string; self?: boolean; responseStatus?: string }>;
    hangoutLink?: string;
    conferenceData?: {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    };
}

async function loadState(): Promise<NotificationState> {
    try {
        const raw = await fs.readFile(STATE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.notifiedEventIds) {
            return parsed as NotificationState;
        }
    } catch {
        // No state file yet, or corrupt — start fresh.
    }
    return { notifiedEventIds: {} };
}

async function saveState(state: NotificationState): Promise<void> {
    // Write to a sibling tmp file then rename so a mid-write crash can't leave
    // the JSON corrupt — a corrupt state file would make every event in the
    // 90s notify window re-fire on next start.
    const tmp = `${STATE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
    await fs.rename(tmp, STATE_FILE);
}

function gcState(state: NotificationState): NotificationState {
    const cutoff = Date.now() - STATE_TTL_MS;
    const fresh: NotificationState["notifiedEventIds"] = {};
    for (const [id, entry] of Object.entries(state.notifiedEventIds)) {
        const ts = Date.parse(entry.notifiedAt);
        if (Number.isFinite(ts) && ts >= cutoff) fresh[id] = entry;
    }
    return { notifiedEventIds: fresh };
}

function isAllDay(event: CalendarEvent): boolean {
    // Google Calendar all-day events have `date` (YYYY-MM-DD) on start, not `dateTime`.
    return !event.start?.dateTime;
}

function isDeclinedBySelf(event: CalendarEvent): boolean {
    if (!event.attendees) return false;
    const self = event.attendees.find((a) => a.self);
    return self?.responseStatus === "declined";
}

async function tick(state: NotificationState): Promise<{ state: NotificationState; dirty: boolean }> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(CALENDAR_SYNC_DIR, { withFileTypes: true });
    } catch {
        return { state, dirty: false };
    }

    let service: INotificationService;
    try {
        service = container.resolve<INotificationService>("notificationService");
    } catch {
        // Notification service not registered yet (very early startup) — skip this tick.
        return { state, dirty: false };
    }
    if (!service.isSupported()) return { state, dirty: false };

    const now = Date.now();
    let dirty = false;

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        if (entry.name === "sync_state.json" || entry.name.startsWith("sync_state")) continue;

        const eventId = entry.name.replace(/\.json$/, "");
        if (state.notifiedEventIds[eventId]) continue;

        const filePath = path.join(CALENDAR_SYNC_DIR, entry.name);
        let event: CalendarEvent;
        try {
            event = JSON.parse(await fs.readFile(filePath, "utf-8"));
        } catch {
            continue;
        }

        if (event.status === "cancelled") continue;
        if (isAllDay(event)) continue;
        if (isDeclinedBySelf(event)) continue;

        const startStr = event.start?.dateTime;
        if (!startStr) continue;
        const startMs = Date.parse(startStr);
        if (!Number.isFinite(startMs)) continue;

        const msUntilStart = startMs - now;
        if (msUntilStart > NOTIFY_LEAD_MS) continue;
        if (msUntilStart < -NOTIFY_GRACE_MS) continue;

        const summary = event.summary?.trim() || "Untitled meeting";
        const eid = encodeURIComponent(eventId);

        try {
            service.notify({
                title: "Upcoming meeting",
                message: `${summary} starts in 1 minute. Click to join and take notes.`,
                // Single labeled button — adding a secondary action would force
                // macOS to bundle them into an "Options" dropdown, hiding the
                // primary label.
                link: `rowboat://action?type=join-and-take-meeting-notes&eventId=${eid}`,
                actionLabel: "Join & Notes",
            });
            console.log(`[CalendarNotify] notified for "${summary}" (${eventId})`);
        } catch (err) {
            console.error(`[CalendarNotify] notify failed for ${eventId}:`, err);
            continue;
        }

        state.notifiedEventIds[eventId] = {
            notifiedAt: new Date().toISOString(),
            startTime: startStr,
        };
        dirty = true;
    }

    return { state, dirty };
}

export async function init(): Promise<void> {
    console.log("[CalendarNotify] starting calendar notification service");
    console.log(`[CalendarNotify] tick every ${TICK_INTERVAL_MS / 1000}s`);

    let state = gcState(await loadState());

    while (true) {
        try {
            const result = await tick(state);
            state = result.state;
            if (result.dirty) {
                state = gcState(state);
                try {
                    await saveState(state);
                } catch (err) {
                    console.error("[CalendarNotify] failed to save state:", err);
                }
            }
        } catch (err) {
            console.error("[CalendarNotify] tick failed:", err);
        }
        await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
    }
}
