import path from "path";
import fs from "fs";
import { homedir } from "os";
import { fileURLToPath } from "url";

// Resolve app root relative to compiled file location (dist/...)
export const WorkDir = path.join(homedir(), ".rowboat");

// Get the directory of this file (for locating bundled assets)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureDirs() {
    const ensure = (p: string) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
    ensure(WorkDir);
    ensure(path.join(WorkDir, "agents"));
    ensure(path.join(WorkDir, "config"));
    ensure(path.join(WorkDir, "knowledge"));
}

function ensureDefaultConfigs() {
    // Create note_creation.json with default strictness if it doesn't exist
    const noteCreationConfig = path.join(WorkDir, "config", "note_creation.json");
    if (!fs.existsSync(noteCreationConfig)) {
        fs.writeFileSync(noteCreationConfig, JSON.stringify({
            strictness: "high",
            configured: false
        }, null, 2));
    }
}

// Welcome content inlined to work with bundled builds (esbuild changes __dirname)
const WELCOME_CONTENT = `# Welcome to Rowboat

This vault is your work memory.

Rowboat extracts context from your emails and meetings and turns it into long-lived, editable Markdown notes. The goal is not to store everything, but to preserve the context that stays useful over time.

---

## How it works

**Entity-based notes**
Notes represent people, projects, organizations, or topics that matter to your work.

**Auto-updating context**
As new emails and meetings come in, Rowboat adds decisions, commitments, and relevant context to the appropriate notes.

**Living notes**
These are not static summaries. Context accumulates over time, and notes evolve as your work evolves.

---

## Your AI coworker

Rowboat uses this shared memory to help with everyday work, such as:

- Drafting emails
- Preparing for meetings
- Summarizing the current state of a project
- Taking local actions when appropriate

The AI works with deep context, but you stay in control. All notes are visible, editable, and yours.

---

## Design principles

**Reduce noise**
Rowboat focuses on recurring contacts and active projects instead of trying to capture everything.

**Local and inspectable**
All data is stored locally as plain Markdown. You can read, edit, or delete any file at any time.

**Built to improve over time**
As you keep using Rowboat, context accumulates across notes instead of being reconstructed from scratch.

---

If something feels confusing or limiting, we'd love to hear about it.
Rowboat is still evolving, and your workflow matters.
`;

function ensureWelcomeFile() {
    // Create Welcome.md in knowledge directory if it doesn't exist
    const welcomeDest = path.join(WorkDir, "knowledge", "Welcome.md");
    if (!fs.existsSync(welcomeDest)) {
        fs.writeFileSync(welcomeDest, WELCOME_CONTENT);
    }
}

ensureDirs();
ensureDefaultConfigs();
ensureWelcomeFile();

// Initialize version history repo (async, fire-and-forget on startup)
import('../knowledge/version_history.js').then(m => m.initRepo()).catch(err => {
    console.error('[VersionHistory] Failed to init repo:', err);
});
