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
 * User-feedback loop for the email importance classifier.
 *
 * "Important" is personal — no fixed rubric gets it right for everyone. When
 * the user flips a verdict in the UI (important ↔ not important), we record
 * the correction here, and the classifier learns two ways:
 *  1. Immediately: recent corrections are injected as few-shot examples into
 *     every classification call.
 *  2. Generalized: once enough new corrections accumulate, an LLM pass distills
 *     them into short preference rules ("LinkedIn notification digests are
 *     never important") that are also injected — so the learning transfers to
 *     senders/threads the user never corrected.
 *
 * The user's explicit verdict on a specific thread is always sticky: it is
 * stored on the inbox_lists entry and re-classification never overrides it.
 */

const FEEDBACK_PATH = path.join(WorkDir, 'config', 'email_importance_feedback.json');
const MAX_CORRECTIONS = 200;
const FEW_SHOT_COUNT = 20;
const DISTILL_EVERY = 6; // distill after this many new corrections
const MAX_RULES = 12;

export interface ImportanceCorrection {
    threadId: string;
    subject: string;
    from: string;
    /** What the classifier had said (or what was shown) before the user flipped it. */
    agentVerdict: 'important' | 'other';
    /** What the user says it actually is. */
    userVerdict: 'important' | 'other';
    at: string; // ISO
}

export interface ImportanceFeedback {
    corrections: ImportanceCorrection[];
    /** Distilled, generalized preference rules. */
    rules: string[];
    rulesUpdatedAt?: string;
    /** How many corrections had been seen at the last distillation. */
    distilledThrough: number;
}

const EMPTY: ImportanceFeedback = { corrections: [], rules: [], distilledThrough: 0 };

export function loadImportanceFeedback(): ImportanceFeedback {
    try {
        if (!fs.existsSync(FEEDBACK_PATH)) return { ...EMPTY };
        const parsed = JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8'));
        return {
            corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
            rules: Array.isArray(parsed.rules) ? parsed.rules : [],
            rulesUpdatedAt: parsed.rulesUpdatedAt,
            distilledThrough: typeof parsed.distilledThrough === 'number' ? parsed.distilledThrough : 0,
        };
    } catch (err) {
        console.warn('[ImportanceFeedback] Failed to load, starting fresh:', err);
        return { ...EMPTY };
    }
}

function saveImportanceFeedback(fb: ImportanceFeedback): void {
    const dir = path.dirname(FEEDBACK_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = FEEDBACK_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(fb, null, 2));
    fs.renameSync(tmp, FEEDBACK_PATH);
}

/**
 * Record a user correction. One entry per thread — flipping back and forth
 * keeps only the latest verdict (and if the user flips back to what the agent
 * originally said, the correction is dropped: no disagreement left to learn).
 */
export function recordImportanceCorrection(correction: ImportanceCorrection): ImportanceFeedback {
    const fb = loadImportanceFeedback();
    const existing = fb.corrections.find(c => c.threadId === correction.threadId);
    // The verdict the agent originally produced is the stable "before" — keep
    // the first recorded agentVerdict if the user flips multiple times.
    const agentVerdict = existing ? existing.agentVerdict : correction.agentVerdict;
    fb.corrections = fb.corrections.filter(c => c.threadId !== correction.threadId);
    if (correction.userVerdict !== agentVerdict) {
        fb.corrections.push({ ...correction, agentVerdict });
        if (fb.corrections.length > MAX_CORRECTIONS) {
            fb.corrections = fb.corrections.slice(-MAX_CORRECTIONS);
        }
    }
    saveImportanceFeedback(fb);
    return fb;
}

/**
 * Render the user's preferences for injection into the classifier prompt.
 * Returns null when there is nothing learned yet.
 */
export function formatImportanceFeedbackForPrompt(): string | null {
    const fb = loadImportanceFeedback();
    if (fb.rules.length === 0 && fb.corrections.length === 0) return null;

    const lines: string[] = [];
    lines.push(`# This user's importance preferences (learned from their explicit corrections — these OVERRIDE the generic criteria above)`);
    lines.push('');
    lines.push(`"Important" is personal. The user has corrected past verdicts; match THEIR standard, not the generic one.`);
    if (fb.rules.length > 0) {
        lines.push('');
        lines.push(`## Their rules`);
        for (const r of fb.rules) lines.push(`- ${r}`);
    }
    const recent = fb.corrections.slice(-FEW_SHOT_COUNT);
    if (recent.length > 0) {
        lines.push('');
        lines.push(`## Their recent corrections (ground truth examples)`);
        for (const c of recent) {
            lines.push(`- From: ${c.from} | Subject: "${c.subject}" → user says ${c.userVerdict.toUpperCase()} (classifier had said ${c.agentVerdict})`);
        }
    }
    return lines.join('\n');
}

const DistilledRules = z.object({
    rules: z.array(z.string()).max(MAX_RULES).describe(
        'Generalized, testable importance preferences derived from the corrections, e.g. "Automated LinkedIn/social notification digests are never important" or "Anything from @acme.com is important — active customer". Each rule must generalize at least one correction; do not restate single threads.'
    ),
});

/**
 * When enough new corrections have accumulated, distill them into generalized
 * rules. Cheap (one small structured call), rate-limited by correction count.
 * Safe to call opportunistically — no-ops most of the time.
 */
export async function maybeDistillImportanceRules(): Promise<void> {
    const fb = loadImportanceFeedback();
    const newSince = fb.corrections.length - fb.distilledThrough;
    if (fb.corrections.length === 0 || (newSince < DISTILL_EVERY && fb.rules.length > 0)) return;
    if (newSince <= 0) return;

    try {
        const { model: modelId, provider } = await getKgModel();
        const config = await resolveProviderConfig(provider);
        const model = createLanguageModel(config, modelId, { priority: 'background' });

        const correctionLines = fb.corrections.map(c =>
            `- From: ${c.from} | Subject: "${c.subject}" | classifier said ${c.agentVerdict}, user corrected to ${c.userVerdict}`
        ).join('\n');
        const existingRules = fb.rules.length ? `\n\nCurrent rules (rewrite/merge as needed):\n${fb.rules.map(r => `- ${r}`).join('\n')}` : '';

        const result = await withUseCase({ useCase: 'knowledge_sync', subUseCase: 'importance_rule_distiller' }, () => generateObjectSafe({
            model,
            system: `You maintain a short list of email-importance preference rules for one user, derived from their explicit corrections of an automated classifier. Write at most ${MAX_RULES} rules. Rules must GENERALIZE (sender domains, email types, topics) — never restate a single thread. Where corrections conflict, prefer the more recent. Keep rules that are still supported; drop ones the corrections no longer support.`,
            prompt: `Corrections (oldest first):\n${correctionLines}${existingRules}`,
            schema: DistilledRules,
            retry: true,
        }));

        captureLlmUsage({
            useCase: 'knowledge_sync',
            subUseCase: 'importance_rule_distiller',
            model: modelId,
            provider,
            usage: result.usage,
        });

        const updated = loadImportanceFeedback(); // re-read: corrections may have advanced
        updated.rules = result.object.rules.slice(0, MAX_RULES);
        updated.rulesUpdatedAt = new Date().toISOString();
        updated.distilledThrough = fb.corrections.length;
        saveImportanceFeedback(updated);
        console.log(`[ImportanceFeedback] Distilled ${updated.rules.length} rules from ${fb.corrections.length} corrections`);
    } catch (err) {
        console.warn('[ImportanceFeedback] Rule distillation failed (will retry later):', err);
    }
}
