import path from 'path';
import fs from 'fs';
import { stringify as stringifyYaml } from 'yaml';
import { LiveNoteSchema } from '@x/shared/dist/live-note.js';
import { WorkDir } from '../config/config.js';
import { splitFrontmatter } from '../application/lib/parse-frontmatter.js';
import z from 'zod';

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');
const DAILY_NOTE_PATH = path.join(KNOWLEDGE_DIR, 'Today.md');

// Bump this whenever the canonical Today.md template changes (objective,
// triggers, default body, etc.). On app start, ensureDailyNote() compares the
// on-disk `templateVersion` against this constant — if older or missing, the
// existing file is renamed to Today.md.bkp.<ISO-stamp> and replaced with the
// new template. v2 is the live-note rewrite (single objective, no `track:`).
const CANONICAL_DAILY_NOTE_VERSION = 2;

const TODAY_LIVE_NOTE: z.infer<typeof LiveNoteSchema> = {
    objective:
`Keep Today.md current as a living dashboard for the day. Maintain these H2 sections in this order:

1. **Overview** — 2-3 prose sentences greeting the user and reading the day (warm, confident tone — use today's calendar density from \`calendar_sync/\` and the existing Priorities section if populated). Below the prose, render exactly one \`image\` block fitting the mood (use weather + calendar density as cues). Source the image via web-search from a permissive host (Unsplash/Pexels/Pixabay/Wikimedia, direct .jpg/.png/.webp URLs only); fall back to NASA APOD (https://apod.nasa.gov/apod/astropix.html) if nothing suitable. Keep the image **wide / low-height**. Skip refreshing this section if its content is still suitable and less than 24h old.

2. **Calendar** — today's meetings as a single \`calendar\` block titled "Today's Meetings". Read \`calendar_sync/\` via \`workspace-readdir\` → \`workspace-readFile\` each \`.json\`. Filter to today; after 10am drop meetings that have already ended. Always emit the block (use \`events: []\` when empty). Set \`showJoinButton: true\` if any event has a \`conferenceLink\`.

3. **Emails** — a digest of email threads worth attention today, as a **single** fenced \`emails\` block (plural — never individual \`email\` blocks per thread). Body shape: \`{"title":"Today's Emails","emails":[...]}\`. Each entry: \`threadId\`, \`subject\`, \`from\`, \`date\`, \`summary\`, \`latest_email\`. For threads needing a reply, add \`draft_response\` written in the user's voice — direct, informal, no fluff. For FYI threads, omit \`draft_response\`. Skip marketing, auto-notifications, and closed threads. Without an event payload, scan \`gmail_sync/\` (skip \`sync_state.json\` and \`attachments/\`), prioritising threads where frontmatter \`action = "reply"\` or \`"respond"\`. With an event payload, integrate qualifying new threads into the existing digest (add a new entry for a new threadId; update the existing entry if shown). Don't re-list threads the user has already seen unless their state changed. If nothing qualifies: "No new emails."

4. **What you missed** — a short markdown summary of yesterday's meetings + emails that matter this morning. Pull decisions / action items from \`knowledge/Meetings/<source>/<yesterday>/\` (\`workspace-readdir\` recursive on \`knowledge/Meetings\`, filter folders matching yesterday's date, read each file). Skim \`gmail_sync/\` for unresolved threads. Skip recurring/routine events. If nothing notable: "Quiet day yesterday — nothing to flag."

5. **Priorities** — a ranked markdown list of actionable items the user should focus on today. Sources: yesterday's meeting action items (\`knowledge/Meetings/<source>/<yesterday>/\`), open follow-ups across \`knowledge/\` (\`workspace-grep\` for "- [ ]"), the **What you missed** section above. Don't list calendar events as tasks (Calendar section has them) and don't list trivial admin. Rank by importance; note time-sensitivity inline. With an event payload (gmail or calendar), only re-emit the full list if the event genuinely shifts priorities (urgent reply, deadline arrival, blocking reschedule). If nothing pressing: "No pressing tasks today — good day to make progress on bigger items."

Treat the note as a coherent artifact. Make small, incremental edits — one section at a time — rather than rewriting the whole body each run.`,
    active: true,
    triggers: {
        // Three windows give the user a fresh dashboard morning, midday, and
        // post-lunch even with no calendar/email events landing in between.
        windows: [
            { startTime: '08:00', endTime: '12:00' },
            { startTime: '12:00', endTime: '15:00' },
            { startTime: '15:00', endTime: '18:00' },
        ],
        // Event-driven updates handle in-day shifts (new email threads worth
        // attention, calendar reshuffles, urgent escalations).
        eventMatchCriteria:
`Email or calendar events that may shift today's dashboard: new or updated email threads needing the user's attention, urgent reply requests, deadline-bearing items, escalations from people the user cares about, calendar additions/cancellations/reschedules affecting today, or anything that changes the user's near-term priorities. Skip marketing, newsletters, auto-notifications, and chatter on closed threads.`,
    },
};

function buildDailyNoteContent(body: string = '# Today\n'): string {
    const fm = stringifyYaml(
        { templateVersion: CANONICAL_DAILY_NOTE_VERSION, live: TODAY_LIVE_NOTE },
        { lineWidth: 0, blockQuote: 'literal' },
    ).trimEnd();
    return `---\n${fm}\n---\n${body}`;
}

function readCurrentTemplateVersion(): number {
    if (!fs.existsSync(DAILY_NOTE_PATH)) return -1;
    const raw = fs.readFileSync(DAILY_NOTE_PATH, 'utf-8');
    const { frontmatter } = splitFrontmatter(raw);
    const v = frontmatter.templateVersion;
    return typeof v === 'number' ? v : 0;
}

export function ensureDailyNote(): void {
    // Fresh install — no existing file.
    if (!fs.existsSync(DAILY_NOTE_PATH)) {
        fs.writeFileSync(DAILY_NOTE_PATH, buildDailyNoteContent(), 'utf-8');
        console.log(`[DailyNote] Created Today.md (v${CANONICAL_DAILY_NOTE_VERSION})`);
        return;
    }

    // Up-to-date — nothing to do.
    const currentVersion = readCurrentTemplateVersion();
    if (currentVersion >= CANONICAL_DAILY_NOTE_VERSION) return;

    // Migrate aggressively: rename existing → backup, write a fresh canonical
    // template (no body carried over). Today.md is a flagship demo whose
    // content is meant to be regenerated by the live-note agent anyway —
    // preserving the old body just leaves orphan sections behind on
    // restructure. The .bkp file is the recovery path; its name doesn't end
    // in `.md`, so the scheduler and event router naturally skip it. Pre-v2
    // notes (with the old `track:` array) are caught by this same path.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${DAILY_NOTE_PATH}.bkp.${stamp}`;
    fs.renameSync(DAILY_NOTE_PATH, backupPath);
    fs.writeFileSync(DAILY_NOTE_PATH, buildDailyNoteContent(), 'utf-8');
    console.log(
        `[DailyNote] Migrated v${currentVersion} → v${CANONICAL_DAILY_NOTE_VERSION}; ` +
        `previous version saved to ${backupPath}`,
    );
}
