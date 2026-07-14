import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import type { EmailCategory } from './classify_thread.js';

/**
 * User-feedback loop for the email category classifier — the sibling of
 * email_importance_feedback.ts, deliberately lighter: corrections are stored
 * and injected as few-shot examples on every classification call, but there
 * is no distillation pass yet (categories are far less personal than
 * importance; the few-shot examples carry most of the signal).
 *
 * The user's explicit category on a specific thread is always sticky: it is
 * stored on the inbox_lists entry (categorySource: 'user') and
 * re-classification never overrides it.
 */

const FEEDBACK_PATH = path.join(WorkDir, 'config', 'email_category_feedback.json');
const MAX_CORRECTIONS = 200;
const FEW_SHOT_COUNT = 20;

export interface CategoryCorrection {
    threadId: string;
    subject: string;
    from: string;
    /** What the classifier had said before the user changed it. */
    agentCategory: EmailCategory | 'unknown';
    /** What the user says it actually is. */
    userCategory: EmailCategory;
    at: string; // ISO
}

interface CategoryFeedback {
    corrections: CategoryCorrection[];
}

export function loadCategoryFeedback(): CategoryFeedback {
    try {
        if (!fs.existsSync(FEEDBACK_PATH)) return { corrections: [] };
        const parsed = JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8'));
        return { corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [] };
    } catch (err) {
        console.warn('[CategoryFeedback] Failed to load, starting fresh:', err);
        return { corrections: [] };
    }
}

function saveCategoryFeedback(fb: CategoryFeedback): void {
    const dir = path.dirname(FEEDBACK_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = FEEDBACK_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(fb, null, 2));
    fs.renameSync(tmp, FEEDBACK_PATH);
}

/**
 * Record a user correction. One entry per thread — re-picking keeps only the
 * latest choice, and picking the classifier's original verdict drops the
 * correction (no disagreement left to learn).
 */
export function recordCategoryCorrection(correction: CategoryCorrection): void {
    const fb = loadCategoryFeedback();
    const existing = fb.corrections.find(c => c.threadId === correction.threadId);
    // The verdict the agent originally produced is the stable "before".
    const agentCategory = existing ? existing.agentCategory : correction.agentCategory;
    fb.corrections = fb.corrections.filter(c => c.threadId !== correction.threadId);
    if (correction.userCategory !== agentCategory) {
        fb.corrections.push({ ...correction, agentCategory });
        if (fb.corrections.length > MAX_CORRECTIONS) {
            fb.corrections = fb.corrections.slice(-MAX_CORRECTIONS);
        }
    }
    saveCategoryFeedback(fb);
}

/**
 * Render recent category corrections for injection into the classifier
 * prompt. Returns null when there is nothing learned yet.
 */
export function formatCategoryFeedbackForPrompt(): string | null {
    const fb = loadCategoryFeedback();
    if (fb.corrections.length === 0) return null;

    const lines: string[] = [];
    lines.push(`# This user's category corrections (ground truth — these OVERRIDE the generic category definitions above)`);
    lines.push('');
    for (const c of fb.corrections.slice(-FEW_SHOT_COUNT)) {
        lines.push(`- From: ${c.from} | Subject: "${c.subject}" → user says ${c.userCategory}${c.agentCategory !== 'unknown' ? ` (classifier had said ${c.agentCategory})` : ''}`);
    }
    return lines.join('\n');
}
