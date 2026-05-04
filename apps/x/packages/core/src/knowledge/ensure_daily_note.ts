import path from 'path';
import fs from 'fs';
import { stringify as stringifyYaml } from 'yaml';
import { TrackBlockSchema } from '@x/shared/dist/track-block.js';
import { WorkDir } from '../config/config.js';
import z from 'zod';

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');
const DAILY_NOTE_PATH = path.join(KNOWLEDGE_DIR, 'Today.md');

interface Section {
    heading: string;
    track: z.infer<typeof TrackBlockSchema>;
}

const SECTIONS: Section[] = [
    {
        heading: '## Up Next',
        track: {
            trackId: 'up-next',
            icon: 'clock',
            instruction:
`Write 1-3 sentences of plain markdown giving the user a shoulder-tap about what's next on their calendar today.

This section refreshes on calendar changes, not on a clock tick — do NOT promise live minute countdowns. Frame urgency in buckets based on the event's start time relative to now:
- Start time is in the past or within roughly half an hour → imminent: name the meeting and say it's starting soon (e.g. "Standup is starting — join link in the Calendar section below.").
- Start time is later this morning or this afternoon → upcoming: name the meeting and roughly when (e.g. "Design review later this morning." / "1:1 with Sam this afternoon.").
- Start time is several hours out or nothing before then → focus block: frame the gap (e.g. "Next up is the all-hands at 3pm — good long focus block until then.").

Use the event's start time of day ("at 3pm", "this afternoon") rather than a countdown ("in 40 minutes"). Countdowns go stale between syncs.

Data: read today's events from calendar_sync/ (workspace-readdir, then workspace-readFile each .json file). Filter to events whose start datetime is today and hasn't ended yet — for finding the next event, pick the earliest upcoming one; if all have passed, treat as clear.

If you find quick context in knowledge/ that's genuinely useful, add one short clause ("Ramnique pushed the OAuth PR yesterday — might come up"). Use workspace-grep / workspace-readFile conservatively; don't stall on deep research.

If nothing remains today, output exactly: Clear for the rest of the day.

Plain markdown prose only — no calendar block, no email block, no headings.`,
            eventMatchCriteria:
`Calendar event changes affecting today — new meetings, reschedules, cancellations, meetings starting soon. Skip changes to events on other days.`,
            active: true,
        },
    },
    {
        heading: '## Calendar',
        track: {
            trackId: 'calendar',
            icon: 'calendar-days',
            instruction:
`Emit today's meetings as a calendar block titled "Today's Meetings".

Data: read calendar_sync/ via workspace-readdir, then workspace-readFile each .json event file. Filter to events occurring today. After 10am local time, drop meetings that have already ended — only include meetings that haven't ended yet.

This section refreshes on calendar changes, not on a clock tick — the "drop ended meetings" rule applies on each refresh, so an ended meeting disappears the next time any calendar event changes (not exactly on the clock hour). That's fine.

Always emit the calendar block, even when there are no remaining events (in that case use events: [] and showJoinButton: false). Set showJoinButton: true whenever any event has a conferenceLink.

After the block, you MAY add one short markdown line per event giving useful prep context pulled from knowledge/ ("Design review: last week we agreed to revisit the type-picker UX."). Keep it tight — one line each, only when meaningful. Skip routine/recurring meetings.`,
            eventMatchCriteria:
`Calendar event changes affecting today — additions, updates, cancellations, reschedules.`,
            active: true,
        },
    },
    {
        heading: '## Emails',
        track: {
            trackId: 'emails',
            icon: 'mail',
            instruction:
`Maintain a digest of email threads worth the user's attention today, rendered as zero or more email blocks (one per thread).

Event-driven path (primary): the agent message will include a "Gmail sync update" digest payload describing one or more freshly-synced threads from a single sync run. The digest lists each thread with its subject, sender, date, threadId, and body. Iterate over every thread in the payload and decide per thread whether it warrants surfacing. Skip marketing, auto-notifications, closed-out threads, and other low-signal mail. For threads that are attention-worthy, integrate them into the existing digest: add a new email block for a new threadId, or update the existing block if the threadId is already shown. If NONE of the threads in the payload are attention-worthy, skip the update — do NOT call update-track-content. Emit at most one update-track-content call that covers the full set of changes from this event.

Manual path (fallback): with no event payload, scan gmail_sync/ via workspace-readdir (skip sync_state.json and attachments/). Read threads with workspace-readFile. Prioritize threads whose frontmatter action field is "reply" or "respond", plus other high-signal recent threads.

Each email block should include threadId, subject, from, date, summary, and latest_email. For threads that need a reply, add a draft_response written in the user's voice — direct, informal, no fluff. For FYI threads, omit draft_response.

If there is genuinely nothing to surface, output the single line: No new emails.

Do NOT re-list threads the user has already seen unless their state changed (new reply, status flip).`,
            eventMatchCriteria:
`New or updated email threads that may need the user's attention today — drafts to send, replies to write, urgent requests, time-sensitive info. Skip marketing, newsletters, auto-notifications, and chatter on closed threads.`,
            active: true,
        },
    },
    {
        heading: '## What You Missed',
        track: {
            trackId: 'what-you-missed',
            icon: 'history',
            instruction:
`Short markdown summary of what happened yesterday that matters this morning.

Data sources:
- knowledge/Meetings/<source>/<YYYY-MM-DD>/meeting-<timestamp>.md — use workspace-readdir with recursive: true on knowledge/Meetings, filter for folders matching yesterday's date (compute yesterday from the current local date), read each matching file. Pull out: decisions made, action items assigned, blockers raised, commitments.
- gmail_sync/ — skim for threads from yesterday that went unresolved or still need a reply.

Skip recurring/routine events (standups, weekly syncs) unless something unusual happened in them.

Write concise markdown — a few bullets or a short paragraph, whichever reads better. Lead with anything that shifts the user's priorities today.

If nothing notable happened, output exactly: Quiet day yesterday — nothing to flag.

Do NOT manufacture content to fill the section.`,
            active: true,
            schedule: {
                type: 'cron',
                expression: '0 7 * * *',
            },
        },
    },
    {
        heading: '## Today\'s Priorities',
        track: {
            trackId: 'priorities',
            icon: 'list-todo',
            instruction:
`Ranked markdown list of the real, actionable items the user should focus on today.

Data sources:
- Yesterday's meeting notes under knowledge/Meetings/<source>/<YYYY-MM-DD>/ — action items assigned to the user are often the most important source.
- knowledge/ — use workspace-grep for "- [ ]" checkboxes, explicit action items, deadlines, follow-ups.
- Optional: workspace-readFile on knowledge/Today.md for the current "What You Missed" section — useful for alignment.

Rules:
- Do NOT list calendar events as tasks — they're already in the Calendar section.
- Do NOT list trivial admin (filing small invoices, archiving spam).
- Rank by importance. Lead with the most critical item. Note time-sensitivity when it exists ("needs to go out before the 3pm review").
- Add a brief reason for each item when it's not self-evident.

If nothing genuinely needs attention, output exactly: No pressing tasks today — good day to make progress on bigger items.

Do NOT invent busywork.`,
            active: true,
            schedule: {
                type: 'cron',
                expression: '30 7 * * *',
            },
        },
    },
];

function buildDailyNoteContent(): string {
    const parts: string[] = ['# Today', ''];
    for (const { heading, track } of SECTIONS) {
        const yaml = stringifyYaml(track, { lineWidth: 0, blockQuote: 'literal' }).trimEnd();
        parts.push(
            heading,
            '',
            '```track',
            yaml,
            '```',
            '',
            `<!--track-target:${track.trackId}-->`,
            `<!--/track-target:${track.trackId}-->`,
            '',
        );
    }
    return parts.join('\n');
}

function migrateEmojiHeadings(): void {
    if (!fs.existsSync(DAILY_NOTE_PATH)) return;
    let content = fs.readFileSync(DAILY_NOTE_PATH, 'utf-8');
    const original = content;
    const replacements: [string, string][] = [
        ['## ⏱ Up Next', '## Up Next'],
        ['## 📅 Calendar', '## Calendar'],
        ['## 📧 Emails', '## Emails'],
        ['## 📰 What You Missed', '## What You Missed'],
        ["## ✅ Today's Priorities", "## Today's Priorities"],
    ];
    for (const [from, to] of replacements) {
        content = content.split(from).join(to);
    }
    if (content !== original) {
        fs.writeFileSync(DAILY_NOTE_PATH, content, 'utf-8');
        console.log('[DailyNote] Migrated emoji headings');
    }
}

export function ensureDailyNote(): void {
    migrateEmojiHeadings();
    if (fs.existsSync(DAILY_NOTE_PATH)) return;
    fs.writeFileSync(DAILY_NOTE_PATH, buildDailyNoteContent(), 'utf-8');
    console.log('[DailyNote] Created today.md');
}
