import path from 'path';
import fs from 'fs';
import { WorkDir } from '../config/config.js';

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');
const DAILY_NOTE_PATH = path.join(KNOWLEDGE_DIR, 'Today.md');
const TARGET_ID = 'dailybrief';

function buildDailyNoteContent(): string {
    const now = new Date();
    const startDate = now.toISOString();
    const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const instruction = 'Create a daily brief for me';

    const taskBlock = JSON.stringify({
        instruction,
        schedule: {
            type: 'cron',
            expression: '*/15 * * * *',
            startDate,
            endDate,
        },
        'schedule-label': 'runs every 15 minutes',
        targetId: TARGET_ID,
    });

    return [
        '---',
        'live_note: true',
        '---',
        '# Today',
        '',
        '```task',
        taskBlock,
        '```',
        '',
        `<!--task-target:${TARGET_ID}-->`,
        `<!--/task-target:${TARGET_ID}-->`,
        '',
    ].join('\n');
}

export function ensureDailyNote(): void {
    if (fs.existsSync(DAILY_NOTE_PATH)) return;
    fs.writeFileSync(DAILY_NOTE_PATH, buildDailyNoteContent(), 'utf-8');
    console.log('[DailyNote] Created today.md');
}
