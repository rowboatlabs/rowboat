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
//   proposed and what the user did with it. Few-shot examples derive from here.
// - `todo/sticky_dismissed.json` — uncapped negative verdicts. The recent
//   ledger may roll over; sticky dismissals must not.
// ---------------------------------------------------------------------------

const PREFS_PATH = path.join(WorkDir, 'todo', 'preferences.md');
export const PREFS_REL_PATH = 'todo/preferences.md';
const FEEDBACK_PATH = path.join(WorkDir, 'todo', 'planner_feedback.json');
export const FEEDBACK_REL_PATH = 'todo/planner_feedback.json';
const STICKY_PATH = path.join(WorkDir, 'todo', 'sticky_dismissed.json');
export const STICKY_REL_PATH = 'todo/sticky_dismissed.json';

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

type StickyKind = Extract<PlannerSignalKind, 'dismissed' | 'taught'>;

interface StickyDismissedEntry {
    itemText: string;
    kind: StickyKind;
    at: string;
}

type StickyDismissedStore = Record<string, StickyDismissedEntry>;

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

async function readStickyDismissed(): Promise<StickyDismissedStore> {
    try {
        const parsed: unknown = JSON.parse(await fs.readFile(STICKY_PATH, 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const out: StickyDismissedStore = {};
            for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
                if (!key || !value || typeof value !== 'object') continue;
                const entry = value as Partial<StickyDismissedEntry>;
                if (
                    typeof entry.itemText === 'string'
                    && (entry.kind === 'dismissed' || entry.kind === 'taught')
                    && typeof entry.at === 'string'
                ) {
                    out[key] = { itemText: entry.itemText, kind: entry.kind, at: entry.at };
                }
            }
            return out;
        }
    } catch {
        // missing/corrupt — fresh sticky store
    }
    return {};
}

async function writeStickyDismissed(store: StickyDismissedStore): Promise<void> {
    const dir = path.dirname(STICKY_PATH);
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
    await fs.writeFile(STICKY_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

export async function recordPlannerSignal(kind: PlannerSignalKind, itemText: string): Promise<void> {
    const key = normalizeKey(itemText);
    const at = new Date().toISOString();
    await withFileLock(FEEDBACK_PATH, async () => {
        const feedback = await readFeedback();
        feedback.signals.push({ kind, itemText, key, at });
        if (feedback.signals.length > MAX_SIGNALS) {
            feedback.signals = feedback.signals.slice(-MAX_SIGNALS);
        }
        const dir = path.dirname(FEEDBACK_PATH);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        await fs.writeFile(FEEDBACK_PATH, JSON.stringify(feedback, null, 2), 'utf-8');
    });
    if (kind === 'dismissed' || kind === 'taught' || kind === 'ran' || kind === 'kept') {
        await withFileLock(STICKY_PATH, async () => {
            const sticky = await readStickyDismissed();
            if (kind === 'dismissed' || kind === 'taught') {
                sticky[key] = { itemText, kind, at };
            } else {
                delete sticky[key];
            }
            await writeStickyDismissed(sticky);
        });
    }
    log.log(`signal: ${kind} — "${itemText.slice(0, 60)}"`);
}

/** Sticky negative verdicts: keys the user dismissed and never later ran.
 * The propose tool refuses to re-propose these. */
export async function stickyDismissedKeys(): Promise<Set<string>> {
    return new Set(Object.keys(await readStickyDismissed()));
}

// ---------------------------------------------------------------------------
// The suggestion tray — todo/suggestions.md. Proposals live HERE, outside
// the user's plan, until accepted: accepting is the act that turns a
// suggestion into an obligation (and the 'kept' signal); declining records
// 'dismissed'. The list itself never gets machine clutter.
// ---------------------------------------------------------------------------

const SUGGESTIONS_PATH = path.join(WorkDir, 'todo', 'suggestions.md');
export const SUGGESTIONS_REL_PATH = 'todo/suggestions.md';

const SUGGESTION_LINE_RE = /^- (.*\S)\s*$/;

export async function listSuggestions(): Promise<string[]> {
    try {
        const raw = await fs.readFile(SUGGESTIONS_PATH, 'utf-8');
        return raw.split('\n')
            .map((l) => SUGGESTION_LINE_RE.exec(l)?.[1]?.trim())
            .filter((t): t is string => !!t);
    } catch {
        return [];
    }
}

async function writeSuggestions(texts: string[]): Promise<void> {
    const dir = path.dirname(SUGGESTIONS_PATH);
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
    const body = texts.map((t) => `- ${t}`).join('\n');
    await fs.writeFile(SUGGESTIONS_PATH, body ? `${body}\n` : '', 'utf-8');
}

/** Add suggestions (deduped against the tray). Returns what was added. */
export async function addSuggestions(texts: string[]): Promise<string[]> {
    return withFileLock(SUGGESTIONS_PATH, async () => {
        const current = await listSuggestions();
        const have = new Set(current.map(normalizeKey));
        const added: string[] = [];
        for (const raw of texts) {
            const text = raw.replace(/\s+/g, ' ').trim();
            if (!text || have.has(normalizeKey(text))) continue;
            have.add(normalizeKey(text));
            current.push(text);
            added.push(text);
        }
        if (added.length > 0) await writeSuggestions(current);
        return added;
    });
}

/** Remove one suggestion from the tray. Returns its text when found. */
export async function takeSuggestion(text: string): Promise<string | null> {
    return withFileLock(SUGGESTIONS_PATH, async () => {
        const key = normalizeKey(text);
        const current = await listSuggestions();
        const idx = current.findIndex((t) => normalizeKey(t) === key);
        if (idx === -1) return null;
        const [taken] = current.splice(idx, 1);
        await writeSuggestions(current);
        return taken;
    });
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
