import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { generateObject } from 'ai';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { WorkDir } from '../config/config.js';
import { createProvider } from '../models/models.js';
import {
    getDefaultModelAndProvider,
    getKgModel,
    resolveProviderConfig,
} from '../models/defaults.js';
import { captureLlmUsage } from '../analytics/usage.js';
import { withUseCase } from '../analytics/use_case.js';
import type { GmailThreadSnapshot } from './sync_gmail.js';

const STYLE_GUIDE_PATH = path.join(WorkDir, 'knowledge', 'Agent Notes', 'style', 'email.md');
const CALENDAR_DIR = path.join(WorkDir, 'calendar_sync');
const CALENDAR_LOOKAHEAD_DAYS = 7;
const MAX_CALENDAR_EVENTS = 25;

function readEmailStyleGuide(): string | null {
    try {
        const raw = fs.readFileSync(STYLE_GUIDE_PATH, 'utf-8').trim();
        return raw || null;
    } catch {
        return null;
    }
}

interface CalendarSlice {
    summary: string;
    startIso: string;
    endIso?: string;
}

function readUpcomingCalendar(): CalendarSlice[] {
    if (!fs.existsSync(CALENDAR_DIR)) return [];
    const now = Date.now();
    const cutoff = now + CALENDAR_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
    const out: CalendarSlice[] = [];
    let names: string[];
    try {
        names = fs.readdirSync(CALENDAR_DIR);
    } catch {
        return [];
    }
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
            const raw = fs.readFileSync(path.join(CALENDAR_DIR, name), 'utf-8');
            const ev = JSON.parse(raw) as {
                summary?: string;
                start?: { dateTime?: string; date?: string };
                end?: { dateTime?: string; date?: string };
                status?: string;
            };
            if (ev.status === 'cancelled') continue;
            const startStr = ev.start?.dateTime ?? ev.start?.date;
            if (!startStr) continue;
            const startMs = Date.parse(startStr);
            if (Number.isNaN(startMs)) continue;
            if (startMs < now || startMs > cutoff) continue;
            out.push({
                summary: ev.summary || '(no title)',
                startIso: startStr,
                endIso: ev.end?.dateTime ?? ev.end?.date,
            });
        } catch {
            // skip malformed
        }
    }
    out.sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
    return out.slice(0, MAX_CALENDAR_EVENTS);
}

function formatCalendar(events: CalendarSlice[]): string {
    if (events.length === 0) return '(no upcoming events)';
    return events.map((e) => {
        const end = e.endIso ? ` – ${e.endIso}` : '';
        return `- ${e.startIso}${end}: ${e.summary}`;
    }).join('\n');
}

let cachedUserEmail: string | null = null;

export async function getUserEmail(auth: OAuth2Client): Promise<string | null> {
    if (cachedUserEmail) return cachedUserEmail;
    try {
        const gmailClient = google.gmail({ version: 'v1', auth });
        const res = await gmailClient.users.getProfile({ userId: 'me' });
        if (res.data.emailAddress) {
            cachedUserEmail = res.data.emailAddress.toLowerCase();
            return cachedUserEmail;
        }
    } catch (err) {
        console.warn('[Email classifier] getProfile failed:', err);
    }
    return null;
}

export interface Classification {
    importance: 'important' | 'other';
    summary?: string;
    draftResponse?: string;
}

const ClassificationSchema = z.object({
    importance: z.enum(['important', 'other']).describe('important = real correspondence, action-required, or content worth referencing later. other = newsletters, marketing, automated notifications, transactional receipts, cold outreach.'),
    summary: z.string().optional().describe('One or two sentences capturing what the thread is about and any implied action. Required when importance is important. Omit when other.'),
    draftResponse: z.string().optional().describe('A complete draft reply the user can send as-is or edit. Plain text with real line breaks (\\n): greeting on its own line, a blank line between paragraphs, and the sign-off on its own line(s) — e.g. "Hi Tyrone,\\n\\nThanks for the follow-up.\\n\\nBest,\\nJohn". Required when importance is important AND the thread implies a response is wanted. Omit when other, or when no response is appropriate (e.g. an FYI from a colleague that does not need a reply).'),
});

const SYSTEM_PROMPT = `You classify a Gmail thread for a personal inbox view and, when appropriate, draft a reply on behalf of the user.

# Importance

Decide if the thread is "important" or "other":
- important: real human correspondence the user is part of (customer, investor, team, vendor, candidate); a time-sensitive notification; a message that needs a response from the user; anything worth referencing later (contracts, pricing, deadlines, decisions).
- other: newsletters, industry digests, marketing or promotional, product tips from vendors, automated notifications (verifications, recording uploads, platform policy updates), transactional confirmations (payment receipts, GST/tax filings, salary disbursements), unsolicited cold outreach.

# Summary (important only)

When the thread is important, write a 1-2 sentence summary that captures the gist and any action implied. Omit when "other".

# Draft response (important only)

When the thread is important AND a reply is reasonably expected from the user, write a complete draft reply they could send as-is.

Format it like a real email, not one run-on block. Use actual line breaks: put the greeting on its own line, separate distinct paragraphs with a blank line, and put the sign-off and the name on their own lines. The example below illustrates only the line-break structure — not the wording, tone, greeting, or sign-off to use:

Hi Tyrone,

Thanks for the follow-up — sorry I missed your earlier note.

Could you resend it with a bit more context so I can get back to you properly?

Best,
John

When an email-style guide is provided below, it takes precedence: follow it for greeting, tone, sign-off, length, and phrasing patterns (while keeping the line-break structure shown above). If no style guide is provided, default to a brief, warm, professional voice.

For scheduling-related threads (where the sender proposes meeting times, asks for the user's availability, or follows up on a meeting request), look at the user's upcoming calendar (provided below) and either:
- Propose 2-3 specific time windows from genuinely free slots, or
- Confirm/decline a specific time the sender proposed, based on calendar conflicts.

Use the same timezone the user appears to operate in (inferable from their previous messages or calendar events).

Omit the draft when:
- importance is "other"
- the thread is purely informational and doesn't ask for a reply
- the latest message is from the user (they already replied; no draft needed)
- you can't write a meaningful reply without information you don't have (don't fabricate)

Be decisive — pick exactly one importance label. Do not hedge.`;

function userSentLatest(snapshot: GmailThreadSnapshot, userEmail: string | null): boolean {
    if (!userEmail) return false;
    const latest = snapshot.messages[snapshot.messages.length - 1];
    if (!latest) return false;
    const needle = userEmail.toLowerCase();
    return (latest.from || '').toLowerCase().includes(needle);
}

function buildPrompt(
    snapshot: GmailThreadSnapshot,
    userEmail: string | null,
    styleGuide: string | null,
    calendar: CalendarSlice[],
): string {
    const lines: string[] = [];

    if (userEmail) {
        lines.push(`# Your identity`);
        lines.push(`The user's own email is ${userEmail}. You write as this person when drafting replies.`);
        lines.push('');
    }

    if (styleGuide) {
        lines.push(`# Email style guide`);
        lines.push(styleGuide);
        lines.push('');
    }

    lines.push(`# User's upcoming calendar (next ${CALENDAR_LOOKAHEAD_DAYS} days)`);
    lines.push(formatCalendar(calendar));
    lines.push('');

    lines.push(`# Thread to classify`);
    lines.push(`Subject: ${snapshot.subject || '(no subject)'}`);
    lines.push(`Message count: ${snapshot.messages.length}`);
    lines.push('');

    for (let i = 0; i < snapshot.messages.length; i += 1) {
        const msg = snapshot.messages[i];
        const isLast = i === snapshot.messages.length - 1;
        lines.push(`## Message ${i + 1}${isLast ? ' (latest)' : ''}`);
        lines.push(`From: ${msg.from || 'unknown'}`);
        if (msg.to) lines.push(`To: ${msg.to}`);
        if (msg.date) lines.push(`Date: ${msg.date}`);
        const body = (msg.body || '').replace(/\s+/g, ' ').slice(0, isLast ? 2000 : 600).trim();
        if (body) {
            lines.push('');
            lines.push(body);
        }
        lines.push('');
    }

    return lines.join('\n');
}

export interface ClassifyOptions {
    skipDraft?: boolean;
}

export async function classifyThread(
    snapshot: GmailThreadSnapshot,
    userEmail: string | null,
    options: ClassifyOptions = {},
): Promise<Classification> {
    if (userSentLatest(snapshot, userEmail)) {
        return { importance: 'important' };
    }

    try {
        const styleGuide = readEmailStyleGuide();
        const calendar = readUpcomingCalendar();

        const modelId = await getKgModel();
        const { provider } = await getDefaultModelAndProvider();
        const config = await resolveProviderConfig(provider);
        const model = createProvider(config).languageModel(modelId);

        const systemPrompt = options.skipDraft
            ? `${SYSTEM_PROMPT}\n\n# Skip the draft\n\nThe user already has their own draft in progress for this thread — DO NOT generate a draftResponse. Always omit the draftResponse field.`
            : SYSTEM_PROMPT;

        const result = await withUseCase({ useCase: 'knowledge_sync', subUseCase: 'email_classifier' }, () => generateObject({
            model,
            system: systemPrompt,
            prompt: buildPrompt(snapshot, userEmail, styleGuide, calendar),
            schema: ClassificationSchema,
        }));

        captureLlmUsage({
            useCase: 'knowledge_sync',
            subUseCase: 'email_classifier',
            model: modelId,
            provider,
            usage: result.usage,
        });

        const out: Classification = { importance: result.object.importance };
        if (result.object.importance === 'important') {
            if (result.object.summary) out.summary = result.object.summary;
            if (!options.skipDraft && result.object.draftResponse) out.draftResponse = result.object.draftResponse;
        }
        return out;
    } catch (err) {
        console.warn(`[Email classifier] LLM call failed for thread ${snapshot.threadId}:`, err);
        return { importance: 'important' };
    }
}
