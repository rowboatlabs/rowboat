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

function loadStorage(): EnabledToolsStorage {
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

function saveStorage(storage: EnabledToolsStorage): void {
    ensureStorageDir();
    fs.writeFileSync(ENABLED_TOOLS_FILE, JSON.stringify(storage, null, 2));
}

/**
 * Repository for managing enabled Composio tools
 */
export class ComposioEnabledToolsRepo implements IComposioEnabledToolsRepo {
    getAll(): Record<string, EnabledTool> {
        return loadStorage().tools;
    }

    getByToolkit(toolkitSlug: string): EnabledTool[] {
        const storage = loadStorage();
        return Object.values(storage.tools).filter(t => t.toolkitSlug === toolkitSlug);
    }

    enable(tool: EnabledTool): void {
        const storage = loadStorage();
        storage.tools[tool.slug] = tool;
        saveStorage(storage);
    }

    enableBatch(tools: EnabledTool[]): void {
        const storage = loadStorage();
        for (const tool of tools) {
            storage.tools[tool.slug] = tool;
        }
        saveStorage(storage);
    }

    disable(toolSlug: string): void {
        const storage = loadStorage();
        delete storage.tools[toolSlug];
        saveStorage(storage);
    }

    disableBatch(toolSlugs: string[]): void {
        const storage = loadStorage();
        for (const slug of toolSlugs) {
            delete storage.tools[slug];
        }
        saveStorage(storage);
    }

    disableAllForToolkit(toolkitSlug: string): void {
        const storage = loadStorage();
        for (const [slug, tool] of Object.entries(storage.tools)) {
            if (tool.toolkitSlug === toolkitSlug) {
                delete storage.tools[slug];
            }
        }
        saveStorage(storage);
    }

    isEnabled(toolSlug: string): boolean {
        const storage = loadStorage();
        return toolSlug in storage.tools;
    }
}

export const composioEnabledToolsRepo = new ComposioEnabledToolsRepo();
