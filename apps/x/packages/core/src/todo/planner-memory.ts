import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { withFileLock } from '../knowledge/file-lock.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';
import { normalizeKey } from './fileops.js';

const log = new PrefixLogger('Todo:PlannerMemory');

// ---------------------------------------------------------------------------
// The planner's memory, mirroring the email-importance feedback loop:
//
// - `todo/preferences.md` — the human-readable taste file. Two sections with
//   strict precedence: "## Your rules" (written by dismiss-to-teach and by
//   hand; the machine NEVER edits it) outranks "## Learned" (distilled from
//   signals; regenerated; delete a line and it stays gone until re-earned).
// - `todo/planner_feedback.json` — the raw signal ledger (losable): what was
//   proposed and what the user did with it. Sticky verdicts and few-shot
//   examples derive from here.
// ---------------------------------------------------------------------------

const PREFS_PATH = path.join(WorkDir, 'todo', 'preferences.md');
export const PREFS_REL_PATH = 'todo/preferences.md';
const FEEDBACK_PATH = path.join(WorkDir, 'todo', 'planner_feedback.json');
export const FEEDBACK_REL_PATH = 'todo/planner_feedback.json';

const MAX_SIGNALS = 200;

const PREFS_TEMPLATE = `# Planner preferences

Rowboat's morning planner reads this file before proposing anything.

## Your rules

<!-- Rules you set — by hand or via "don't suggest things like this".
     These always win. -->

## Learned

<!-- Rules Rowboat inferred from what you keep, run, and dismiss.
     Delete any you disagree with, or override them above. -->
`;

export type PlannerSignalKind = 'proposed' | 'dismissed' | 'taught' | 'ran' | 'kept';

export interface PlannerSignal {
    kind: PlannerSignalKind;
    /** The item's line text at the time of the signal. */
    itemText: string;
    key: string;
    at: string;
}

interface PlannerFeedback {
    signals: PlannerSignal[];
}

async function readFeedback(): Promise<PlannerFeedback> {
    try {
        const parsed: unknown = JSON.parse(await fs.readFile(FEEDBACK_PATH, 'utf-8'));
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as PlannerFeedback).signals)) {
            return parsed as PlannerFeedback;
        }
    } catch {
        // missing/corrupt — fresh ledger
    }
    return { signals: [] };
}

export async function recordPlannerSignal(kind: PlannerSignalKind, itemText: string): Promise<void> {
    await withFileLock(FEEDBACK_PATH, async () => {
        const feedback = await readFeedback();
        feedback.signals.push({ kind, itemText, key: normalizeKey(itemText), at: new Date().toISOString() });
        if (feedback.signals.length > MAX_SIGNALS) {
            feedback.signals = feedback.signals.slice(-MAX_SIGNALS);
        }
        const dir = path.dirname(FEEDBACK_PATH);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        await fs.writeFile(FEEDBACK_PATH, JSON.stringify(feedback, null, 2), 'utf-8');
    });
    log.log(`signal: ${kind} — "${itemText.slice(0, 60)}"`);
}

/** Sticky negative verdicts: keys the user dismissed and never later ran.
 * The propose tool refuses to re-propose these. */
export async function stickyDismissedKeys(): Promise<Set<string>> {
    const { signals } = await readFeedback();
    const verdict = new Map<string, PlannerSignalKind>();
    for (const s of signals) verdict.set(s.key, s.kind);
    const out = new Set<string>();
    for (const [key, kind] of verdict) {
        if (kind === 'dismissed' || kind === 'taught') out.add(key);
    }
    return out;
}

export async function ensurePreferencesFile(): Promise<void> {
    if (!fsSync.existsSync(PREFS_PATH)) {
        const dir = path.dirname(PREFS_PATH);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        await fs.writeFile(PREFS_PATH, PREFS_TEMPLATE, 'utf-8');
    }
}

/** Append a rule under "## Your rules" — the machine-untouchable section. */
export async function addYourRule(rule: string): Promise<void> {
    await withFileLock(PREFS_PATH, async () => {
        await ensurePreferencesFile();
        const raw = await fs.readFile(PREFS_PATH, 'utf-8');
        const lines = raw.split('\n');
        const yourIdx = lines.findIndex((l) => /^##\s+Your rules\s*$/i.test(l));
        const clean = `- ${rule.replace(/\s+/g, ' ').trim()}`;
        if (yourIdx === -1) {
            lines.push('', '## Your rules', '', clean);
        } else {
            // Insert before the next section header (or at end).
            let insertAt = lines.length;
            for (let i = yourIdx + 1; i < lines.length; i++) {
                if (/^##\s+/.test(lines[i])) { insertAt = i; break; }
            }
            // Skip back over trailing blanks so rules stay grouped.
            while (insertAt > yourIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--;
            lines.splice(insertAt, 0, clean);
        }
        await fs.writeFile(PREFS_PATH, lines.join('\n'), 'utf-8');
    });
    log.log(`your-rule added: "${rule.slice(0, 80)}"`);
}
