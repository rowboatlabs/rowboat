import fs from "fs";
import path from "path";
import { z } from "zod";
import { WorkDir } from "../config/config.js";

const ENABLED_TOOLS_FILE = path.join(WorkDir, 'data', 'composio', 'enabled_tools.json');

/**
 * Schema for an enabled Composio tool
 */
export const ZEnabledTool = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    toolkitSlug: z.string(),
    inputParameters: z.object({
        type: z.literal('object').optional().default('object'),
        properties: z.record(z.string(), z.unknown()).optional().default({}),
        required: z.array(z.string()).optional(),
    }).optional().default({ type: 'object', properties: {} }),
});

export type EnabledTool = z.infer<typeof ZEnabledTool>;

/**
 * Schema for the enabled tools storage file
 */
const ZEnabledToolsStorage = z.object({
    tools: z.record(z.string(), ZEnabledTool), // keyed by tool slug
});

type EnabledToolsStorage = z.infer<typeof ZEnabledToolsStorage>;

/**
 * Interface for Composio enabled tools repository
 */
export interface IComposioEnabledToolsRepo {
    getAll(): Record<string, EnabledTool>;
    getByToolkit(toolkitSlug: string): EnabledTool[];
    enable(tool: EnabledTool): void;
    enableBatch(tools: EnabledTool[]): void;
    disable(toolSlug: string): void;
    disableBatch(toolSlugs: string[]): void;
    disableAllForToolkit(toolkitSlug: string): void;
    isEnabled(toolSlug: string): boolean;
}

function ensureStorageDir(): void {
    const dir = path.dirname(ENABLED_TOOLS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadStorageFromDisk(): EnabledToolsStorage {
    try {
        if (fs.existsSync(ENABLED_TOOLS_FILE)) {
            const data = fs.readFileSync(ENABLED_TOOLS_FILE, 'utf-8');
            return ZEnabledToolsStorage.parse(JSON.parse(data));
        }
    } catch (error) {
        console.error('[ComposioEnabledTools] Failed to load storage:', error);
    }
    return { tools: {} };
}

function saveStorageToDisk(storage: EnabledToolsStorage): void {
    ensureStorageDir();
    fs.writeFileSync(ENABLED_TOOLS_FILE, JSON.stringify(storage, null, 2));
}

/**
 * Repository for managing enabled Composio tools.
 * Uses an in-memory cache loaded once from disk. Mutations write through to disk.
 */
export class ComposioEnabledToolsRepo implements IComposioEnabledToolsRepo {
    private cache: EnabledToolsStorage | null = null;

    private getStorage(): EnabledToolsStorage {
        if (!this.cache) {
            this.cache = loadStorageFromDisk();
        }
        return this.cache;
    }

    private persist(): void {
        if (this.cache) {
            saveStorageToDisk(this.cache);
        }
    }

    getAll(): Record<string, EnabledTool> {
        return this.getStorage().tools;
    }

    getByToolkit(toolkitSlug: string): EnabledTool[] {
        const storage = this.getStorage();
        return Object.values(storage.tools).filter(t => t.toolkitSlug === toolkitSlug);
    }

    enable(tool: EnabledTool): void {
        const storage = this.getStorage();
        storage.tools[tool.slug] = tool;
        this.persist();
    }

    enableBatch(tools: EnabledTool[]): void {
        const storage = this.getStorage();
        for (const tool of tools) {
            storage.tools[tool.slug] = tool;
        }
        this.persist();
    }

    disable(toolSlug: string): void {
        const storage = this.getStorage();
        delete storage.tools[toolSlug];
        this.persist();
    }

    disableBatch(toolSlugs: string[]): void {
        const storage = this.getStorage();
        for (const slug of toolSlugs) {
            delete storage.tools[slug];
        }
        this.persist();
    }

    disableAllForToolkit(toolkitSlug: string): void {
        const storage = this.getStorage();
        for (const [slug, tool] of Object.entries(storage.tools)) {
            if (tool.toolkitSlug === toolkitSlug) {
                delete storage.tools[slug];
            }
        }
        this.persist();
    }

    isEnabled(toolSlug: string): boolean {
        const storage = this.getStorage();
        return toolSlug in storage.tools;
    }
}

export const composioEnabledToolsRepo = new ComposioEnabledToolsRepo();
