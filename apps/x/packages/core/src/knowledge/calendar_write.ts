import { randomUUID } from 'crypto';
import { google, calendar_v3 as cal } from 'googleapis';
import { GoogleClientFactory } from './google-client-factory.js';
import { persistSyncedEvent, removeSyncedEvent, triggerSync } from './sync_calendar.js';

/**
 * Google Calendar write operations backing the visual calendar's quick-create,
 * edit/delete, and RSVP actions. Creates go to the primary calendar; edits,
 * deletes, and RSVPs target the calendar the event lives on (default primary).
 *
 * Requires the calendar.events scope. Grants issued before that scope replaced
 * calendar.events.readonly report `needsReconnect` so the renderer can point
 * the user at Settings → reconnect Google (the startup scope migration in
 * oauth-handler.ts invalidates such grants anyway, so in practice a connected
 * account either has write access or is already flagged for reconnect).
 *
 * After each successful write the returned event is persisted straight into
 * the calendar_sync dir (the renderer's file watcher refreshes the UI from it)
 * and the background sync loop is woken to reconcile.
 */

const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CALENDAR_ID = 'primary';

export type CalendarWriteStatus = { connected: boolean; canWrite: boolean };

export type CalendarWriteResult = {
    ok: boolean;
    eventId?: string;
    htmlLink?: string;
    error?: string;
    needsReconnect?: boolean;
};

export type RsvpResponse = 'accepted' | 'declined' | 'tentative';

export async function getCalendarWriteStatus(): Promise<CalendarWriteStatus> {
    const status = await GoogleClientFactory.getCredentialStatus([WRITE_SCOPE]);
    return { connected: status.connected, canWrite: status.hasRequiredScopes };
}

async function getWriteCalendar(): Promise<{ calendar: cal.Calendar } | { error: string; needsReconnect: true }> {
    const status = await GoogleClientFactory.getCredentialStatus([WRITE_SCOPE]);
    if (!status.connected) {
        return { error: 'Google account not connected.', needsReconnect: true };
    }
    if (!status.hasRequiredScopes) {
        return { error: 'Calendar write access not granted yet — reconnect Google in Settings.', needsReconnect: true };
    }
    const auth = await GoogleClientFactory.getClient();
    if (!auth) {
        return { error: 'Google credentials unavailable — reconnect Google in Settings.', needsReconnect: true };
    }
    return { calendar: google.calendar({ version: 'v3', auth }) };
}

function toWriteError(err: unknown): CalendarWriteResult {
    const e = err as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
    const status = e.response?.status;
    if (status === 401) {
        // Mirrors the sync loop: stale token — drop the cached client so the
        // next call rebuilds/refreshes.
        GoogleClientFactory.clearCache();
    }
    const message = e.response?.data?.error?.message || e.message || 'Calendar request failed.';
    // 403 is ambiguous: missing scope (fixable by reconnecting) vs. lacking
    // permission on someone else's event (not) — only flag the former.
    const needsReconnect = status === 401 || (status === 403 && /insufficient|scope/i.test(message));
    return { ok: false, error: message, needsReconnect: needsReconnect || undefined };
}

export async function createCalendarEvent(args: {
    summary: string;
    startISO: string;
    endISO: string;
    addMeet?: boolean;
}): Promise<CalendarWriteResult> {
    const client = await getWriteCalendar();
    if ('error' in client) return { ok: false, ...client };

    const requestBody: cal.Schema$Event = {
        summary: args.summary,
        start: { dateTime: args.startISO },
        end: { dateTime: args.endISO },
    };
    if (args.addMeet) {
        requestBody.conferenceData = {
            createRequest: {
                requestId: randomUUID(),
                conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
        };
    }

    try {
        const res = await client.calendar.events.insert({
            calendarId: CALENDAR_ID,
            conferenceDataVersion: args.addMeet ? 1 : 0,
            requestBody,
        });
        await persistSyncedEvent(res.data);
        triggerSync();
        return { ok: true, eventId: res.data.id ?? undefined, htmlLink: res.data.htmlLink ?? undefined };
    } catch (err) {
        console.error('[Calendar] Failed to create event:', err);
        return toWriteError(err);
    }
}

export async function updateCalendarEvent(args: {
    eventId: string;
    summary?: string;
    startISO?: string;
    endISO?: string;
    calendarId?: string;
}): Promise<CalendarWriteResult> {
    const client = await getWriteCalendar();
    if ('error' in client) return { ok: false, ...client };
    const calendarId = args.calendarId ?? CALENDAR_ID;

    const requestBody: cal.Schema$Event = {};
    if (args.summary !== undefined) requestBody.summary = args.summary;
    if (args.startISO !== undefined) requestBody.start = { dateTime: args.startISO };
    if (args.endISO !== undefined) requestBody.end = { dateTime: args.endISO };
    if (Object.keys(requestBody).length === 0) {
        return { ok: true, eventId: args.eventId };
    }

    try {
        const res = await client.calendar.events.patch({
            calendarId,
            eventId: args.eventId,
            sendUpdates: 'all',
            requestBody,
        });
        await persistSyncedEvent(res.data, calendarId);
        triggerSync();
        return { ok: true, eventId: res.data.id ?? undefined, htmlLink: res.data.htmlLink ?? undefined };
    } catch (err) {
        console.error('[Calendar] Failed to update event:', err);
        return toWriteError(err);
    }
}

export async function deleteCalendarEvent(eventId: string, calendarIdArg?: string): Promise<CalendarWriteResult> {
    const client = await getWriteCalendar();
    if ('error' in client) return { ok: false, ...client };
    const calendarId = calendarIdArg ?? CALENDAR_ID;

    try {
        await client.calendar.events.delete({
            calendarId,
            eventId,
            sendUpdates: 'all',
        });
    } catch (err) {
        // 410 = already gone; treat as success so the local copy still clears.
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status !== 410) {
            console.error('[Calendar] Failed to delete event:', err);
            return toWriteError(err);
        }
    }
    removeSyncedEvent(eventId, calendarId);
    triggerSync();
    return { ok: true, eventId };
}

export async function respondToCalendarEvent(eventId: string, response: RsvpResponse, calendarIdArg?: string): Promise<CalendarWriteResult> {
    const client = await getWriteCalendar();
    if ('error' in client) return { ok: false, ...client };
    const calendarId = calendarIdArg ?? CALENDAR_ID;

    try {
        // Patch replaces the whole attendees array, so read-modify-write it
        // with only our own responseStatus changed.
        const existing = await client.calendar.events.get({ calendarId, eventId });
        const attendees = existing.data.attendees ?? [];
        const self = attendees.find((a) => a.self);
        if (!self) {
            return { ok: false, error: 'You are not an attendee of this event.' };
        }
        self.responseStatus = response;
        const res = await client.calendar.events.patch({
            calendarId,
            eventId,
            sendUpdates: 'none',
            requestBody: { attendees },
        });
        await persistSyncedEvent(res.data, calendarId);
        triggerSync();
        return { ok: true, eventId };
    } catch (err) {
        console.error('[Calendar] Failed to update RSVP:', err);
        return toWriteError(err);
    }
}
