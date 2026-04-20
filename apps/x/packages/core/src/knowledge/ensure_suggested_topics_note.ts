import path from 'path';
import fs from 'fs';
import { stringify as stringifyYaml } from 'yaml';
import { WorkDir } from '../config/config.js';

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');
const NOTE_PATH = path.join(KNOWLEDGE_DIR, 'Suggested Topics.md');
const TRACK_ID = 'suggested-topics';

const INSTRUCTION = `Curate a shortlist of 8-12 items the user should consider exploring next: topics, projects, people, or organizations surfaced by recent activity.

Read source material via workspace tools:
- Recent emails under \`gmail_sync/\`
- Meeting transcripts under \`knowledge/Meetings/\` (fireflies, granola)

Prefer strategically relevant, near-term, actionable items. Skip transactional or low-signal noise. Skip entities that already have a canonical note under \`knowledge/People/\`, \`knowledge/Organizations/\`, \`knowledge/Topics/\`, or \`knowledge/Projects/\` unless there is a distinct new angle worth exploring.

## Output format

Write the target region as category-grouped stacks of fenced \`prompt\` code blocks. Omit empty categories. Use these headings in this order:

    ## Topics
    ## Projects
    ## People
    ## Organizations

Under each heading, emit one \`prompt\`-language fenced code block per item. Each block is YAML with two fields:

- \`label\`: concise card title (~60 chars).
- \`instruction\`: multi-line block scalar (\`|\`). The full prompt Copilot runs when the user clicks Run.

Write each \`instruction\` in first-person voice, asking Copilot to set up a track block for that suggestion. Include:
- Which item to track and its category (topic / project / person / organization).
- A 1-2 sentence hook explaining why it matters now.
- Target folder: \`knowledge/<Topics|Projects|People|Organizations>/\`.
- Ask Copilot to describe what the tracking note would monitor and confirm before creating or modifying anything.
- On confirmation, load the \`tracks\` skill, check whether a matching note already exists in the target folder, and update it with an appropriate track block. If none exists, create a new note there with a suitable filename. Use a track block rather than only static content.

Rules: 8-12 cards total across categories. Be selective. Prefer freshness and near-term leverage.`;

function buildNoteContent(): string {
    const trackYaml = stringifyYaml({
        trackId: TRACK_ID,
        active: true,
        instruction: INSTRUCTION,
        schedule: {
            type: 'cron',
            expression: '0 */4 * * *',
        },
    }).trimEnd();

    return [
        '# Suggested Topics',
        '',
        '> Auto-curated list of topics, people, organizations, and projects worth exploring next. Refreshes every 4 hours. Click any card to explore it with Copilot.',
        '',
        '```track',
        trackYaml,
        '```',
        '',
        `<!--track-target:${TRACK_ID}-->`,
        `<!--/track-target:${TRACK_ID}-->`,
        '',
    ].join('\n');
}

export function ensureSuggestedTopicsNote(): void {
    if (fs.existsSync(NOTE_PATH)) return;
    fs.writeFileSync(NOTE_PATH, buildNoteContent(), 'utf-8');
    console.log('[SuggestedTopicsNote] Created Suggested Topics.md');
}
