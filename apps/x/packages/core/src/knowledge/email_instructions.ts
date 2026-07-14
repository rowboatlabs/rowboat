import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';

/**
 * Free-text user instructions for the email classifier/drafter — the direct
 * channel alongside the learned feedback loops. Whatever the user writes here
 * is injected verbatim into every classification call (which also writes the
 * pre-drafted replies), so it steers importance, category, knowledge AND
 * draft tone in one place: "never draft replies to recruiters", "investor
 * updates are correspondence, not newsletters", "sign off with 'Cheers'".
 *
 * Stored as plain markdown so it's also editable directly on disk.
 */

const INSTRUCTIONS_PATH = path.join(WorkDir, 'config', 'email_instructions.md');
const MAX_LENGTH = 8000;

/**
 * First-run seed: a starter set of granular labels for real human mail, so
 * the user opens the instructions dialog to something concrete they can edit
 * or delete rather than an empty box. Must stay in sync with
 * DEFAULT_CUSTOM_LABELS in email_labels.ts — these lines are what the label
 * extractor would produce those labels from on the next save.
 */
export const DEFAULT_EMAIL_INSTRUCTIONS = [
    'Create a label "Investor" for emails from investors and VCs.',
    'Create a label "Candidate" for emails from job applicants and people interviewing with us.',
    'Create a label "Customer" for emails from paying customers and active pilots.',
].join('\n');

export function loadEmailInstructions(): string {
    try {
        return fs.readFileSync(INSTRUCTIONS_PATH, 'utf-8').trim();
    } catch {
        // First run: seed the file so the dialog opens populated. An existing
        // file — even one the user saved as empty — is never overwritten.
        try {
            const dir = path.dirname(INSTRUCTIONS_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(INSTRUCTIONS_PATH, DEFAULT_EMAIL_INSTRUCTIONS + '\n', { flag: 'wx' });
        } catch { /* raced or unwritable — fall through */ }
        return DEFAULT_EMAIL_INSTRUCTIONS;
    }
}

export function saveEmailInstructions(text: string): { ok: boolean; error?: string } {
    try {
        const dir = path.dirname(INSTRUCTIONS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(INSTRUCTIONS_PATH, text.slice(0, MAX_LENGTH).trim() + '\n');
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/** Render for injection into the classifier system prompt; null when empty. */
export function formatEmailInstructionsForPrompt(): string | null {
    const text = loadEmailInstructions();
    if (!text) return null;
    return [
        `# The user's standing instructions (highest priority — follow these over everything above)`,
        ``,
        `The user wrote these instructions for you directly. They govern importance, category, knowledge, and how drafts are written:`,
        ``,
        text,
    ].join('\n');
}
