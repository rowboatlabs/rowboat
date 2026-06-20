import { createEvent } from '../events/producer.js';

// Emitted when a meeting note/transcript is first written to disk (Fireflies,
// Granola, …). This is the natural "the meeting is over and we have content"
// signal — unlike a calendar end-time, the notes actually exist now. Coding
// background tasks subscribe to it (via eventMatchCriteria) to scan freshly
// landed notes for actionable coding items.
//
// Fire ONCE per meeting (on first write), not on every re-sync/edit, so a note
// that keeps updating doesn't re-trigger downstream agents.
export async function publishMeetingNotesReadyEvent(args: {
    source: string;
    title: string;
    filePath: string;
    when?: string;
}): Promise<void> {
    const { source, title, filePath, when } = args;
    try {
        await createEvent({
            source,
            type: 'meeting.notes_ready',
            createdAt: new Date().toISOString(),
            payload: [
                `# Meeting notes ready`,
                ``,
                `**Title:** ${title}`,
                when ? `**When:** ${when}` : ``,
                `**Source:** ${source}`,
                `**Notes file:** \`${filePath}\``,
                ``,
                `The full meeting notes/transcript are at the path above. They may contain coding action items (bugs to fix, features to build, changes requested). Read the file to decide whether to act.`,
            ].filter(Boolean).join('\n'),
        });
    } catch (err) {
        console.error(`[${source}] Failed to publish meeting.notes_ready event:`, err);
    }
}
