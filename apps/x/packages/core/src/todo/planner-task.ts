import fsSync from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { createTask, listTasks, patchTask } from '../background-tasks/fileops.js';
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
   3) Important email threads aging without the user's reply for 2+ days.
   4) Waiting-on-others gone quiet for 3+ days (propose a chase).
5. THE EMAIL GATE: every gmail_sync/*.md file carries an \`importance:\` line in its frontmatter, stamped by the app's classifier (which learns from the user's own corrections). Only threads stamped \`importance: important\` may produce candidates — find them with a narrow grep for "importance: important". Threads stamped \`importance: other\` and unstamped files are newsletters, notifications, and noise by definition: never read them for candidates, no matter how actionable a subject line looks.
6. NEVER propose: routine email replies (the Email surface already pre-drafts those), meetings (the calendar shows them), anything an existing background agent already handles, newsletters or automated notifications, or restatements of information with no action.
7. Cap: at most 3 proposals. One or two great items beat three decent ones. ZERO is a good outcome — if nothing clears the bar, end quietly with a "nothing needed" summary. The test for every candidate: does putting this on the list change what the user does today?
8. Phrase each item the way the user would write it — short, concrete, starting with a verb. Include @rowboat in the text ONLY to offer internal prep you could do yourself (research, outline, compile, summarize — never anything outward-facing); it waits for the user's go either way.
9. Submit via todo-propose — your only pen. Proposals land in a suggestion tray on the home surface where the user accepts or declines each one; nothing touches the list or runs without their accept. Never use todo-add, never edit todo.md directly, never start runs.`;

// Prior seeded doctrines, verbatim. A task whose instructions exactly match
// one of these was never edited by the user, so boot upgrades it to the
// current text; anything else is the user's and is never touched.
const PLANNER_PRIOR_COMMON = `Each morning, propose a FEW high-signal to-do items for the user's day — or none. This is ACTION mode: your side-effect is the todo-propose tool; journal one line about what you proposed (or that nothing was needed).

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
7. Phrase each item the way the user would write it — short, concrete, starting with a verb. Include @rowboat in the text ONLY to offer internal prep you could do yourself (research, outline, compile, summarize — never anything outward-facing); it waits for the user's go either way.`;

const PLANNER_INSTRUCTIONS_PRIOR: string[] = [
    `${PLANNER_PRIOR_COMMON}
8. Report via todo-propose — your only pen on the list. Never use todo-add, never edit todo.md directly, never start runs.`,
    `${PLANNER_PRIOR_COMMON}
8. Submit via todo-propose — your only pen. Proposals land in a suggestion tray on the home surface where the user accepts or declines each one; nothing touches the list or runs without their accept. Never use todo-add, never edit todo.md directly, never start runs.`,
];

// Frequency presets the Home surface offers — each maps to daily windows.
export type PlannerFrequency = 'morning' | 'twice' | 'thrice';

const FREQUENCY_WINDOWS: Record<PlannerFrequency, { startTime: string; endTime: string }[]> = {
    morning: [{ startTime: '06:30', endTime: '09:30' }],
    twice: [
        { startTime: '06:30', endTime: '09:30' },
        { startTime: '13:00', endTime: '15:00' },
    ],
    thrice: [
        { startTime: '06:30', endTime: '09:30' },
        { startTime: '13:00', endTime: '15:00' },
        { startTime: '17:30', endTime: '19:30' },
    ],
};

async function findPlannerSlug(): Promise<string | null> {
    const { items } = await listTasks({});
    const hit = items.find(t => t.slug.includes('planner') || t.name.toLowerCase().includes('planner'));
    return hit?.slug ?? null;
}

export interface PlannerConfig {
    slug: string | null;
    active: boolean;
    frequency: PlannerFrequency;
}

/** The Home surface's view of the planner: on/off + how often. */
export async function getPlannerConfig(): Promise<PlannerConfig> {
    const slug = await findPlannerSlug();
    if (!slug) return { slug: null, active: false, frequency: 'morning' };
    const { items } = await listTasks({});
    const task = items.find(t => t.slug === slug);
    const windows = task?.triggers?.windows?.length ?? 1;
    const frequency: PlannerFrequency = windows >= 3 ? 'thrice' : windows === 2 ? 'twice' : 'morning';
    return { slug, active: task?.active ?? false, frequency };
}

export async function setPlannerConfig(input: { active?: boolean; frequency?: PlannerFrequency }): Promise<PlannerConfig> {
    const slug = await findPlannerSlug();
    if (!slug) return { slug: null, active: false, frequency: 'morning' };
    const patch: Record<string, unknown> = {};
    if (input.active !== undefined) patch.active = input.active;
    if (input.frequency) patch.triggers = { windows: FREQUENCY_WINDOWS[input.frequency] };
    await patchTask(slug, patch);
    return getPlannerConfig();
}

/**
 * Seed the planner task once. Existing users get it on next boot; a user
 * who deletes or pauses it is respected forever after.
 */
export async function ensureMorningPlannerTask(): Promise<void> {
    try {
        // Doctrine upgrade first, marker or not: a seeded planner whose
        // instructions exactly match a prior seeded text was never edited —
        // bring it forward so doctrine fixes reach existing installs.
        const { items } = await listTasks({});
        const planner = items.find(t => t.name.toLowerCase().includes('planner') || t.slug.includes('planner'));
        if (planner && PLANNER_INSTRUCTIONS_PRIOR.includes(planner.instructions)) {
            await patchTask(planner.slug, { instructions: PLANNER_INSTRUCTIONS });
            log.log('upgraded seeded planner instructions to the current doctrine');
        }

        if (fsSync.existsSync(SEEDED_MARKER)) return;
        await ensurePreferencesFile();

        const exists = planner !== undefined;
        if (!exists) {
            const { slug } = await createTask({
                name: PLANNER_NAME,
                instructions: PLANNER_INSTRUCTIONS,
                triggers: { windows: [{ startTime: '06:30', endTime: '09:30' }] },
            });
            // Dormant until the user opts in from Home's Suggest dropdown —
            // an untouched feature must never spend tokens on a schedule.
            // The manual ✦ Suggest button works regardless.
            await patchTask(slug, { active: false });
            log.log('seeded the morning planner background task (off until opted in)');
        }
        const dir = path.dirname(SEEDED_MARKER);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        fsSync.writeFileSync(SEEDED_MARKER, new Date().toISOString());
    } catch (err) {
        // Seeding is best-effort — never let it disturb startup.
        log.log(`seeding skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
}
