import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WorkDir } from '../config/config.js';
import { OutlookClientFactory } from './outlook-client-factory.js';
import { serviceLogger } from '../services/service_logger.js';
import { limitEventItems } from './limit_event_items.js';
import { createEvent } from '../events/producer.js';

// Outlook calendar sync. Mirrors sync_calendar.ts, but the crucial contract is
// the OUTPUT SHAPE: every consumer of calendar_sync/ (meeting prep scheduler,
// meeting notifications, thread classifier, meetings detector, home/sidebar/
// meetings views, deep links) parses raw Google Schema$Event JSON. So Graph
// events are mapped into that Google shape and written to the same directory —
// consumers need zero changes.

const SYNC_DIR = path.join(WorkDir, 'calendar_sync');
const SYNC_INTERVAL_MS = 30 * 1000;
const LOOKBACK_DAYS = 7;
const FORWARD_DAYS = 14;
const REQUIRED_SCOPE = 'https://graph.microsoft.com/Calendars.Read';
const MAX_EVENTS_IN_DIGEST = 50;
const MAX_DESCRIPTION_CHARS = 500;

interface GraphDateTimeTimeZone {
    dateTime?: string;
    timeZone?: string;
}

interface GraphAttendee {
    emailAddress?: { name?: string; address?: string };
    status?: { response?: string };
}

interface GraphCalendarEvent {
    id?: string;
    subject?: string;
    bodyPreview?: string;
    isAllDay?: boolean;
    isCancelled?: boolean;
    start?: GraphDateTimeTimeZone;
    end?: GraphDateTimeTimeZone;
    location?: { displayName?: string };
    attendees?: GraphAttendee[];
    organizer?: { emailAddress?: { name?: string; address?: string } };
    responseStatus?: { response?: string };
    webLink?: string;
    onlineMeeting?: { joinUrl?: string };
    onlineMeetingUrl?: string;
}

interface GraphListResponse<T> {
    value?: T[];
    '@odata.nextLink'?: string;
}

/** The Google-Event-shaped JSON consumers of calendar_sync/ expect. */
interface GoogleShapedEvent {
    id: string;
    /** The raw Graph event id (debugging / traceability). Not read by consumers. */
    outlookId?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: Array<{ email?: string; self?: boolean; responseStatus?: string }>;
    organizer?: { email?: string };
    status?: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

// --- Wake Signal for Immediate Sync Trigger ---
let wakeResolve: (() => void) | null = null;

export function triggerSync(): void {
    if (wakeResolve) {
        console.log('[Outlook Calendar] Triggered - waking up immediately');
        wakeResolve();
        wakeResolve = null;
    }
}

function interruptibleSleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            wakeResolve = null;
            resolve();
        }, ms);
        wakeResolve = () => {
            clearTimeout(timeout);
            resolve();
        };
    });
}

function shortHash(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function mapResponseStatus(response: string | undefined): string {
    switch (response) {
        case 'accepted':
        case 'organizer':
            return 'accepted';
        case 'declined':
            return 'declined';
        case 'tentativelyAccepted':
            return 'tentative';
        default:
            return 'needsAction';
    }
}

function mapDateTime(dt: GraphDateTimeTimeZone | undefined, isAllDay: boolean | undefined): { dateTime?: string; date?: string } | undefined {
    const raw = dt?.dateTime;
    if (!raw) return undefined;
    if (isAllDay) {
        return { date: raw.slice(0, 10) };
    }
    // Prefer: outlook.timezone="UTC" makes these UTC wall times; stamp the Z so
    // Date.parse treats them correctly (Graph omits the offset).
    const withZone = /Z|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`;
    return { dateTime: withZone };
}

function mapEvent(event: GraphCalendarEvent, accountEmail: string | null): GoogleShapedEvent | null {
    if (!event.id) return null;

    const joinUrl = event.onlineMeeting?.joinUrl || event.onlineMeetingUrl || undefined;
    const description = (event.bodyPreview ?? '').slice(0, MAX_DESCRIPTION_CHARS) || undefined;

    const attendees: GoogleShapedEvent['attendees'] = (event.attendees ?? [])
        .map((a) => {
            const email = a.emailAddress?.address?.toLowerCase();
            if (!email) return null;
            return {
                email,
                responseStatus: mapResponseStatus(a.status?.response),
                self: !!accountEmail && email === accountEmail,
            };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);

    // Declined-detection everywhere (meeting prep, notifications, renderer)
    // keys off attendees[].self.responseStatus — Graph omits the user from
    // attendees on some events, so synthesize a self entry from the event's
    // own responseStatus.
    if (accountEmail && !attendees.some((a) => a.self)) {
        attendees.push({
            email: accountEmail,
            self: true,
            responseStatus: mapResponseStatus(event.responseStatus?.response),
        });
    }

    return {
        id: shortHash(event.id),
        outlookId: event.id,
        summary: event.subject ?? undefined,
        description,
        location: event.location?.displayName || undefined,
        start: mapDateTime(event.start, event.isAllDay),
        end: mapDateTime(event.end, event.isAllDay),
        attendees: attendees.length > 0 ? attendees : undefined,
        organizer: event.organizer?.emailAddress?.address
            ? { email: event.organizer.emailAddress.address.toLowerCase() }
            : undefined,
        status: event.isCancelled ? 'cancelled' : 'confirmed',
        htmlLink: event.webLink ?? undefined,
        // Join button + meeting notifications resolve either of these.
        hangoutLink: joinUrl,
        conferenceData: joinUrl
            ? { entryPoints: [{ entryPointType: 'video', uri: joinUrl }] }
            : undefined,
    };
}

// --- Digest event (knowledge pipeline) ---

function formatEventBlock(event: GoogleShapedEvent, label: 'NEW' | 'UPDATED'): string {
    const time = `${event.start?.dateTime ?? event.start?.date ?? 'unknown'} → ${event.end?.dateTime ?? event.end?.date ?? 'unknown'}`;
    const attendeeEmails = (event.attendees ?? []).map((a) => a.email).filter(Boolean);
    return [
        `### [${label}] ${event.summary ?? '(no title)'}`,
        `**ID:** ${event.id}`,
        `**Time:** ${time}`,
        `**Organizer:** ${event.organizer?.email ?? 'unknown'}`,
        event.location ? `**Location:** ${event.location}` : '',
        attendeeEmails.length > 0 ? `**Attendees:** ${attendeeEmails.join(', ')}` : '',
        event.description ? `\n${event.description}` : '',
    ].filter(Boolean).join('\n');
}

async function publishCalendarSyncEvent(
    newEvents: GoogleShapedEvent[],
    updatedEvents: GoogleShapedEvent[],
    deletedFiles: string[],
): Promise<void> {
    if (newEvents.length === 0 && updatedEvents.length === 0 && deletedFiles.length === 0) return;
    const lines: string[] = [
        `# Calendar sync update`,
        ``,
        `${newEvents.length} new, ${updatedEvents.length} updated, ${deletedFiles.length} deleted.`,
        ``,
    ];
    const allChanges = [
        ...newEvents.map((e) => ({ event: e, label: 'NEW' as const })),
        ...updatedEvents.map((e) => ({ event: e, label: 'UPDATED' as const })),
    ];
    const shown = allChanges.slice(0, MAX_EVENTS_IN_DIGEST);
    if (shown.length > 0) {
        lines.push(`## Changed events`, ``);
        for (const { event, label } of shown) {
            lines.push(formatEventBlock(event, label), ``);
        }
        const hidden = allChanges.length - shown.length;
        if (hidden > 0) lines.push(`_…and ${hidden} more change(s) omitted from digest._`, ``);
    }
    if (deletedFiles.length > 0) {
        lines.push(`## Deleted event IDs`, ``);
        for (const id of deletedFiles.slice(0, MAX_EVENTS_IN_DIGEST)) lines.push(`- ${id}`);
        lines.push(``);
    }
    try {
        await createEvent({
            source: 'calendar',
            type: 'calendar.synced',
            createdAt: new Date().toISOString(),
            payload: lines.join('\n'),
        });
    } catch (err) {
        console.error('[Outlook Calendar] Failed to publish sync event:', err);
    }
}

// --- Sync logic ---

/**
 * Remove event files whose id is outside the current window set. Copied from
 * sync_calendar.ts — this also self-heals provider switches: the other
 * provider's event files are never in the current set, so they age out here.
 */
function cleanUpOldFiles(currentEventIds: Set<string>): string[] {
    if (!fs.existsSync(SYNC_DIR)) return [];
    const files = fs.readdirSync(SYNC_DIR);
    const deleted: string[] = [];
    for (const filename of files) {
        if (filename === 'sync_state.json' || filename === 'composio_state.json') continue;

        let eventId: string | null = null;
        if (filename.endsWith('.json')) {
            eventId = filename.replace('.json', '');
        } else if (filename.endsWith('.md')) {
            const parts = filename.split('_doc_');
            if (parts.length > 1) eventId = parts[0];
        }

        if (eventId && !currentEventIds.has(eventId)) {
            try {
                fs.unlinkSync(path.join(SYNC_DIR, filename));
                console.log(`[Outlook Calendar] Removed old/out-of-window file: ${filename}`);
                deleted.push(filename);
            } catch (e) {
                console.error(`[Outlook Calendar] Error deleting file ${filename}:`, e);
            }
        }
    }
    return deleted;
}

function saveEvent(event: GoogleShapedEvent): { changed: boolean; isNew: boolean; title: string } {
    const filePath = path.join(SYNC_DIR, `${event.id}.json`);
    const content = JSON.stringify(event, null, 2);
    const exists = fs.existsSync(filePath);
    try {
        if (exists) {
            const existing = fs.readFileSync(filePath, 'utf-8');
            if (existing === content) {
                return { changed: false, isNew: false, title: event.summary || event.id };
            }
        }
        fs.writeFileSync(filePath, content);
        return { changed: true, isNew: !exists, title: event.summary || event.id };
    } catch (e) {
        console.error(`[Outlook Calendar] Error saving event ${event.id}:`, e);
        return { changed: false, isNew: false, title: event.summary || event.id };
    }
}

async function getAccountEmail(): Promise<string | null> {
    try {
        const me = await OutlookClientFactory.graphFetch<{ mail?: string; userPrincipalName?: string }>(
            '/me?$select=mail,userPrincipalName',
        );
        return (me?.mail || me?.userPrincipalName || '').toLowerCase() || null;
    } catch {
        return null;
    }
}

async function syncCalendarWindow(): Promise<void> {
    const now = Date.now();
    const start = new Date(now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(now + FORWARD_DAYS * 24 * 60 * 60 * 1000).toISOString();

    console.log(`[Outlook Calendar] Syncing from ${start} to ${end}...`);

    let runId: string | null = null;
    let runStartedAt = 0;
    let newCount = 0;
    let updatedCount = 0;
    const changedTitles: string[] = [];
    const newEvents: GoogleShapedEvent[] = [];
    const updatedEvents: GoogleShapedEvent[] = [];

    const ensureRun = async () => {
        if (!runId) {
            const run = await serviceLogger.startRun({
                service: 'calendar',
                message: 'Syncing calendar',
                trigger: 'timer',
            });
            runId = run.runId;
            runStartedAt = run.startedAt;
        }
    };

    try {
        const accountEmail = await getAccountEmail();

        const events: GraphCalendarEvent[] = [];
        let url: string | undefined =
            `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=100`;
        while (url) {
            const page: GraphListResponse<GraphCalendarEvent> = await OutlookClientFactory.graphFetch<GraphListResponse<GraphCalendarEvent>>(
                url,
                { headers: { Prefer: 'outlook.timezone="UTC"' } },
            );
            events.push(...(page.value ?? []));
            url = page['@odata.nextLink'];
        }

        const currentEventIds = new Set<string>();
        for (const graphEvent of events) {
            const mapped = mapEvent(graphEvent, accountEmail);
            if (!mapped) continue;
            currentEventIds.add(mapped.id);
            const result = saveEvent(mapped);
            if (result.changed) {
                await ensureRun();
                changedTitles.push(result.title);
                if (result.isNew) {
                    newCount++;
                    newEvents.push(mapped);
                } else {
                    updatedCount++;
                    updatedEvents.push(mapped);
                }
            }
        }

        const deletedFiles = cleanUpOldFiles(currentEventIds);
        if (deletedFiles.length > 0) await ensureRun();

        await publishCalendarSyncEvent(newEvents, updatedEvents, deletedFiles);

        if (runId) {
            const totalChanges = newCount + updatedCount + deletedFiles.length;
            const limitedTitles = limitEventItems(changedTitles);
            await serviceLogger.log({
                type: 'changes_identified',
                service: 'calendar',
                runId,
                level: 'info',
                message: `Calendar updates: ${totalChanges} change${totalChanges === 1 ? '' : 's'}`,
                counts: {
                    newEvents: newCount,
                    updatedEvents: updatedCount,
                    deletedFiles: deletedFiles.length,
                },
                items: limitedTitles.items,
                truncated: limitedTitles.truncated,
            });
            await serviceLogger.log({
                type: 'run_complete',
                service: 'calendar',
                runId,
                level: 'info',
                message: `Calendar sync complete: ${totalChanges} change${totalChanges === 1 ? '' : 's'}`,
                durationMs: Date.now() - runStartedAt,
                outcome: 'ok',
                summary: {
                    newEvents: newCount,
                    updatedEvents: updatedCount,
                    deletedFiles: deletedFiles.length,
                },
            });
        }
    } catch (error) {
        console.error('[Outlook Calendar] An error occurred during calendar sync:', error);
        if (runId) {
            await serviceLogger.log({
                type: 'error',
                service: 'calendar',
                runId,
                level: 'error',
                message: 'Calendar sync error',
                error: error instanceof Error ? error.message : String(error),
            });
            await serviceLogger.log({
                type: 'run_complete',
                service: 'calendar',
                runId,
                level: 'error',
                message: 'Calendar sync failed',
                durationMs: Date.now() - runStartedAt,
                outcome: 'error',
            });
        }
        throw error;
    }
}

async function performSync(): Promise<void> {
    try {
        if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });
        if (!(await OutlookClientFactory.getAccessToken())) {
            console.log('[Outlook Calendar] No valid OAuth credentials available.');
            return;
        }
        await syncCalendarWindow();
        console.log('[Outlook Calendar] Sync completed.');
    } catch (error) {
        console.error('[Outlook Calendar] Error during sync:', error);
    }
}

export async function init() {
    console.log('Starting Outlook Calendar Sync (TS)...');
    console.log(`Will sync every ${SYNC_INTERVAL_MS / 1000} seconds.`);

    while (true) {
        try {
            const hasCredentials = await OutlookClientFactory.hasValidCredentials(REQUIRED_SCOPE);
            if (!hasCredentials) {
                console.log('Microsoft OAuth credentials not available or missing Calendars.Read scope. Sleeping...');
            } else {
                await performSync();
            }
        } catch (error) {
            console.error('[Outlook Calendar] Error in main loop:', error);
        }

        await interruptibleSleep(SYNC_INTERVAL_MS);
    }
}
