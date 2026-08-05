// Builtin tools: calendar domain. Read tools serve from the local
// calendar_sync mirror (primary flat, secondary calendars under secondary/);
// write tools wrap the same calendar_write.ts functions the visual calendar
// uses, so results land in the sync dir and the UI refreshes immediately.

import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { WorkDir } from "../../../config/config.js";
import {
    createCalendarEvent,
    deleteCalendarEvent,
    getCalendarWriteStatus,
    respondToCalendarEvent,
    updateCalendarEvent,
} from "../../../knowledge/calendar_write.js";
import { BuiltinToolsSchema } from "../types.js";

const SYNC_DIR = path.join(WorkDir, "calendar_sync");
const SECONDARY_DIR = path.join(SYNC_DIR, "secondary");
const NON_EVENT_FILES = new Set(["calendars.json", "sync_state.json", "composio_state.json"]);
const DEFAULT_DURATION_MS = 30 * 60 * 1000;

type RawEvent = {
    id?: string;
    summary?: string;
    status?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    location?: string;
    htmlLink?: string;
    organizer?: { email?: string; displayName?: string; self?: boolean };
    attendees?: Array<{ email?: string; displayName?: string; self?: boolean; responseStatus?: string; optional?: boolean }>;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    recurringEventId?: string;
    rowboatCalendarId?: string;
};

type ListedEvent = {
    id: string;
    summary: string;
    start: string;
    end: string | null;
    allDay: boolean;
    location?: string;
    organizer?: string;
    attendees?: Array<{ email: string; responseStatus?: string; self?: boolean }>;
    conferenceLink?: string;
    htmlLink?: string;
    calendarId: string;
    // Present on instances of a repeating series; pass it as eventId to
    // calendar-delete-event to remove the whole series.
    recurringEventId?: string;
    startMs: number;
    endMs: number;
};

function conferenceLinkOf(event: RawEvent): string | undefined {
    if (event.hangoutLink) return event.hangoutLink;
    const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video" && e.uri);
    return video?.uri ?? undefined;
}

async function readEventsIn(dir: string): Promise<RawEvent[]> {
    let names: string[];
    try {
        names = await fs.readdir(dir);
    } catch {
        return [];
    }
    const out: RawEvent[] = [];
    for (const name of names) {
        if (!name.endsWith(".json") || NON_EVENT_FILES.has(name) || name.startsWith("sync_state")) continue;
        try {
            out.push(JSON.parse(await fs.readFile(path.join(dir, name), "utf-8")) as RawEvent);
        } catch {
            // unreadable file — skip
        }
    }
    return out;
}

// All synced events (primary + secondary calendars), normalized for tool
// output, deduped by id (an invite can live on several calendars).
async function loadSyncedEvents(): Promise<ListedEvent[]> {
    const raws = await readEventsIn(SYNC_DIR);
    try {
        for (const entry of await fs.readdir(SECONDARY_DIR)) {
            raws.push(...await readEventsIn(path.join(SECONDARY_DIR, entry)));
        }
    } catch {
        // no secondary calendars synced
    }

    const byId = new Map<string, ListedEvent>();
    for (const raw of raws) {
        if (!raw.id || raw.status === "cancelled") continue;
        if (raw.attendees?.find((a) => a.self)?.responseStatus === "declined") continue;
        const startStr = raw.start?.dateTime ?? raw.start?.date;
        if (!startStr) continue;
        const startMs = Date.parse(startStr);
        if (!Number.isFinite(startMs)) continue;
        const endStr = raw.end?.dateTime ?? raw.end?.date ?? null;
        const endParsed = endStr ? Date.parse(endStr) : NaN;
        const endMs = Number.isFinite(endParsed) ? endParsed : startMs + DEFAULT_DURATION_MS;
        const calendarId = raw.rowboatCalendarId ?? "primary";

        const existing = byId.get(raw.id);
        if (existing && !(existing.calendarId !== "primary" && calendarId === "primary")) continue;
        byId.set(raw.id, {
            id: raw.id,
            summary: raw.summary?.trim() || "(No title)",
            start: startStr,
            end: endStr,
            allDay: !raw.start?.dateTime,
            location: raw.location?.trim() || undefined,
            organizer: raw.organizer?.email ?? undefined,
            attendees: raw.attendees?.slice(0, 20).map((a) => ({
                email: a.email ?? "",
                responseStatus: a.responseStatus,
                self: a.self || undefined,
            })),
            conferenceLink: conferenceLinkOf(raw),
            htmlLink: raw.htmlLink ?? undefined,
            calendarId,
            recurringEventId: raw.recurringEventId,
            startMs,
            endMs,
        });
    }
    return [...byId.values()].sort((a, b) => a.startMs - b.startMs);
}

function stripInternal(ev: ListedEvent): Omit<ListedEvent, "startMs" | "endMs"> {
    const copy: Partial<ListedEvent> = { ...ev };
    delete copy.startMs;
    delete copy.endMs;
    return copy as Omit<ListedEvent, "startMs" | "endMs">;
}

async function isCalendarSynced(): Promise<boolean> {
    try {
        await fs.access(SYNC_DIR);
        return true;
    } catch {
        return false;
    }
}

async function canWriteCalendar(): Promise<boolean> {
    try {
        const status = await getCalendarWriteStatus();
        return status.connected && status.canWrite;
    } catch {
        return false;
    }
}

export const calendarTools: z.infer<typeof BuiltinToolsSchema> = {
    "calendar-list-events": {
        permission: "none",
        description: "List the user's calendar events from the locally synced Google Calendar mirror (primary + secondary calendars, ±60 days). Returns events sorted by start time. Use this before scheduling, rescheduling, or answering questions about the user's schedule.",
        inputSchema: z.object({
            startISO: z.string().optional().describe("Window start (ISO 8601). Defaults to now."),
            endISO: z.string().optional().describe("Window end (ISO 8601). Defaults to 7 days after the window start."),
            query: z.string().optional().describe("Case-insensitive substring filter on the event title."),
            limit: z.number().int().positive().max(200).optional().describe("Max events to return (default 50)."),
        }),
        isAvailable: isCalendarSynced,
        execute: async ({ startISO, endISO, query, limit }: { startISO?: string; endISO?: string; query?: string; limit?: number }) => {
            const startMs = startISO ? Date.parse(startISO) : Date.now();
            if (!Number.isFinite(startMs)) return { success: false, error: `Invalid startISO: ${startISO}` };
            const endMs = endISO ? Date.parse(endISO) : startMs + 7 * 24 * 60 * 60 * 1000;
            if (!Number.isFinite(endMs)) return { success: false, error: `Invalid endISO: ${endISO}` };

            const q = query?.trim().toLowerCase();
            const events = (await loadSyncedEvents())
                .filter((ev) => ev.endMs > startMs && ev.startMs < endMs)
                .filter((ev) => !q || ev.summary.toLowerCase().includes(q));
            const capped = events.slice(0, limit ?? 50);
            return {
                success: true,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                total: events.length,
                events: capped.map(stripInternal),
            };
        },
    },
    "calendar-find-free-slots": {
        permission: "none",
        description: "Find open time slots on the user's calendar within a window, honoring working hours. Use when the user asks to 'find a time', schedule something, or share availability. Slots avoid all non-declined timed events across their calendars.",
        inputSchema: z.object({
            durationMinutes: z.number().int().positive().max(24 * 60).optional().describe("Required slot length in minutes (default 30)."),
            startISO: z.string().optional().describe("Search window start (ISO 8601). Defaults to now."),
            endISO: z.string().optional().describe("Search window end (ISO 8601). Defaults to 7 days after the window start."),
            workdayStartHour: z.number().int().min(0).max(23).optional().describe("Earliest local hour to propose (default 9)."),
            workdayEndHour: z.number().int().min(1).max(24).optional().describe("Latest local hour a slot may end (default 18)."),
            includeWeekends: z.boolean().optional().describe("Whether Saturday/Sunday slots count (default false)."),
            maxSlots: z.number().int().positive().max(50).optional().describe("Max slots to return (default 10)."),
        }),
        isAvailable: isCalendarSynced,
        execute: async ({ durationMinutes, startISO, endISO, workdayStartHour, workdayEndHour, includeWeekends, maxSlots }: {
            durationMinutes?: number;
            startISO?: string;
            endISO?: string;
            workdayStartHour?: number;
            workdayEndHour?: number;
            includeWeekends?: boolean;
            maxSlots?: number;
        }) => {
            const durationMs = (durationMinutes ?? 30) * 60 * 1000;
            const windowStart = startISO ? Date.parse(startISO) : Date.now();
            if (!Number.isFinite(windowStart)) return { success: false, error: `Invalid startISO: ${startISO}` };
            const windowEnd = endISO ? Date.parse(endISO) : windowStart + 7 * 24 * 60 * 60 * 1000;
            if (!Number.isFinite(windowEnd)) return { success: false, error: `Invalid endISO: ${endISO}` };
            const dayStart = workdayStartHour ?? 9;
            const dayEnd = workdayEndHour ?? 18;
            if (dayEnd <= dayStart) return { success: false, error: "workdayEndHour must be after workdayStartHour" };

            // Busy = every non-declined timed event; all-day events don't block.
            const busy = (await loadSyncedEvents())
                .filter((ev) => !ev.allDay && ev.endMs > windowStart && ev.startMs < windowEnd)
                .map((ev) => ({ start: ev.startMs, end: ev.endMs }))
                .sort((a, b) => a.start - b.start);

            const slots: Array<{ start: string; end: string }> = [];
            const limit = maxSlots ?? 10;
            // Walk day by day so working hours apply in local time.
            for (let dayCursor = new Date(windowStart); dayCursor.getTime() < windowEnd && slots.length < limit; dayCursor = new Date(dayCursor.getFullYear(), dayCursor.getMonth(), dayCursor.getDate() + 1)) {
                const dow = dayCursor.getDay();
                if (!includeWeekends && (dow === 0 || dow === 6)) continue;
                const dayOpen = new Date(dayCursor.getFullYear(), dayCursor.getMonth(), dayCursor.getDate(), dayStart).getTime();
                const dayClose = new Date(dayCursor.getFullYear(), dayCursor.getMonth(), dayCursor.getDate(), dayEnd).getTime();
                // Snap the cursor to the next quarter hour so proposals look sane.
                let cursor = Math.max(dayOpen, windowStart);
                cursor = Math.ceil(cursor / (15 * 60 * 1000)) * (15 * 60 * 1000);
                while (cursor + durationMs <= Math.min(dayClose, windowEnd) && slots.length < limit) {
                    const conflict = busy.find((b) => b.start < cursor + durationMs && b.end > cursor);
                    if (conflict) {
                        cursor = Math.ceil(conflict.end / (15 * 60 * 1000)) * (15 * 60 * 1000);
                        continue;
                    }
                    slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + durationMs).toISOString() });
                    cursor += durationMs;
                }
            }
            return {
                success: true,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                durationMinutes: durationMinutes ?? 30,
                slots,
            };
        },
    },
    "calendar-create-event": {
        permission: "prompt",
        description: "Create an event on the user's primary Google Calendar, optionally with a Google Meet link. Times are ISO 8601. Confirm the details with the user before calling unless they were explicit.",
        inputSchema: z.object({
            summary: z.string().min(1).describe("Event title."),
            startISO: z.string().min(1).describe("Start time (ISO 8601, include offset)."),
            endISO: z.string().min(1).describe("End time (ISO 8601, include offset)."),
            addMeet: z.boolean().optional().describe("Attach a Google Meet link (default false)."),
        }),
        isAvailable: canWriteCalendar,
        execute: async (args: { summary: string; startISO: string; endISO: string; addMeet?: boolean }) => {
            const result = await createCalendarEvent(args);
            return result.ok
                ? { success: true, eventId: result.eventId, htmlLink: result.htmlLink }
                : { success: false, error: result.error ?? "Could not create the event." };
        },
    },
    "calendar-update-event": {
        permission: "prompt",
        description: "Update an event's title and/or times. Start and end must travel together when rescheduling. Attendees are notified. For repeating events this changes only the given instance.",
        inputSchema: z.object({
            eventId: z.string().min(1).describe("Event id from calendar-list-events."),
            summary: z.string().optional().describe("New title."),
            startISO: z.string().optional().describe("New start (ISO 8601); requires endISO too."),
            endISO: z.string().optional().describe("New end (ISO 8601); requires startISO too."),
            calendarId: z.string().optional().describe("calendarId from calendar-list-events when the event isn't on the primary calendar."),
        }),
        isAvailable: canWriteCalendar,
        execute: async (args: { eventId: string; summary?: string; startISO?: string; endISO?: string; calendarId?: string }) => {
            if ((args.startISO === undefined) !== (args.endISO === undefined)) {
                return { success: false, error: "startISO and endISO must be provided together." };
            }
            const result = await updateCalendarEvent(args);
            return result.ok
                ? { success: true, eventId: result.eventId, htmlLink: result.htmlLink }
                : { success: false, error: result.error ?? "Could not update the event." };
        },
    },
    "calendar-delete-event": {
        permission: "prompt",
        description: "Delete an event (organizer: cancels it for everyone; attendee: removes it from the user's calendar). To delete a whole repeating series, pass the event's recurringEventId as eventId.",
        inputSchema: z.object({
            eventId: z.string().min(1).describe("Event id (or recurringEventId to remove a whole series)."),
            calendarId: z.string().optional().describe("calendarId from calendar-list-events when the event isn't on the primary calendar."),
        }),
        isAvailable: canWriteCalendar,
        execute: async ({ eventId, calendarId }: { eventId: string; calendarId?: string }) => {
            const result = await deleteCalendarEvent(eventId, calendarId);
            return result.ok
                ? { success: true, eventId }
                : { success: false, error: result.error ?? "Could not delete the event." };
        },
    },
    "calendar-rsvp-event": {
        permission: "prompt",
        description: "Set the user's RSVP on an event they're invited to (accepted / declined / tentative). Declined events drop off their calendar view.",
        inputSchema: z.object({
            eventId: z.string().min(1).describe("Event id from calendar-list-events."),
            response: z.enum(["accepted", "declined", "tentative"]).describe("The RSVP to record."),
            calendarId: z.string().optional().describe("calendarId from calendar-list-events when the event isn't on the primary calendar."),
        }),
        isAvailable: canWriteCalendar,
        execute: async ({ eventId, response, calendarId }: { eventId: string; response: "accepted" | "declined" | "tentative"; calendarId?: string }) => {
            const result = await respondToCalendarEvent(eventId, response, calendarId);
            return result.ok
                ? { success: true, eventId, response }
                : { success: false, error: result.error ?? "Could not update the RSVP." };
        },
    },
};
