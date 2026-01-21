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

function ensureWelcomeFile() {
    // Copy welcome.md to knowledge directory if it doesn't exist
    const welcomeDest = path.join(WorkDir, "knowledge", "Welcome.md");
    if (!fs.existsSync(welcomeDest)) {
        // Look for welcome.md in the dist/knowledge directory (bundled with the package)
        // __dirname is dist/config, so we need to go up one level to find dist/knowledge
        const welcomeSrc = path.join(__dirname, "..", "knowledge", "welcome.md");
        if (fs.existsSync(welcomeSrc)) {
            fs.copyFileSync(welcomeSrc, welcomeDest);
        }
    }
}

ensureDirs();
ensureDefaultConfigs();
ensureWelcomeFile();