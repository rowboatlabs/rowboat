import path from "path";
import fs from "fs";
import { homedir } from "os";
import { fileURLToPath } from "url";

function resolveWorkDir(): string {
    const configured = process.env.ROWBOAT_WORKDIR;
    if (!configured) {
        return path.join(homedir(), ".rowboat");
    }

    const expanded = configured === "~"
        ? homedir()
        : (configured.startsWith("~/") || configured.startsWith("~\\"))
            ? path.join(homedir(), configured.slice(2))
            : configured;

    return path.resolve(expanded);
}

// Resolve app root relative to compiled file location (dist/...)
// Allow override via ROWBOAT_WORKDIR env var for standalone pipeline usage.
// Normalize to an absolute path so workspace boundary checks behave consistently.
export const WorkDir = resolveWorkDir();

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
            strictness: "medium",
            configured: false
        }, null, 2));
    }
}

ensureDirs();
ensureDefaultConfigs();

// Ensure default knowledge files exist
import('../knowledge/ensure_daily_note.js').then(m => m.ensureDailyNote()).catch(err => {
    console.error('[DailyNote] Failed to ensure daily note:', err);
});

// Initialize version history repo (async, fire-and-forget on startup)
import('../knowledge/version_history.js').then(m => m.initRepo()).catch(err => {
    console.error('[VersionHistory] Failed to init repo:', err);
});
