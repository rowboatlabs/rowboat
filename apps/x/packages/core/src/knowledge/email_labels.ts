import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { WorkDir } from '../config/config.js';
import { createLanguageModel } from '../models/models.js';
import { generateObjectSafe } from '../models/structured.js';
import { getKgModel, resolveProviderConfig } from '../models/defaults.js';
import { captureLlmUsage } from '../analytics/usage.js';
import { withUseCase } from '../analytics/use_case.js';

/**
 * The email label registry: the built-in category set plus user-defined
 * custom labels. The classifier's category enum, its prompt section, and the
 * UI's chips / filter pills / correction dropdown are all built from this
 * one list, so a label created here exists everywhere at once.
 *
 * Custom labels come from the user's free-text agent instructions: on save,
 * an extraction pass (syncCustomLabelsFromInstructions) pulls out any labels
 * the user asked for and persists them to config/email_labels.json. Built-in
 * labels are code-defined and immutable; ids are stable slugs because they
 * get stamped into snapshots, markdown frontmatter, and feedback files.
 */

export interface EmailLabelDef {
    /** Stable slug — stamped into snapshots/frontmatter; never renamed. */
    id: string;
    /** Display name shown on chips, pills, and the correction dropdown. */
    name: string;
    /** Classifier guidance — what belongs under this label. */
    description: string;
    kind: 'builtin' | 'custom';
}

export const BUILTIN_EMAIL_LABELS: EmailLabelDef[] = [
    { id: 'correspondence', name: 'Direct', kind: 'builtin', description: 'A real person writing to (or with) the user — there is prior engagement or a genuine relationship. A cold sender bumping their own unanswered email is NOT correspondence; that stays cold_outreach.' },
    { id: 'meeting', name: 'Calendar', kind: 'builtin', description: 'Scheduling with named people — calendar invites, availability requests, reschedules. Automated meeting reminders with no human context ("your meeting starts in 10 minutes") are notification, not meeting.' },
    { id: 'notification', name: 'Notification', kind: 'builtin', description: 'Automated system messages — verifications, password resets, recording uploads, policy updates, deploy/CI alerts, social and forum digests.' },
    { id: 'newsletter', name: 'News', kind: 'builtin', description: 'Subscription content, industry reports, community digests, product tips — even from platforms the user actively uses.' },
    { id: 'promotion', name: 'Marketing', kind: 'builtin', description: 'Marketing, offers, product launches, webinar/workshop invites from companies, startup-program upsells.' },
    { id: 'cold_outreach', name: 'Pitch', kind: 'builtin', description: 'Unsolicited pitches from people with no prior engagement — agencies, dev shops, freelancers, hiring platforms — even when they mention the user\'s company by name or offer something free.' },
    { id: 'receipt', name: 'Receipt', kind: 'builtin', description: 'Completed transactions with no decision remaining — payment receipts, payroll, tax filings, order/shipping confirmations, travel bookings.' },
];

const LABELS_PATH = path.join(WorkDir, 'config', 'email_labels.json');
const MAX_CUSTOM_LABELS = 12;

const BUILTIN_IDS = new Set(BUILTIN_EMAIL_LABELS.map(l => l.id));

/**
 * First-run seed, matching DEFAULT_EMAIL_INSTRUCTIONS in email_instructions.ts
 * line for line — so the starter labels exist before the user ever saves, and
 * the next save's extraction round-trips to the same set.
 */
const DEFAULT_CUSTOM_LABELS: EmailLabelDef[] = [
    { id: 'investor', name: 'Investor', kind: 'custom', description: 'Emails from investors and VCs — current, prospective, or in an active raise.' },
    { id: 'candidate', name: 'Candidate', kind: 'custom', description: 'Emails from job applicants and people interviewing with the user\'s company.' },
    { id: 'customer', name: 'Customer', kind: 'custom', description: 'Emails from paying customers and active pilots.' },
];

let cachedCustom: EmailLabelDef[] | null = null;
let cachedMtimeMs: number | null = null;

function loadCustomLabels(): EmailLabelDef[] {
    try {
        if (!fs.existsSync(LABELS_PATH)) {
            // First run: seed the starter custom set (mirrors the seeded
            // instructions). A user who deletes those instruction lines gets
            // the labels removed by the next save's sync — this seed only
            // ever fires when no labels file exists at all.
            saveCustomLabels(DEFAULT_CUSTOM_LABELS);
        }
        const stats = fs.statSync(LABELS_PATH);
        if (cachedCustom && cachedMtimeMs === stats.mtimeMs) return cachedCustom;
        const parsed = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8'));
        const custom: EmailLabelDef[] = Array.isArray(parsed.custom)
            ? parsed.custom
                .filter((l: EmailLabelDef) => l && typeof l.id === 'string' && typeof l.name === 'string' && !BUILTIN_IDS.has(l.id))
                .map((l: EmailLabelDef) => ({ id: l.id, name: l.name, description: String(l.description ?? ''), kind: 'custom' as const }))
            : [];
        cachedCustom = custom.slice(0, MAX_CUSTOM_LABELS);
        cachedMtimeMs = stats.mtimeMs;
        return cachedCustom;
    } catch {
        cachedCustom = null;
        cachedMtimeMs = null;
        return [];
    }
}

function saveCustomLabels(custom: EmailLabelDef[]): void {
    const dir = path.dirname(LABELS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = LABELS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ custom }, null, 2) + '\n');
    fs.renameSync(tmp, LABELS_PATH);
    cachedCustom = null;
    cachedMtimeMs = null;
}

/** Built-ins followed by the user's custom labels. Never empty. */
export function getEmailLabels(): EmailLabelDef[] {
    return [...BUILTIN_EMAIL_LABELS, ...loadCustomLabels()];
}

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
}

const ExtractedLabels = z.object({
    labels: z.array(z.object({
        name: z.string().describe('Short display name for the label, e.g. "Investor", "Portfolio", "Legal".'),
        description: z.string().describe('One or two sentences defining what belongs under this label, written as classifier guidance, derived from the user\'s instructions.'),
    })).max(MAX_CUSTOM_LABELS).describe('The custom email labels the user\'s instructions define. Empty when the instructions define none.'),
});

/**
 * Extract user-defined labels from the free-text agent instructions and
 * persist them as the custom label set (full replace: labels the user has
 * removed from their instructions disappear from the registry; threads
 * already stamped with a removed id keep it and render via a fallback).
 *
 * Steering rules for existing labels ("investor updates are Direct, not
 * News") are NOT labels and must not create one — the instructions text
 * itself is injected into every classification call and handles steering.
 */
export async function syncCustomLabelsFromInstructions(instructions: string): Promise<{ labels: EmailLabelDef[] }> {
    const text = instructions.trim();
    if (!text) {
        saveCustomLabels([]);
        return { labels: getEmailLabels() };
    }

    const { model: modelId, provider } = await getKgModel();
    const config = await resolveProviderConfig(provider);
    const model = createLanguageModel(config, modelId);

    const builtinList = BUILTIN_EMAIL_LABELS.map(l => `- ${l.id} ("${l.name}"): ${l.description}`).join('\n');

    const result = await withUseCase({ useCase: 'knowledge_sync', subUseCase: 'email_label_extractor' }, () => generateObjectSafe({
        model,
        system: [
            `You read a user's written instructions for their email agent and extract any CUSTOM CATEGORY LABELS the instructions define.`,
            ``,
            `A custom label exists only when the user clearly wants emails grouped under a name of their own — "create a label Portfolio for...", "tag anything about the Series A as Fundraise", "I want an Investors label".`,
            ``,
            `These are NOT custom labels:`,
            `- Steering rules that map mail onto an existing built-in label ("investor updates are Direct, not News").`,
            `- Importance rules ("emails from my board are always important").`,
            `- Drafting preferences ("keep replies short").`,
            ``,
            `Built-in labels that already exist (never re-create these or near-synonyms of them):`,
            builtinList,
            ``,
            `Return an empty list when the instructions define no custom labels.`,
        ].join('\n'),
        prompt: text,
        schema: ExtractedLabels,
        retry: true,
    }));

    captureLlmUsage({
        useCase: 'knowledge_sync',
        subUseCase: 'email_label_extractor',
        model: modelId,
        provider,
        usage: result.usage,
    });

    const seen = new Set<string>();
    const custom: EmailLabelDef[] = [];
    for (const l of result.object.labels) {
        const id = slugify(l.name);
        if (!id || BUILTIN_IDS.has(id) || seen.has(id)) continue;
        seen.add(id);
        custom.push({ id, name: l.name.trim(), description: l.description.trim(), kind: 'custom' });
    }
    saveCustomLabels(custom);
    return { labels: getEmailLabels() };
}
