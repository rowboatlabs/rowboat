import fsSync from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { createTask, listTasks } from '../background-tasks/fileops.js';
import { ensurePreferencesFile, PREFS_REL_PATH, FEEDBACK_REL_PATH } from './planner-memory.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';

const log = new PrefixLogger('Todo:PlannerTask');

// ---------------------------------------------------------------------------
// The morning planner ships as a background task, not a subsystem: its
// schedule and editorial doctrine live in a task spec the user can open,
// edit, pause, or delete in the Background agents view. Seeded exactly once
// — a deleted planner stays deleted.
// ---------------------------------------------------------------------------

const SEEDED_MARKER = path.join(WorkDir, 'todo', '.planner-seeded');

const PLANNER_NAME = 'Morning planner';

const PLANNER_INSTRUCTIONS = `Each morning, propose a FEW high-signal to-do items for the user's day — or none. This is ACTION mode: your side-effect is the todo-propose tool; journal one line about what you proposed (or that nothing was needed).

Process, in order:

1. Read ${PREFS_REL_PATH}. "Your rules" outrank "Learned"; both outrank the defaults below.
2. Read ${FEEDBACK_REL_PATH} — recent outcomes are examples of the user's taste: 'dismissed'/'taught' items were unwanted (never propose anything similar); 'ran'/'kept' items were valued (more like those).
3. Read todo.md and this month's todo/archive file. Never duplicate an existing or recently archived item. If an existing item already covers a matter, do nothing about it.
4. Hunt for candidates ONLY in these sources, ranked, using the last ~3 days of synced data (gmail_sync/, calendar_sync/, granola_sync/, fireflies_sync/ — read specific recent files; keep any grep narrow):
   1) Commitments the user made ("I'll send X by Friday" in sent mail or meeting transcripts) — the gold vein.
   2) Explicit deadlines approaching.
   3) Important threads aging without the user's reply for 2+ days (important = investors, customers, candidates, team — check knowledge/ for who matters).
   4) Waiting-on-others gone quiet for 3+ days (propose a chase).
5. NEVER propose: routine email replies (the Email surface already pre-drafts those), meetings (the calendar shows them), anything an existing background agent already handles, newsletters or automated notifications, or restatements of information with no action.
6. Cap: at most 3 proposals. One or two great items beat three decent ones. ZERO is a good outcome — if nothing clears the bar, end quietly with a "nothing needed" summary. The test for every candidate: does putting this on the list change what the user does today?
7. Phrase each item the way the user would write it — short, concrete, starting with a verb. Include @rowboat in the text ONLY to offer internal prep you could do yourself (research, outline, compile, summarize — never anything outward-facing); it waits for the user's go either way.
8. Report via todo-propose — your only pen on the list. Never use todo-add, never edit todo.md directly, never start runs.`;

/**
 * Seed the planner task once. Existing users get it on next boot; a user
 * who deletes or pauses it is respected forever after.
 */
export async function ensureMorningPlannerTask(): Promise<void> {
    try {
        if (fsSync.existsSync(SEEDED_MARKER)) return;
        await ensurePreferencesFile();

        // If anything resembling a planner already exists (user-made or from
        // a previous install), just mark and stand down.
        const { items } = await listTasks({});
        const exists = items.some(t => t.name.toLowerCase().includes('planner') || t.slug.includes('planner'));
        if (!exists) {
            await createTask({
                name: PLANNER_NAME,
                instructions: PLANNER_INSTRUCTIONS,
                triggers: { windows: [{ startTime: '06:30', endTime: '09:30' }] },
            });
            log.log('seeded the morning planner background task');
        }
        const dir = path.dirname(SEEDED_MARKER);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        fsSync.writeFileSync(SEEDED_MARKER, new Date().toISOString());
    } catch (err) {
        // Seeding is best-effort — never let it disturb startup.
        log.log(`seeding skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
}
