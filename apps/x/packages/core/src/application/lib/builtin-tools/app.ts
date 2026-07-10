// Builtin tools: app domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import container from "../../../di/container.js";
import * as files from "../../../filesystem/files.js";
import { WorkDir } from "../../../config/config.js";
import { RowboatAppManifestSchema } from "@x/shared/dist/rowboat-app.js";
import { listApps } from "../../../apps/indexer.js";
import { listImportantThreads, searchThreads } from "../../../knowledge/sync_gmail.js";
import { listTasks as listBackgroundTasks } from "../../../background-tasks/fileops.js";
import type { ISessions } from "../../../sessions/api.js";
import {
    BuiltinToolsSchema,
} from "./support.js";


export const appNavigationTools: z.infer<typeof BuiltinToolsSchema> = {
    'app-navigation': {
        description: 'Drive the Rowboat app UI: navigate to any view, read what a view contains (emails, background agents, chat history), open specific items (an email thread, a note, an agent, a past chat), filter/search the knowledge base, and manage saved views. Use it to SHOW the user things while telling them — navigation happens on their screen.',
        inputSchema: z.object({
            action: z.enum(["open-note", "open-view", "open-app", "read-view", "open-item", "update-base-view", "get-base-state", "create-base"]).describe("The navigation action to perform"),
            // open-note
            path: z.string().optional().describe("Knowledge file path for open-note, e.g. knowledge/People/John.md"),
            // open-app
            appId: z.string().optional().describe("App folder slug under ~/.rowboat/apps (for open-app) — opens the app in the middle pane."),
            // open-view / read-view
            view: z.enum(["home", "email", "meetings", "live-notes", "bg-tasks", "chat-history", "knowledge", "workspace", "code", "bases", "graph", "apps"]).optional().describe("Which view to open (open-view) or read (read-view; supported for read: email, bg-tasks, chat-history, apps)"),
            // read-view (email)
            query: z.string().optional().describe("For read-view on email: runs a LIVE Gmail search over the user's ENTIRE mailbox (not just synced mail) via the Gmail API. Supports full Gmail search operators: from:, to:, subject:, before:/after:, has:attachment, quoted phrases, OR, etc. Omit to list the latest important inbox threads."),
            limit: z.number().int().min(1).max(50).optional().describe("For read-view: max items to return (default 15)"),
            // open-item
            kind: z.enum(["email-thread", "note", "bg-task", "session"]).optional().describe("What to open (for open-item)"),
            threadId: z.string().optional().describe("Gmail thread id (open-item kind=email-thread; get it from read-view email)"),
            taskName: z.string().optional().describe("Background task/agent name (open-item kind=bg-task; get it from read-view bg-tasks)"),
            sessionId: z.string().optional().describe("Chat session id (open-item kind=session; get it from read-view chat-history)"),

            // update-base-view
            filters: z.object({
                set: z.array(z.object({ category: z.string(), value: z.string() })).optional().describe("Replace all filters with these"),
                add: z.array(z.object({ category: z.string(), value: z.string() })).optional().describe("Add these filters"),
                remove: z.array(z.object({ category: z.string(), value: z.string() })).optional().describe("Remove these filters"),
                clear: z.boolean().optional().describe("Clear all filters"),
            }).optional().describe("Filter modifications (for update-base-view)"),
            columns: z.object({
                set: z.array(z.string()).optional().describe("Replace visible columns with these"),
                add: z.array(z.string()).optional().describe("Add these columns"),
                remove: z.array(z.string()).optional().describe("Remove these columns"),
            }).optional().describe("Column modifications (for update-base-view)"),
            sort: z.object({
                field: z.string(),
                dir: z.enum(["asc", "desc"]),
            }).optional().describe("Sort configuration (for update-base-view)"),
            search: z.string().optional().describe("Search query to filter notes (for update-base-view)"),
            // get-base-state
            base_name: z.string().optional().describe("Name of a saved base to inspect (for get-base-state). Omit for the current/default view."),
            // create-base
            name: z.string().optional().describe("Name for the saved base view (for create-base)"),
        }),
        execute: async (input: {
            action: string;
            [key: string]: unknown;
        }) => {
            switch (input.action) {
                case 'open-note': {
                    const filePath = input.path as string;
                    try {
                        const result = await files.exists(filePath);
                        if (!result.exists) {
                            return { success: false, error: `File not found: ${filePath}` };
                        }
                        return { success: true, action: 'open-note', path: filePath };
                    } catch {
                        return { success: false, error: `Could not access file: ${filePath}` };
                    }
                }

                case 'open-view': {
                    const view = input.view as string;
                    return { success: true, action: 'open-view', view };
                }

                case 'open-app': {
                    const appId = input.appId as string;
                    if (!appId) return { success: false, error: 'open-app requires appId (the app folder slug)' };
                    let appName = appId;
                    try {
                        const raw = await fs.readFile(path.join(WorkDir, 'apps', appId, 'rowboat-app.json'), 'utf-8');
                        const m = JSON.parse(raw) as { name?: string };
                        if (m.name) appName = m.name;
                    } catch {
                        return { success: false, error: `App not found: ${appId}` };
                    }
                    return { success: true, action: 'open-app', appId, appName };
                }

                case 'read-view': {
                    // Returns the same data the view renders, so the assistant
                    // can answer precisely — and the renderer navigates to the
                    // view at the same time so the user SEES what's being read.
                    const view = input.view as string;
                    const limit = (input.limit as number | undefined) ?? 15;
                    try {
                        switch (view) {
                            case 'email': {
                                const query = (input.query as string | undefined)?.trim();
                                const result = query
                                    ? await searchThreads(query, { limit })
                                    : listImportantThreads({ limit });
                                const threads = (result.threads ?? []).slice(0, limit).map((t) => ({
                                    threadId: t.threadId,
                                    subject: t.subject ?? '(no subject)',
                                    from: t.from ?? '',
                                    date: t.date ?? '',
                                    unread: t.unread ?? false,
                                    summary: t.summary ? t.summary.slice(0, 200) : undefined,
                                }));
                                return { success: true, action: 'read-view', view, query, threads };
                            }
                            case 'bg-tasks': {
                                const { items } = await listBackgroundTasks({ limit });
                                const agents = items.map((t) => ({
                                    name: t.name,
                                    slug: t.slug,
                                    active: t.active,
                                    triggers: t.triggers,
                                    lastRunAt: t.lastRunAt,
                                    lastRunSummary: t.lastRunSummary ? t.lastRunSummary.slice(0, 200) : undefined,
                                    lastRunError: t.lastRunError ? t.lastRunError.slice(0, 200) : undefined,
                                }));
                                return { success: true, action: 'read-view', view, agents };
                            }
                            case 'chat-history': {
                                const sessions = container.resolve<ISessions>('sessions')
                                    .listSessions()
                                    .slice(0, limit)
                                    .map((s) => ({
                                        sessionId: s.sessionId,
                                        title: s.title ?? '(untitled)',
                                        updatedAt: s.updatedAt,
                                        turnCount: s.turnCount,
                                    }));
                                return { success: true, action: 'read-view', view, sessions };
                            }
                            case 'apps': {
                                // Installed/local Rowboat apps — the copilot uses this to
                                // route questions to an app's data (app-read-data) and to
                                // surface the app (open-app). Generic: apps are matched by
                                // their own name/description, nothing app-specific here.
                                const summaries = await listApps();
                                const apps = await Promise.all(summaries.slice(0, limit).map(async (a) => {
                                    let dataFiles: string[] = [];
                                    try {
                                        const entries = await fs.readdir(path.join(WorkDir, 'apps', a.folder, 'data'), { withFileTypes: true });
                                        dataFiles = entries.filter((e) => e.isFile()).map((e) => e.name).slice(0, 10);
                                    } catch { /* no data dir */ }
                                    return {
                                        folder: a.folder,
                                        name: a.manifest?.name ?? a.folder,
                                        description: a.manifest?.description ?? '',
                                        kind: a.kind,
                                        dataFiles,
                                        agentSlugs: a.agentSlugs,
                                    };
                                }));
                                return { success: true, action: 'read-view', view, apps };
                            }
                            default:
                                return {
                                    success: false,
                                    error: `read-view supports: email, bg-tasks, chat-history, apps. For notes/meetings/live-notes use the file-* tools (they are files under the workspace); for other views use open-view and describe what you need.`,
                                };
                        }
                    } catch (error) {
                        return {
                            success: false,
                            error: error instanceof Error ? error.message : `Failed to read ${view}`,
                        };
                    }
                }

                case 'open-item': {
                    const kind = input.kind as string;
                    switch (kind) {
                        case 'email-thread': {
                            const threadId = input.threadId as string | undefined;
                            if (!threadId) return { success: false, error: 'threadId is required for kind=email-thread' };
                            return { success: true, action: 'open-item', kind, threadId };
                        }
                        case 'note': {
                            const filePath = input.path as string | undefined;
                            if (!filePath) return { success: false, error: 'path is required for kind=note' };
                            const result = await files.exists(filePath);
                            if (!result.exists) return { success: false, error: `File not found: ${filePath}` };
                            return { success: true, action: 'open-item', kind, path: filePath };
                        }
                        case 'bg-task': {
                            const taskName = input.taskName as string | undefined;
                            if (!taskName) return { success: false, error: 'taskName is required for kind=bg-task' };
                            // Validate (and canonicalize) against the real task list.
                            const { items: tasks } = await listBackgroundTasks({});
                            const match = tasks.find(
                                (t) => t.name === taskName || t.slug === taskName
                                    || t.name.toLowerCase() === taskName.toLowerCase(),
                            );
                            if (!match) {
                                return {
                                    success: false,
                                    error: `No background task named "${taskName}". Known tasks: ${tasks.map((t) => t.name).join(', ') || '(none)'}`,
                                };
                            }
                            return { success: true, action: 'open-item', kind, taskName: match.name };
                        }
                        case 'session': {
                            const sessionId = input.sessionId as string | undefined;
                            if (!sessionId) return { success: false, error: 'sessionId is required for kind=session' };
                            return { success: true, action: 'open-item', kind, sessionId };
                        }
                        default:
                            return { success: false, error: `Unknown item kind: ${kind}` };
                    }
                }

                case 'update-base-view': {
                    const updates: Record<string, unknown> = {};
                    if (input.filters) updates.filters = input.filters;
                    if (input.columns) updates.columns = input.columns;
                    if (input.sort) updates.sort = input.sort;
                    if (input.search !== undefined) updates.search = input.search;
                    return { success: true, action: 'update-base-view', updates };
                }

                case 'get-base-state': {
                    // Scan knowledge/ files and extract frontmatter properties
                    try {
                        const { parseFrontmatter } = await import("@x/shared/dist/frontmatter.js");
                        const entries = await files.list("knowledge", { recursive: true, allowedExtensions: [".md"] });
                        const noteFiles = entries.filter(e => e.kind === 'file');
                        const properties = new Map<string, Set<string>>();
                        let noteCount = 0;

                        for (const file of noteFiles) {
                            try {
                                const result = await fs.readFile(file.resolvedPath, 'utf8');
                                const { fields } = parseFrontmatter(result);
                                noteCount++;
                                for (const [key, value] of Object.entries(fields)) {
                                    if (!value) continue;
                                    let set = properties.get(key);
                                    if (!set) { set = new Set(); properties.set(key, set); }
                                    const values = Array.isArray(value) ? value : [value];
                                    for (const v of values) {
                                        const trimmed = v.trim();
                                        if (trimmed) set.add(trimmed);
                                    }
                                }
                            } catch {
                                // skip unreadable files
                            }
                        }

                        const availableProperties: Record<string, string[]> = {};
                        for (const [key, values] of properties) {
                            availableProperties[key] = [...values].sort();
                        }

                        return {
                            success: true,
                            action: 'get-base-state',
                            noteCount,
                            availableProperties,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: error instanceof Error ? error.message : 'Failed to read knowledge base',
                        };
                    }
                }

                case 'create-base': {
                    const name = input.name as string;
                    const safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
                    if (!safeName) {
                        return { success: false, error: 'Invalid base name' };
                    }
                    const basePath = `bases/${safeName}.base`;
                    try {
                        const config = { name: safeName, filters: [], columns: [] };
                        await files.writeText(basePath, JSON.stringify(config, null, 2), { mkdirp: true });
                        return { success: true, action: 'create-base', name: safeName, path: basePath };
                    } catch (error) {
                        return {
                            success: false,
                            error: error instanceof Error ? error.message : 'Failed to create base',
                        };
                    }
                }

                default:
                    return { success: false, error: `Unknown action: ${input.action}` };
            }
        },
    },

    // ============================================================================
    // Web Search (Exa Search API)
    // ============================================================================,
};

// Cap what a data file read returns to the model — app data can be large
// (feeds, series); the copilot needs enough to answer, not the whole store.
const APP_READ_DATA_MAX_CHARS = 50_000;

export const appDataTools: z.infer<typeof BuiltinToolsSchema> = {
    'app-read-data': {
        description: "Read a Rowboat App's data file — the JSON its background agent maintains and its frontend renders. THE way to answer questions an installed app already tracks (fresh, no API calls): find the app via app-navigation read-view apps, read its data file, answer from it. Omit `file` to list the files under the app's data/.",
        inputSchema: z.object({
            appFolder: z.string().describe('The app folder slug under ~/.rowboat/apps.'),
            file: z.string().optional().describe("Path relative to the app's data/ directory, e.g. \"data.json\". Omit to list available files."),
        }),
        execute: async ({ appFolder, file }: { appFolder: string; file?: string }) => {
            try {
                const dir = path.join(WorkDir, 'apps', appFolder);
                try {
                    RowboatAppManifestSchema.parse(JSON.parse(await fs.readFile(path.join(dir, 'rowboat-app.json'), 'utf-8')));
                } catch {
                    return { success: false, error: `No app "${appFolder}" (missing or invalid rowboat-app.json).` };
                }
                const dataRoot = path.join(dir, 'data');

                if (!file) {
                    try {
                        const entries = await fs.readdir(dataRoot, { withFileTypes: true });
                        const files = await Promise.all(entries.filter((e) => e.isFile()).map(async (e) => {
                            const stat = await fs.stat(path.join(dataRoot, e.name)).catch(() => null);
                            return { file: e.name, size: stat?.size ?? 0, mtime: stat ? new Date(stat.mtimeMs).toISOString() : '' };
                        }));
                        return { success: true, appFolder, files };
                    } catch {
                        return { success: true, appFolder, files: [] };
                    }
                }

                // Same path confinement rules as app-set-data / the data API.
                const relNorm = path.posix.normalize(file).replace(/^\/+/, '');
                if (!relNorm || relNorm === '.' || relNorm.startsWith('..') || relNorm.includes('\0') || relNorm.includes('\\')) {
                    return { success: false, error: `invalid file path: ${file}` };
                }
                const abs = path.resolve(dataRoot, relNorm);
                if (abs !== dataRoot && !abs.startsWith(dataRoot + path.sep)) {
                    return { success: false, error: `file path escapes data/: ${file}` };
                }

                let text: string;
                try {
                    text = await fs.readFile(abs, 'utf-8');
                } catch {
                    return { success: false, error: `no such data file: ${relNorm} (omit \`file\` to list what exists)` };
                }
                const truncated = text.length > APP_READ_DATA_MAX_CHARS;
                if (truncated) text = text.slice(0, APP_READ_DATA_MAX_CHARS);
                // Parsed JSON is easiest for the model to reason over; fall back
                // to raw text for non-JSON (or truncated-mid-JSON) content.
                if (!truncated) {
                    try {
                        return { success: true, appFolder, file: relNorm, data: JSON.parse(text) as unknown };
                    } catch { /* not JSON — return as text */ }
                }
                return { success: true, appFolder, file: relNorm, text, ...(truncated ? { truncated: true } : {}) };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
    'app-set-data': {
        description: "Write a Rowboat App's data file — JSON its frontend reads via GET /_rowboat/data/<file>. Deterministic: you supply the content, code handles the path, atomicity (temp→rename), and the app's dataContracts validation. This is how a background task refreshes an app's data — the agent RETURNS the data; never hand-write files under apps/.",
        inputSchema: z.object({
            appFolder: z.string().describe('The app folder slug under ~/.rowboat/apps.'),
            file: z.string().describe("Path relative to the app's data/ directory, e.g. \"data.json\"."),
            data: z.unknown().describe('Full payload to store. Pass the object directly — do NOT JSON.stringify it.'),
        }),
        execute: async ({ appFolder, file, data }: { appFolder: string; file: string; data: unknown }) => {
            try {
                // #1 agent mistake: passing a stringified payload. Auto-parse
                // strings; reject anything that isn't an object/array.
                let payload: unknown = data;
                if (typeof payload === 'string') {
                    try { payload = JSON.parse(payload); }
                    catch { return { success: false, error: 'data must be a JSON object/array — pass the object directly, do NOT JSON.stringify it.' }; }
                }
                if (payload === null || typeof payload !== 'object') {
                    return { success: false, error: 'data must be a JSON object or array.' };
                }

                // The app must exist with a valid manifest — never create stray folders.
                const dir = path.join(WorkDir, 'apps', appFolder);
                let manifest: z.infer<typeof RowboatAppManifestSchema>;
                try {
                    manifest = RowboatAppManifestSchema.parse(JSON.parse(await fs.readFile(path.join(dir, 'rowboat-app.json'), 'utf-8')));
                } catch {
                    return { success: false, error: `No app "${appFolder}" (missing or invalid rowboat-app.json).` };
                }

                // Same path rules as the data API: confined to data/.
                const dataRoot = path.join(dir, 'data');
                const relNorm = path.posix.normalize(file).replace(/^\/+/, '');
                if (!relNorm || relNorm === '.' || relNorm.startsWith('..') || relNorm.includes('\0') || relNorm.includes('\\')) {
                    return { success: false, error: `invalid file path: ${file}` };
                }
                const abs = path.resolve(dataRoot, relNorm);
                if (abs !== dataRoot && !abs.startsWith(dataRoot + path.sep)) {
                    return { success: false, error: `file path escapes data/: ${file}` };
                }

                const contract = manifest.dataContracts.find((c) => path.posix.normalize(c.file) === relNorm);
                if (contract) {
                    if (Array.isArray(payload) && (contract.requiredKeys.length || contract.nonEmptyArrayKeys.length)) {
                        return { success: false, error: `${relNorm} must be a JSON object to satisfy its data contract. Keep the last good data — do not retry with a different shape.` };
                    }
                    if (!Array.isArray(payload)) {
                        const obj = payload as Record<string, unknown>;
                        const missing = contract.requiredKeys.filter((k) => obj[k] === undefined || obj[k] === null);
                        if (missing.length) {
                            return { success: false, error: `data is missing required key(s): ${missing.join(', ')}. Match the app's data shape and keep the last good data — do NOT retry with a different shape.` };
                        }
                        const badArrays = contract.nonEmptyArrayKeys.filter((k) => !Array.isArray(obj[k]) || (obj[k] as unknown[]).length === 0);
                        if (badArrays.length) {
                            return { success: false, error: `these key(s) must be non-empty arrays: ${badArrays.join(', ')}. Don't overwrite good series with empty ones — keep the last good data.` };
                        }
                    }
                }

                await fs.mkdir(path.dirname(abs), { recursive: true });
                const tmp = `${abs}.tmp-${Math.random().toString(16).slice(2, 10)}`;
                await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
                await fs.rename(tmp, abs);
                return { success: true, appFolder, file: relNorm };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
};
