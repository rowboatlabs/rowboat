import fs from 'fs';
import path from 'path';
import { generateText } from 'ai';
import container from '../di/container.js';
import type { IModelConfigRepo } from '../models/repo.js';
import { createProvider } from '../models/models.js';
import { isSignedIn } from '../account/account.js';
import { getGatewayProvider } from '../models/gateway.js';
import { WorkDir } from '../config/config.js';

const CALENDAR_SYNC_DIR = path.join(WorkDir, 'calendar_sync');

const SYSTEM_PROMPT = `You are a meeting notes assistant. Given a raw meeting transcript and a list of calendar events from around the same time, create concise, well-organized meeting notes.

## Calendar matching
You will be given the transcript (with a timestamp of when recording started) and recent calendar events with their titles, times, and attendees. If a calendar event clearly matches this meeting (overlapping time + content aligns), then:
- Do NOT output a title or heading — the title is already set by the caller.
- ONLY use names from the calendar event attendee list. Do NOT introduce names that are not in the attendee list — any unrecognized names in the transcript are transcription errors.
- Replace generic speaker labels ("Speaker 0", "Speaker 1", "System audio") with actual attendee names from the list, but ONLY if you have HIGH CONFIDENCE about which speaker is which based on the discussion content. If unsure, use "They" instead of "Speaker 0" etc.
- "You" in the transcript is the local user — if the calendar event has an organizer or you can identify who "You" is from context, use their name.

If no calendar event matches with high confidence, or if no calendar events are provided, use "They" for all non-"You" speakers.

## Format rules
- Do NOT output a title or top-level heading (# or ##). Start directly with section content.
- Use ### for section headers that group related discussion topics
- Section headers should be in sentence case (e.g. "### Onboarding flow status"), NOT Title Case
- Use bullet points with sub-bullets for details
- Include a "### Action items" section at the end if any were discussed
- Focus on decisions, key discussions, and takeaways — not verbatim quotes
- Attribute statements to speakers when relevant
- Keep it concise — the notes should be much shorter than the transcript
- Output markdown only, no preamble or explanation`;

/**
 * Load recent calendar events from the calendar_sync directory.
 * Returns a formatted string of events for the LLM prompt.
 */
function loadRecentCalendarEvents(meetingTime: string): string {
    try {
        if (!fs.existsSync(CALENDAR_SYNC_DIR)) return '';

        const files = fs.readdirSync(CALENDAR_SYNC_DIR).filter(f => f.endsWith('.json') && f !== 'sync_state.json' && f !== 'composio_state.json');
        if (files.length === 0) return '';

        const meetingDate = new Date(meetingTime);
        // Only consider events within ±3 hours of the meeting
        const windowMs = 3 * 60 * 60 * 1000;

        const relevantEvents: string[] = [];

        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(CALENDAR_SYNC_DIR, file), 'utf-8');
                const event = JSON.parse(content);

                const startTime = event.start?.dateTime || event.start?.date;
                if (!startTime) continue;

                const eventStart = new Date(startTime);
                if (Math.abs(eventStart.getTime() - meetingDate.getTime()) > windowMs) continue;

                const attendees = (event.attendees || [])
                    .map((a: { displayName?: string; email?: string }) => a.displayName || a.email)
                    .filter(Boolean)
                    .join(', ');

                const endTime = event.end?.dateTime || event.end?.date || '';
                const organizer = event.organizer?.displayName || event.organizer?.email || '';

                relevantEvents.push(
                    `- Title: ${event.summary || 'Untitled'}\n` +
                    `  Start: ${startTime}\n` +
                    `  End: ${endTime}\n` +
                    `  Organizer: ${organizer}\n` +
                    `  Attendees: ${attendees || 'none listed'}`
                );
            } catch {
                // Skip malformed files
            }
        }

        if (relevantEvents.length === 0) return '';
        return `\n\n## Calendar events around this time\n\n${relevantEvents.join('\n\n')}`;
    } catch {
        return '';
    }
}

/**
 * Load a specific calendar event from the calendar_sync directory using
 * the calendar_event JSON stored in the meeting note frontmatter.
 * If a `source` field is present, loads the full event file for richer
 * details (attendees, organizer, etc.).
 */
function loadCalendarEventContext(calendarEventJson: string): string {
    try {
        const meta = JSON.parse(calendarEventJson) as {
            summary?: string;
            start?: string;
            end?: string;
            location?: string;
            htmlLink?: string;
            conferenceLink?: string;
            source?: string;
        };

        // Try to load the full event from source file for attendee info
        let attendees = '';
        let organizer = '';
        if (meta.source) {
            try {
                const fullPath = path.join(WorkDir, meta.source);
                if (fs.existsSync(fullPath)) {
                    const event = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                    attendees = (event.attendees || [])
                        .map((a: { displayName?: string; email?: string }) => a.displayName || a.email)
                        .filter(Boolean)
                        .join(', ');
                    organizer = event.organizer?.displayName || event.organizer?.email || '';
                }
            } catch {
                // Fall through — use metadata only
            }
        }

        const eventStr =
            `- Title: ${meta.summary || 'Untitled'}\n` +
            `  Start: ${meta.start || ''}\n` +
            `  End: ${meta.end || ''}\n` +
            `  Organizer: ${organizer || 'unknown'}\n` +
            `  Attendees: ${attendees || 'none listed'}`;

        return `\n\n## Calendar event for this meeting\n\n${eventStr}`;
    } catch {
        return '';
    }
}

export async function summarizeMeeting(transcript: string, meetingStartTime?: string, calendarEventJson?: string): Promise<string> {
    const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
    const config = await repo.getConfig();
    const signedIn = await isSignedIn();
    const provider = signedIn
        ? await getGatewayProvider()
        : createProvider(config.provider);
    const modelId = config.meetingNotesModel
        || (signedIn ? "gpt-5.4" : config.model);
    const model = provider.languageModel(modelId);

    // If a specific calendar event was linked, use it directly.
    // Otherwise fall back to scanning events within ±3 hours.
    let calendarContext: string;
    if (calendarEventJson) {
        calendarContext = loadCalendarEventContext(calendarEventJson);
    } else {
        calendarContext = meetingStartTime ? loadRecentCalendarEvents(meetingStartTime) : '';
    }

    const prompt = `Meeting recording started at: ${meetingStartTime || 'unknown'}\n\n${transcript}${calendarContext}`;

    const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt,
    });

    return result.text.trim();
}
