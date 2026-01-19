import path from "path";
import fs from "fs";
import { homedir } from "os";

// Resolve app root relative to compiled file location (dist/...)
export const WorkDir = path.join(homedir(), ".rowboat");

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

ensureDirs();
ensureDefaultConfigs();