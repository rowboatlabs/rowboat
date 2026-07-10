// Builtin tools: browser domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import container from "../../../di/container.js";
import { BrowserControlInputSchema, type BrowserControlInput } from "@x/shared/dist/browser-control.js";
import { ensureLoaded as ensureBrowserSkillsLoaded, readSkillContent as readBrowserSkillContent, refreshFromRemote as refreshBrowserSkills } from "../../../application/browser-skills/index.js";
import type { ToolContext } from "../exec-tool.js";
import type { IBrowserControlService } from "../../../application/browser-control/service.js";
import { BuiltinToolsSchema } from "../types.js";


export const browserTools: z.infer<typeof BuiltinToolsSchema> = {
    'load-browser-skill': {
        description: 'Load a site-specific browser skill (from the browser-use/browser-harness domain-skills library) by id. Returns the full markdown content with selectors, gotchas, and recipes for the target site. Call this after browser-control responses surface a matching skill in suggestedSkills. Pass action="list" to see all available skills. Skills are fetched on first use and cached locally; pass action="refresh" to force an update from upstream.',
        inputSchema: z.object({
            action: z.enum(['load', 'list', 'refresh']).optional().describe('load: fetch a skill by id (default). list: list all cached skills. refresh: re-fetch the library from upstream.'),
            id: z.string().optional().describe('Skill id (e.g., "github/repo-actions") — required for load.'),
            site: z.string().optional().describe('Filter list results to a single site (e.g., "github").'),
        }),
        execute: async (input: { action?: 'load' | 'list' | 'refresh'; id?: string; site?: string }) => {
            const action = input.action ?? 'load';
            try {
                if (action === 'refresh') {
                    const index = await refreshBrowserSkills();
                    return {
                        success: true,
                        message: `Refreshed ${index.entries.length} skill${index.entries.length === 1 ? '' : 's'} from upstream.`,
                        count: index.entries.length,
                        treeSha: index.treeSha,
                    };
                }

                if (action === 'list') {
                    const status = await ensureBrowserSkillsLoaded();
                    if (status.status === 'error') {
                        return { success: false, error: status.error };
                    }
                    if (status.status === 'empty') {
                        return { success: false, error: 'No browser skills cached yet.' };
                    }
                    const entries = status.index.entries
                        .filter((e) => !input.site || e.site === input.site)
                        .map((e) => ({ id: e.id, title: e.title, site: e.site }));
                    return {
                        success: true,
                        count: entries.length,
                        skills: entries,
                        cacheAgeMs: Date.now() - status.index.fetchedAt,
                        refreshing: status.status === 'stale' ? status.refreshing : false,
                    };
                }

                if (!input.id) {
                    return { success: false, error: 'id is required for load.' };
                }
                const result = await readBrowserSkillContent(input.id);
                if (!result.ok) {
                    return { success: false, error: result.error };
                }
                return {
                    success: true,
                    id: result.entry.id,
                    title: result.entry.title,
                    site: result.entry.site,
                    path: result.entry.path,
                    content: result.content,
                };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : 'Failed to load browser skill.' };
            }
        },
    },

    // ============================================================================
    // Browser Control
    // ============================================================================,

    'browser-control': {
        description: 'Control the embedded browser pane. Read the current page, inspect indexed interactable elements, and navigate/click/type/press keys in the active browser tab.',
        inputSchema: BrowserControlInputSchema,
        isAvailable: async () => {
            try {
                container.resolve<IBrowserControlService>('browserControlService');
                return true;
            } catch {
                return false;
            }
        },
        execute: async (input: BrowserControlInput, ctx?: ToolContext) => {
            try {
                const browserControlService = container.resolve<IBrowserControlService>('browserControlService');
                return await browserControlService.execute(input, { signal: ctx?.signal });
            } catch (error) {
                return {
                    success: false,
                    action: input.action,
                    error: error instanceof Error ? error.message : 'Browser control is unavailable.',
                    browser: {
                        activeTabId: null,
                        tabs: [],
                    },
                };
            }
        },
    },

    // ============================================================================
    // App Navigation
    // ============================================================================,
};
