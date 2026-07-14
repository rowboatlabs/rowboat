import fs from 'node:fs/promises';
import path from 'node:path';
import { generateText } from 'ai';
import { WorkDir } from '../config/config.js';
import { createLanguageModel } from '../models/models.js';
import { getMeetingNotesModel, resolveProviderConfig } from '../models/defaults.js';
import { captureLlmUsage } from '../analytics/usage.js';
import { withUseCase } from '../analytics/use_case.js';
import { parseFrontmatter } from '../application/lib/parse-frontmatter.js';
import { resolveMeetingPrep, type MeetingPrepResult } from './meeting_prep.js';

const MEETINGS_DIR = path.join(WorkDir, 'knowledge', 'Meetings');
const PREP_DIR = path.join(MEETINGS_DIR, 'prep');

/** The bits of a Google Calendar event we use for prep. */
interface CalendarEvent {
    id?: string;
    summary?: string;
    description?: string;
    status?: string;
    recurringEventId?: string;
    start?: { dateTime?: string; date?: string };
    attendees?: Array<{ email?: string; displayName?: string; self?: boolean; responseStatus?: string }>;
}

export interface PrepNoteResult {
    /** Workspace-relative path of the written note. */
    path: string;
}

function norm(s: string | undefined): string {
    return (s ?? '').trim().toLowerCase();
}

function slugify(s: string): string {
    return (s || 'meeting')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'meeting';
}

/** Local YYYY-MM-DD for the event's start. */
function eventDateKey(event: CalendarEvent): string {
    const iso = event.start?.dateTime ?? event.start?.date ?? '';
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return 'undated';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Pull a "## Heading" section's body (until the next "## " or end). */
function extractSection(markdown: string, heading: string): string {
    const headRe = new RegExp(`^##\\s+${heading}\\s*$`, 'i');
    const out: string[] = [];
    let capturing = false;
    for (const line of markdown.split('\n')) {
        if (capturing) {
            if (/^##\s/.test(line)) break;
            out.push(line);
        } else if (headRe.test(line)) {
            capturing = true;
        }
    }
    return out.join('\n').trim();
}

interface PriorNote {
    file: string; // workspace-relative
    title: string;
    date: string;
    actionItems: string;
    body: string;
}

/**
 * Find the most recent prior meeting note for this series. We match by title
 * resemblance to the event summary (notes don't yet store an event id), and
 * only consider notes dated before the meeting.
 */
async function findLastMeetingNote(event: CalendarEvent): Promise<PriorNote | null> {
    const summaryNorm = norm(event.summary);
    if (!summaryNorm) return null;
    const meetingDate = eventDateKey(event);

    let entries: string[] = [];
    try {
        entries = (await fs.readdir(MEETINGS_DIR, { recursive: true }))
            .filter((p) => p.endsWith('.md'));
    } catch {
        return null;
    }

    const candidates: PriorNote[] = [];
    for (const rel of entries) {
        // Skip our own generated prep notes.
        if (rel.startsWith('prep/') || rel.startsWith(`prep${path.sep}`)) continue;
        let raw: string;
        try {
            raw = await fs.readFile(path.join(MEETINGS_DIR, rel), 'utf-8');
        } catch {
            continue;
        }
        const { frontmatter, content } = parseFrontmatter(raw);
        const fm = (frontmatter ?? {}) as Record<string, unknown>;
        const title = String(fm.title ?? (content.match(/^#\s+(.+)$/m)?.[1] ?? '')).trim();
        const date = String(fm.date ?? '').trim();
        const titleNorm = norm(title);
        // Series match: the event summary appears in the note title (e.g.
        // "standup" within "Eng Standup — 2026-06-18").
        if (!titleNorm || !titleNorm.includes(summaryNorm)) continue;
        // Only prior instances.
        if (date && meetingDate !== 'undated' && date >= meetingDate) continue;
        candidates.push({
            file: path.posix.join('knowledge', 'Meetings', rel.split(path.sep).join('/')),
            title,
            date,
            actionItems: extractSection(content, 'Action items'),
            body: content,
        });
    }

    if (candidates.length === 0) return null;
    // Most recent by date (notes without a date sort last).
    candidates.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return candidates[0];
}

/** True when this looks like a recurring meeting we have history for. */
function isRecurring(event: CalendarEvent, prior: PriorNote | null): boolean {
    return Boolean(event.recurringEventId) && prior !== null;
}

/** Assemble the deterministic prep context for an event. */
async function assembleContext(event: CalendarEvent): Promise<{
    roster: MeetingPrepResult;
    prior: PriorNote | null;
    recurring: boolean;
    agenda: string;
}> {
    const attendees = (event.attendees ?? []).map((a) => ({
        email: a.email,
        displayName: a.displayName,
        self: a.self,
    }));
    const roster = await resolveMeetingPrep(attendees);
    const prior = await findLastMeetingNote(event);
    return {
        roster,
        prior,
        recurring: isRecurring(event, prior),
        agenda: (event.description ?? '').trim(),
    };
}

const BRIEF_SYSTEM = `You write a short, concrete "what matters for this meeting" brief.
Rules:
- Use ONLY the context provided. Never invent facts, names, or commitments.
- 3-5 bullet points, one line each. No preamble, no headings, no sign-off.
- Lead with what the user should focus on or decide. Reference open items and
  prior commitments by name where the context supplies them.
- If the context is thin, say so in one line rather than padding.`;

/** Generate the "what matters" brief via the user's configured model. */
async function generateBrief(event: CalendarEvent, ctx: Awaited<ReturnType<typeof assembleContext>>): Promise<string> {
    const parts: string[] = [`Meeting: ${event.summary || '(untitled)'}`];
    if (ctx.agenda) parts.push(`Agenda:\n${ctx.agenda}`);
    if (ctx.prior?.actionItems) parts.push(`Action items from last time (${ctx.prior.date || 'prior'}):\n${ctx.prior.actionItems}`);
    const attendeeLines = ctx.roster.attendees.map((a) => {
        if (!a.note) return `- ${a.label} (no note)`;
        const sub = [a.note.role, a.note.organization].filter(Boolean).join(', ');
        return `- ${a.note.name}${sub ? ` — ${sub}` : ''}`;
    });
    if (attendeeLines.length) parts.push(`Attendees:\n${attendeeLines.join('\n')}`);

    const { model: modelId, provider: providerName } = await getMeetingNotesModel();
    const providerConfig = await resolveProviderConfig(providerName);
    const model = createLanguageModel(providerConfig, modelId);

    const result = await withUseCase({ useCase: 'meeting_prep' }, () => generateText({
        model,
        instructions: BRIEF_SYSTEM,
        prompt: parts.join('\n\n'),
    }));
    captureLlmUsage({ useCase: 'meeting_prep', model: modelId, provider: providerName, usage: result.usage });
    return result.text.trim();
}

/** Render the prep note's markdown body (brief is optional). */
function renderPrepNote(event: CalendarEvent, ctx: Awaited<ReturnType<typeof assembleContext>>, brief: string, generatedAt: string): string {
    const fm = [
        '---',
        'source: meeting-prep',
        `title: "Prep: ${(event.summary || 'Meeting').replace(/"/g, "'")}"`,
        `meetingDate: "${eventDateKey(event)}"`,
        event.id ? `eventId: "${event.id}"` : null,
        event.recurringEventId ? `recurringEventId: "${event.recurringEventId}"` : null,
        `generatedAt: "${generatedAt}"`,
        '---',
        '',
    ].filter((l) => l !== null).join('\n');

    const lines: string[] = [`# Prep: ${event.summary || 'Meeting'}`, ''];

    if (brief) {
        lines.push('## What matters', '', brief, '');
    }

    // Adaptive ordering: recurring → recap first; new → agenda first.
    const recapBlock = ctx.prior
        ? ['## Last time', '', ctx.prior.actionItems
            ? ctx.prior.actionItems
            : `See [[${ctx.prior.title}]].`, '']
        : [];
    const agendaBlock = ctx.agenda ? ['## Agenda', '', ctx.agenda, ''] : [];
    if (ctx.recurring) {
        lines.push(...recapBlock, ...agendaBlock);
    } else {
        lines.push(...agendaBlock, ...recapBlock);
    }

    // Roster — every attendee, linking to their note when we have one.
    lines.push('## Who’s coming', '');
    for (const a of ctx.roster.attendees) {
        if (a.note) {
            const sub = [a.note.role, a.note.organization].filter(Boolean).join(', ');
            lines.push(`- [[${a.note.name}]]${sub ? ` — ${sub}` : ''}`);
        } else {
            lines.push(`- ${a.label} _(no note yet)_`);
        }
    }
    lines.push('');

    if (ctx.roster.organizations.length > 0) {
        lines.push('## Companies', '');
        for (const org of ctx.roster.organizations) lines.push(`- [[${org.name}]]`);
        lines.push('');
    }

    return fm + lines.join('\n').trimEnd() + '\n';
}

/**
 * Generate and write the prep note for a calendar event. Returns the note path,
 * or null when there's nothing to prep (no other attendees). The AI brief is
 * best-effort — if no model is configured the note is still written with the
 * deterministic sections.
 */
export async function generateAndWritePrep(eventJson: string): Promise<PrepNoteResult | null> {
    const event = JSON.parse(eventJson) as CalendarEvent;
    if (event.status === 'cancelled') return null;
    if (!(event.attendees ?? []).some((a) => !a.self)) return null; // nobody else

    const ctx = await assembleContext(event);
    if (ctx.roster.attendees.length === 0) return null;

    let brief = '';
    try {
        brief = await generateBrief(event, ctx);
    } catch (err) {
        console.error('[MeetingPrep] brief generation failed:', err);
    }

    const generatedAt = new Date().toISOString();
    const body = renderPrepNote(event, ctx, brief, generatedAt);

    await fs.mkdir(PREP_DIR, { recursive: true });
    const fileName = `${slugify(event.summary || 'meeting')}-${eventDateKey(event)}.md`;
    const absPath = path.join(PREP_DIR, fileName);
    await fs.writeFile(absPath, body, 'utf-8');

    return { path: path.posix.join('knowledge', 'Meetings', 'prep', fileName) };
}

/**
 * Find the pre-generated prep note for a calendar event (matched by the
 * `eventId` stamped in frontmatter) and return its path + "What matters" brief.
 * Returns null when no prep has been generated yet.
 */
export async function readPrepNoteForEvent(eventId: string): Promise<{ path: string; brief: string } | null> {
    if (!eventId) return null;
    let files: string[];
    try {
        files = (await fs.readdir(PREP_DIR)).filter((f) => f.endsWith('.md'));
    } catch {
        return null;
    }
    for (const f of files) {
        let raw: string;
        try {
            raw = await fs.readFile(path.join(PREP_DIR, f), 'utf-8');
        } catch {
            continue;
        }
        const { frontmatter, content } = parseFrontmatter(raw);
        const fm = (frontmatter ?? {}) as Record<string, unknown>;
        if (String(fm.eventId ?? '') !== eventId) continue;
        return {
            path: path.posix.join('knowledge', 'Meetings', 'prep', f),
            brief: extractSection(content, 'What matters'),
        };
    }
    return null;
}
