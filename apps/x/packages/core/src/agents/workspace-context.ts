import fs from "fs";
import path from "path";
import { WorkDir } from "../config/config.js";
import { hasWorkspaceContext } from "./registry.js";

// Workspace context for agent assembly: agent notes (global) and the user's
// per-chat work directory. loadWorkspaceContext is THE chokepoint — the
// workspaceContext trait gate lives inside it, so no assembly site can
// forget the gate and leak the user's agent-memory into a non-workspace
// agent's prompt (or silently omit it for the copilot). Loaders extracted
// verbatim from the legacy runtime file.

const AGENT_NOTES_DIR = path.join(WorkDir, 'knowledge', 'Agent Notes');

// Work directory is scoped per run (per chat). Each run gets its own sidecar
// config file so setting it in one chat does not leak into others.
function workDirConfigFile(runId: string): string {
    return path.join(WorkDir, 'config', `workdir-${runId}.json`);
}

export function loadUserWorkDir(runId: string): string | null {
    try {
        const file = workDirConfigFile(runId);
        if (!fs.existsSync(file)) return null;
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw) as { path?: unknown };
        const value = typeof parsed.path === 'string' ? parsed.path.trim() : '';
        return value || null;
    } catch {
        return null;
    }
}

export function loadAgentNotesContext(): string | null {
    const sections: string[] = [];

    const userFile = path.join(AGENT_NOTES_DIR, 'user.md');
    const prefsFile = path.join(AGENT_NOTES_DIR, 'preferences.md');

    try {
        if (fs.existsSync(userFile)) {
            const content = fs.readFileSync(userFile, 'utf-8').trim();
            if (content) {
                sections.push(`## About the User\nThese are notes you took about the user in previous chats.\n\n${content}`);
            }
        }
    } catch { /* ignore */ }

    try {
        if (fs.existsSync(prefsFile)) {
            const content = fs.readFileSync(prefsFile, 'utf-8').trim();
            if (content) {
                sections.push(`## User Preferences\nThese are notes you took on their general preferences.\n\n${content}`);
            }
        }
    } catch { /* ignore */ }

    // List other Agent Notes files for on-demand access
    const otherFiles: string[] = [];
    const skipFiles = new Set(['user.md', 'preferences.md', 'inbox.md']);
    try {
        if (fs.existsSync(AGENT_NOTES_DIR)) {
            function listMdFiles(dir: string, prefix: string) {
                for (const entry of fs.readdirSync(dir)) {
                    const fullPath = path.join(dir, entry);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        listMdFiles(fullPath, `${prefix}${entry}/`);
                    } else if (entry.endsWith('.md') && !skipFiles.has(`${prefix}${entry}`)) {
                        otherFiles.push(`${prefix}${entry}`);
                    }
                }
            }
            listMdFiles(AGENT_NOTES_DIR, '');
        }
    } catch { /* ignore */ }

    if (otherFiles.length > 0) {
        sections.push(`## More Specific Preferences\nFor more specific preferences, you can read these files using file-readText. Only read them when relevant to the current task.\n\n${otherFiles.map(f => `- knowledge/Agent Notes/${f}`).join('\n')}`);
    }

    if (sections.length === 0) return null;
    return `# Agent Memory\n\n${sections.join('\n\n')}`;
}

export interface WorkspaceContext {
    agentNotesContext: string | null;
    userWorkDir: string | null;
}

const NO_WORKSPACE: WorkspaceContext = {
    agentNotesContext: null,
    userWorkDir: null,
};

// workDirKey is the per-chat work-directory sidecar key: the composition's
// workDirId on the turn runtime, the runId on the legacy engine.
export function loadWorkspaceContext(
    agentId: string | null | undefined,
    workDirKey: string | null | undefined,
    loaders: {
        loadNotes?: typeof loadAgentNotesContext;
        loadWorkDir?: typeof loadUserWorkDir;
    } = {},
): WorkspaceContext {
    if (!hasWorkspaceContext(agentId)) {
        return NO_WORKSPACE;
    }
    const loadNotes = loaders.loadNotes ?? loadAgentNotesContext;
    const loadWorkDir = loaders.loadWorkDir ?? loadUserWorkDir;
    return {
        agentNotesContext: loadNotes(),
        userWorkDir: workDirKey ? loadWorkDir(workDirKey) : null,
    };
}
