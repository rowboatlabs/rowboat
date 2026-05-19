import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { LiveNoteSchema } from '@x/shared/dist/live-note.js';
import { WorkDir } from '../config/config.js';
import { splitFrontmatter, joinFrontmatter } from '../application/lib/parse-frontmatter.js';

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');
const TODAY_NOTE_PATH = path.join(KNOWLEDGE_DIR, 'Today.md');
const STATE_FILE = path.join(WorkDir, 'config', 'today-note-deprecation.json');
const NOTICE_MARKER = '<!-- rowboat-today-md-deprecated -->';
const DEPRECATION_NOTICE = `${NOTICE_MARKER}
> Rowboat's Today.md live dashboard is paused for now while we work on a better experience. You can keep using this note as a regular markdown file. If you want Rowboat to keep updating it automatically, re-enable the live note settings; automatic updates may use credits.

`;

const StateSchema = z.object({
    processed_at: z.string().min(1).optional(),
});
type State = z.infer<typeof StateSchema>;

const TodayNoteFrontmatterSchema = z.object({
    live: LiveNoteSchema.optional(),
}).passthrough();

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function loadState(): Promise<State> {
    try {
        if (!await pathExists(STATE_FILE)) return {};
        const raw = await fs.readFile(STATE_FILE, 'utf-8');
        return StateSchema.parse(JSON.parse(raw));
    } catch (error) {
        console.warn('[TodayNoteDeprecation] Failed to load state:', error);
        return {};
    }
}

async function saveState(state: State): Promise<void> {
    const dir = path.dirname(STATE_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

async function markProcessed(): Promise<void> {
    await saveState({ processed_at: new Date().toISOString() });
}

function disableLiveBlock(frontmatter: Record<string, unknown>): Record<string, unknown> {
    const parsed = TodayNoteFrontmatterSchema.safeParse(frontmatter);
    if (!parsed.success || !parsed.data.live) {
        return frontmatter;
    }

    return {
        ...frontmatter,
        live: {
            ...parsed.data.live,
            active: false,
        },
    };
}

function prependNotice(body: string): string {
    if (body.includes(NOTICE_MARKER)) return body;
    return `${DEPRECATION_NOTICE}${body}`;
}

export async function deprecateTodayNote(): Promise<void> {
    const state = await loadState();
    if (state.processed_at) return;

    if (!await pathExists(TODAY_NOTE_PATH)) {
        await markProcessed();
        return;
    }

    const content = await fs.readFile(TODAY_NOTE_PATH, 'utf-8');
    const { frontmatter, body } = splitFrontmatter(content);
    const nextFrontmatter = disableLiveBlock(frontmatter);
    const nextBody = prependNotice(body);

    if (nextFrontmatter !== frontmatter || nextBody !== body) {
        await fs.writeFile(TODAY_NOTE_PATH, joinFrontmatter(nextFrontmatter, nextBody), 'utf-8');
        console.log('[TodayNoteDeprecation] Deprecated Today.md live dashboard');
    }

    await markProcessed();
}
