import fs from 'fs';
import path from 'path';
import { generateText } from 'ai';
import container from '../di/container.js';
import type { IModelConfigRepo } from '../models/repo.js';
import { createProvider } from '../models/models.js';
import { WorkDir } from '../config/config.js';

const CALENDAR_SYNC_DIR = path.join(WorkDir, 'calendar_sync');

const SYSTEM_PROMPT = `You are a meeting notes assistant. Given a raw meeting transcript and a list of calendar events from around the same time, create concise, well-organized meeting notes.

## Calendar matching
You will be given the transcript (with a timestamp of when recording started) and recent calendar events with their titles, times, and attendees. If a calendar event clearly matches this meeting (overlapping time + content aligns), then:
- Use the calendar event title as the meeting title (output it as the first line: "## <event title>")
- Replace generic speaker labels ("Speaker 0", "Speaker 1", "System audio") with actual attendee names, but ONLY if you have HIGH CONFIDENCE about which speaker is which based on the discussion content. If unsure, use "They" instead of "Speaker 0" etc.
- "You" in the transcript is the local user — if the calendar event has an organizer or you can identify who "You" is from context, use their name.

If no calendar event matches with high confidence, or if no calendar events are provided, skip the title line and use "They" for all non-"You" speakers.

## Format rules
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

export async function summarizeMeeting(transcript: string, meetingStartTime?: string): Promise<string> {
    const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
    const config = await repo.getConfig();
    const provider = createProvider(config.provider);
    const model = provider.languageModel(config.model);

    const calendarContext = meetingStartTime ? loadRecentCalendarEvents(meetingStartTime) : '';

    const prompt = `Meeting recording started at: ${meetingStartTime || 'unknown'}\n\n${transcript}${calendarContext}`;

    const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt,
    });

    return result.text.trim();
}
