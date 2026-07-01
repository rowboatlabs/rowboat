import path from "node:path";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { WorkDir } from "../config/config.js";
import { generateAndWritePrep } from "./meeting_prep_brief.js";

// Generate prep up to 6h before a meeting. We tick every 5 minutes and scan the
// synced calendar — a calendar-aware loop fits "N hours before each meeting"
// better than a fixed cron, and re-reading the calendar each tick means moves
// and cancellations are picked up automatically.
const TICK_INTERVAL_MS = 15 * 60_000;
const PREP_LEAD_MS = 6 * 60 * 60_000;
// Drop state entries older than 24h so the file doesn't grow forever.
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

const CALENDAR_SYNC_DIR = path.join(WorkDir, "calendar_sync");
const STATE_FILE = path.join(WorkDir, "meeting_prep_state.json");

interface PrepState {
    preppedEventIds: Record<string, { preppedAt: string; startTime: string }>;
}

interface CalendarEvent {
    id?: string;
    summary?: string;
    status?: string;
    start?: { dateTime?: string; date?: string };
    attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

async function loadState(): Promise<PrepState> {
    try {
        const raw = await fs.readFile(STATE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.preppedEventIds) {
            return parsed as PrepState;
        }
    } catch {
        // No state file yet, or corrupt — start fresh.
    }
    return { preppedEventIds: {} };
}

async function saveState(state: PrepState): Promise<void> {
    // Write to a sibling tmp file then rename so a mid-write crash can't leave
    // the JSON corrupt.
    const tmp = `${STATE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
    await fs.rename(tmp, STATE_FILE);
}

function gcState(state: PrepState): PrepState {
    const cutoff = Date.now() - STATE_TTL_MS;
    const fresh: PrepState["preppedEventIds"] = {};
    for (const [id, entry] of Object.entries(state.preppedEventIds)) {
        const ts = Date.parse(entry.preppedAt);
        if (Number.isFinite(ts) && ts >= cutoff) fresh[id] = entry;
    }
    return { preppedEventIds: fresh };
}

function isAllDay(event: CalendarEvent): boolean {
    return !event.start?.dateTime;
}

function isDeclinedBySelf(event: CalendarEvent): boolean {
    return event.attendees?.find((a) => a.self)?.responseStatus === "declined";
}

async function tick(state: PrepState): Promise<{ state: PrepState; dirty: boolean }> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(CALENDAR_SYNC_DIR, { withFileTypes: true });
    } catch {
        return { state, dirty: false };
    }

    const now = Date.now();
    let dirty = false;

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        if (entry.name.startsWith("sync_state")) continue;

        const eventId = entry.name.replace(/\.json$/, "");
        if (state.preppedEventIds[eventId]) continue;

        let raw: string;
        try {
            raw = await fs.readFile(path.join(CALENDAR_SYNC_DIR, entry.name), "utf-8");
        } catch {
            continue;
        }
        let event: CalendarEvent;
        try {
            event = JSON.parse(raw);
        } catch {
            continue;
        }

        if (event.status === "cancelled") continue;
        if (isAllDay(event)) continue;
        if (isDeclinedBySelf(event)) continue;
        if (!(event.attendees ?? []).some((a) => !a.self)) continue; // nobody else

        const startStr = event.start?.dateTime;
        if (!startStr) continue;
        const startMs = Date.parse(startStr);
        if (!Number.isFinite(startMs)) continue;

        const msUntilStart = startMs - now;
        if (msUntilStart > PREP_LEAD_MS) continue; // too far out
        if (msUntilStart <= 0) continue; // already started — too late to pre-generate

        try {
            const result = await generateAndWritePrep(raw);
            if (result) {
                console.log(`[MeetingPrep] generated prep for "${event.summary ?? eventId}" → ${result.path}`);
            }
        } catch (err) {
            console.error(`[MeetingPrep] prep generation failed for ${eventId}:`, err);
            continue; // leave unmarked so we retry next tick
        }

        state.preppedEventIds[eventId] = {
            preppedAt: new Date().toISOString(),
            startTime: startStr,
        };
        dirty = true;
    }

    return { state, dirty };
}

export async function init(): Promise<void> {
    console.log("[MeetingPrep] starting meeting prep scheduler");
    console.log(`[MeetingPrep] tick every ${TICK_INTERVAL_MS / 60_000}m, lead ${PREP_LEAD_MS / 3_600_000}h`);

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
                    console.error("[MeetingPrep] failed to save state:", err);
                }
            }
        } catch (err) {
            console.error("[MeetingPrep] tick failed:", err);
        }
        await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
    }
}
