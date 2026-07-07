import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { TriggersSchema, type BackgroundTask } from '@x/shared/dist/background-task.js';
import type { AppSummary } from '@x/shared/dist/rowboat-app.js';
import { WorkDir } from '../config/config.js';
import { getDefaultModelAndProvider } from '../models/defaults.js';
import { appDir, agentTaskSlug } from './indexer.js';

// Bundled background agents (spec §8). Definitions ship in the app package at
// agents/<name>.yaml and materialize as DISABLED bg-tasks with deterministic
// slugs (app--<folder>--<base>) owned by the app lifecycle via `sourceApp`.

const BG_TASKS_DIR = path.join(WorkDir, 'bg-tasks');

/**
 * Authorable subset of BackgroundTaskSchema (§8.1). strict() is REQUIRED:
 * packages must not smuggle state, `active`, or model overrides.
 */
export const AppAgentDefinitionSchema = z.object({
    name: z.string().min(1),
    instructions: z.string().min(1),
    triggers: TriggersSchema.optional(),
}).strict();

export type AppAgentDefinition = z.infer<typeof AppAgentDefinitionSchema>;

async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * Materialize one bundled agent as a bg-task (§8.3). New tasks start
 * `active: false`; an existing task keeps its `active`, runtime fields, and
 * history — only name/instructions/triggers are overwritten (§8.4).
 */
async function materializeAgent(folder: string, agentFile: string): Promise<string | null> {
    const defPath = path.join(appDir(folder), 'agents', agentFile);
    let def: AppAgentDefinition;
    try {
        const parsed = AppAgentDefinitionSchema.safeParse(parseYaml(await fs.readFile(defPath, 'utf-8')));
        if (!parsed.success) {
            console.warn(`[Apps] invalid agent definition ${folder}/agents/${agentFile}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
            return null;
        }
        def = parsed.data;
    } catch {
        return null; // listed in the manifest but file missing — indexer surfaces manifest truth
    }

    const slug = agentTaskSlug(folder, agentFile);
    const taskDir = path.join(BG_TASKS_DIR, slug);
    const taskYaml = path.join(taskDir, 'task.yaml');

    if (await pathExists(taskYaml)) {
        // Update path (§8.4): overwrite definition fields, preserve the rest.
        // Write ONLY when the definition actually changed — this sync runs on
        // every apps:list poll, and an unconditional rewrite races the bg
        // runner's own task.yaml patches mid-run (and spams watcher events).
        try {
            const current = parseYaml(await fs.readFile(taskYaml, 'utf-8')) as BackgroundTask;
            const next: BackgroundTask = {
                ...current,
                name: def.name,
                instructions: def.instructions,
                ...(def.triggers ? { triggers: def.triggers } : {}),
                sourceApp: folder,
            };
            if (!def.triggers) delete next.triggers;
            const unchanged =
                current.name === next.name &&
                current.instructions === next.instructions &&
                current.sourceApp === next.sourceApp &&
                JSON.stringify(current.triggers ?? null) === JSON.stringify(next.triggers ?? null);
            if (!unchanged) {
                await fs.writeFile(taskYaml, stringifyYaml(next), 'utf-8');
            }
        } catch (e) {
            console.warn(`[Apps] failed to update agent task ${slug}:`, e);
        }
        return slug;
    }

    const task: BackgroundTask = {
        name: def.name,
        instructions: def.instructions,
        ...(def.triggers ? { triggers: def.triggers } : {}),
        active: false, // bundled agents MUST start disabled (§8.3)
        sourceApp: folder,
        createdAt: new Date().toISOString(),
    };
    // Packages can't pin a model (§8.1 — the author's providers aren't the
    // installer's), but the bg-task category default is a lite model that
    // reliably mangles large tool payloads (invalid JSON → contract
    // rejections → the app never gets data). Pin the HOST's default model at
    // materialization instead — the installer's machine decides, exactly like
    // the copilot does for tasks it authors.
    try {
        const sel = await getDefaultModelAndProvider();
        task.model = sel.model;
        task.provider = sel.provider;
    } catch { /* no model config — leave the category default */ }
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(taskYaml, stringifyYaml(task), 'utf-8');
    await fs.writeFile(path.join(taskDir, 'index.md'), '', 'utf-8').catch(() => undefined);
    return slug;
}

/**
 * Sync all bundled agents for an app (idempotent; called after listing).
 * Tasks whose definition disappeared from the manifest are deactivated, not
 * deleted (§8.4).
 */
export async function syncAppAgents(app: AppSummary): Promise<void> {
    if (app.status !== 'ok' || !app.manifest) return;
    const wanted = new Set<string>();
    for (const agentFile of app.manifest.agents) {
        const slug = await materializeAgent(app.folder, agentFile);
        if (slug) wanted.add(slug);
    }

    // Deactivate app-owned tasks no longer in the manifest.
    let entries: string[] = [];
    try {
        entries = await fs.readdir(BG_TASKS_DIR);
    } catch {
        return;
    }
    const prefix = `app--${app.folder}--`;
    for (const slug of entries) {
        if (!slug.startsWith(prefix) || wanted.has(slug)) continue;
        const taskYaml = path.join(BG_TASKS_DIR, slug, 'task.yaml');
        try {
            const current = parseYaml(await fs.readFile(taskYaml, 'utf-8')) as BackgroundTask;
            if (current.sourceApp === app.folder && current.active) {
                await fs.writeFile(taskYaml, stringifyYaml({ ...current, active: false }), 'utf-8');
            }
        } catch { /* ignore */ }
    }
}

/** Delete all bg-tasks owned by an app (§8.5, uninstall path). */
export async function deleteAppAgents(folder: string): Promise<string[]> {
    let entries: string[] = [];
    try {
        entries = await fs.readdir(BG_TASKS_DIR);
    } catch {
        return [];
    }
    const deleted: string[] = [];
    const prefix = `app--${folder}--`;
    for (const slug of entries) {
        if (!slug.startsWith(prefix)) continue;
        await fs.rm(path.join(BG_TASKS_DIR, slug), { recursive: true, force: true });
        deleted.push(slug);
    }
    return deleted;
}
