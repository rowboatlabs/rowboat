import path from "node:path";
import fs from "node:fs/promises";
import { WorkDir } from "@x/core/dist/config/config.js";

// Match a detection event against the user's synced calendar. The detector
// fires when the mic flips on; if there's a calendar event currently in
// progress (or about to start / just ended), we attach its metadata so the
// popup can show the right title and the deeplink can target the right note.

const CALENDAR_SYNC_DIR = path.join(WorkDir, "calendar_sync");

// Pre-roll: someone joining 2 min early should still match the upcoming event.
const PRE_ROLL_MS = 2 * 60 * 1000;
// Post-roll: someone joining 2 min late (or a meeting that ran long and the
// next-event window already started) should still match.
const POST_ROLL_MS = 2 * 60 * 1000;

interface CalendarEventFile {
    id?: string;
    summary?: string;
    status?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    attendees?: Array<{ email?: string; displayName?: string; self?: boolean; responseStatus?: string }>;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

export interface CorrelatedEvent {
    eventId: string;
    summary: string;
    startMs: number;
    endMs: number;
    attendees: Array<{ email?: string; displayName?: string }>;
    meetingUrl?: string;
}

/**
 * Find a calendar event whose [start - PRE_ROLL, end + POST_ROLL] window
 * contains `now`. Returns the closest match (smallest |now - start|) when
 * multiple events overlap (back-to-back meetings).
 */
export async function correlateNow(now: Date = new Date()): Promise<CorrelatedEvent | null> {
    return correlateFromDir(CALENDAR_SYNC_DIR, now);
}

/** Exposed for tests — accepts an arbitrary directory of calendar JSON files. */
export async function correlateFromDir(dir: string, now: Date): Promise<CorrelatedEvent | null> {
    let entries: string[];
    try {
        entries = await fs.readdir(dir);
    } catch {
        return null;
    }

    const nowMs = now.getTime();
    let best: { event: CorrelatedEvent; distance: number } | null = null;

    for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        if (name === "sync_state.json" || name.startsWith("sync_state")) continue;

        let raw: string;
        try {
            raw = await fs.readFile(path.join(dir, name), "utf-8");
        } catch {
            continue;
        }
        let event: CalendarEventFile;
        try {
            event = JSON.parse(raw);
        } catch {
            continue;
        }

        if (event.status === "cancelled") continue;
        if (isDeclinedBySelf(event)) continue;

        const startStr = event.start?.dateTime;
        const endStr = event.end?.dateTime;
        if (!startStr || !endStr) continue;

        const startMs = Date.parse(startStr);
        const endMs = Date.parse(endStr);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

        // Skip events outside the active window.
        if (nowMs < startMs - PRE_ROLL_MS) continue;
        if (nowMs > endMs + POST_ROLL_MS) continue;

        const eventId = event.id || name.replace(/\.json$/, "");
        const correlated: CorrelatedEvent = {
            eventId,
            summary: event.summary?.trim() || "Untitled meeting",
            startMs,
            endMs,
            attendees: (event.attendees || [])
                .filter((a) => !a.self)
                .map((a) => ({ email: a.email, displayName: a.displayName })),
            meetingUrl: extractMeetingUrl(event),
        };

        const distance = Math.abs(nowMs - startMs);
        if (!best || distance < best.distance) {
            best = { event: correlated, distance };
        }
    }

    return best?.event ?? null;
}

function isDeclinedBySelf(event: CalendarEventFile): boolean {
    if (!event.attendees) return false;
    const self = event.attendees.find((a) => a.self);
    return self?.responseStatus === "declined";
}

function extractMeetingUrl(event: CalendarEventFile): string | undefined {
    if (event.hangoutLink) return event.hangoutLink;
    const eps = event.conferenceData?.entryPoints || [];
    const video = eps.find((e) => e.entryPointType === "video");
    return video?.uri;
}
